import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { hangupCall, startCall, useCall, useEndedNotice, type InputActions } from './call/session'
import { PhoneIcon } from './icons'

type Hook<S> = <T>(select: (state: S) => T) => T
type InputSnapshot = { draft?: string, phase?: string, attachmentIds?: readonly string[] } | undefined
type SessionSnapshot = { removed?: boolean, subagent?: unknown, running?: boolean }

/** conversation.input.right 拿到的标准 Session props（只声明用到的）。 */
interface CallButtonProps {
  sessionId?: string
  useInput?: Hook<InputSnapshot>
  useSession?: Hook<SessionSnapshot>
  inputActions?: InputActions
}

const noInput: Hook<InputSnapshot> = (select) => select(undefined)
const noSession: Hook<SessionSnapshot> = (select) => select({})

/** 官方的发送 / 停止按钮（InputBar 的 primary）。没有 data 属性，只能按类名认；有两个时（在跑又打了字）取最后一个。 */
function findPrimary(card: HTMLElement): HTMLButtonElement | null {
  const list = card.querySelectorAll<HTMLButtonElement>('button[class*="_primary"]:not(.vr-call-send)')
  return list[list.length - 1] ?? null
}

/** 发送按钮外面可能包了一层只装它的元素（悬停提示）：电话放在这一层外面，免得悬停时弹出「发送」。 */
function outerOf(primary: HTMLElement, card: HTMLElement, host: HTMLElement | null): HTMLElement {
  let node: HTMLElement = primary
  for (;;) {
    const parent = node.parentElement
    if (parent === null || parent === card) return node
    let others = 0
    for (const child of Array.from(parent.children)) if (child !== host) others++
    if (others !== 1) return node
    node = parent
  }
}

interface Seat { host: HTMLElement, className: string }

/**
 * 语音通话的入口，和 ChatGPT 一样放在发送按钮的位置：
 * 输入框空着、没附件、agent 没在跑、不在通话时，官方那个灰掉的发送按钮换成电话（同样大小颜色，点一下接通）；
 * 其余时候（有字、有附件、在跑、通话中）都是官方按钮原样。挂断用胶囊上的红色按钮。
 *
 * 官方发送按钮没给插件留位置：本组件挂在 conversation.input.right（同一张卡片里），找到发送按钮后
 * 在它前面放一个占位元素、把电话画进去，并给那个官方按钮打 data-vr-replaced 让 CSS 藏起它。
 * 只在官方按钮是禁用的（空着发不了）时才换，官方认为能发（比如有排队的消息）就不动。
 * 找不到发送按钮（DSH 改了结构）：退回以前那个小电话按钮，保证还能打电话。
 *
 * 接通要在这一下点按里同步完成（解锁声音、建采集），所以不放进 effect。
 */
export function CallButton({ sessionId, useInput, useSession, inputActions }: CallButtonProps) {
  const view = useCall(sessionId)
  const ended = useEndedNotice(sessionId)
  const [refusal, setRefusal] = useState<string | undefined>(undefined)
  const draft = (useInput ?? noInput)((input) => input?.draft ?? '')
  const phase = (useInput ?? noInput)((input) => input?.phase ?? '')
  const attachments = (useInput ?? noInput)((input) => (input?.attachmentIds ?? []).join('\n'))
  const unavailable = (useSession ?? noSession)((session) => session.removed === true || (session.subagent ?? null) !== null)
  const running = (useSession ?? noSession)((session) => session.running === true)
  const active = view !== undefined
  const enabled = sessionId !== undefined && !unavailable
  const want = enabled && !active && !running && draft.trim() === '' && attachments === '' && (phase === 'plain' || phase === '')

  const anchor = useRef<HTMLSpanElement>(null)
  const [seat, setSeat] = useState<Seat | null>(null)
  const [fallback, setFallback] = useState(false)
  const wantRef = useRef(want)
  wantRef.current = want
  const syncRef = useRef<() => void>(() => {})

  useLayoutEffect(() => {
    const card = anchor.current?.closest<HTMLElement>('[data-composer-card]') ?? null
    if (card === null) {
      setFallback(true)
      return
    }
    let host: HTMLElement | null = null
    /** 被换掉（藏起来）的那个官方按钮。只藏它，不按类名一把藏，免得误藏停止按钮。 */
    let replaced: HTMLElement | null = null
    let frame = 0
    const unmark = () => {
      replaced?.removeAttribute('data-vr-replaced')
      replaced = null
    }
    const hide = () => {
      unmark()
      host?.remove()
      setSeat(null)
    }
    const sync = () => {
      frame = 0
      const primary = findPrimary(card)
      setFallback(primary === null)
      if (primary === null || !wantRef.current || !primary.disabled) {
        hide()
        return
      }
      const before = outerOf(primary, card, host)
      if (host === null) {
        host = document.createElement('span')
        host.className = 'vr-call-send-seat'
      }
      if (host.nextSibling !== before || host.parentElement !== before.parentElement) before.parentElement?.insertBefore(host, before)
      if (replaced !== primary) {
        unmark()
        primary.setAttribute('data-vr-replaced', '')
        replaced = primary
      }
      const next: Seat = { host, className: primary.className }
      setSeat((current) => (current?.host === next.host && current.className === next.className ? current : next))
    }
    syncRef.current = sync
    sync()
    // 官方按钮的禁用状态、结构可能因为别的原因变（没走我们的 props）：跟着重看
    const observer = new MutationObserver(() => { if (frame === 0) frame = requestAnimationFrame(sync) })
    observer.observe(card, { subtree: true, childList: true, attributes: true, attributeFilter: ['disabled'] })
    return () => {
      observer.disconnect()
      cancelAnimationFrame(frame)
      syncRef.current = () => {}
      hide()
    }
  }, [])

  useLayoutEffect(() => { syncRef.current() }, [want])

  useEffect(() => {
    if (refusal === undefined) return
    const timer = setTimeout(() => setRefusal((current) => (current === refusal ? undefined : current)), 4000)
    return () => clearTimeout(timer)
  }, [refusal])

  if (!enabled) return <span ref={anchor} className="vr-call-anchor" />
  const notice = refusal ?? ended

  const onClick = () => {
    if (active) {
      hangupCall()
      return
    }
    setRefusal(startCall({
      sessionId,
      actions: inputActions,
      input: inputActions === undefined ? undefined : { draft, phase, attachmentIds: attachments === '' ? [] : attachments.split('\n') },
    }))
  }

  const noticeEl = notice !== undefined && !active ? <span className="vr-call-notice" role="status">{notice}</span> : null

  // 找不到官方发送按钮：以前那个小电话按钮，通话中再点就挂断
  if (fallback) {
    const label = active ? '挂断语音通话' : '语音通话：说话直接发送，回复读给你听'
    return (
      <span ref={anchor} className="vr-call-wrap">
        <button type="button" className="vr-call" data-active={active ? '' : undefined} aria-label={label} title={label} onClick={onClick}>
          <PhoneIcon hangup={active} />
        </button>
        {noticeEl}
      </span>
    )
  }

  const label = '语音通话：说话直接发送，回复读给你听'
  return (
    <span ref={anchor} className="vr-call-anchor">
      {seat !== null && createPortal(
        <span className="vr-call-wrap">
          <button type="button" className={`${seat.className} vr-call-send`} aria-label={label} title={label} onClick={onClick}>
            <PhoneIcon />
          </button>
          {noticeEl}
        </span>,
        seat.host,
      )}
    </span>
  )
}
