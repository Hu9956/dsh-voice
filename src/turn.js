/**
 * smart-turn：听一句话的声音，判断说完了没有（停顿只是在想，还是真说完了）。
 *
 * 推理在工作线程里（turn-worker.js），第一次用时才启动，空闲一会儿自动退出。
 * 出任何错（文件缺、模型加载失败、超时）都抛给调用方，调用方退回按停顿时长判断。
 */
import { Worker } from 'node:worker_threads'

const IDLE_EXIT_MS = 120_000
const TIMEOUT_MS = 4000
/** 最多看最后 8 秒（模型就这么长）。 */
export const MAX_SAMPLES = 16000 * 8

export class SmartTurn {
  /** @param {{ idleMs?: number, timeoutMs?: number, workerUrl?: URL }} [options] */
  constructor(options = {}) {
    this.idleMs = options.idleMs ?? IDLE_EXIT_MS
    this.timeoutMs = options.timeoutMs ?? TIMEOUT_MS
    this.workerUrl = options.workerUrl ?? new URL('./turn-worker.js', import.meta.url)
    /** @type {Worker | undefined} */
    this.worker = undefined
    /** @type {Promise<void> | undefined} */
    this.ready = undefined
    this.nextId = 1
    /** @type {Map<number, { resolve: (p: number) => void, reject: (e: Error) => void, timer: ReturnType<typeof setTimeout> }>} */
    this.pending = new Map()
    this.idleTimer = undefined
  }

  /**
   * @param {Float32Array} samples 16 kHz 单声道，这一句到目前为止的声音
   * @returns {Promise<number>} 说完的概率 0–1
   */
  async predict(samples) {
    const tail = samples.length > MAX_SAMPLES ? samples.slice(samples.length - MAX_SAMPLES) : samples.slice()
    const worker = await this.start()
    clearTimeout(this.idleTimer)
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error('断句模型超时'))
        // 卡住的线程不要了，下次重新起
        this.stop()
      }, this.timeoutMs)
      this.pending.set(id, { resolve, reject, timer })
      worker.postMessage({ id, samples: tail }, [tail.buffer])
    })
  }

  /** @returns {Promise<Worker>} */
  async start() {
    if (this.worker !== undefined && this.ready !== undefined) {
      await this.ready
      return /** @type {Worker} */ (this.worker)
    }
    const worker = new Worker(this.workerUrl)
    this.worker = worker
    worker.unref()
    this.ready = new Promise((resolve, reject) => {
      const onFirst = (message) => {
        if (message?.ready === true) {
          worker.off('message', onFirst)
          resolve()
        }
      }
      worker.on('message', onFirst)
      worker.once('error', reject)
      worker.once('exit', (code) => reject(new Error(`断句模型没能启动（退出码 ${code}）`)))
    })
    worker.on('message', (message) => {
      if (typeof message?.id !== 'number') return
      const entry = this.pending.get(message.id)
      if (entry === undefined) return
      this.pending.delete(message.id)
      clearTimeout(entry.timer)
      if (typeof message.p === 'number') entry.resolve(message.p)
      else entry.reject(new Error(String(message.error ?? '断句模型出错')))
      if (this.pending.size === 0) this.scheduleIdle()
    })
    worker.on('error', (error) => this.failAll(error))
    worker.on('exit', () => {
      if (this.worker === worker) {
        this.worker = undefined
        this.ready = undefined
      }
      this.failAll(new Error('断句模型退出了'))
    })
    try {
      await this.ready
    } catch (error) {
      this.stop()
      throw error
    }
    return worker
  }

  scheduleIdle() {
    clearTimeout(this.idleTimer)
    this.idleTimer = setTimeout(() => this.stop(), this.idleMs)
    this.idleTimer.unref?.()
  }

  /** @param {unknown} error */
  failAll(error) {
    const e = error instanceof Error ? error : new Error(String(error))
    for (const [id, entry] of this.pending) {
      clearTimeout(entry.timer)
      entry.reject(e)
      this.pending.delete(id)
    }
  }

  stop() {
    clearTimeout(this.idleTimer)
    const worker = this.worker
    this.worker = undefined
    this.ready = undefined
    if (worker !== undefined) void worker.terminate().catch(() => {})
  }
}

/** 浏览器发来的 16 位 PCM（base64）转成 Float32。 */
export function pcm16ToFloat(base64) {
  const bytes = Buffer.from(base64, 'base64')
  const n = Math.floor(bytes.length / 2)
  const out = new Float32Array(n)
  for (let i = 0; i < n; i++) out[i] = bytes.readInt16LE(i * 2) / 32768
  return out
}
