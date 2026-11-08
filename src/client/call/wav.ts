/**
 * 把一句话的采样转成识别要的格式：16 kHz 单声道 PCM16 WAV，再转 base64。
 * 和 dsh-voice-hold 送给官方 speech Remote 的格式一样。
 *
 * 纯计算，Node 里能直接测。只用可擦除的 TypeScript 语法。
 */

export const TARGET_RATE = 16000

/**
 * 重采样到 16 kHz。降采样时把落进同一个输出采样的输入取平均（简单的低通，比直接抽点少些混叠）；
 * 升采样用线性插值。
 */
export function resample(samples: Float32Array, fromRate: number, toRate = TARGET_RATE): Float32Array {
  if (fromRate === toRate || samples.length === 0) return samples.slice()
  const ratio = fromRate / toRate
  const length = Math.max(1, Math.floor(samples.length / ratio))
  const out = new Float32Array(length)
  if (ratio > 1) {
    for (let i = 0; i < length; i++) {
      const start = Math.floor(i * ratio)
      const end = Math.min(samples.length, Math.max(start + 1, Math.floor((i + 1) * ratio)))
      let sum = 0
      for (let j = start; j < end; j++) sum += samples[j] ?? 0
      out[i] = sum / (end - start)
    }
    return out
  }
  for (let i = 0; i < length; i++) {
    const at = i * ratio
    const left = Math.floor(at)
    const right = Math.min(samples.length - 1, left + 1)
    const t = at - left
    out[i] = (samples[left] ?? 0) * (1 - t) + (samples[right] ?? 0) * t
  }
  return out
}

/** 16 位单声道 WAV。 */
export function encodeWav(samples: Float32Array, sampleRate = TARGET_RATE): Uint8Array {
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
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  text(36, 'data')
  view.setUint32(40, samples.length * 2, true)
  for (let i = 0; i < samples.length; i++) {
    const v = Math.max(-1, Math.min(1, samples[i] ?? 0))
    view.setInt16(44 + i * 2, v < 0 ? v * 0x8000 : v * 0x7fff, true)
  }
  return bytes
}

/** 裸 16 位小端 PCM（不带 WAV 头），给 smart-turn 用。 */
export function encodePcm16(samples: Float32Array): Uint8Array {
  const bytes = new Uint8Array(samples.length * 2)
  const view = new DataView(bytes.buffer)
  for (let i = 0; i < samples.length; i++) {
    const v = Math.max(-1, Math.min(1, samples[i] ?? 0))
    view.setInt16(i * 2, v < 0 ? v * 0x8000 : v * 0x7fff, true)
  }
  return bytes
}

/** 读 16 位单声道 PCM WAV（自测录音用）。返回采样和采样率；格式不对返回 null。 */
export function decodeWav(bytes: Uint8Array): { samples: Float32Array, sampleRate: number } | null {
  if (bytes.length < 44) return null
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const tag = (at: number) => String.fromCharCode(...bytes.subarray(at, at + 4))
  if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE') return null
  let offset = 12
  let sampleRate = 0
  let channels = 0
  let bits = 0
  while (offset + 8 <= bytes.length) {
    const id = tag(offset)
    const size = view.getUint32(offset + 4, true)
    const body = offset + 8
    if (id === 'fmt ') {
      channels = view.getUint16(body + 2, true)
      sampleRate = view.getUint32(body + 4, true)
      bits = view.getUint16(body + 14, true)
    } else if (id === 'data') {
      if (bits !== 16 || channels < 1 || sampleRate <= 0) return null
      const end = Math.min(bytes.length, body + size)
      const frames = Math.floor((end - body) / (2 * channels))
      const samples = new Float32Array(frames)
      for (let i = 0; i < frames; i++) samples[i] = view.getInt16(body + i * 2 * channels, true) / 32768
      return { samples, sampleRate }
    }
    offset = body + size + (size % 2)
  }
  return null
}

export function toBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}
