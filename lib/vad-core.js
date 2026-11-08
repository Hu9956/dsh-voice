/**
 * 人声检测（Silero VAD v5）的计算部分：浏览器工作线程（vad-worker.js）和 Node 测试共用。
 *
 * - Downsampler：任意采样率的连续音频块转成 16 kHz，跨块连续（不会每块丢半个采样）。
 * - SileroStream：每 512 个采样（32ms）跑一次模型，给出「这段是人声」的概率 0–1。
 *   模型输入是前一窗最后 64 个采样 + 这一窗 512 个，外加 LSTM 状态 [2,1,128]。
 *
 * 不依赖浏览器或 Node 的 API；onnxruntime 由调用方传进来。
 */

export const VAD_RATE = 16000
export const WINDOW = 512
const CONTEXT = 64

/** 连续重采样到 16 kHz：降采样时把落进同一个输出采样的输入取平均，升采样用线性插值。 */
export class Downsampler {
  /** @param {number} fromRate */
  constructor(fromRate) {
    this.ratio = fromRate / VAD_RATE
    /** 还没用完的输入。 */
    this.buffer = new Float32Array(0)
    /** 下一个输出采样在 buffer 里的起点（可以是小数）。 */
    this.pos = 0
  }

  /** @param {Float32Array} samples @returns {Float32Array} */
  push(samples) {
    if (this.ratio === 1) return samples.slice()
    const joined = new Float32Array(this.buffer.length + samples.length)
    joined.set(this.buffer)
    joined.set(samples, this.buffer.length)
    const out = []
    const ratio = this.ratio
    let pos = this.pos
    if (ratio > 1) {
      while (pos + ratio <= joined.length) {
        const start = Math.floor(pos)
        const end = Math.max(start + 1, Math.floor(pos + ratio))
        let sum = 0
        for (let j = start; j < end; j++) sum += joined[j]
        out.push(sum / (end - start))
        pos += ratio
      }
    } else {
      while (Math.floor(pos) + 1 < joined.length) {
        const left = Math.floor(pos)
        const t = pos - left
        out.push(joined[left] * (1 - t) + joined[left + 1] * t)
        pos += ratio
      }
    }
    const drop = Math.floor(pos)
    this.buffer = joined.slice(drop)
    this.pos = pos - drop
    return Float32Array.from(out)
  }

  reset() {
    this.buffer = new Float32Array(0)
    this.pos = 0
  }
}

export class SileroStream {
  /**
   * @param {any} ort onnxruntime（web 或 node 版）
   * @param {any} session InferenceSession（模型 silero_vad.onnx）
   */
  constructor(ort, session) {
    this.ort = ort
    this.session = session
    this.sr = new ort.Tensor('int64', BigInt64Array.from([BigInt(VAD_RATE)]), [])
    this.reset()
  }

  reset() {
    this.state = new this.ort.Tensor('float32', new Float32Array(2 * 128), [2, 1, 128])
    this.context = new Float32Array(CONTEXT)
    this.pending = new Float32Array(0)
  }

  /**
   * 喂 16 kHz 采样；凑够一窗就跑一次。返回这次跑出的每一窗的概率（可能为空）。
   * @param {Float32Array} samples
   * @returns {Promise<number[]>}
   */
  async push(samples) {
    const joined = new Float32Array(this.pending.length + samples.length)
    joined.set(this.pending)
    joined.set(samples, this.pending.length)
    const probs = []
    let at = 0
    while (at + WINDOW <= joined.length) {
      const input = new Float32Array(CONTEXT + WINDOW)
      input.set(this.context)
      input.set(joined.subarray(at, at + WINDOW), CONTEXT)
      this.context = joined.slice(at + WINDOW - CONTEXT, at + WINDOW)
      const result = await this.session.run({
        input: new this.ort.Tensor('float32', input, [1, CONTEXT + WINDOW]),
        state: this.state,
        sr: this.sr,
      })
      this.state = result.stateN
      const p = Number(result.output.data[0])
      probs.push(Number.isFinite(p) ? p : 0)
      at += WINDOW
    }
    this.pending = joined.slice(at)
    return probs
  }
}
