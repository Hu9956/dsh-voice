import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { APPENDED_NOTICE, type CallPhase, type CallView } from './call/controller'
import { currentCall, useCall, type InputActions } from './call/session'
import { selectProgress } from './call/intent'
import { mirrorGlass } from './call-glass'
import { useCallVisual } from './call-visual'
import { selectTurn } from './follow'
import { MicIcon, PhoneIcon } from './icons'
import { changeSpeechRate, formatRate, useSettings } from './settings'

type Hook<S> = <T>(select: (state: S) => T) => T
type InputSnapshot = { draft?: string, phase?: string, attachmentIds?: readonly string[] } | undefined
type SessionSnapshot = { running?: boolean }

/** conversation.input.overlay 拿到的标准 Session props（只声明用到的）。 */
interface CallPanelProps {
  sessionId?: string
  useChat?: Hook<unknown>
  useInput?: Hook<InputSnapshot>
  useSession?: Hook<SessionSnapshot>
  inputActions?: InputActions
  /** 和输入框「停止生成」按钮同一个：让这个会话的 agent 停下。 */
  stop?: () => void
}

const noChat: Hook<unknown> = (select) => select(undefined)
const noInput: Hook<InputSnapshot> = (select) => select(undefined)
const noSession: Hook<SessionSnapshot> = (select) => select({})
const nothing = (): string => ''

const STATUS: Record<CallPhase, string> = {
  connecting: '正在接通',
  listening: '在听',
  hearing: '在听你说',
  transcribing: '识别中',
  thinking: '在想',
  working: '在干活',
  speaking: '在说',
  'needs-you': '需要你在屏幕上确认',
  muted: '已静音',
  paused: '已暂停',
  ended: '已挂断',
}

const HINT: Record<CallPhase, string> = {
  connecting: '请允许使用麦克风',
  listening: '说吧，停一下就发出去',
  hearing: '说完停一下，或点「说完了」',
  transcribing: '',
  thinking: '点这里可以直接说',
  working: '点这里可以插话',
  speaking: '点这里打断',
  'needs-you': '处理完会接着通话',
  muted: '点麦克风取消静音',
  paused: '点这里继续',
  ended: '',
}

/** 输入框里有字时，说的话不自动发，接到草稿末尾。 */
const COMPOSING_HINT: Partial<Record<CallPhase, string>> = {
  listening: '输入框里有字：说的话会接在末尾，不自动发',
  hearing: '说完停一下，会接到输入框末尾',
}

/**
 * 通话胶囊：通话中出现在输入框正上方，输入框照常露着、能打字。
 * 胶囊插在输入框卡片（data-composer-card）前面、跟它同一层，输入区整体变高，不会盖住对话。
 * 它只是视图：通话本身在 call/session 里，审批、提问把输入栏换掉时胶囊卸载，电话照常进行。
 * 挂着的时候顺手把对话内容（给跟读）和输入框状态（给自动发送、接草稿）喂给通话。
 */
export function CallPanel({ sessionId, useChat, useInput, useSession, inputActions, stop }: CallPanelProps) {
  const view = useCall(sessionId)
  const active = view !== undefined
  const anchor = useRef<HTMLDivElement>(null)
  const [seat, setSeat] = useState<HTMLElement | null>(null)
  // 不在通话时不订阅对话内容，免得每写一个字都重渲染
  const signature = (useChat ?? noChat)(active ? selectTurn : nothing)
  // 问「进度怎么样」时念的：这一轮走了几步、刚才在用什么工具、最近一句
  const progress = (useChat ?? noChat)(active ? selectProgress : nothing)
  const draft = (useInput ?? noInput)((input) => input?.draft ?? '')
  const phase = (useInput ?? noInput)((input) => input?.phase ?? '')
  const attachments = (useInput ?? noInput)((input) => (input?.attachmentIds ?? []).join('\n'))
  const running = (useSession ?? noSession)((session) => session.running === true)
  const composing = draft.trim() !== '' || attachments !== ''

  // 通话中在输入框卡片前面放一个空 div 当胶囊的位置，挂断就拿掉
  useLayoutEffect(() => {
    if (!active) return
    const card = anchor.current?.closest<HTMLElement>('[data-composer-card]')
    const parent = card?.parentElement
    if (card == null || parent == null) return
    const host = document.createElement('div')
    host.className = 'vr-call-seat'
    parent.insertBefore(host, card)
    // 胶囊的玻璃照抄输入框卡片实际画出来的样子
    const stopGlass = mirrorGlass(card, host)
    setSeat(host)
    return () => {
      stopGlass()
      host.remove()
      setSeat(null)
    }
  }, [active])

  useEffect(() => {
    if (!active) return
    const call = currentCall()
    if (call === undefined || call.sessionId !== sessionId) return
    return call.addViewer()
  }, [active, sessionId])

  useEffect(() => {
    if (!active) return
    const call = currentCall()
    if (call === undefined || call.sessionId !== sessionId) return
    call.observeInput(inputActions, { draft, phase, attachmentIds: attachments === '' ? [] : attachments.split('\n') }, running)
  }, [active, sessionId, inputActions, draft, phase, attachments, running])

  useEffect(() => {
    if (!active) return
    const call = currentCall()
    if (call === undefined || call.sessionId !== sessionId) return
    call.feedChat(signature)
  }, [active, sessionId, signature])

  useEffect(() => {
    if (!active) return
    const call = currentCall()
    if (call === undefined || call.sessionId !== sessionId) return
    call.observeAgent(stop, progress)
  }, [active, sessionId, stop, progress])

  return (
    <div ref={anchor} className="vr-call-anchor">
      {view !== undefined && seat !== null && createPortal(<Panel view={view} composing={composing} />, seat)}
    </div>
  )
}

function Panel({ view, composing }: { view: CallView, composing: boolean }) {
  const call = () => currentCall()
  const { canvasRef, avatarRef, tone } = useCallVisual(view.phase)
  const heardShown = view.heard !== '' && (view.phase === 'thinking' || view.phase === 'working' || view.phase === 'transcribing')
  const hint = (composing ? COMPOSING_HINT[view.phase] : undefined) ?? HINT[view.phase]
  const sub = view.notice !== '' ? view.notice : heardShown ? `你说：${view.heard}` : hint
  return (
    <div className="vr-call-panel" data-phase={view.phase} data-tone={tone} role="region" aria-label="语音通话">
      <canvas ref={canvasRef} className="vr-call-wave" aria-hidden="true" />
      <button
        type="button"
        className="vr-call-main"
        onClick={() => call()?.tap()}
        aria-label={`${STATUS[view.phase]}${sub === '' ? '' : `，${sub}`}`}
      >
        <span ref={avatarRef} className="vr-call-avatar" aria-hidden="true">
          <span className="vr-call-avatar-ring" />
        </span>
        <span className="vr-call-text" aria-live="polite">
          <span className="vr-call-status">{STATUS[view.phase]}</span>
          {sub !== '' && <span className="vr-call-sub" data-notice={view.notice === '' ? undefined : view.notice === APPENDED_NOTICE ? 'info' : 'warn'}>{sub}</span>}
        </span>
      </button>
      <div className="vr-call-actions">
        <button
          type="button"
          className="vr-call-btn vr-call-done"
          hidden={view.phase !== 'hearing'}
          onClick={() => call()?.done()}
        >
          说完了
        </button>
        <RateButton />
        <button
          type="button"
          className="vr-call-btn vr-call-icon"
          data-on={view.muted ? '' : undefined}
          aria-label={view.muted ? '取消静音' : '静音'}
          aria-pressed={view.muted}
          title={view.muted ? '取消静音' : '静音'}
          onClick={() => call()?.toggleMute()}
        >
          <MicIcon muted={view.muted} />
        </button>
        <button
          type="button"
          className="vr-call-btn vr-call-icon vr-call-hangup"
          aria-label="挂断"
          title="挂断"
          onClick={() => call()?.hangup()}
        >
          <PhoneIcon hangup />
        </button>
      </div>
    </div>
  )
}

/**
 * 语速按钮：点一下换下一档（1× → 1.25× → 1.5× → 2× → 1×），存进设置，语音模式的朗读也用这个语速。
 * 百炼一段朗读开始后改不了语速，所以正在念的这段照旧，从下一段起变。旧版服务端没有语速就不显示。
 */
function RateButton() {
  const { view } = useSettings()
  const rates = view?.catalog.speechRates ?? []
  const current = view?.settings.speechRate
  if (rates.length === 0 || typeof current !== 'number') return null
  const index = rates.indexOf(current)
  const next = rates[(index + 1) % rates.length] ?? rates[0]!
  const label = `语速 ${formatRate(current)}，点一下换成 ${formatRate(next)}（下一句起生效）`
  return (
    <button
      type="button"
      className="vr-call-btn vr-call-rate"
      data-on={current !== 1 ? '' : undefined}
      aria-label={label}
      title={label}
      onClick={() => { changeSpeechRate(next).catch((error: unknown) => console.warn('[voice-reply] 换语速失败', error)) }}
    >
      {formatRate(current)}
    </button>
  )
}
