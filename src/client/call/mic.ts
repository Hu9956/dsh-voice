/**
 * 通话的麦克风：整通电话只开一次，原始采样一块块交给 sink（通话状态机决定要不要）。
 *
 * - 播放上下文（AudioContext）必须在点「通话」的那一下里同步建好、resume，不然手机上会一直是 suspended。
 *   所以分两步：create() 在点按里同步调用；open() 之后再异步申请麦克风。
 * - 麦克风设备跟官方「语音输入」详情页里选的走（浏览器本地存储 dsh.voice-input.microphone），和按住说话一致。
 * - 开发自测：~/.config/dsh-voice/call-test.json 里列了录音时，不开麦克风，改成按实时速度
 *   把这些录音一段段喂进来（轮到你说时才放下一段），其余时间喂很小的底噪。夜里测试不用对着麦克风说话。
 */
import { decodeWav, resample } from './wav.ts'

const BASE = '/voice-reply'
/** 官方语音插件保存的麦克风选择；空字符串表示跟随系统默认。 */
const DEVICE_KEY = 'dsh.voice-input.microphone'
const PROCESSOR_SIZE = 2048
/** 自测：每次喂 20ms。 */
const CLIP_STEP_MS = 20

export interface MicSink {
  /** 一块原始采样（采样率 = Mic.sampleRate）。 */
  audio(samples: Float32Array): void
  /** 自测用：现在轮不轮到用户说（轮到才放下一段录音）。 */
  wantsAudio(): boolean
  /** 麦克风被系统或用户掐断了。 */
  lost(message: string): void
}

export class MicError extends Error {}

function selectedDevice(): string {
  try {
    const saved = JSON.parse(localStorage.getItem(DEVICE_KEY) ?? 'null') as { id?: unknown } | null
    return typeof saved?.id === 'string' ? saved.id : ''
  } catch {
    return ''
  }
}

interface CallTest {
  enabled: boolean
  clips: string[]
  gapMs: number
}

async function readCallTest(): Promise<CallTest> {
  try {
    const res = await fetch(`${BASE}/call/test`, { credentials: 'same-origin' })
    if (!res.ok) return { enabled: false, clips: [], gapMs: 1500 }
    const data = await res.json() as Partial<CallTest>
    return {
      enabled: data.enabled === true && Array.isArray(data.clips) && data.clips.length > 0,
      clips: Array.isArray(data.clips) ? data.clips.filter((c): c is string => typeof c === 'string') : [],
      gapMs: typeof data.gapMs === 'number' ? data.gapMs : 1500,
    }
  } catch {
    return { enabled: false, clips: [], gapMs: 1500 }
  }
}

export class Mic {
  readonly context: AudioContext
  private stream: MediaStream | undefined
  private nodes: AudioNode[] = []
  private timer: ReturnType<typeof setInterval> | undefined
  private closed = false
  /** 自测模式（用录音代替麦克风）。 */
  testMode = false

  private constructor(context: AudioContext) {
    this.context = context
  }

  /** 在点按里同步调用：建好采集用的 AudioContext 并 resume。建不了返回 undefined。 */
  static create(): Mic | undefined {
    let context: AudioContext
    try {
      context = new AudioContext()
    } catch {
      return undefined
    }
    void context.resume().catch(() => {})
    return new Mic(context)
  }

  get sampleRate(): number { return this.context.sampleRate }

  /** 申请麦克风（或进入自测）。首次使用会弹授权框。 */
  async open(sink: MicSink): Promise<void> {
    const test = await readCallTest()
    if (this.closed) return
    if (test.enabled) {
      this.testMode = true
      await this.openClips(sink, test)
      return
    }
    const devices = navigator.mediaDevices
    if (!devices?.getUserMedia) throw new MicError('这个浏览器不能录音（需要 HTTPS 或本机地址）')
    let stream: MediaStream
    try {
      const deviceId = selectedDevice()
      stream = await devices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          ...deviceId === '' ? {} : { deviceId: { exact: deviceId } },
        },
        video: false,
      })
    } catch (error) {
      if (error instanceof DOMException) {
        if (error.name === 'NotAllowedError') throw new MicError('麦克风权限被拒绝，请在浏览器或系统设置里允许')
        if (error.name === 'NotFoundError' || error.name === 'OverconstrainedError') throw new MicError('找不到选定的麦克风：请插好设备，或到「语音输入」详情页换一个')
      }
      throw new MicError(`打不开麦克风：${error instanceof Error ? error.message : String(error)}`)
    }
    if (this.closed) {
      stream.getTracks().forEach((track) => track.stop())
      return
    }
    this.stream = stream
    for (const track of stream.getTracks()) {
      track.addEventListener('ended', () => { if (!this.closed) sink.lost('麦克风断开了') })
    }
    const ctx = this.context
    const source = ctx.createMediaStreamSource(stream)
    // ScriptProcessor 老但到处能用；AudioWorklet 要单独的模块文件
    const processor = ctx.createScriptProcessor(PROCESSOR_SIZE, 1, 1)
    processor.onaudioprocess = (event) => {
      if (this.closed) return
      // getChannelData 返回的数组会被复用，要拷一份
      sink.audio(event.inputBuffer.getChannelData(0).slice())
    }
    // 处理节点要连到输出才会跑；中间接一个音量 0 的节点，免得把麦克风的声音放出来
    const mute = ctx.createGain()
    mute.gain.value = 0
    source.connect(processor)
    processor.connect(mute)
    mute.connect(ctx.destination)
    this.nodes = [source, processor, mute]
  }

  /**
   * 采集还在不在正常工作：AudioContext 在跑，麦克风轨道没结束、没被系统静音。
   * 锁屏后继续通话时据此判断系统有没有把麦克风停掉。
   */
  get healthy(): boolean {
    if (this.closed || this.context.state !== 'running') return false
    if (this.testMode) return true
    const tracks = this.stream?.getAudioTracks() ?? []
    return tracks.length > 0 && tracks.every((track) => track.readyState === 'live' && !track.muted)
  }

  /** 切回前台后恢复采集（手机上后台会把 AudioContext 挂起）。要在点按里调用才保证成功。 */
  resume(): void {
    if (this.context.state !== 'running' && this.context.state !== 'closed') void this.context.resume().catch(() => {})
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    clearInterval(this.timer)
    this.timer = undefined
    for (const node of this.nodes) {
      try { node.disconnect() } catch { /* 已经断了 */ }
    }
    this.nodes = []
    this.stream?.getTracks().forEach((track) => track.stop())
    this.stream = undefined
    void this.context.close().catch(() => {})
  }

  /** 自测：按实时速度喂录音。轮到用户说、隔了 gapMs 之后放下一段；其余时间喂很小的底噪。 */
  private async openClips(sink: MicSink, test: CallTest): Promise<void> {
    const rate = this.sampleRate
    const clips: Float32Array[] = []
    for (const name of test.clips) {
      const res = await fetch(`${BASE}/call/test?clip=${encodeURIComponent(name)}`, { credentials: 'same-origin' })
      if (!res.ok) throw new MicError(`自测录音读不到：${name}`)
      const decoded = decodeWav(new Uint8Array(await res.arrayBuffer()))
      if (decoded === null) throw new MicError(`自测录音格式不对（要 16 位 PCM WAV）：${name}`)
      // 前后各补 0.3 秒静音，像真的说话一样
      const body = resample(decoded.samples, decoded.sampleRate, rate)
      const pad = Math.round(rate * 0.3)
      const padded = new Float32Array(body.length + pad * 2)
      padded.set(body, pad)
      clips.push(padded)
    }
    if (this.closed) return
    let next = 0
    let current: Float32Array | undefined
    let offset = 0
    let wantedSince = -1
    let last = performance.now()
    let seed = 1
    const hiss = () => {
      seed = (seed * 16807) % 2147483647
      return ((seed / 2147483647) - 0.5) * 0.0006
    }
    this.timer = setInterval(() => {
      if (this.closed) return
      const now = performance.now()
      // 后台节流时一次补太多没意义，最多补 200ms
      const due = Math.min(Math.round((now - last) * rate / 1000), Math.round(rate * 0.2))
      last = now
      if (due <= 0) return
      if (current === undefined) {
        if (sink.wantsAudio()) {
          if (wantedSince < 0) wantedSince = now
          if (next < clips.length && now - wantedSince >= test.gapMs) {
            current = clips[next++]
            offset = 0
            wantedSince = -1
          }
        } else {
          wantedSince = -1
        }
      }
      const out = new Float32Array(due)
      for (let i = 0; i < due; i++) {
        if (current !== undefined && offset < current.length) out[i] = (current[offset++] ?? 0) + hiss()
        else out[i] = hiss()
      }
      if (current !== undefined && offset >= current.length) current = undefined
      sink.audio(out)
    }, CLIP_STEP_MS)
  }
}
