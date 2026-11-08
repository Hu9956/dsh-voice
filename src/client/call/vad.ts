/**
 * 通话断句：按音量判断「开始说话」和「说完了」，不用模型。
 *
 * - 每 20ms 一帧算音量（dBFS）。没在说话时，慢慢跟踪环境底噪（变吵慢慢升，变静很快降）。
 * - 音量比底噪高出一截（有上下限）且连续几帧，算开始说话；说话中用低一点的门限判断还在说（迟滞，免得句中轻声被切断）。
 * - 说话后连续静音超过 silenceMs，算这句说完，交出整段音频（带开头前的一小段，免得吞掉第一个字）。
 * - 不到 minSpeechMs 的声音（咳嗽、敲桌子）丢掉；超过 maxSpeechMs 直接截断交出。
 *
 * 纯计算，不碰浏览器 API，Node 里能直接测。只用可擦除的 TypeScript 语法。
 */

export interface VadOptions {
  sampleRate: number
  /** 一帧多长（毫秒）。 */
  frameMs?: number
  /** 停顿多久算说完。 */
  silenceMs?: number
  /** 至少说这么久才算一句。 */
  minSpeechMs?: number
  /** 一句最长多久，到了就截断交出。 */
  maxSpeechMs?: number
  /** 开头往前多留多少音频。 */
  preRollMs?: number
  /** 连续这么多帧够响才算开口。 */
  onsetFrames?: number
  /** 比底噪高出多少分贝算说话。 */
  marginDb?: number
  /** 说话门限的下限、上限（dBFS）。 */
  minThresholdDb?: number
  maxThresholdDb?: number
  /** 说话中，门限降低多少分贝（迟滞）。 */
  holdDb?: number
  /** 停顿这么久先问一次「说完了没有」（smart-turn），0 表示不问。要比 silenceMs 短才有用。 */
  checkMs?: number
  /** 停顿中要连续这么多帧够响，才算又开口（短促的响声不算）。 */
  resumeFrames?: number
}

export type VadEvent =
  | { kind: 'start' }
  /** 一句说完：这句话的原始采样（浮点，采样率同输入），以及说了多久。 */
  | { kind: 'end', samples: Float32Array, speechMs: number, forced: boolean }
  /** 太短，丢掉。 */
  | { kind: 'discard', speechMs: number }
  /**
   * 说话中停顿了 checkMs：到目前为止的音频。外面判断说完了，就调 finishIf(token) 提前结束；
   * 在那之前又开口、或者这句已经结束，token 就作废。
   */
  | { kind: 'pause', samples: Float32Array, token: number }

const DEFAULTS = {
  frameMs: 20,
  silenceMs: 1200,
  minSpeechMs: 400,
  maxSpeechMs: 30_000,
  preRollMs: 300,
  onsetFrames: 3,
  marginDb: 12,
  minThresholdDb: -50,
  maxThresholdDb: -28,
  holdDb: 4,
  checkMs: 0,
  resumeFrames: 3,
}

/**
 * 收音灵敏度：声音比底噪高多少才算在说话，门限最低、最高到多少。中档就是 DEFAULTS。
 * 门限上限也跟着档位走：底噪大（风扇、空调）时，上限太低会把门限压到离底噪只差几分贝，底噪一波动就当成还在说。
 */
export type Sensitivity = 'lowest' | 'low' | 'medium' | 'high'
export interface SensitivityPreset { marginDb: number, minThresholdDb: number, maxThresholdDb: number }
export const SENSITIVITY: Record<Sensitivity, SensitivityPreset> = {
  lowest: { marginDb: 24, minThresholdDb: -38, maxThresholdDb: -18 },
  low: { marginDb: 18, minThresholdDb: -44, maxThresholdDb: -24 },
  medium: { marginDb: 12, minThresholdDb: -50, maxThresholdDb: -28 },
  high: { marginDb: 8, minThresholdDb: -54, maxThresholdDb: -28 },
}

/** 某档在这个底噪下的说话门限（dBFS）。 */
export function thresholdFor(level: Sensitivity, noiseDb: number): number {
  const p = SENSITIVITY[level]
  return Math.min(p.maxThresholdDb, Math.max(p.minThresholdDb, noiseDb + p.marginDb))
}

/** 说话中（门限降了 holdDb）门限比底噪高多少：太小的话底噪一波动就当成还在说，这句结束不了。 */
export function holdGapDb(level: Sensitivity, noiseDb: number): number {
  return thresholdFor(level, noiseDb) - DEFAULTS.holdDb - noiseDb
}

/** 说话中门限至少要比底噪高这么多，才算这档在这个环境里能用。 */
export const MIN_HOLD_GAP_DB = 8

/**
 * 按底噪建议档位：中、低、很低里挑最灵敏、又够用的那档（高档只给说话轻的人，不主动建议）。
 * 很低也不够时返回 null：只能靠「说完了」按钮或戴耳机。
 */
export function suggestSensitivity(noiseDb: number): Sensitivity | null {
  for (const level of ['medium', 'low', 'lowest'] as const) {
    if (holdGapDb(level, noiseDb) >= MIN_HOLD_GAP_DB) return level
  }
  return null
}

/** 人声概率到这么高才算开口；说话中降到这么低才算停（Silero 官方的默认门限和迟滞）。 */
export const VOICE_ONSET = 0.5
export const VOICE_HOLD = 0.35
/**
 * 人声模型确认过开口的一句：至少这么长就算数（不用 minSpeechMs 的 400ms）。
 * 咳嗽、敲桌子过不了开口那一关，不用靠长度挡；短命令「停」只有 250–350ms，按 400ms 会被丢掉。
 */
export const VOICED_MIN_SPEECH_MS = 200
/** 模型概率比音量晚这么多帧（20ms 一帧）：算一句多长时，结尾静音里这几帧还按音量算。 */
const VOICE_LAG_FRAMES = 8

/** 音量的最小值，免得 log(0)。 */
const FLOOR_DB = -100
/** 刚开麦这么久只学底噪。 */
const WARMUP_MS = 300

export function rmsDb(samples: Float32Array, start = 0, end = samples.length): number {
  let sum = 0
  for (let i = start; i < end; i++) {
    const v = samples[i] ?? 0
    sum += v * v
  }
  const n = end - start
  if (n <= 0 || sum === 0) return FLOOR_DB
  return Math.max(FLOOR_DB, 10 * Math.log10(sum / n))
}

export class Vad {
  readonly sampleRate: number
  private frameSize: number
  private opts: typeof DEFAULTS
  /** 还没凑够一帧的采样。 */
  private partial: Float32Array
  private partialLength = 0
  /** 估计的环境底噪（dBFS）。 */
  private noiseDb = -60
  /** 已经看过多少帧（前几帧快速校准底噪）。 */
  private framesSeen = 0
  /** 开口前的最近几帧。 */
  private preRoll: Float32Array[] = []
  private preRollFrames: number
  /** 连续够响的帧数（还没算开口时）。 */
  private loudRun = 0
  /** 开口前够响的那几帧，开口后并进这句话里。 */
  private pendingOnset: Float32Array[] = []
  private speaking = false
  /** 这一句开口时人声模型在用（长度门槛放低、按音量数）。 */
  private gated = false
  /** 这一句到目前为止的帧。 */
  private frames: Float32Array[] = []
  /** 这一句里最后一帧够响的帧之后，又过了几帧。 */
  private silentRun = 0
  /** 停顿中连续够响的帧数（够 resumeFrames 才算又开口）。 */
  private resumeRun = 0
  /** 这一句里够响的帧（不含开头补的）一共多少。 */
  private voicedFrames = 0
  /** 这一句、这一段停顿的编号：再开口或这句结束就换一个，旧的 pause 判断随之作废。 */
  private token = 0
  /** 这一段停顿已经发过 pause 了。 */
  private pauseSent = false
  /** 最近一帧的音量，界面画声波用。 */
  lastDb = FLOOR_DB
  /**
   * 人声模型（Silero）给的「现在是人声」的概率 0–1，外面每次 push 前更新；undefined 表示没有模型，只看音量。
   * 有模型时，够响还要像人声才算在说：风扇、空调、敲键盘再响也不算。
   */
  voiceProb: number | undefined = undefined

  constructor(options: VadOptions) {
    this.sampleRate = options.sampleRate
    this.opts = { ...DEFAULTS }
    for (const key of Object.keys(DEFAULTS) as (keyof typeof DEFAULTS)[]) {
      const value = options[key]
      if (typeof value === 'number' && Number.isFinite(value)) this.opts[key] = value
    }
    this.frameSize = Math.max(1, Math.round(this.sampleRate * this.opts.frameMs / 1000))
    this.partial = new Float32Array(this.frameSize)
    this.preRollFrames = Math.max(0, Math.round(this.opts.preRollMs / this.opts.frameMs))
  }

  /** 现在在不在说话（开口之后、说完之前）。 */
  get isSpeaking(): boolean { return this.speaking }

  /** 现在的说话门限（dBFS），调试用。 */
  get thresholdDb(): number {
    const { marginDb, minThresholdDb, maxThresholdDb } = this.opts
    return Math.min(maxThresholdDb, Math.max(minThresholdDb, this.noiseDb + marginDb))
  }

  get noiseFloorDb(): number { return this.noiseDb }

  /** 改停顿时长（设置里调）。 */
  setSilenceMs(ms: number): void {
    if (Number.isFinite(ms) && ms > 0) this.opts.silenceMs = ms
  }

  /** 改「停顿多久先问一次说完没有」，0 关掉。 */
  setCheckMs(ms: number): void {
    if (Number.isFinite(ms) && ms >= 0) this.opts.checkMs = ms
  }

  /** 改收音灵敏度（设置里调）：低档要比底噪响得多才算说话，高档小声也算。认不出的值按中档。 */
  setSensitivity(level: string): void {
    const preset = SENSITIVITY[level as Sensitivity] ?? SENSITIVITY.medium
    this.opts.marginDb = preset.marginDb
    this.opts.minThresholdDb = preset.minThresholdDb
    this.opts.maxThresholdDb = preset.maxThresholdDb
  }

  /** pause 事件之后，外面判断说完了：token 还有效（没再开口、这句没结束）就结束这句。 */
  finishIf(token: number): VadEvent[] {
    if (!this.speaking || token !== this.token) return []
    const events: VadEvent[] = []
    this.endSpeech(events, false, true)
    return events
  }

  /** 喂入一段采样，返回这段里发生的事件。 */
  push(samples: Float32Array): VadEvent[] {
    const events: VadEvent[] = []
    let offset = 0
    while (offset < samples.length) {
      const take = Math.min(this.frameSize - this.partialLength, samples.length - offset)
      this.partial.set(samples.subarray(offset, offset + take), this.partialLength)
      this.partialLength += take
      offset += take
      if (this.partialLength === this.frameSize) {
        const frame = this.partial
        this.partial = new Float32Array(this.frameSize)
        this.partialLength = 0
        this.frame(frame, events)
      }
    }
    return events
  }

  /** 手动结束这一句（「说完了」按钮）：在说就交出来，没在说就什么都不做。 */
  finish(): VadEvent[] {
    if (!this.speaking) return []
    const events: VadEvent[] = []
    this.endSpeech(events, true, false)
    return events
  }

  /** 丢掉进行中的一切（朗读时不听、静音、挂断）。底噪估计保留。 */
  reset(): void {
    this.speaking = false
    this.gated = false
    this.frames = []
    this.preRoll = []
    this.pendingOnset = []
    this.loudRun = 0
    this.silentRun = 0
    this.resumeRun = 0
    this.voicedFrames = 0
    this.partialLength = 0
    this.token++
    this.pauseSent = false
  }

  private frame(frame: Float32Array, events: VadEvent[]): void {
    const db = rmsDb(frame)
    this.lastDb = db
    this.framesSeen++
    const threshold = this.thresholdDb

    if (!this.speaking && this.framesSeen * this.opts.frameMs <= WARMUP_MS) {
      // 刚开麦：只学底噪，不判断开口（不然风扇声一上来就被当成说话）。
      // 一开始就说话也没关系：底噪估高了，门限有上限，校准完照样能识别。
      this.keepPreRoll(frame)
      this.trackNoise(db)
      return
    }

    if (!this.speaking) {
      const loud = db >= threshold && this.voiced(VOICE_ONSET)
      if (loud) {
        this.loudRun++
        this.pendingOnset.push(frame)
        if (this.loudRun >= this.opts.onsetFrames) {
          this.speaking = true
          this.gated = this.voiceProb !== undefined
          this.frames = [...this.preRoll, ...this.pendingOnset]
          this.voicedFrames = this.pendingOnset.length
          this.preRoll = []
          this.pendingOnset = []
          this.silentRun = 0
          this.token++
          this.pauseSent = false
          events.push({ kind: 'start' })
        }
        return
      }
      // 不够响：之前那几帧够响的不算开口，退回开头缓冲
      for (const f of this.pendingOnset) this.keepPreRoll(f)
      this.pendingOnset = []
      this.loudRun = 0
      this.keepPreRoll(frame)
      this.trackNoise(db)
      return
    }

    this.frames.push(frame)
    const frameMs = this.opts.frameMs
    const loud = db >= threshold - this.opts.holdDb && this.voiced(VOICE_HOLD)
    if (loud && this.silentRun === 0) {
      // 一直在说
      this.voicedFrames++
    } else if (loud && ++this.resumeRun >= this.opts.resumeFrames) {
      // 停顿后又连续响了一小段（像在说话）：重新开始计停顿，之前的「说完了没有」作废
      this.token++
      this.pauseSent = false
      this.voicedFrames += this.resumeRun
      this.silentRun = 0
      this.resumeRun = 0
    } else {
      // 安静，或者停顿中只响了一下（敲键盘、碰桌子）：照样算停顿，不让它把计时清零
      if (!loud) this.resumeRun = 0
      this.silentRun++
      const { checkMs, minSpeechMs } = this.opts
      if (checkMs > 0 && !this.pauseSent && this.silentRun * frameMs >= checkMs && this.voicedFrames * frameMs >= minSpeechMs) {
        this.pauseSent = true
        events.push({ kind: 'pause', samples: this.joined(this.silentRun), token: this.token })
      }
    }
    if (this.silentRun * frameMs >= this.opts.silenceMs) {
      this.endSpeech(events, false, true)
      return
    }
    if (this.frames.length * frameMs >= this.opts.maxSpeechMs) this.endSpeech(events, true, false)
  }

  private endSpeech(events: VadEvent[], forced: boolean, trimSilence: boolean): void {
    const frameMs = this.opts.frameMs
    let speechMs = this.voicedFrames * frameMs
    let minSpeechMs = this.opts.minSpeechMs
    if (this.gated) {
      // 模型确认是人声：长度按音量数（含开头缓冲里模型还没跟上的那段），门槛放低
      speechMs = Math.max(speechMs, this.energyFrames(trimSilence ? this.silentRun : 0) * frameMs)
      minSpeechMs = Math.min(minSpeechMs, VOICED_MIN_SPEECH_MS)
    }
    this.gated = false
    // 结尾的静音只留一点（200ms），其余截掉（joined 里做）
    const samples = this.joined(trimSilence ? this.silentRun : 0)
    this.speaking = false
    this.frames = []
    this.silentRun = 0
    this.resumeRun = 0
    this.voicedFrames = 0
    this.loudRun = 0
    this.token++
    this.pauseSent = false
    if (speechMs < minSpeechMs) {
      events.push({ kind: 'discard', speechMs })
      return
    }
    events.push({ kind: 'end', samples, speechMs, forced })
  }

  /** 这一句到目前为止的音频，结尾的静音只留 200ms（silentFrames 是结尾有几帧静音）。 */
  private joined(silentFrames: number): Float32Array {
    const keepTail = Math.round(200 / this.opts.frameMs)
    const drop = Math.max(0, silentFrames - keepTail)
    const count = Math.max(0, this.frames.length - drop)
    const samples = new Float32Array(count * this.frameSize)
    for (let i = 0; i < count; i++) samples.set(this.frames[i]!, i * this.frameSize)
    return samples
  }

  /** 这一句里按音量够响（说话中的门限）的帧数；结尾静音只看模型晚到的那几帧。 */
  private energyFrames(silentFrames: number): number {
    const drop = Math.max(0, silentFrames - VOICE_LAG_FRAMES)
    const count = Math.max(0, this.frames.length - drop)
    const min = this.thresholdDb - this.opts.holdDb
    let n = 0
    for (let i = 0; i < count; i++) if (rmsDb(this.frames[i]!) >= min) n++
    return n
  }

  /** 没有模型时总算像人声；有模型时看概率。 */
  private voiced(min: number): boolean {
    return this.voiceProb === undefined || this.voiceProb >= min
  }

  private keepPreRoll(frame: Float32Array): void {
    if (this.preRollFrames === 0) return
    this.preRoll.push(frame)
    if (this.preRoll.length > this.preRollFrames) this.preRoll.shift()
  }

  /** 底噪：前 0.5 秒快速校准；之后变吵慢慢升（约 3 秒跟上），变静很快降。 */
  private trackNoise(db: number): void {
    if (this.framesSeen === 1) {
      this.noiseDb = db
      return
    }
    const warmup = this.framesSeen * this.opts.frameMs <= WARMUP_MS + 200
    const alpha = warmup ? 0.3 : db > this.noiseDb ? 0.007 : 0.15
    this.noiseDb += (db - this.noiseDb) * alpha
  }
}
