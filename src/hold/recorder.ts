/**
 * 一次录音：麦克风采集 + 停止后重采样成 Host 要的 16 kHz 单声道 PCM16 WAV。
 * 做法照搬官方 dsh-experimental-client-ui-voice-input 的 Recording（MediaRecorder 录、Web Audio 转），
 * 麦克风设备跟官方「语音输入」详情页里选的走（浏览器本地存储 dsh.voice-input.microphone）。
 */

/** 官方语音插件保存的麦克风选择；空字符串表示跟随系统默认。 */
const DEVICE_KEY = 'dsh.voice-input.microphone'

function selectedDevice(): string {
  try {
    const saved = JSON.parse(localStorage.getItem(DEVICE_KEY) ?? 'null') as { id?: unknown } | null
    return typeof saved?.id === 'string' ? saved.id : ''
  } catch {
    return ''
  }
}

export type RecordingFailure = 'unavailable' | 'permission' | 'deviceMissing' | 'interrupted' | 'empty' | 'cancelled'

export class RecordingError extends Error {
  constructor(readonly kind: RecordingFailure) {
    super(kind)
    this.name = 'RecordingError'
  }
}

export class Recording {
  private stream?: MediaStream
  private recorder?: MediaRecorder
  private context?: AudioContext
  private analyser?: AnalyserNode
  private samples = new Float32Array(256)
  private chunks: Blob[] = []
  private disposed = false

  /** 拿到麦克风并开始录。首次使用会弹授权框，这时 Promise 会一直等到用户点完。 */
  async start(onInterrupted: () => void): Promise<void> {
    const devices = navigator.mediaDevices
    if (!devices || typeof MediaRecorder === 'undefined') throw new RecordingError('unavailable')
    let stream: MediaStream
    try {
      const deviceId = selectedDevice()
      // 和官方一致：明确选了设备就只用它，不静默换成别的麦克风
      stream = await devices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, ...deviceId === '' ? {} : { deviceId: { exact: deviceId } } },
        video: false,
      })
    } catch (error) {
      if (error instanceof DOMException) {
        if (error.name === 'NotAllowedError') throw new RecordingError('permission')
        if (error.name === 'NotFoundError' || error.name === 'OverconstrainedError') throw new RecordingError('deviceMissing')
      }
      throw error
    }
    if (this.disposed) {
      stream.getTracks().forEach(track => track.stop())
      throw new RecordingError('cancelled')
    }
    this.stream = stream
    try {
      this.context = new AudioContext()
      this.analyser = this.context.createAnalyser()
      this.analyser.fftSize = this.samples.length
      this.context.createMediaStreamSource(stream).connect(this.analyser)
      for (const track of stream.getTracks()) {
        track.addEventListener('ended', () => { if (!this.disposed) onInterrupted() })
      }
      this.recorder = new MediaRecorder(stream)
      this.recorder.ondataavailable = (event) => {
        if (!this.disposed && event.data.size > 0) this.chunks.push(event.data)
      }
      this.recorder.onerror = () => { if (!this.disposed) onInterrupted() }
      this.recorder.start()
    } catch (error) {
      await this.dispose()
      throw error
    }
  }

  /** 当前音量（RMS），用来画声波。 */
  amplitude(): number {
    if (!this.analyser) return 0
    this.analyser.getFloatTimeDomainData(this.samples)
    let sum = 0
    for (const sample of this.samples) sum += sample * sample
    return Math.sqrt(sum / this.samples.length)
  }

  /** 停止录音，返回整段 WAV；超过 maxSeconds 的部分截掉。 */
  async stop(maxSeconds: number): Promise<Uint8Array> {
    const recorder = this.recorder
    const context = this.context
    if (!recorder || !context || recorder.state !== 'recording') {
      await this.dispose()
      throw new RecordingError('empty')
    }
    try {
      await new Promise<void>((resolve, reject) => {
        recorder.onstop = () => resolve()
        recorder.onerror = () => reject(new RecordingError('empty'))
        recorder.stop()
      })
      this.stream?.getTracks().forEach(track => track.stop())
      if (this.disposed) throw new RecordingError('cancelled')
      const blob = new Blob(this.chunks, { type: recorder.mimeType })
      if (blob.size === 0) throw new RecordingError('empty')
      const decoded = await context.decodeAudioData(await blob.arrayBuffer())
      const frames = Math.max(1, Math.floor(Math.min(decoded.duration, maxSeconds) * 16000))
      const offline = new OfflineAudioContext(1, frames, 16000)
      const source = offline.createBufferSource()
      source.buffer = decoded
      source.connect(offline.destination)
      source.start()
      const resampled = await offline.startRendering()
      return encodeWave(resampled.getChannelData(0))
    } finally {
      await this.dispose()
    }
  }

  /** 释放麦克风；授权框还没点完时调用，之后拿到的流会立刻关掉。 */
  async dispose(): Promise<void> {
    if (this.disposed) return
    this.disposed = true
    if (this.recorder?.state === 'recording') this.recorder.stop()
    this.stream?.getTracks().forEach(track => track.stop())
    this.stream = undefined
    const context = this.context
    this.context = undefined
    this.analyser = undefined
    this.chunks = []
    if (context && context.state !== 'closed') await context.close().catch(() => {})
  }
}

/** 16 kHz 单声道 PCM16 WAV。 */
function encodeWave(samples: Float32Array): Uint8Array {
  const bytes = new Uint8Array(44 + samples.length * 2)
  const view = new DataView(bytes.buffer)
  const text = (at: number, value: string) => {
    for (let i = 0; i < value.length; i++) bytes[at + i] = value.charCodeAt(i)
  }
  text(0, 'RIFF')
  view.setUint32(4, bytes.length - 8, true)
  text(8, 'WAVE')
  text(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, 16000, true)
  view.setUint32(28, 32000, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  text(36, 'data')
  view.setUint32(40, samples.length * 2, true)
  for (let i = 0; i < samples.length; i++) {
    const value = Math.max(-1, Math.min(1, samples[i]!))
    view.setInt16(44 + i * 2, Math.round(value * (value < 0 ? 32768 : 32767)), true)
  }
  return bytes
}

/** 给 JSON Remote 用的 base64（不带 data: 前缀）。 */
export function toBase64(bytes: Uint8Array): string {
  let text = ''
  for (let i = 0; i < bytes.length; i += 8192) text += String.fromCharCode(...bytes.subarray(i, i + 8192))
  return btoa(text)
}
