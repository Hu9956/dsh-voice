/**
 * 浏览器里的一通电话：把状态机（controller）接到麦克风、识别、输入框、朗读、提示音和 DSH 的会话状态上。
 *
 * 同一时间只有一通电话（current）。它是模块级的，不挂在 React 组件上：
 * agent 弹出审批 / 提问时 DSH 会把整个输入栏换掉，通话面板随之卸载，但电话不能断。
 * 面板挂着时，把聊天内容（跟读用）和输入框状态喂进来；卸载太久（切到别的会话）才自动挂断。
 */
import { useSyncExternalStore } from 'react'
import { Follower, parseTurn } from '../follow'
import { callBargeIn, callCloudAsr, callKeepOnLock, callSensitivity, callSilenceMs, callSmartTurn, callVoiceModel, loadSettings } from '../settings'
import { speaker } from '../speaker'
import { CallController, type CallEnv, type CallView, type TranscribeResult } from './controller'
import { VoiceDetector } from './voice'
import { isComposing, joinDraft } from './draft'
import { parseProgress, progressText } from './intent'
import { rms } from './meter'
import { Mic, MicError } from './mic'
import { Tones } from './tones'
import { encodePcm16, encodeWav, resample, TARGET_RATE, toBase64 } from './wav'

const BASE = '/voice-reply'
const TICK_MS = 200
/** 面板卸载、又没有审批 / 提问在等，这么久还没回来就挂断（多半是切到别的会话了）。 */
const ORPHAN_HANGUP_MS = 10_000
/** 挂断后，按钮旁的提示留这么久。 */
const ENDED_NOTICE_MS = 6000
const USABLE = new Set(['ready', 'standby', 'waking'])
/** 开了「锁屏后继续通话」，但系统在锁屏后停了麦克风或声音。 */
const LOCK_STOPPED_NOTICE = '锁屏后系统停了麦克风或声音，点这里继续'

// ---------- 外面注入的 DSH 服务 ----------

type Result<T> = { ok: true, value: T } | { ok: false, error: { message: string } }

interface SpeechCatalog {
  maxAudioBytes: number
  maxDurationSeconds: number
  providers: readonly { id: string, preparation: { phase: string } }[]
  selection: { providerId: string, language: string }
}

/** 官方语音 Remote（ctx.remote.speech）里用到的部分。 */
export interface SpeechRemote {
  catalog(): Promise<Result<SpeechCatalog>>
  transcribe(request: { audioBase64: string, providerId?: string, language?: string }, signal?: AbortSignal): Promise<Result<{ text: string }>>
}

interface SessionStatusEntry { running?: boolean, pendingInteraction?: unknown }
/** ctx.uiSession.sessionStatus：每个会话在不在跑、有没有提问 / 审批在等。 */
export interface StatusStore {
  getSnapshot(): ReadonlyMap<string, SessionStatusEntry>
  subscribe(listener: () => void): () => void
}

/** 输入框动作里用到的部分（官方 inputActions）。 */
export interface InputActions {
  setDraft(text: string): void
  /** 官方 submit(mode)：'queue' 排到这一轮之后，'steer' 插进正在跑的这一轮。旧版不认参数，照常排队。 */
  submit(mode?: 'queue' | 'steer'): void
}

export interface InputState {
  draft: string
  phase: string
  attachmentIds: readonly string[]
}

/** 官方会话层（ctx.sessions）里用到的部分：取会话的 scope，再拿 conversation 停下 agent（和输入框的停止按钮同一条路）。 */
export interface SessionsApi {
  scope(id: string): { get(name: string): unknown } | undefined
}

let speech: SpeechRemote | undefined
let status: StatusStore | undefined
let sessions: SessionsApi | undefined

export function setSpeech(remote: SpeechRemote | undefined): void { speech = remote }
export function setStatus(store: StatusStore | undefined): void { status = store }

export function setSessions(api: SessionsApi | undefined): void { sessions = api }

/** 让这个会话的 agent 停下（和输入框的停止按钮同一条路）。拿不到会话层返回 false。 */
function cancelSession(sessionId: string): boolean {
  const conversation = sessions?.scope(sessionId)?.get('conversation') as { cancel?: () => Promise<unknown> } | undefined
  if (typeof conversation?.cancel !== 'function') return false
  void conversation.cancel().catch(() => {})
  return true
}

// ---------- 一通电话 ----------

class ActiveCall {
  readonly sessionId: string
  readonly controller: CallController
  readonly follower = new Follower()
  private mic: Mic
  private tones: Tones
  private actions: InputActions
  private input: InputState
  /** 麦克风最近一块采样的均方根（给波浪用；静音时也照算，波浪按状态决定看不看）。 */
  private micRms = 0
  private catalog: SpeechCatalog | undefined
  private timer: ReturnType<typeof setInterval> | undefined
  private wakeLock: { release(): Promise<void> } | undefined
  private cleanups: (() => void)[] = []
  private viewers = 0
  private orphanSince = -1
  /** 面板挂着时它从 useSession 读到的 running（比状态表新一点）；没挂着是 undefined。 */
  private panelRunning: boolean | undefined
  /** 人声模型（设置里关了、服务端太旧时没有）。整通电话只起一次，中途改设置下一通生效。 */
  private voice: VoiceDetector | undefined
  ended = false

  constructor(sessionId: string, mic: Mic, actions: InputActions, input: InputState) {
    this.sessionId = sessionId
    this.mic = mic
    this.actions = actions
    this.input = input
    this.tones = new Tones(() => speaker.audioContext())
    this.controller = new CallController(this.env(), mic.sampleRate, { silenceMs: callSilenceMs(), bargeIn: callBargeIn(), smartTurn: callSmartTurn(), sensitivity: callSensitivity() })
    // 设置可能还没读到（或在别的设备上改过）：读到后按设置里的停顿时长、「说话打断」「听语气判断」来
    void loadSettings(true).then(() => {
      this.controller.setSilenceMs(callSilenceMs())
      this.controller.setBargeIn(callBargeIn())
      this.controller.setSmartTurn(callSmartTurn())
      this.controller.setSensitivity(callSensitivity())
      this.startVoice()
    })
  }

  private startVoice(): void {
    if (this.ended || this.voice !== undefined) return
    const version = callVoiceModel()
    if (version === undefined) return
    this.voice = new VoiceDetector(this.mic.sampleRate, version)
  }

  /** 接通（已经在点按里建好了播放和采集的 AudioContext）。 */
  begin(): void {
    const controller = this.controller
    controller.start()
    const catalogReady = (async () => {
      if (speech === undefined) throw new MicError('语音识别服务不可用：请在插件页启用官方「语音输入」')
      const result = await speech.catalog()
      if (!result.ok) throw new MicError(`语音识别不可用：${result.error.message}`)
      const catalog = result.value
      const provider = catalog.providers.find((item) => item.id === catalog.selection.providerId)
      if (provider === undefined || !USABLE.has(provider.preparation.phase)) {
        throw new MicError('语音模型还没准备好：请到插件页「语音输入」里下载并准备')
      }
      this.catalog = catalog
    })()
    const micReady = this.mic.open({
      audio: (samples) => {
        this.micRms = rms(samples)
        controller.audio(samples)
        // 锁屏、切后台时浏览器可能把定时器放慢；麦克风回调还在走，就顺带推一下状态机
        if (document.visibilityState === 'hidden') this.maybeTick()
      },
      wantsAudio: () => controller.listening,
      lost: (message) => controller.fail(message),
    })
    Promise.all([catalogReady, micReady]).then(
      () => { if (!this.ended) controller.micReady() },
      (error: unknown) => controller.fail(error instanceof Error ? error.message : String(error)),
    )

    this.timer = setInterval(() => this.maybeTick(), TICK_MS)

    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        // 默认锁屏、切后台就暂停；设置里开了「锁屏后继续通话」，而且麦克风和朗读都还在，就接着打
        if (!callKeepOnLock()) controller.pause()
        else if (!this.mediaHealthy()) controller.pause(LOCK_STOPPED_NOTICE)
      } else {
        void this.requestWakeLock()
        // 不在点按里也试一下恢复采集；不成功的话用户点「继续」时会再试
        this.mic.resume()
      }
    }
    document.addEventListener('visibilitychange', onVisibility)
    this.cleanups.push(() => document.removeEventListener('visibilitychange', onVisibility))

    // 直接关页面：尽量告诉后台挂断了（失败也没关系，后台 90 秒没心跳会自己当挂断）
    const onPageHide = () => postActive(this.sessionId, false, true)
    window.addEventListener('pagehide', onPageHide)
    this.cleanups.push(() => window.removeEventListener('pagehide', onPageHide))

    void this.requestWakeLock()
  }

  private lastTickAt = 0

  /** 定时器和（后台时的）麦克风回调都会调；最多每 TICK_MS 推一次状态机。 */
  private maybeTick(): void {
    if (this.ended) return
    const now = Date.now()
    if (now - this.lastTickAt < TICK_MS - 20) return
    this.lastTickAt = now
    this.controller.tick()
    this.watchOrphan()
    this.watchBackground()
  }

  /** 锁屏后继续通话时：系统中途停了麦克风或朗读，就暂停并留一句原因，回来点一下继续。 */
  private watchBackground(): void {
    if (document.visibilityState !== 'hidden' || this.controller.isPaused) return
    if (!callKeepOnLock()) return
    if (!this.mediaHealthy()) this.controller.pause(LOCK_STOPPED_NOTICE)
  }

  /** 麦克风还在采、朗读的播放还在跑。 */
  private mediaHealthy(): boolean {
    return this.mic.healthy && speaker.playbackRunning
  }

  /** 点面板：顺手解锁声音（这一下是用户手势），恢复采集，再交给状态机。 */
  tap(): void {
    speaker.unlock()
    this.mic.resume()
    this.controller.tap()
  }

  hangup(): void {
    this.controller.hangup()
  }

  done(): void {
    this.controller.done()
  }

  toggleMute(): void {
    this.controller.toggleMute()
  }

  /** 波浪每帧来取：麦克风和朗读输出的均方根。 */
  levels(): { mic: number, out: number } {
    if (this.ended) return { mic: 0, out: 0 }
    return { mic: this.micRms, out: speaker.outputRms() }
  }

  /** 输入框里有没发的字或附件（面板据此换提示）。 */
  get composing(): boolean {
    return isComposing(this.input)
  }

  // ---------- 面板喂进来的东西 ----------

  private fedChat = false

  feedChat(signature: string): void {
    if (this.ended) return
    const view = parseTurn(signature)
    if (!this.fedChat) {
      this.fedChat = true
      // 空白会话第一次喂进来是空的：当作「之前什么都没有」，下一轮照常念
      if (view === null) this.follower.update({ turn: '', steps: [] })
    }
    this.follower.update(view)
  }

  observeInput(actions: InputActions | undefined, input: InputState | undefined, running: boolean | undefined): void {
    if (actions !== undefined) this.actions = actions
    if (input !== undefined) this.input = input
    this.panelRunning = running
  }

  /** 停止生成的函数（输入栏给的，和「停止生成」按钮同一个），面板卸载后也留着。 */
  private stopFn: (() => void) | undefined
  /** 最新一轮的进度（selectProgress 的结果）。 */
  private progressSignature = ''

  observeAgent(stop: (() => void) | undefined, progressSignature: string): void {
    if (stop !== undefined) this.stopFn = stop
    this.progressSignature = progressSignature
  }

  addViewer(): () => void {
    this.viewers++
    return () => {
      this.viewers--
      if (this.viewers <= 0) this.panelRunning = undefined
    }
  }

  // ---------- 内部 ----------

  private statusEntry(): SessionStatusEntry | undefined {
    return status?.getSnapshot().get(this.sessionId)
  }

  private isRunning(): boolean {
    return this.panelRunning ?? (this.statusEntry()?.running === true)
  }

  private env(): CallEnv {
    const tag = `call:${this.sessionId}`
    return {
      now: () => Date.now(),
      running: () => this.isRunning(),
      pending: () => this.statusEntry()?.pendingInteraction !== undefined,
      speaking: () => speaker.isSpeaking(),
      sounding: () => speaker.isSounding(),
      stopSpeech: () => speaker.stopAll(),
      say: (text) => {
        const u = speaker.start(tag)
        u.append(text)
        u.finish()
      },
      tone: (name) => this.tones.play(name),
      toneBusy: () => this.tones.busy,
      thinking: (on) => this.tones.thinking(on),
      transcribe: (samples, sampleRate) => this.transcribe(samples, sampleRate),
      send: (text) => this.send(text),
      composing: () => isComposing(this.input),
      appendDraft: (text) => this.appendDraft(text),
      setActive: (active) => postActive(this.sessionId, active, false),
      ended: (reason) => this.cleanup(reason),
      stopAgent: () => {
        // 先走官方会话层（输入框停止按钮同一条路）；拿不到再用面板收到的 stop（输入栏的子位置不一定给）
        try {
          if (cancelSession(this.sessionId)) return true
        } catch {
          // 退到下面
        }
        const stop = this.stopFn
        if (stop === undefined) return false
        try {
          stop()
          return true
        } catch {
          return false
        }
      },
      progress: (elapsedMs) => progressText(parseProgress(this.progressSignature), elapsedMs, this.isRunning()),
      recentSpeech: () => speaker.recentText(),
      duck: (on) => speaker.duck(on),
      turnComplete: (samples, sampleRate) => turnComplete(samples, sampleRate),
      voice: {
        push: (samples) => this.voice?.push(samples),
        probability: () => this.voice?.probability(),
        reset: () => this.voice?.reset(),
      },
    }
  }

  /** 识别一句话：设置里开了「百炼识别」就先用百炼，出错再退回本机；没开就用本机（官方语音输入）。 */
  private async transcribe(samples: Float32Array, sampleRate: number): Promise<TranscribeResult> {
    if (!callCloudAsr()) return this.transcribeLocal(samples, sampleRate)
    const cloud = await cloudTranscribe(samples, sampleRate)
    if (cloud.ok) return cloud
    console.warn('[voice-reply] 百炼识别失败，改用本机识别：', cloud.error)
    const local = await this.transcribeLocal(samples, sampleRate)
    return local.ok ? local : cloud
  }

  private async transcribeLocal(samples: Float32Array, sampleRate: number): Promise<TranscribeResult> {
    const remote = speech
    const catalog = this.catalog
    if (remote === undefined || catalog === undefined) return { ok: false, error: '语音识别服务不可用' }
    let audio = resample(samples, sampleRate, TARGET_RATE)
    const maxSamples = Math.floor(catalog.maxDurationSeconds * TARGET_RATE)
    if (audio.length > maxSamples) audio = audio.subarray(0, maxSamples)
    const wav = encodeWav(audio)
    if (wav.byteLength > catalog.maxAudioBytes) return { ok: false, error: '这句太长了' }
    const result = await remote.transcribe({ audioBase64: toBase64(wav), ...catalog.selection })
    return result.ok ? { ok: true, text: result.value.text } : { ok: false, error: result.error.message }
  }

  /** 写进草稿并发送。草稿在提交中、有附件等写不进去时返回 false。 */
  private send(text: string): boolean {
    const input = this.input
    if (input.phase !== 'plain') return false
    if (input.attachmentIds.length > 0) return false
    try {
      this.actions.setDraft(text)
      // agent 在跑：插话（和 Cmd+Enter 一样，下一步就看到），不排到这一轮结束后
      this.actions.submit(this.isRunning() ? 'steer' : 'queue')
    } catch {
      return false
    }
    return true
  }

  /** 接到草稿末尾，不发送。正在用命令（/xxx）等写不进去时返回 false。 */
  private appendDraft(text: string): boolean {
    const input = this.input
    if (input.phase !== 'plain') return false
    const next = joinDraft(input.draft, text)
    try {
      this.actions.setDraft(next)
    } catch {
      return false
    }
    // 面板下一次喂进来之前又接一句，也接在这次后面
    this.input = { ...input, draft: next }
    return true
  }

  private watchOrphan(): void {
    if (this.ended || this.viewers > 0 || this.statusEntry()?.pendingInteraction !== undefined) {
      this.orphanSince = -1
      return
    }
    const now = Date.now()
    if (this.orphanSince < 0) this.orphanSince = now
    else if (now - this.orphanSince > ORPHAN_HANGUP_MS) this.controller.hangup()
  }

  private async requestWakeLock(): Promise<void> {
    if (this.ended || this.wakeLock !== undefined || document.visibilityState !== 'visible') return
    const nav = navigator as Navigator & { wakeLock?: { request(type: 'screen'): Promise<{ release(): Promise<void>, addEventListener(type: 'release', cb: () => void): void }> } }
    if (nav.wakeLock === undefined) return
    try {
      const lock = await nav.wakeLock.request('screen')
      if (this.ended) {
        void lock.release().catch(() => {})
        return
      }
      this.wakeLock = lock
      // 切到后台时浏览器会自动释放；回来再申请
      lock.addEventListener('release', () => { if (this.wakeLock === lock) this.wakeLock = undefined })
    } catch {
      // 拿不到常亮也能打电话
    }
  }

  private cleanup(reason: string): void {
    if (this.ended) return
    this.ended = true
    clearInterval(this.timer)
    this.timer = undefined
    this.mic.close()
    this.voice?.close()
    this.voice = undefined
    this.tones.dispose()
    void this.wakeLock?.release().catch(() => {})
    this.wakeLock = undefined
    for (const cleanup of this.cleanups.splice(0)) cleanup()
    this.follower.detach()
    // 草稿不用恢复：通话中输入框一直露着，说的话只会接在后面，不会盖掉你打的字
    if (current === this) {
      current = undefined
      endedNotice = reason === '' ? undefined : { sessionId: this.sessionId, text: reason, at: Date.now() }
      notify()
      if (endedNotice !== undefined) {
        const shown = endedNotice
        setTimeout(() => {
          if (endedNotice === shown) {
            endedNotice = undefined
            notify()
          }
        }, ENDED_NOTICE_MS)
      }
    }
  }
}

/** 百炼识别一句话最长这么多秒（通话一句最长 30 秒）。 */
const CLOUD_MAX_SECONDS = 60

/** 百炼识别（经本插件后台，Key 不出后台）。出错返回 ok: false，不抛。 */
async function cloudTranscribe(samples: Float32Array, sampleRate: number): Promise<TranscribeResult> {
  let audio = resample(samples, sampleRate, TARGET_RATE)
  if (audio.length > CLOUD_MAX_SECONDS * TARGET_RATE) audio = audio.subarray(0, CLOUD_MAX_SECONDS * TARGET_RATE)
  try {
    const res = await fetch(`${BASE}/asr`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ audio: toBase64(encodeWav(audio)) }),
    })
    const data = await res.json().catch(() => undefined) as { text?: unknown, error?: unknown } | undefined
    if (!res.ok || typeof data?.text !== 'string') {
      return { ok: false, error: typeof data?.error === 'string' ? data.error : `HTTP ${res.status}` }
    }
    return { ok: true, text: data.text }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

/** 告诉后台这个会话在不在通话。后台不认（老版本、出错）返回 false。 */
/** smart-turn：把这一句到目前为止的声音（最后 8 秒，16 kHz PCM16）发给后台，拿回「说完了」的概率。出错就抛。 */
async function turnComplete(samples: Float32Array, sampleRate: number): Promise<number> {
  let audio = resample(samples, sampleRate, TARGET_RATE)
  const max = TARGET_RATE * 8
  if (audio.length > max) audio = audio.subarray(audio.length - max)
  const res = await fetch(`${BASE}/turn`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ audio: toBase64(encodePcm16(audio)) }),
  })
  const data = await res.json().catch(() => undefined) as { probability?: unknown, error?: unknown } | undefined
  if (!res.ok || typeof data?.probability !== 'number') {
    throw new Error(typeof data?.error === 'string' ? data.error : `HTTP ${res.status}`)
  }
  return data.probability
}

async function postActive(sessionId: string, active: boolean, keepalive: boolean): Promise<boolean> {
  try {
    const res = await fetch(`${BASE}/call`, {
      method: 'POST',
      credentials: 'same-origin',
      keepalive,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId, active }),
    })
    return res.ok
  } catch {
    return false
  }
}

// ---------- 对外 ----------

let current: ActiveCall | undefined
let endedNotice: { sessionId: string, text: string, at: number } | undefined
const listeners = new Set<() => void>()

function notify(): void {
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function currentCall(): ActiveCall | undefined {
  return current
}

/** 有电话在打（任何会话）。语音模式的跟读据此让位，免得念两遍。 */
export function isCallActive(): boolean {
  return current !== undefined
}

export interface StartRequest {
  sessionId: string
  actions: InputActions | undefined
  input: InputState | undefined
}

/**
 * 接通。必须在点按的同步代码里调用：解锁播放、建采集用的 AudioContext 都要在用户手势里。
 * 返回一句不能接通的原因，能接通返回 undefined。
 */
export function startCall(request: StartRequest): string | undefined {
  if (current !== undefined) {
    if (current.sessionId === request.sessionId) return undefined
    current.hangup()
  }
  const { actions, input } = request
  if (actions === undefined || input === undefined) return '输入框还没准备好，稍后再试'
  if (input.attachmentIds.length > 0) return '草稿里有附件：先发出去或删掉，再打电话'
  if (speech === undefined) return '语音识别服务不可用：请在插件页启用官方「语音输入」'
  // 下面两步都要在点按里：播放（朗读、提示音）和采集
  speaker.unlock()
  const mic = Mic.create()
  if (mic === undefined) return '这个浏览器不能录音'
  endedNotice = undefined
  const call = new ActiveCall(request.sessionId, mic, actions, input)
  current = call
  // 打开电话前已经存在的回复当作念过了（Follower 第一次 update 时会这么处理）
  call.controller.subscribe(notify)
  notify()
  call.begin()
  return undefined
}

export function hangupCall(): void {
  current?.hangup()
}

const NO_VIEW: CallView | undefined = undefined

/** 这个会话的通话画面；没在通话返回 undefined。 */
export function useCall(sessionId: string | undefined): CallView | undefined {
  return useSyncExternalStore(subscribe, () => {
    const call = current
    if (call === undefined || sessionId === undefined || call.sessionId !== sessionId) return NO_VIEW
    return call.controller.getView()
  })
}

/** 任何会话在通话。 */
export function useCallActive(): boolean {
  return useSyncExternalStore(subscribe, isCallActive)
}

/** 刚挂断（出错）时给按钮旁显示的一句话。 */
export function useEndedNotice(sessionId: string | undefined): string | undefined {
  return useSyncExternalStore(subscribe, () => endedNotice !== undefined && endedNotice.sessionId === sessionId ? endedNotice.text : undefined)
}
