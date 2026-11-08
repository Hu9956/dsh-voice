/**
 * 人声模型（Silero VAD）在浏览器里的入口：起一个模块 Worker（/voice-reply/vad/worker.js），
 * 把麦克风采样喂过去，收回每 32ms 一个「是人声」的概率。
 *
 * 加载失败、Worker 出错或太久没回概率时，probability() 返回 undefined，断句退回只看音量。
 * 只用可擦除的 TypeScript 语法。
 */
import type { VoiceEnv } from './controller.ts'

const BASE = '/voice-reply/vad'
/** 这么久没收到新概率，就当模型跟不上了，先只看音量。 */
const STALE_MS = 400

export type VoiceState = 'loading' | 'ready' | 'failed'

export class VoiceDetector implements VoiceEnv {
  private worker: Worker | undefined
  private state: VoiceState = 'loading'
  private prob = 0
  private lastAt = 0
  private lastPushAt = -Infinity
  private rate: number
  private now: () => number
  /** 加载失败的原因（调试用）。 */
  error = ''
  onFail: ((message: string) => void) | undefined

  constructor(sampleRate: number, version: string, now: () => number = () => performance.now()) {
    this.rate = sampleRate
    this.now = now
    try {
      const worker = new Worker(`${BASE}/worker.js`, { type: 'module', name: 'voice-reply-vad' })
      this.worker = worker
      worker.onmessage = (event: MessageEvent) => this.message(event.data)
      worker.onerror = (event) => this.fail(event.message || '人声模型的工作线程出错')
      worker.postMessage({ type: 'init', version })
    } catch (error) {
      this.fail(error instanceof Error ? error.message : String(error))
    }
  }

  get status(): VoiceState { return this.state }

  push(samples: Float32Array): void {
    if (this.state !== 'ready' || this.worker === undefined) return
    const now = this.now()
    // 停了一阵再接着听（朗读完、静音后）：新概率回来之前先当不是人声
    if (now - this.lastPushAt > STALE_MS) {
      this.prob = 0
      this.lastAt = now
    }
    this.lastPushAt = now
    const copy = samples.slice()
    this.worker.postMessage({ type: 'audio', samples: copy, rate: this.rate }, [copy.buffer])
  }

  probability(): number | undefined {
    if (this.state !== 'ready') return undefined
    if (this.now() - this.lastAt > STALE_MS) return undefined
    return this.prob
  }

  /** 丢掉模型状态。概率先当 0（不是人声），等新的算出来；免得重新开始听的头几十毫秒只看音量。 */
  reset(): void {
    this.prob = 0
    this.lastAt = this.now()
    this.worker?.postMessage({ type: 'reset' })
  }

  close(): void {
    this.worker?.terminate()
    this.worker = undefined
    if (this.state === 'loading') this.state = 'failed'
  }

  private message(data: unknown): void {
    const m = data as { type?: string, p?: unknown, message?: unknown } | null
    if (m?.type === 'ready') {
      if (this.state !== 'loading') return
      this.state = 'ready'
      this.prob = 0
      this.lastAt = this.now()
    } else if (m?.type === 'prob' && typeof m.p === 'number') {
      this.prob = m.p
      this.lastAt = this.now()
    } else if (m?.type === 'error') {
      this.fail(typeof m.message === 'string' ? m.message : '人声模型加载失败')
    }
  }

  private fail(message: string): void {
    if (this.state === 'failed') return
    this.state = 'failed'
    this.error = message
    this.worker?.terminate()
    this.worker = undefined
    console.warn('[voice-reply] 人声模型不可用，断句只看音量：', message)
    this.onFail?.(message)
  }
}
