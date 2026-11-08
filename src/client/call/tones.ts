/**
 * 通话提示音：都用振荡器现场合成，不用音频文件。
 * - connect 接通、hangup 挂断、ack 收到你的话、turn 轮到你说、tick 还在干活、need 需要你在屏幕上操作。
 * - 思考音：发出消息后循环播很轻的两声，第一句朗读出声就停。
 * 提示音播放期间（加一点余量）麦克风不收音，免得把提示音当成说话。
 */

export type ToneName = 'connect' | 'hangup' | 'ack' | 'turn' | 'tick' | 'need'

/** [频率 Hz, 开始偏移 s, 时长 s, 峰值音量] */
type Note = readonly [number, number, number, number]

const TONES: Record<ToneName, readonly Note[]> = {
  connect: [[523, 0, 0.09, 0.12], [784, 0.1, 0.14, 0.12]],
  hangup: [[784, 0, 0.09, 0.12], [523, 0.1, 0.16, 0.12]],
  ack: [[660, 0, 0.08, 0.09]],
  turn: [[784, 0, 0.07, 0.11], [988, 0.09, 0.11, 0.11]],
  tick: [[1047, 0, 0.05, 0.045]],
  need: [[660, 0, 0.08, 0.1], [660, 0.15, 0.08, 0.1]],
}

const THINKING_PULSE: readonly Note[] = [[440, 0, 0.2, 0.03], [554, 0.22, 0.2, 0.03]]
const THINKING_EVERY_MS = 1800
/** 提示音结束后再等这么久才开始收音。 */
const TAIL_S = 0.15

export class Tones {
  private context: () => AudioContext | undefined
  private busyUntil = 0
  private thinkingTimer: ReturnType<typeof setInterval> | undefined

  constructor(context: () => AudioContext | undefined) {
    this.context = context
  }

  play(name: ToneName): void {
    this.notes(TONES[name])
  }

  /** 有提示音在响（麦克风这时不收音）。 */
  get busy(): boolean {
    const ctx = this.context()
    return ctx !== undefined && ctx.currentTime < this.busyUntil
  }

  /** 开关思考音。重复调用没关系。 */
  thinking(on: boolean): void {
    if (on === (this.thinkingTimer !== undefined)) return
    if (!on) {
      clearInterval(this.thinkingTimer)
      this.thinkingTimer = undefined
      return
    }
    this.notes(THINKING_PULSE)
    this.thinkingTimer = setInterval(() => this.notes(THINKING_PULSE), THINKING_EVERY_MS)
  }

  dispose(): void {
    this.thinking(false)
  }

  private notes(notes: readonly Note[]): void {
    const ctx = this.context()
    if (ctx === undefined || ctx.state !== 'running') return
    const t0 = ctx.currentTime + 0.02
    let end = t0
    for (const [freq, offset, duration, peak] of notes) {
      const start = t0 + offset
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.value = freq
      gain.gain.setValueAtTime(0.0001, start)
      gain.gain.linearRampToValueAtTime(peak, start + 0.012)
      gain.gain.exponentialRampToValueAtTime(0.0001, start + duration)
      osc.connect(gain).connect(ctx.destination)
      osc.start(start)
      osc.stop(start + duration + 0.02)
      osc.onended = () => {
        osc.disconnect()
        gain.disconnect()
      }
      end = Math.max(end, start + duration)
    }
    this.busyUntil = Math.max(this.busyUntil, end + TAIL_S)
  }
}
