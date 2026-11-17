import { test } from 'node:test'
import assert from 'node:assert/strict'
import { TimeStretcher } from '../src/client/time-stretch.ts'

const SAMPLE_RATE = 24000

/** 生成一段纯正弦波（用来检验变速后基频有没有变尖、帧交界处有没有爆音跳变）。 */
function makeSine(freqHz: number, seconds: number, amplitude = 0.6): Float32Array {
  const total = Math.round(SAMPLE_RATE * seconds)
  const out = new Float32Array(total)
  for (let i = 0; i < total; i++) {
    out[i] = amplitude * Math.sin((2 * Math.PI * freqHz * i) / SAMPLE_RATE)
  }
  return out
}

/** 估算中间稳态段的基频（上升过零点计数）。 */
function estimateFreqHz(samples: Float32Array): number {
  const start = Math.floor(samples.length * 0.15)
  const end = Math.floor(samples.length * 0.85)
  let firstCross = -1
  let lastCross = -1
  let crossings = 0
  for (let i = start + 1; i < end; i++) {
    if (samples[i - 1]! <= 0 && samples[i]! > 0) {
      if (firstCross < 0) firstCross = i
      lastCross = i
      crossings++
    }
  }
  if (crossings < 2 || lastCross <= firstCross) return 0
  const periods = crossings - 1
  return (periods * SAMPLE_RATE) / (lastCross - firstCross)
}

test('TimeStretcher：1× 原速直通，不缓冲也不改采样', () => {
  const stretcher = new TimeStretcher(1)
  const input = makeSine(220, 0.2)
  const out = stretcher.push(input)
  assert.equal(out.length, input.length)
  assert.deepEqual(out, input)
  assert.equal(stretcher.flush().length, 0)
})

test('TimeStretcher：1.25× / 1.5× / 2× 按碎块流式喂入，时长准确且音调（基频）不变、无爆音跳变', () => {
  const freq = 220
  const input = makeSine(freq, 1.5)
  for (const rate of [1.25, 1.5, 2]) {
    const stretcher = new TimeStretcher(rate)
    const pieces: Float32Array[] = []
    // 故意按不整除帧长的 113 采样碎块流式推入，模拟网络流分帧
    for (let at = 0; at < input.length; at += 113) {
      const chunk = stretcher.push(input.subarray(at, Math.min(input.length, at + 113)))
      if (chunk.length > 0) pieces.push(chunk)
    }
    const tail = stretcher.flush()
    if (tail.length > 0) pieces.push(tail)

    const total = pieces.reduce((sum, p) => sum + p.length, 0)
    const output = new Float32Array(total)
    let offset = 0
    for (const p of pieces) {
      output.set(p, offset)
      offset += p.length
    }

    const expectedLen = input.length / rate
    const lenRatio = output.length / expectedLen
    assert.ok(lenRatio > 0.96 && lenRatio < 1.04, `rate=${rate} 输出长度比例应在 1±0.04 内，实际 ${lenRatio.toFixed(4)}`)

    const measuredHz = estimateFreqHz(output)
    assert.ok(Math.abs(measuredHz - freq) < 4, `rate=${rate} 基频应保持 ${freq}Hz 左右，实际 ${measuredHz.toFixed(2)}Hz`)

    // 相邻采样最大斜率：220Hz 振幅 0.6 在 24kHz 下单步理论差约 0.035，若有错相硬拼接会出现 >0.2 的爆音尖峰
    const steadyEnd = output.length - 400
    let maxStep = 0
    for (let i = 1; i < steadyEnd; i++) {
      const step = Math.abs(output[i]! - output[i - 1]!)
      if (step > maxStep) maxStep = step
    }
    assert.ok(maxStep < 0.09, `rate=${rate} 稳态段不应有拼接爆音跳变，maxStep=${maxStep.toFixed(4)}`)
  }
})

test('TimeStretcher：极短音频（不足一帧 30ms）也能安全 flush 出来', () => {
  const stretcher = new TimeStretcher(1.5)
  const short = makeSine(220, 0.01) // 240 samples < 720
  assert.equal(stretcher.push(short).length, 0)
  const flushed = stretcher.flush()
  assert.equal(flushed.length, 160)
  assert.equal(stretcher.flush().length, 0)
})
