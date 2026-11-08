/**
 * 浏览器端播放：每段朗读（Utterance）对应服务端一个 utterance，
 * 文字用 POST 发过去，音频从 GET /voice-reply/audio 分帧流回来，用 Web Audio 接着播。
 * 多段朗读按开始的先后排队播，不会叠在一起。
 *
 * 手机浏览器只在用户点按的那一下里允许创建或恢复播放（AudioContext）。
 * 语音模式开着时，页面上每次点按都顺手解锁（installUnlock）；
 * 声音被拦住（没点按过、来电或切到后台之后）超过一小会儿，blocked 变成 true，开关提示「轻点开启声音」。
 */

import { speechRate } from './settings'

const BASE = '/voice-reply'
const SAMPLE_RATE = 24000
/** 一段新声音开始前留一点余量，吸收网络抖动。 */
const LEAD_IN_S = 0.08
/** 声音被拦住超过这么久才提示，免得正常恢复的那一瞬间闪一下。 */
const BLOCKED_HINT_MS = 600
/** 回声判断看最近这么久念过的字。 */
const RECENT_MS = 30_000
/** 打断时朗读压到原来的多少。 */
const DUCK_GAIN = 0.25
const FRAME_PCM = 1
const FRAME_ERROR = 2
const FRAME_END = 3
/** 只有这些事件算用户手势：手指按下（pointerdown）不算，抬起才算。 */
const GESTURE_EVENTS = ['pointerup', 'touchend', 'click', 'keydown'] as const

/** 临时指定音色、模型（「试听」用），不改设置。 */
export interface OpenOptions {
  voice?: string
  model?: string
  /** 语速；不给就用设置里的（设置还没读到、或旧版服务端时不带，服务端用存着的）。 */
  speechRate?: number
}

async function post(path: string, body: unknown): Promise<void> {
  const res = await fetch(`${BASE}/${path}`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    let message = `HTTP ${res.status}`
    try {
      const data = await res.json() as { error?: unknown }
      if (typeof data.error === 'string') message = data.error
    } catch {
      // 不是 JSON 就用状态码
    }
    throw new Error(message)
  }
}

/** crypto.randomUUID 只在安全上下文里有（手机用局域网 http 访问时没有），退回 getRandomValues。 */
function newId(): string {
  if (typeof crypto.randomUUID === 'function' && window.isSecureContext) return crypto.randomUUID()
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

export class Utterance {
  readonly id = newId()
  /** 解码好、还没排进播放的声音。 */
  chunks: Float32Array[] = []
  /** 音频流结束了（念完、出错或取消）。 */
  ended = false
  cancelled = false
  private failed = false
  private finished = false
  private leftover: number | null = null
  private chain: Promise<void>
  private pendingText = ''
  private flushQueued = false
  private abort = new AbortController()

  constructor(readonly tag: string, private speaker: Speaker, options: OpenOptions = {}) {
    const rate = options.speechRate ?? speechRate()
    this.chain = post('open', { id: this.id, ...options, ...(rate === undefined ? {} : { speechRate: rate }) }).then(
      () => { this.listen() },
      (error: unknown) => { this.fail(error) },
    )
  }

  /** 追加要念的文字。连续多次调用会合并成一个请求。 */
  append(text: string): void {
    if (text === '' || this.cancelled || this.finished) return
    this.speaker.remember(text)
    this.pendingText += text
    if (this.flushQueued) return
    this.flushQueued = true
    this.step(async () => {
      this.flushQueued = false
      const text = this.pendingText
      this.pendingText = ''
      if (text !== '') await post('append', { id: this.id, text })
    })
  }

  /** 没有更多文字了。 */
  finish(): void {
    if (this.cancelled || this.finished) return
    this.finished = true
    this.step(() => post('finish', { id: this.id }))
  }

  cancel(): void {
    if (this.cancelled) return
    this.cancelled = true
    this.ended = true
    this.chunks = []
    this.abort.abort()
    // 排在 open 之后发，免得服务端还没建好就先收到 cancel
    this.chain = this.chain.then(() => post('cancel', { id: this.id })).catch(() => {})
  }

  private step(run: () => Promise<void>): void {
    this.chain = this.chain.then(async () => {
      if (this.failed || this.cancelled) return
      try {
        await run()
      } catch (error) {
        this.fail(error)
      }
    })
  }

  private fail(error: unknown): void {
    if (this.cancelled) return
    this.failed = true
    this.ended = true
    this.speaker.reportError(error instanceof Error ? error.message : String(error))
    this.speaker.pump()
  }

  private async listen(): Promise<void> {
    try {
      const res = await fetch(`${BASE}/audio?id=${encodeURIComponent(this.id)}`, {
        credentials: 'same-origin',
        signal: this.abort.signal,
      })
      if (!res.ok || res.body === null) throw new Error(`取音频失败：HTTP ${res.status}`)
      const reader = res.body.getReader()
      let buffer = new Uint8Array(0)
      for (;;) {
        const { value, done } = await reader.read()
        if (done) break
        const merged = new Uint8Array(buffer.length + value.length)
        merged.set(buffer)
        merged.set(value, buffer.length)
        buffer = merged
        let offset = 0
        while (buffer.length - offset >= 5) {
          const view = new DataView(buffer.buffer, buffer.byteOffset + offset)
          const type = view.getUint8(0)
          const length = view.getUint32(1)
          if (buffer.length - offset - 5 < length) break
          const payload = buffer.subarray(offset + 5, offset + 5 + length)
          offset += 5 + length
          if (type === FRAME_PCM) {
            this.pushPcm(payload)
          } else if (type === FRAME_ERROR) {
            let message = '语音合成出错'
            try {
              const data = JSON.parse(new TextDecoder().decode(payload)) as { message?: unknown }
              if (typeof data.message === 'string') message = data.message
            } catch {
              // 用默认文字
            }
            this.fail(new Error(message))
          } else if (type === FRAME_END) {
            // 结束帧之后服务端就关流了
          }
        }
        buffer = buffer.slice(offset)
      }
    } catch (error) {
      if (!this.cancelled) this.fail(error)
    } finally {
      this.ended = true
      this.speaker.pump()
    }
  }

  /** 16 位小端 PCM 转成 Float32；帧之间可能把一个采样拆开，留着拼下一帧。 */
  private pushPcm(bytes: Uint8Array): void {
    if (this.cancelled || bytes.length === 0) return
    let data = bytes
    if (this.leftover !== null) {
      const joined = new Uint8Array(bytes.length + 1)
      joined[0] = this.leftover
      joined.set(bytes, 1)
      data = joined
      this.leftover = null
    }
    const whole = data.length - (data.length % 2)
    if (whole < data.length) this.leftover = data[data.length - 1] ?? null
    const samples = new Float32Array(whole / 2)
    const view = new DataView(data.buffer, data.byteOffset, whole)
    for (let i = 0; i < samples.length; i++) samples[i] = view.getInt16(i * 2, true) / 32768
    if (samples.length === 0) return
    this.chunks.push(samples)
    this.speaker.clearError()
    this.speaker.pump()
  }
}

export class Speaker {
  /** 每次 stopAll 加一，跟读的人据此知道被打断了。 */
  stops = 0
  lastError: string | null = null
  /** 有声音在等着播，但浏览器还没允许出声（要用户点一下）。 */
  blocked = false
  private context: AudioContext | undefined
  private master: GainNode | undefined
  private analyser: AnalyserNode | undefined
  private meterBuffer: Float32Array<ArrayBuffer> | undefined
  private recent: { at: number, text: string }[] = []
  private queue: Utterance[] = []
  private playing = new Map<AudioBufferSourceNode, string>()
  private nextTime = 0
  private listeners = new Set<() => void>()
  private version = 0
  private unlockInstalled = false
  private blockedTimer: ReturnType<typeof setTimeout> | undefined

  /**
   * 开始一段朗读。tag 用来标记来源（比如哪条回复），按钮据此显示「正在念」。
   * options 临时指定音色、模型（试听用），不给就用设置里的。
   */
  start(tag: string, options?: OpenOptions): Utterance {
    const u = new Utterance(tag, this, options)
    this.queue.push(u)
    this.notify()
    return u
  }

  /** 把能播的声音排进时间线：排在最前的那段念完（流结束）才轮到下一段。 */
  pump(): void {
    while (this.queue.length > 0) {
      const head = this.queue[0]!
      if (head.cancelled) {
        this.queue.shift()
        continue
      }
      const ctx = this.ensureContext()
      if (ctx === undefined) {
        head.cancel()
        this.queue.shift()
        this.lastError = '这个浏览器不能播放声音'
        continue
      }
      for (const samples of head.chunks.splice(0)) this.schedule(ctx, samples, head.tag)
      if (!head.ended) break
      this.queue.shift()
    }
    this.notify()
  }

  private schedule(ctx: AudioContext, samples: Float32Array, tag: string): void {
    const buffer = ctx.createBuffer(1, samples.length, SAMPLE_RATE)
    buffer.getChannelData(0).set(samples)
    const source = ctx.createBufferSource()
    source.buffer = buffer
    source.connect(this.output(ctx))
    const now = ctx.currentTime
    const start = this.playing.size === 0 || this.nextTime < now ? now + LEAD_IN_S : this.nextTime
    source.start(start)
    this.nextTime = start + buffer.duration
    this.playing.set(source, tag)
    source.onended = () => {
      this.playing.delete(source)
      this.notify()
    }
  }

  private ensureContext(): AudioContext | undefined {
    if (this.context === undefined) {
      try {
        this.context = new AudioContext({ sampleRate: SAMPLE_RATE })
      } catch {
        try {
          this.context = new AudioContext()
        } catch {
          return undefined
        }
      }
      this.context.addEventListener('statechange', () => this.notify())
    }
    // 'suspended'，以及 Safari 来电、切后台之后的 'interrupted'，都试着恢复；不在点按里时可能失败，等下一次点按
    const state = this.context.state
    if (state !== 'running' && state !== 'closed') void this.context.resume().catch(() => {})
    return this.context
  }

  /**
   * 页面上每次点按都顺手解锁播放。听抬起类事件和按键（只有它们算用户手势）；
   * 解锁后不摘掉，来电、切后台被系统停掉之后，下一次点按还能恢复。
   * @param wanted 还没建过播放时要不要建：语音模式关着就不建，免得白白占用手机的声音通道。
   */
  installUnlock(wanted: () => boolean = () => true): () => void {
    if (this.unlockInstalled) return () => {}
    this.unlockInstalled = true
    const onGesture = () => {
      if (this.context === undefined && !wanted()) return
      if (this.context?.state === 'running') return
      this.unlock()
    }
    const onVisible = () => {
      if (document.visibilityState !== 'visible' || this.context === undefined) return
      if (this.context.state !== 'running') void this.context.resume().catch(() => {})
    }
    for (const type of GESTURE_EVENTS) window.addEventListener(type, onGesture, { capture: true, passive: true })
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      for (const type of GESTURE_EVENTS) window.removeEventListener(type, onGesture, { capture: true })
      document.removeEventListener('visibilitychange', onVisible)
      this.unlockInstalled = false
    }
  }

  /** 在用户点按里调用：创建或恢复播放，之后自动朗读才能出声。 */
  unlock(): void {
    const ctx = this.ensureContext()
    if (ctx === undefined || ctx.state === 'running') return
    // 老的 iPhone 要在点按里真的播一下才算解锁：播一个听不见的空样本
    try {
      const source = ctx.createBufferSource()
      source.buffer = ctx.createBuffer(1, 1, ctx.sampleRate)
      source.connect(ctx.destination)
      source.start()
    } catch {
      // 不影响正常播放
    }
  }

  /** 立刻停下所有朗读（正在播的和还在合成的）。 */
  stopAll(): void {
    this.stops++
    for (const u of this.queue) u.cancel()
    this.queue = []
    for (const source of this.playing.keys()) {
      source.onended = null
      try {
        source.stop()
      } catch {
        // 已经停了
      }
    }
    this.playing.clear()
    this.nextTime = 0
    this.notify()
  }

  /** 有没有在念（tag 不给就是任何一段）。还在合成、没出声的也算。 */
  isSpeaking(tag?: string): boolean {
    for (const u of this.queue) if (!u.cancelled && (tag === undefined || u.tag === tag)) return true
    for (const playingTag of this.playing.values()) if (tag === undefined || playingTag === tag) return true
    return false
  }

  /** 有没有 tag 以 prefix 开头的那一类在念（如自动朗读的 `turn:`）。 */
  isSpeakingPrefix(prefix: string): boolean {
    for (const u of this.queue) if (!u.cancelled && u.tag.startsWith(prefix)) return true
    for (const playingTag of this.playing.values()) if (playingTag.startsWith(prefix)) return true
    return false
  }

  /** 已经有声音排进播放了（不只是还在合成）。通话里思考音据此在第一句出声时停。 */
  /** 记一下念过的字（通话里判断麦克风录到的是不是朗读的回声）。 */
  remember(text: string): void {
    const now = Date.now()
    this.recent.push({ at: now, text })
    while (this.recent.length > 0 && now - this.recent[0]!.at > RECENT_MS) this.recent.shift()
  }

  /** 最近 RECENT_MS 里念过的字。 */
  recentText(): string {
    const now = Date.now()
    return this.recent.filter((r) => now - r.at <= RECENT_MS).map((r) => r.text).join('')
  }

  /** 通话里用户开口打断时，先把朗读压小；识别完再恢复或停掉。 */
  duck(on: boolean): void {
    const ctx = this.context
    const master = this.master
    if (ctx === undefined || master === undefined) return
    const target = on ? DUCK_GAIN : 1
    try {
      master.gain.cancelScheduledValues(ctx.currentTime)
      master.gain.setTargetAtTime(target, ctx.currentTime, 0.05)
    } catch {
      master.gain.value = target
    }
  }

  /** 所有朗读先经过这个音量节点（打断时压小），再经过分析节点（通话波浪看朗读音量）出声。 */
  private output(ctx: AudioContext): AudioNode {
    if (this.master === undefined || this.master.context !== ctx) {
      this.master = ctx.createGain()
      this.analyser = undefined
      try {
        const analyser = ctx.createAnalyser()
        analyser.fftSize = 1024
        this.master.connect(analyser)
        analyser.connect(ctx.destination)
        this.analyser = analyser
        this.meterBuffer = new Float32Array(analyser.fftSize)
      } catch {
        this.master.connect(ctx.destination)
      }
    }
    return this.master
  }

  /** 朗读输出现在的均方根（压小后的，就是你听到的）。没在出声是 0。 */
  outputRms(): number {
    const analyser = this.analyser
    const buffer = this.meterBuffer
    if (analyser === undefined || buffer === undefined || this.playing.size === 0) return 0
    analyser.getFloatTimeDomainData(buffer)
    let sum = 0
    for (let i = 0; i < buffer.length; i++) {
      const v = buffer[i]!
      sum += v * v
    }
    return Math.sqrt(sum / buffer.length)
  }

  isSounding(): boolean {
    return this.playing.size > 0
  }

  /** 播放还能不能出声：还没建过算能（第一次念时再建），建过就要在跑。不会创建或恢复。 */
  get playbackRunning(): boolean {
    return this.context === undefined || this.context.state === 'running'
  }

  /** 通话用：拿到（必要时创建）播放用的 AudioContext，提示音也用它播。要在点按里第一次调用。 */
  audioContext(): AudioContext | undefined {
    return this.ensureContext()
  }

  reportError(message: string): void {
    this.lastError = message
    this.notify()
  }

  clearError(): void {
    if (this.lastError === null) return
    this.lastError = null
    this.notify()
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  getVersion(): number {
    return this.version
  }

  private notify(): void {
    this.updateBlocked()
    this.version++
    for (const listener of this.listeners) listener()
  }

  /** 有声音在等、播放却没在运行：等一小会儿还没恢复，就提示用户点一下。 */
  private updateBlocked(): void {
    const waiting = this.context !== undefined && this.context.state !== 'running' && this.isSpeaking()
    if (!waiting) {
      clearTimeout(this.blockedTimer)
      this.blockedTimer = undefined
      this.blocked = false
      return
    }
    if (this.blocked || this.blockedTimer !== undefined) return
    this.blockedTimer = setTimeout(() => {
      this.blockedTimer = undefined
      if (this.context === undefined || this.context.state === 'running' || !this.isSpeaking()) return
      this.blocked = true
      this.version++
      for (const listener of this.listeners) listener()
    }, BLOCKED_HINT_MS)
  }

  dispose(): void {
    this.stopAll()
    clearTimeout(this.blockedTimer)
    this.blockedTimer = undefined
    void this.context?.close().catch(() => {})
    this.context = undefined
  }
}

export const speaker = new Speaker()
