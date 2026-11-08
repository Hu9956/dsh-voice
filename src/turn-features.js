/**
 * smart-turn v3 的输入：Whisper 式 log-mel 特征（80 × 800）。
 * 照 pipecat 的 numpy 版（src/pipecat/audio/turn/smart_turn/_whisper_features.py，
 * 它又是照 transformers.WhisperFeatureExtractor 抄的）写成纯 JS：
 *
 *   取最后 8 秒（不够在前面补零）→ 整段零均值单位方差 → 两头各镜像补 200 点 →
 *   每 160 点一帧、400 点周期 Hann 窗、实数 DFT 取功率 → 80 个 Slaney mel 滤波器 →
 *   log10（下限 1e-10）→ 去掉最后一帧 → 低于最大值 8 的抬到 max-8 → (x+4)/4
 *
 * 400 点不是 2 的幂，直接做 DFT。前面补零的部分归一化后是常数，那些帧的频谱只算一次。
 */

export const SAMPLE_RATE = 16000
export const N_MELS = 80
export const N_FRAMES = 800
const N_FFT = 400
const HOP = 160
const N_BINS = N_FFT / 2 + 1
const N_SAMPLES = SAMPLE_RATE * 8
const MEL_FLOOR = 1e-10
const NORM_EPS = 1e-7

function hzToMel(f) {
  return f < 1000 ? (3 * f) / 200 : 15 + Math.log(f / 1000) * (27 / Math.log(6.4))
}

function melToHz(m) {
  return m < 15 ? (200 * m) / 3 : 1000 * Math.exp((Math.log(6.4) / 27) * (m - 15))
}

function linspace(a, b, n) {
  const out = new Float64Array(n)
  for (let i = 0; i < n; i++) out[i] = n === 1 ? a : a + ((b - a) * i) / (n - 1)
  return out
}

/** [mel][bin] 的 Slaney 归一化三角滤波器。 */
function buildMelFilters() {
  const melFreqs = linspace(hzToMel(0), hzToMel(SAMPLE_RATE / 2), N_MELS + 2)
  const filterFreqs = melFreqs.map(melToHz)
  const fftFreqs = linspace(0, Math.floor(SAMPLE_RATE / 2), N_BINS)
  const filters = new Float64Array(N_MELS * N_BINS)
  for (let m = 0; m < N_MELS; m++) {
    const lowDiff = filterFreqs[m + 1] - filterFreqs[m]
    const highDiff = filterFreqs[m + 2] - filterFreqs[m + 1]
    const enorm = 2 / (filterFreqs[m + 2] - filterFreqs[m])
    for (let k = 0; k < N_BINS; k++) {
      const down = -(filterFreqs[m] - fftFreqs[k]) / lowDiff
      const up = (filterFreqs[m + 2] - fftFreqs[k]) / highDiff
      filters[m * N_BINS + k] = Math.max(0, Math.min(down, up)) * enorm
    }
  }
  return filters
}

const MEL_FILTERS = buildMelFilters()
/** 周期 Hann 窗（np.hanning(401)[:-1]）。 */
const WINDOW = (() => {
  const w = new Float64Array(N_FFT)
  for (let n = 0; n < N_FFT; n++) w[n] = 0.5 - 0.5 * Math.cos((2 * Math.PI * n) / N_FFT)
  return w
})()
const COS = new Float64Array(N_FFT)
const SIN = new Float64Array(N_FFT)
for (let i = 0; i < N_FFT; i++) {
  COS[i] = Math.cos((2 * Math.PI * i) / N_FFT)
  SIN[i] = Math.sin((2 * Math.PI * i) / N_FFT)
}

/** 一帧（已加窗）的功率谱，写进 out[0..200]。 */
function power(frame, out) {
  for (let k = 0; k < N_BINS; k++) {
    let re = 0
    let im = 0
    let idx = 0
    for (let n = 0; n < N_FFT; n++) {
      const v = frame[n]
      re += v * COS[idx]
      im -= v * SIN[idx]
      idx += k
      if (idx >= N_FFT) idx -= N_FFT
    }
    out[k] = re * re + im * im
  }
}

/**
 * @param {Float32Array} audio 16 kHz 单声道
 * @returns {Float32Array} 80 × 800，按 [mel][帧] 排（模型要的 [1, 80, 800]）
 */
export function logMelFeatures(audio) {
  // 取最后 8 秒；不够在前面补零（smart-turn 的约定：语音靠在末尾）
  const x = new Float32Array(N_SAMPLES)
  const take = Math.min(audio.length, N_SAMPLES)
  const lead = N_SAMPLES - take
  x.set(audio.subarray(audio.length - take), lead)

  // 零均值单位方差（参考实现在 float32 里做）
  let sum = 0
  for (let i = 0; i < N_SAMPLES; i++) sum += x[i]
  const mean = sum / N_SAMPLES
  let sq = 0
  for (let i = 0; i < N_SAMPLES; i++) {
    const d = x[i] - mean
    sq += d * d
  }
  const std = Math.sqrt(sq / N_SAMPLES + NORM_EPS)
  for (let i = 0; i < N_SAMPLES; i++) x[i] = (x[i] - mean) / std

  const pad = N_FFT / 2
  const at = (i) => {
    // 镜像补齐（numpy reflect：不重复边上那个点）
    if (i < 0) return x[-i]
    if (i >= N_SAMPLES) return x[2 * N_SAMPLES - 2 - i]
    return x[i]
  }

  const frames = N_FRAMES + 1
  const spec = new Float64Array(frames * N_BINS)
  const frame = new Float64Array(N_FFT)
  const tmp = new Float64Array(N_BINS)
  let constant = null
  for (let t = 0; t < frames; t++) {
    const start = t * HOP - pad
    // 整帧都落在前面补零的那段（含镜像的部分）：归一化后是常数，频谱都一样
    const inLead = start + N_FFT - 1 < lead && pad < lead
    if (inLead && constant !== null) {
      spec.set(constant, t * N_BINS)
      continue
    }
    for (let n = 0; n < N_FFT; n++) frame[n] = at(start + n) * WINDOW[n]
    power(frame, tmp)
    spec.set(tmp, t * N_BINS)
    if (inLead) constant = tmp.slice()
  }

  // mel、log10，去掉最后一帧
  const out = new Float32Array(N_MELS * N_FRAMES)
  let max = -Infinity
  const logMel = new Float64Array(N_MELS * N_FRAMES)
  for (let m = 0; m < N_MELS; m++) {
    const row = m * N_BINS
    for (let t = 0; t < N_FRAMES; t++) {
      const base = t * N_BINS
      let v = 0
      for (let k = 0; k < N_BINS; k++) v += MEL_FILTERS[row + k] * spec[base + k]
      const l = Math.log10(Math.max(MEL_FLOOR, v))
      logMel[m * N_FRAMES + t] = l
      if (l > max) max = l
    }
  }
  const floor = max - 8
  for (let i = 0; i < logMel.length; i++) out[i] = (Math.max(logMel[i], floor) + 4) / 4
  return out
}
