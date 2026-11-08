import { Recording, RecordingError, toBase64 } from './recorder'

/** 官方语音 Remote（ctx.remote.speech）里本插件用到的部分。返回值都是 Result 形状。 */
export interface SpeechRemote {
  catalog(): Promise<Result<SpeechCatalog>>
  transcribe(request: { audioBase64: string, providerId?: string, language?: string }, signal?: AbortSignal): Promise<Result<{ text: string }>>
}

type Result<T> = { ok: true, value: T } | { ok: false, error: { message: string } }

interface SpeechCatalog {
  maxAudioBytes: number
  maxDurationSeconds: number
  providers: readonly { id: string, preparation: { phase: string } }[]
  selection: { providerId: string, language: string }
}

interface Active {
  run: number
  recording: Recording
  abort: AbortController
  requestedAt: number
  startedAt?: number
  maxSeconds?: number
  released: boolean
  timer?: ReturnType<typeof setTimeout>
  catalog: Promise<SpeechCatalog | string>
}

/** 一次「按住说话」的界面状态。 */
export type Phase =
  | { kind: 'idle' }
  | { kind: 'requesting' }
  | { kind: 'recording', recording: Recording, cancelArmed: boolean, startedAt: number, maxSeconds: number }
  | { kind: 'transcribing' }
  | { kind: 'message', text: string }
  /** 识别出来了但写不进输入框：结果留着，等用户点「插入」或丢弃。 */
  | { kind: 'pending', text: string }

const USABLE = new Set(['ready', 'standby', 'waking'])
/** 按住不到这么久就松手，当作误触，不送去识别。 */
const MIN_RECORDING_MS = 400
/** 麦克风准备超过这么久，多半是弹了授权框：松手后提示再按一次。 */
const PERMISSION_PROMPT_MS = 1200

const FAILURE_TEXT: Record<string, string> = {
  unavailable: '这个浏览器不能录音',
  permission: '麦克风权限被拒绝，请在浏览器或系统设置里允许',
  deviceMissing: '找不到选定的麦克风：请插好设备，或到「语音输入」详情页换一个',
  interrupted: '录音被打断了',
  empty: '没有录到声音',
  cancelled: '已取消',
}

export interface SessionCallbacks {
  setPhase(phase: Phase): void
  /** 把识别结果写进草稿；返回 false 表示写不进去（草稿正在提交等）。 */
  insert(text: string): boolean
}

/**
 * 一个会话里的录音控制：开始、结束、取消。一次只有一段录音。
 * 界面只通过 setPhase 看到状态变化。
 */
export class HoldController {
  private generation = 0
  private active?: Active
  private messageTimer?: ReturnType<typeof setTimeout>

  constructor(private speech: () => SpeechRemote | undefined, private ui: SessionCallbacks) {}

  get busy(): boolean { return this.active !== undefined }

  /** 按下：申请麦克风并开始录。麦克风真正开了才进入 recording。 */
  start(): void {
    if (this.active) return
    // 上一段结果还没插进去：先试着插；还插不进就不开新录音，免得把它盖掉
    if (this.pendingText !== undefined) {
      this.insertPending()
      if (this.pendingText !== undefined) return
    }
    const speech = this.speech()
    if (!speech) {
      this.show('语音识别服务不可用：请在插件页启用官方「语音输入」')
      return
    }
    const run = ++this.generation
    const recording = new Recording()
    const active: Active = {
      run,
      recording,
      abort: new AbortController(),
      requestedAt: Date.now(),
      released: false,
      catalog: speech.catalog().then(
        (result): SpeechCatalog | string => result.ok ? result.value : result.error.message,
        (error: unknown) => error instanceof Error ? error.message : String(error),
      ),
    }
    this.active = active
    this.setPhase({ kind: 'requesting' })
    // 告诉 dsh-voice-reply：要开始说话了，停止朗读（免得麦克风录进朗读的声音）
    window.dispatchEvent(new Event('dsh-voice-hold:recording'))
    recording.start(() => {
      if (this.active === active) {
        this.drop()
        this.show(FAILURE_TEXT.interrupted!)
      }
    }).then(async () => {
      if (this.active !== active) return
      const catalog = await active.catalog
      if (this.active !== active) return
      const problem = unusable(catalog)
      if (problem !== undefined) {
        this.drop()
        this.show(problem)
        return
      }
      if (Date.now() - active.requestedAt > PERMISSION_PROMPT_MS) {
        // 多半是弹了授权框：按住状态已经被打断（松手事件可能根本没送到），这次不录
        this.drop()
        this.show('麦克风已就绪，请再按住说话')
        return
      }
      if (active.released) {
        this.drop()
        this.show('按住的时间太短')
        return
      }
      active.startedAt = Date.now()
      active.maxSeconds = (catalog as SpeechCatalog).maxDurationSeconds
      active.timer = setTimeout(() => {
        // 到上限：自动结束并识别（按住状态也一起结束）
        void this.finish()
      }, active.maxSeconds * 1000)
      this.setPhase({ kind: 'recording', recording, cancelArmed: false, startedAt: active.startedAt, maxSeconds: active.maxSeconds })
    }, (error: unknown) => {
      if (this.active !== active) return
      this.active = undefined
      this.show(failureText(error))
    })
  }

  /** 上滑取消的「预备」提示（手机）。 */
  armCancel(armed: boolean): void {
    const active = this.active
    if (!active?.startedAt || active.released) return
    this.setPhase({ kind: 'recording', recording: active.recording, cancelArmed: armed, startedAt: active.startedAt, maxSeconds: active.maxSeconds ?? 0 })
  }

  /** 松手：录够了就送去识别。 */
  async finish(): Promise<void> {
    const active = this.active
    if (!active || active.released) return
    active.released = true
    if (active.startedAt === undefined) return // 还在申请麦克风，start() 里接着处理
    clearTimeout(active.timer)
    if (Date.now() - active.startedAt < MIN_RECORDING_MS) {
      this.drop()
      this.show('按住的时间太短')
      return
    }
    this.setPhase({ kind: 'transcribing' })
    try {
      const catalog = await active.catalog as SpeechCatalog
      const audio = await active.recording.stop(catalog.maxDurationSeconds)
      if (this.active !== active) return
      if (audio.byteLength > catalog.maxAudioBytes) {
        this.active = undefined
        this.show('录音太长了')
        return
      }
      const speech = this.speech()
      if (!speech) throw new Error('语音识别服务已断开')
      const result = await speech.transcribe({ audioBase64: toBase64(audio), ...catalog.selection }, active.abort.signal)
      if (this.active !== active) return
      this.active = undefined
      if (!result.ok) {
        this.show(`识别失败：${result.error.message}`)
        return
      }
      const text = result.value.text.trim()
      if (text === '') {
        this.show('没有识别到说话内容')
        return
      }
      if (!this.ui.insert(text)) {
        this.setPhase({ kind: 'pending', text })
        return
      }
      this.setPhase({ kind: 'idle' })
    } catch (error) {
      if (this.active !== active) return
      this.active = undefined
      await active.recording.dispose()
      this.show(failureText(error))
    }
  }

  /** 取消：丢掉录音，不识别。quiet 为 true 时不显示「已取消」。 */
  cancel(quiet = false): void {
    if (!this.active) return
    this.drop()
    if (quiet) this.setPhase({ kind: 'idle' })
    else this.show(FAILURE_TEXT.cancelled!)
  }

  /** 「插入」：把留着的结果再写一次；还是写不进就继续留着。 */
  insertPending(): void {
    if (this.pendingText === undefined) return
    if (this.ui.insert(this.pendingText)) this.setPhase({ kind: 'idle' })
  }

  discardPending(): void {
    if (this.pendingText !== undefined) this.setPhase({ kind: 'idle' })
  }

  private get pendingText(): string | undefined {
    return this.lastPhase?.kind === 'pending' ? this.lastPhase.text : undefined
  }

  dispose(): void {
    this.drop()
    clearTimeout(this.messageTimer)
  }

  private drop(): void {
    const active = this.active
    this.active = undefined
    this.generation++
    if (!active) return
    clearTimeout(active.timer)
    active.abort.abort()
    void active.recording.dispose()
  }

  private show(text: string): void {
    this.setPhase({ kind: 'message', text })
    clearTimeout(this.messageTimer)
    this.messageTimer = setTimeout(() => {
      if (!this.active) this.setPhase({ kind: 'idle' })
    }, 2600)
  }

  private lastPhase?: Phase

  private setPhase(phase: Phase): void {
    if (phase.kind !== 'message') clearTimeout(this.messageTimer)
    this.lastPhase = phase
    this.ui.setPhase(phase)
  }
}

function unusable(catalog: SpeechCatalog | string): string | undefined {
  if (typeof catalog === 'string') return `语音识别不可用：${catalog}`
  const provider = catalog.providers.find(item => item.id === catalog.selection.providerId)
  if (provider === undefined || !USABLE.has(provider.preparation.phase)) {
    return '语音模型还没准备好：请到插件页「语音输入」里下载并准备'
  }
  return undefined
}

function failureText(error: unknown): string {
  if (error instanceof RecordingError) return FAILURE_TEXT[error.kind] ?? error.kind
  if (error instanceof DOMException && error.name === 'AbortError') return FAILURE_TEXT.cancelled!
  return `语音输入失败：${error instanceof Error ? error.message : String(error)}`
}
