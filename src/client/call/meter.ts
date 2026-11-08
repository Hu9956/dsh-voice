/**
 * 通话胶囊的波浪和头像：音量换算、平滑、每个状态用哪路声音、什么颜色。
 * 纯函数，不碰 DOM，Node 里能直接测。
 */
import type { CallPhase } from './controller.ts'

/** 头像和波浪的几种样子。 */
export type Tone = 'listen' | 'think' | 'speak' | 'alert' | 'off'

/** 波浪跟哪路声音：麦克风、朗读、都不跟（缓慢流动或平线）。 */
export type Source = 'mic' | 'out' | 'idle' | 'none'

export function toneOf(phase: CallPhase): Tone {
  switch (phase) {
    case 'listening':
    case 'hearing':
      return 'listen'
    case 'transcribing':
    case 'thinking':
    case 'working':
      return 'think'
    case 'speaking':
      return 'speak'
    case 'needs-you':
      return 'alert'
    default:
      return 'off'
  }
}

/** 你说话时跟麦克风；它念的时候跟朗读（不看麦克风，免得回声把波浪带起来）。 */
export function sourceOf(tone: Tone): Source {
  if (tone === 'listen') return 'mic'
  if (tone === 'speak') return 'out'
  if (tone === 'think' || tone === 'alert') return 'idle'
  return 'none'
}

/**
 * 每个样子的三种颜色（波浪从左到右、头像柔光球的渐变）。CSS 变量和画布共用这一份。
 * 这是深色主题的；浅色主题有不同的写在 LIGHT_PALETTES 里，没写的两边一样。
 * 整体偏暖、偏柔和（不要科技感的冷色）：在听：奶桃色；在说：鼠尾草绿配奶黄；在想：淡紫配粉；需要你：琥珀。
 */
export const PALETTES: Record<Tone, readonly [string, string, string]> = {
  listen: ['#f6d9c4', '#f2b8a0', '#f9e6c8'],
  think: ['#d9c8f0', '#f3c6d8', '#cfe3f5'],
  speak: ['#b9dcc4', '#f0d9a8', '#a9d3d0'],
  alert: ['#f6c177', '#f4a261', '#f2998c'],
  off: ['#8b8b92', '#a1a1aa', '#8b8b92'],
}

/** 浅色主题：深色用的粉彩在白底上太淡，各加深一点（需要你、静音两边一样）。 */
export const LIGHT_PALETTES: Partial<Record<Tone, readonly [string, string, string]>> = {
  listen: ['#f0c4a6', '#ea9f84', '#f2d6a8'],
  think: ['#c9b6ec', '#eba9c4', '#a9cdea'],
  speak: ['#9fcfae', '#e6c987', '#8cc4c0'],
}

export function paletteOf(tone: Tone, dark: boolean): readonly [string, string, string] {
  return (dark ? undefined : LIGHT_PALETTES[tone]) ?? PALETTES[tone]
}

/** 不跟声音时的幅度（0–1）：在听时轻轻起伏，在想时慢慢流动，平线是 0。 */
export const IDLE_LEVEL: Record<Tone, number> = { listen: 0.06, think: 0.2, speak: 0.08, alert: 0.16, off: 0 }

/** 一段采样的均方根。 */
export function rms(samples: Float32Array): number {
  if (samples.length === 0) return 0
  let sum = 0
  for (let i = 0; i < samples.length; i++) {
    const v = samples[i]!
    sum += v * v
  }
  return Math.sqrt(sum / samples.length)
}

/** 均方根换成 0–1：-55 dB 以下算 0，-15 dB 以上算 1，中间按分贝线性。 */
export function levelOf(value: number): number {
  if (!(value > 0)) return 0
  const db = 20 * Math.log10(value)
  return Math.max(0, Math.min(1, (db + 55) / 40))
}

/** 波浪的目标幅度：跟声音时取声音和底幅里大的那个。 */
export function targetLevel(tone: Tone, levels: { mic: number, out: number }): number {
  const idle = IDLE_LEVEL[tone]
  const source = sourceOf(tone)
  if (source === 'mic') return Math.max(idle, levelOf(levels.mic))
  if (source === 'out') return Math.max(idle, levelOf(levels.out))
  return idle
}

/** 起得快、落得慢。dtMs 是距上一帧的毫秒数。 */
export function smooth(current: number, target: number, dtMs: number): number {
  const tau = target > current ? 60 : 260
  const k = 1 - Math.exp(-Math.max(0, dtMs) / tau)
  return current + (target - current) * k
}

/** '#rrggbb' → [r, g, b]；认不出来返回 undefined。 */
export function parseHex(hex: string): [number, number, number] | undefined {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim())
  if (m === null) return undefined
  const n = Number.parseInt(m[1]!, 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

/** 两种颜色按 t（0–1）混合。 */
export function mixRgb(a: readonly [number, number, number], b: readonly [number, number, number], t: number): [number, number, number] {
  const k = Math.max(0, Math.min(1, t))
  return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k]
}
