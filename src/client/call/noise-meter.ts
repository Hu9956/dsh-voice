/**
 * 设置页「测一下环境噪声」用的纯计算：记最近几秒的音量，估环境底噪，给出档位建议。
 *
 * 底噪取最近几秒音量的低分位（默认第 20 百分位），不跟断句的底噪估计走：
 * 断句在「当成你在说话」时不更新底噪，风扇声被误当成说话时它的读数会停住。
 *
 * 纯计算，不碰浏览器 API，Node 里能直接测。只用可擦除的 TypeScript 语法。
 */
import { suggestSensitivity, type Sensitivity } from './vad.ts'

export const SENSITIVITY_LABELS: Record<Sensitivity, string> = {
  lowest: '很低',
  low: '低',
  medium: '中',
  high: '高',
}

export class LevelHistory {
  private items: { db: number, ms: number }[] = []
  private totalMs = 0
  private windowMs: number
  private percentile: number

  constructor(windowMs = 3000, percentile = 0.2) {
    this.windowMs = windowMs
    this.percentile = percentile
  }

  /** 记一块音频的音量（dBFS）和时长（毫秒）。 */
  push(db: number, ms: number): void {
    if (!Number.isFinite(db) || !(ms > 0)) return
    this.items.push({ db, ms })
    this.totalMs += ms
    while (this.items.length > 1 && this.totalMs - this.items[0]!.ms >= this.windowMs) {
      this.totalMs -= this.items.shift()!.ms
    }
  }

  /** 记满多久了（毫秒，最多 windowMs）。 */
  get coveredMs(): number { return Math.min(this.totalMs, this.windowMs) }

  /** 估计的环境底噪：音量的低分位。还没数据时 null。 */
  floorDb(): number | null {
    if (this.items.length === 0) return null
    const sorted = this.items.map((i) => i.db).sort((a, b) => a - b)
    const at = Math.min(sorted.length - 1, Math.floor(sorted.length * this.percentile))
    return sorted[at]!
  }

  clear(): void {
    this.items = []
    this.totalMs = 0
  }
}

/** 按底噪给一句建议；current 是现在选的档。 */
export function adviceFor(noiseDb: number, current: string): string {
  const suggested = suggestSensitivity(noiseDb)
  if (suggested === null) return '环境太吵，很低档也不够用：说完点「说完了」，或戴耳机麦克风。'
  const label = SENSITIVITY_LABELS[suggested]
  if (current === suggested) return `现在的「${label}」档合适。`
  if (current === 'high' && suggested === 'medium') return '这个环境用「中」档就够；你说话轻、常听不到时再用「高」。'
  return `建议用「${label}」档。`
}
