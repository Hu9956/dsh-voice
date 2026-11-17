/**
 * 语音变速不变调（流式 WSOLA：Waveform Similarity Overlap-Add）。
 *
 * 给服务端不支持调语速的 TTS（如 DeepSeek）在浏览器端把 24 kHz 单声道 PCM
 * 按 1.25× / 1.5× / 2× 缩短时长，同时保持声带基频（音调）不变。
 * 只用可擦除的 TypeScript 语法，Node 可以直接跑单元测试。
 */

/** 30 ms 帧长（24 kHz 下 720 采样），50% 汉宁窗重叠满足恒定相加（COLA = 1）。 */
const WIN = 720
const HOP = WIN / 2
/** ±10 ms 搜索半径（覆盖约 50 Hz 以上的基音周期）。 */
const SEARCH = 240
const COMPACT_THRESHOLD = 8192

const HANN = (() => {
  const w = new Float32Array(WIN)
  for (let i = 0; i < WIN; i++) {
    w[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / WIN))
  }
  return w
})()

export class TimeStretcher {
  readonly rate: number
  private buf = new Float32Array(0)
  private started = false
  private nominalPos = 0
  private readonly overlap = new Float32Array(HOP)
  private readonly naturalRef = new Float32Array(HOP)

  constructor(rate: number) {
    this.rate = Number.isFinite(rate) && rate > 0 ? rate : 1
  }

  private get passthrough(): boolean {
    return Math.abs(this.rate - 1) < 0.01
  }

  /** 喂入一段新的 PCM 采样，返回当前已经拼好、可以排进播放器的采样。 */
  push(samples: Float32Array): Float32Array {
    if (samples.length === 0) return new Float32Array(0)
    if (this.passthrough) return samples

    this.append(samples)
    const frames: Float32Array[] = []

    if (!this.started) {
      if (this.buf.length < WIN) return new Float32Array(0)
      frames.push(this.buf.slice(0, HOP))
      this.saveTail(0)
      this.started = true
      this.nominalPos = HOP * this.rate
    }

    for (;;) {
      const center = Math.round(this.nominalPos)
      const minPos = Math.max(0, center - SEARCH)
      const maxPos = center + SEARCH
      if (this.buf.length < maxPos + WIN) {
        this.compact(minPos)
        break
      }
      const best = this.findBestOffset(minPos, maxPos, center)
      frames.push(this.overlapFrame(best))
      this.saveTail(best)
      this.nominalPos += HOP * this.rate
    }

    return concatChunks(frames)
  }

  /** 音频流结束时把缓冲区里剩下的尾巴冲出来。 */
  flush(): Float32Array {
    if (this.passthrough) return new Float32Array(0)
    if (!this.started) {
      const rest = this.buf
      this.buf = new Float32Array(0)
      if (rest.length === 0) return new Float32Array(0)
      const outLen = Math.max(1, Math.round(rest.length / this.rate))
      const out = new Float32Array(outLen)
      for (let i = 0; i < outLen; i++) {
        out[i] = rest[Math.min(rest.length - 1, Math.floor(i * this.rate))]!
      }
      return out
    }

    const frames: Float32Array[] = []
    while (Math.round(this.nominalPos) + WIN <= this.buf.length) {
      const center = Math.round(this.nominalPos)
      const minPos = Math.max(0, center - SEARCH)
      const maxPos = Math.min(this.buf.length - WIN, center + SEARCH)
      const best = maxPos >= minPos ? this.findBestOffset(minPos, maxPos, center) : Math.max(0, this.buf.length - WIN)
      frames.push(this.overlapFrame(best))
      this.saveTail(best)
      this.nominalPos += HOP * this.rate
    }

    // overlap 本身已经乘过汉宁窗下降沿（从 1 平滑降到 0），直接放出即可无爆音收尾
    frames.push(this.overlap.slice())
    this.buf = new Float32Array(0)
    this.started = false
    this.nominalPos = 0
    return concatChunks(frames)
  }

  private append(samples: Float32Array): void {
    if (this.buf.length === 0) {
      this.buf = samples.slice()
      return
    }
    const merged = new Float32Array(this.buf.length + samples.length)
    merged.set(this.buf)
    merged.set(samples, this.buf.length)
    this.buf = merged
  }

  private compact(keepFrom: number): void {
    if (keepFrom < COMPACT_THRESHOLD || keepFrom <= 0) return
    const drop = Math.min(keepFrom, this.buf.length)
    this.buf = this.buf.slice(drop)
    this.nominalPos -= drop
  }

  private saveTail(pos: number): void {
    const start = pos + HOP
    for (let i = 0; i < HOP; i++) {
      const s = this.buf[start + i]!
      this.naturalRef[i] = s
      this.overlap[i] = s * HANN[HOP + i]!
    }
  }

  private overlapFrame(pos: number): Float32Array {
    const out = new Float32Array(HOP)
    for (let i = 0; i < HOP; i++) {
      out[i] = this.overlap[i]! + this.buf[pos + i]! * HANN[i]!
    }
    return out
  }

  private findBestOffset(minPos: number, maxPos: number, center: number): number {
    let refEnergy = 0
    for (let i = 0; i < HOP; i += 2) {
      const r = this.naturalRef[i]!
      refEnergy += r * r
    }
    if (refEnergy < 1e-8) return Math.min(maxPos, Math.max(minPos, center))

    let bestCoarse = center
    let bestScore = -Infinity
    for (let pos = minPos; pos <= maxPos; pos += 2) {
      let dot = 0
      let candEnergy = 0
      for (let i = 0; i < HOP; i += 2) {
        const r = this.naturalRef[i]!
        const c = this.buf[pos + i]!
        dot += r * c
        candEnergy += c * c
      }
      const norm = dot / Math.sqrt(refEnergy * candEnergy + 1e-12)
      const score = norm - 1e-4 * (Math.abs(pos - center) / SEARCH)
      if (score > bestScore) {
        bestScore = score
        bestCoarse = pos
      }
    }

    let fullRefEnergy = 0
    for (let i = 0; i < HOP; i++) {
      const r = this.naturalRef[i]!
      fullRefEnergy += r * r
    }
    let bestFine = bestCoarse
    let bestFineScore = -Infinity
    const fineStart = Math.max(minPos, bestCoarse - 2)
    const fineEnd = Math.min(maxPos, bestCoarse + 2)
    for (let pos = fineStart; pos <= fineEnd; pos++) {
      let dot = 0
      let candEnergy = 0
      for (let i = 0; i < HOP; i++) {
        const r = this.naturalRef[i]!
        const c = this.buf[pos + i]!
        dot += r * c
        candEnergy += c * c
      }
      const norm = dot / Math.sqrt(fullRefEnergy * candEnergy + 1e-12)
      const score = norm - 1e-4 * (Math.abs(pos - center) / SEARCH)
      if (score > bestFineScore) {
        bestFineScore = score
        bestFine = pos
      }
    }
    return bestFine
  }
}

function concatChunks(chunks: readonly Float32Array[]): Float32Array {
  if (chunks.length === 0) return new Float32Array(0)
  if (chunks.length === 1) return chunks[0]!
  let total = 0
  for (const c of chunks) total += c.length
  const out = new Float32Array(total)
  let offset = 0
  for (const c of chunks) {
    out.set(c, offset)
    offset += c.length
  }
  return out
}
