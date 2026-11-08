/**
 * 一通语音通话的状态机（半双工）：
 *   在听 → 你说话 → 识别 → 发出去 → 等它（思考音 / 干活轻响 / 朗读）→ 这一轮结束、读完 → 提示音 → 在听 …
 *
 * - 麦克风整通电话开着，但只在「在听」且没静音、没朗读、没提示音时才把声音交给断句；其余时间直接丢掉。
 * - 点一下屏幕：停止朗读，马上轮到你说；agent 在后台照常干活，你说的话排队发出。
 * - agent 弹出提问或审批：读一句「需要你在屏幕上确认」，等你在屏幕上处理完。
 * - 切到后台：暂停，回来点一下继续。
 *
 * 浏览器、DSH 的东西都通过 CallEnv 注入，这个文件 Node 里能直接测。只用可擦除的 TypeScript 语法。
 */
import { commandOf, isEcho, type Command } from './intent.ts'
import { Vad, type VadEvent } from './vad.ts'

export type CallPhase =
  | 'connecting'
  | 'listening'
  | 'hearing'
  | 'transcribing'
  | 'thinking'
  | 'working'
  | 'speaking'
  | 'needs-you'
  | 'muted'
  | 'paused'
  | 'ended'

export interface CallView {
  phase: CallPhase
  /** 刚识别出、发出去的那句话。 */
  heard: string
  /** 一行提示（出错、没听清等），过几秒自动消失。 */
  notice: string
  /** 麦克风音量 0–1（只在听的时候有）。 */
  level: number
  muted: boolean
  /** 能不能直接说话打断。 */
  bargeIn: boolean
}

export type TranscribeResult = { ok: true, text: string } | { ok: false, error: string }

export interface CallEnv {
  now(): number
  /** 这个会话的 agent 在跑。 */
  running(): boolean
  /** 有提问或审批在等用户。 */
  pending(): boolean
  /** 有朗读在排队或在播（包括还在合成的）。 */
  speaking(): boolean
  /** 朗读已经出声。 */
  sounding(): boolean
  /** 停掉所有朗读（这一轮剩下的也不念）。 */
  stopSpeech(): void
  /** 念一句话（用朗读）。 */
  say(text: string): void
  tone(name: 'connect' | 'hangup' | 'ack' | 'turn' | 'tick' | 'need'): void
  /** 提示音在响。 */
  toneBusy(): boolean
  thinking(on: boolean): void
  transcribe(samples: Float32Array, sampleRate: number): Promise<TranscribeResult>
  /** 写进草稿并发送。返回 false 表示没发出去。 */
  send(text: string): boolean
  /** 输入框里有用户打了还没发的字（或附件）。这时识别出来的话接到草稿末尾，不自动发。 */
  composing?(): boolean
  /** 把话接到草稿末尾（不发送）。返回 false 表示写不进去。 */
  appendDraft?(text: string): boolean
  /** 告诉后台这个会话在不在通话。返回 false 表示后台不认（就在消息末尾带一句提示）。 */
  setActive(active: boolean): Promise<boolean>
  /** 通话结束（挂断或出错）：关麦等。 */
  ended(reason: string): void
  /** 让 agent 停下（和输入框的停止按钮一样）。返回 false 表示停不了。 */
  stopAgent?(): boolean
  /** 念给用户听的一句进度。elapsedMs：这一轮等了多久。 */
  progress?(elapsedMs: number): string
  /** 最近念过的话（判断回声用）。 */
  recentSpeech?(): string
  /** 用户开口时把朗读调小声，说完恢复。 */
  duck?(on: boolean): void
  /** smart-turn：听这段声音，说完了的概率（0–1）。出错抛异常。 */
  turnComplete?(samples: Float32Array, sampleRate: number): Promise<number>
  /** 人声模型（可选）：没有或没加载好时，断句只看音量。 */
  voice?: VoiceEnv
}

export interface VoiceEnv {
  /** 喂一段采样（采样率同麦克风）。 */
  push(samples: Float32Array): void
  /** 最近的人声概率；没准备好、出错或太久没更新时返回 undefined。 */
  probability(): number | undefined
  /** 不听了（朗读、静音）：丢掉模型状态。 */
  reset(): void
}

export interface CallOptions {
  silenceMs?: number
  maxSpeechMs?: number
  /** 等它、听它念的时候也收音，直接说话就能打断（戴耳机时用）。 */
  bargeIn?: boolean
  /** 停顿一下就听语气判断说完没有（smart-turn）；没说完就多等一会儿。 */
  smartTurn?: boolean
  /** 收音灵敏度：'low' | 'medium' | 'high'（见 vad.ts 的 SENSITIVITY），默认中档。 */
  sensitivity?: string
}

/** smart-turn 打开时：停顿这么久先问一次说完没有。 */
const SMART_CHECK_MS = 500
/** smart-turn 判断没说完时，最多等这么久（再长就按停顿当说完）。 */
const SMART_FALLBACK_MS = 3000
/** 说完的概率超过这个就提前结束这句。 */
const SMART_THRESHOLD = 0.5

/** 这轮结束要连续这么久都安静（不在跑、不在念、没在等你），才算真的结束。 */
const SETTLE_MS = 800
/** 发出去后这么久 agent 都没开始跑，就当没发出去。 */
const START_TIMEOUT_MS = 8000
/** 思考音最多响这么久，之后改成干活时的定时轻响。 */
const THINKING_MAX_MS = 20_000
const TICK_EVERY_MS = 15_000
const HEARTBEAT_MS = 30_000
const NOTICE_MS = 4000
export const NEED_YOU_TEXT = '需要你在屏幕上确认。'
/** 输入框里有字时，说的话接到末尾后给的提示。 */
export const APPENDED_NOTICE = '已接到输入框末尾，发送时一起发'
/** 输入框里有字、但接不进去（比如正在用命令）。 */
export const APPEND_FAILED_NOTICE = '没接进输入框，请再说一遍'
/** 后台不认通话时，附在每条语音消息后面的提示。 */
export const FALLBACK_HINT = '（语音通话中：请口语化、简短回答；调工具前先用一句话说你要做什么。）'

/** 只有语气词、标点：当作没听清，不发。 */
const FILLER = /^[\s，。,.!?！？、…~～嗯啊呃额唔哦噢哈呀]*$/u

type Mode = 'connecting' | 'open' | 'transcribing' | 'await' | 'ended'

export class CallController {
  readonly vad: Vad
  private env: CallEnv
  private mode: Mode = 'connecting'
  private muted = false
  private paused = false
  private hostOk = true
  private heard = ''
  private notice = ''
  private noticeAt = 0
  private level = 0
  private run = 0
  private lastHeartbeat = 0
  private gateWasOpen = false
  private bargeIn = false
  /** 打断的那句正在识别（这时不再收音）。 */
  private barging = false
  /** 设置里的停顿时长（smart-turn 关着时就按它断句）。 */
  private silenceMs = 1200
  private smartTurn = false
  /** smart-turn 出过错就整通电话不再用，提示只说一次。 */
  private smartTurnFailed = false
  /** 等它的这一轮的情况。 */
  private turn = { since: 0, sawRunning: false, quietSince: -1, spoke: false, mine: false, needAnnounced: false, lastTick: 0 }
  private listeners = new Set<() => void>()
  private view: CallView
  private sampleRate = 16000

  constructor(env: CallEnv, sampleRate: number, options: CallOptions = {}) {
    this.env = env
    this.sampleRate = sampleRate
    this.vad = new Vad({ sampleRate, silenceMs: options.silenceMs, maxSpeechMs: options.maxSpeechMs })
    if (typeof options.silenceMs === 'number') this.silenceMs = options.silenceMs
    this.bargeIn = options.bargeIn === true
    this.setSmartTurn(options.smartTurn === true)
    if (options.sensitivity !== undefined) this.vad.setSensitivity(options.sensitivity)
    this.view = this.compute()
  }

  /** 设置里改了收音灵敏度。 */
  setSensitivity(level: string): void {
    this.vad.setSensitivity(level)
  }

  /** 设置里改了「说话打断」。 */
  setBargeIn(on: boolean): void {
    this.bargeIn = on
    this.publish()
  }

  /** 设置里改了停顿时长。 */
  setSilenceMs(ms: number): void {
    if (!Number.isFinite(ms) || ms <= 0) return
    this.silenceMs = ms
    this.applyTurnTiming()
  }

  /**
   * 设置里改了「听语气判断说完没有」。打开后：停顿 0.5 秒先问 smart-turn，说完了马上发；
   * 没说完就接着等，最多等 3 秒（或者设置的停顿时长，取长的）。环境没有 turnComplete 时不生效。
   */
  setSmartTurn(on: boolean): void {
    this.smartTurn = on && this.env.turnComplete !== undefined
    this.applyTurnTiming()
  }

  private applyTurnTiming(): void {
    if (this.smartTurn) {
      this.vad.setCheckMs(SMART_CHECK_MS)
      this.vad.setSilenceMs(Math.max(this.silenceMs, SMART_FALLBACK_MS))
    } else {
      this.vad.setCheckMs(0)
      this.vad.setSilenceMs(this.silenceMs)
    }
  }

  // ---------- 外部调用 ----------

  /** 接通：告诉后台、等麦克风。麦克风好了调 micReady。 */
  start(): void {
    this.lastHeartbeat = this.env.now()
    void this.env.setActive(true).then((ok) => { this.hostOk = ok }, () => { this.hostOk = false })
    this.publish()
  }

  /** 麦克风打开了。agent 正在跑就先等它这一轮完，否则直接轮到你说。 */
  micReady(): void {
    if (this.mode !== 'connecting') return
    this.env.tone('connect')
    if (this.env.running() || this.env.speaking() || this.env.pending()) this.enterAwait(false)
    else this.mode = 'open'
    this.publish()
  }

  /** 麦克风打不开、识别服务不可用等：结束通话。 */
  fail(message: string): void {
    if (this.mode === 'ended') return
    this.finish(message, false)
  }

  /** 麦克风来的一段采样。 */
  audio(samples: Float32Array): void {
    if (this.mode === 'ended') return
    const open = this.gateOpen()
    if (!open) {
      if (this.gateWasOpen) {
        this.vad.reset()
        this.env.voice?.reset()
      }
      this.gateWasOpen = false
      if (this.level !== 0) {
        this.level = 0
        this.publish()
      }
      return
    }
    this.gateWasOpen = true
    // 模型在工作线程里异步算，概率比音量晚几十毫秒；开头缓冲（300ms）和停顿时长都盖得住
    const voice = this.env.voice
    if (voice !== undefined) {
      voice.push(samples)
      this.vad.voiceProb = voice.probability()
    }
    for (const event of this.vad.push(samples)) this.onVad(event)
    const level = Math.max(0, Math.min(1, (this.vad.lastDb + 60) / 45))
    const bucket = Math.round(level * 10) / 10
    if (bucket !== this.level) {
      this.level = bucket
      this.publish()
    }
  }

  /** 每 200ms 左右调一次：判断这一轮结束没有、思考音、定时轻响、心跳。 */
  tick(): void {
    if (this.mode === 'ended') return
    const now = this.env.now()
    if (now - this.lastHeartbeat >= HEARTBEAT_MS) {
      this.lastHeartbeat = now
      void this.env.setActive(true).then((ok) => { this.hostOk = ok }, () => { this.hostOk = false })
    }
    // 暂停时的提示（比如「锁屏后系统停了麦克风」）留着，等用户回来看到、点了继续再消失
    if (this.notice !== '' && !this.paused && now - this.noticeAt > NOTICE_MS) this.notice = ''
    // 听的时候 agent 弹出了提问或审批（比如打断后它还在跑）：转去等它
    if (this.mode === 'open' && this.env.pending() && !this.vad.isSpeaking) this.enterAwait(false)
    if (this.mode === 'await') this.tickAwait(now)
    else this.env.thinking(false)
    this.publish()
  }

  /** 点一下屏幕：暂停中就继续；等它的时候就停止朗读、轮到你说。 */
  tap(): void {
    if (this.mode === 'ended') return
    if (this.paused) {
      this.paused = false
      this.notice = ''
      this.publish()
      return
    }
    if (this.mode === 'await') {
      this.env.stopSpeech()
      this.env.thinking(false)
      this.mode = 'open'
      this.publish()
    }
  }

  /** 「说完了」：正在说就立刻交出去。 */
  done(): void {
    if (this.mode !== 'open') return
    for (const event of this.vad.finish()) this.onVad(event)
    this.publish()
  }

  toggleMute(): void {
    if (this.mode === 'ended') return
    this.muted = !this.muted
    this.publish()
  }

  /**
   * 切到后台：暂停（不收音、不放提示音），回来点一下继续。
   * reason 是暂停的原因，一直显示到用户点继续（用户在锁屏时看不到，回来才看到）。
   */
  pause(reason = ''): void {
    if (this.mode === 'ended' || this.paused) return
    this.paused = true
    this.env.thinking(false)
    if (reason !== '') {
      this.notice = reason
      this.noticeAt = this.env.now()
    }
    this.publish()
  }

  get isPaused(): boolean { return this.paused }

  hangup(): void {
    if (this.mode === 'ended') return
    this.env.stopSpeech()
    this.finish('', true)
  }

  getView(): CallView { return this.view }

  /** 现在是不是轮到用户说（自测录音据此决定什么时候「说」下一段）。等它的时候能打断不算。 */
  get listening(): boolean { return this.mode === 'open' && this.gateOpen() }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  // ---------- 内部 ----------

  private gateOpen(): boolean {
    if (this.muted || this.paused) return false
    if (this.mode === 'open') return !this.env.speaking() && !this.env.toneBusy()
    // 戴耳机、开了「说话打断」：等它、听它念的时候也收音（提问 / 审批在等时不收，要在屏幕上处理）
    if (this.mode === 'await') return this.bargeIn && !this.barging && !this.env.pending()
    return false
  }

  private onVad(event: VadEvent): void {
    if (event.kind === 'pause') {
      void this.checkTurn(event.samples, event.token)
      return
    }
    if (this.mode === 'await') {
      // 打断：一开口先把朗读压小，识别完再决定是停还是恢复
      if (event.kind === 'start') this.env.duck?.(true)
      else if (event.kind === 'discard') this.env.duck?.(false)
      else void this.bargeRecognize(event.samples)
      return
    }
    if (event.kind === 'start') {
      this.notice = ''
      return
    }
    if (event.kind === 'discard') return
    void this.recognize(event.samples)
  }

  /**
   * 说话中停顿了一下：问 smart-turn 说完没有。说完了就结束这句（照常识别发出）；
   * 没说完就什么都不做，VAD 接着等（再开口，或者停够 3 秒）。
   * 出错就整通电话退回只按停顿判断，提示一次。
   */
  private async checkTurn(samples: Float32Array, token: number): Promise<void> {
    if (!this.smartTurn || this.env.turnComplete === undefined) return
    let probability: number
    try {
      // 按方法调用（保留 this），不要先取出来再调
      probability = await this.env.turnComplete(samples, this.sampleRate)
    } catch {
      if (!this.smartTurnFailed) {
        this.smartTurnFailed = true
        this.say('听语气判断用不了，改成按停顿判断')
      }
      this.smartTurn = false
      this.applyTurnTiming()
      this.publish()
      return
    }
    if (this.mode === 'ended' || !(probability >= SMART_THRESHOLD)) return
    // token 作废（又开口了、这句已经结束、门关了）时 finishIf 什么都不做
    for (const event of this.vad.finishIf(token)) this.onVad(event)
    this.publish()
  }

  /** 识别结果是不是要本地处理的命令。「停」在 agent 跑或在念时才算；「进度」在跑时才算。 */
  private commandFor(text: string): Command | undefined {
    const command = commandOf(text)
    if (command === 'stop') return this.env.running() || this.env.speaking() ? 'stop' : undefined
    if (command === 'progress') return this.env.running() ? 'progress' : undefined
    return undefined
  }

  /** 处理命令。处理完都回到「等它」：这一轮真结束了才响提示音轮到你。 */
  private runCommand(command: Command): void {
    this.env.duck?.(false)
    if (command === 'stop') {
      this.env.stopSpeech()
      this.env.thinking(false)
      if (this.env.running()) {
        const stopped = this.env.stopAgent?.() ?? false
        if (!stopped) {
          this.say('停不了：请点屏幕上的停止按钮')
          this.mode = 'open'
          this.publish()
          return
        }
        this.say('已经让它停下')
      } else {
        this.say('不念了')
      }
      this.env.tone('ack')
      this.enterAwait(false)
      // 刚停的是一轮正在跑 / 在念的：它已经开始过，安静下来就轮到你（不用等「没发出去」的超时）
      this.turn.sawRunning = true
      this.publish()
      return
    }
    // 进度：本地念一句，不打断 agent
    const elapsed = this.mode === 'await' ? this.env.now() - this.turn.since : 0
    const text = this.env.progress?.(elapsed) ?? '它还在干活。'
    this.env.stopSpeech()
    this.env.say(text)
    if (this.mode !== 'await') this.enterAwait(false)
    this.publish()
  }

  /** 等它的时候用户开口了（说话打断）：先识别，再看是回声、命令还是新的话。 */
  private async bargeRecognize(samples: Float32Array): Promise<void> {
    const run = ++this.run
    this.barging = true
    this.vad.reset()
    this.publish()
    let result: TranscribeResult
    try {
      result = await this.env.transcribe(samples, this.sampleRate)
    } catch (error) {
      result = { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
    this.barging = false
    if (run !== this.run || this.mode !== 'await') {
      this.env.duck?.(false)
      return
    }
    const text = result.ok ? result.text.trim() : ''
    if (text === '' || FILLER.test(text)) {
      this.env.duck?.(false)
      this.publish()
      return
    }
    const command = this.commandFor(text)
    // 很短的命令（「停」）不做回声判断：误停比停不下来好
    if (command === undefined && isEcho(text, this.env.recentSpeech?.() ?? '')) {
      this.env.duck?.(false)
      this.publish()
      return
    }
    if (command !== undefined) {
      this.runCommand(command)
      return
    }
    // 新的话：停掉朗读，排队发给 agent
    this.env.duck?.(false)
    this.env.stopSpeech()
    this.heard = text
    // 输入框里有你打的字：接到末尾，等你自己发；这一轮照常等它结束
    if (this.composing()) {
      this.addToDraft(text)
      return
    }
    const sent = this.env.send(this.hostOk ? text : `${text}\n\n${FALLBACK_HINT}`)
    if (!sent) {
      this.say('没发出去，请再说一遍')
      this.publish()
      return
    }
    this.env.tone('ack')
    this.enterAwait(true)
    this.publish()
  }

  private async recognize(samples: Float32Array): Promise<void> {
    const run = ++this.run
    this.mode = 'transcribing'
    this.vad.reset()
    this.publish()
    let result: TranscribeResult
    try {
      result = await this.env.transcribe(samples, this.sampleRate)
    } catch (error) {
      result = { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
    if (run !== this.run || this.mode !== 'transcribing') return
    if (!result.ok) {
      this.mode = 'open'
      this.say(`识别失败：${result.error}`)
      return
    }
    const text = result.text.trim()
    if (text === '' || FILLER.test(text)) {
      this.mode = 'open'
      // 正在打字时多半是键盘声：不提示
      if (this.composing()) this.publish()
      else this.say('没听清，请再说一遍')
      return
    }
    // 点屏幕插话后 agent 还在跑：「停」「进度怎么样」本地处理，不发给它
    const command = this.commandFor(text)
    if (command !== undefined) {
      this.mode = 'open'
      this.runCommand(command)
      return
    }
    this.heard = text
    if (this.composing()) {
      this.mode = 'open'
      this.addToDraft(text)
      return
    }
    const sent = this.env.send(this.hostOk ? text : `${text}\n\n${FALLBACK_HINT}`)
    if (!sent) {
      this.mode = 'open'
      this.say('没发出去，请再说一遍')
      return
    }
    this.env.tone('ack')
    this.enterAwait(true)
    this.publish()
  }

  private composing(): boolean {
    try {
      return this.env.composing?.() === true
    } catch {
      return false
    }
  }

  /** 接到草稿末尾，不发送、不响提示音（你正看着屏幕）。 */
  private addToDraft(text: string): void {
    let ok = false
    try {
      ok = this.env.appendDraft?.(text) === true
    } catch {
      ok = false
    }
    this.say(ok ? APPENDED_NOTICE : APPEND_FAILED_NOTICE)
  }

  private enterAwait(mine: boolean): void {
    this.mode = 'await'
    const now = this.env.now()
    this.turn = { since: now, sawRunning: this.env.running(), quietSince: -1, spoke: false, mine, needAnnounced: false, lastTick: now }
  }

  private tickAwait(now: number): void {
    const running = this.env.running()
    const speaking = this.env.speaking()
    const pending = this.env.pending()
    const turn = this.turn
    if (running) turn.sawRunning = true
    if (this.env.sounding()) turn.spoke = true

    if (pending) {
      if (!turn.needAnnounced && !this.paused) {
        turn.needAnnounced = true
        this.env.tone('need')
        this.env.say(NEED_YOU_TEXT)
      }
    } else {
      turn.needAnnounced = false
    }

    const thinking = turn.mine && !turn.spoke && !pending && !this.paused && now - turn.since < THINKING_MAX_MS
    this.env.thinking(thinking)
    if (!thinking && !speaking && !pending && !this.paused && running && now - turn.lastTick >= TICK_EVERY_MS) {
      turn.lastTick = now
      this.env.tone('tick')
    }
    if (speaking) turn.lastTick = now

    const quiet = !running && !speaking && !pending
    if (!quiet) {
      turn.quietSince = -1
      return
    }
    if (turn.quietSince < 0) turn.quietSince = now
    const started = turn.sawRunning || now - turn.since >= START_TIMEOUT_MS
    if (now - turn.quietSince < SETTLE_MS || !started) return
    // 这一轮完了：轮到你
    this.env.thinking(false)
    this.mode = 'open'
    if (!turn.sawRunning && turn.mine) this.say('好像没发出去，请再说一遍')
    if (!this.paused) this.env.tone('turn')
  }

  private finish(reason: string, byUser: boolean): void {
    this.mode = 'ended'
    this.run++
    this.barging = false
    this.env.thinking(false)
    this.env.duck?.(false)
    this.vad.reset()
    if (byUser) this.env.tone('hangup')
    void this.env.setActive(false).catch(() => {})
    this.notice = reason
    this.publish()
    this.env.ended(reason)
  }

  private say(notice: string): void {
    this.notice = notice
    this.noticeAt = this.env.now()
    this.publish()
  }

  private phase(): CallPhase {
    if (this.mode === 'ended') return 'ended'
    if (this.mode === 'connecting') return 'connecting'
    if (this.paused) return 'paused'
    if (this.mode === 'transcribing') return 'transcribing'
    if (this.mode === 'open') {
      if (this.muted) return 'muted'
      return this.vad.isSpeaking ? 'hearing' : 'listening'
    }
    // await
    if (this.env.pending()) return 'needs-you'
    if (this.env.sounding() || (this.env.speaking() && this.turn.spoke)) return 'speaking'
    if (this.turn.mine && !this.turn.spoke && this.env.now() - this.turn.since < THINKING_MAX_MS) return 'thinking'
    return 'working'
  }

  private compute(): CallView {
    return { phase: this.phase(), heard: this.heard, notice: this.notice, level: this.mode === 'open' ? this.level : 0, muted: this.muted, bargeIn: this.bargeIn }
  }

  private publish(): void {
    const next = this.compute()
    const prev = this.view
    if (prev.phase === next.phase && prev.heard === next.heard && prev.notice === next.notice && prev.level === next.level && prev.muted === next.muted && prev.bargeIn === next.bargeIn) return
    this.view = next
    for (const listener of this.listeners) listener()
  }
}
