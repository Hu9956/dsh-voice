import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { Phase } from './controller'
import { sessionEntry, usePhase, type InputActions } from './store'

type Hook<S> = <T>(select: (state: S) => T) => T

/** conversation.input.overlay 拿到的标准 Session props（只声明用到的）。 */
export interface HoldOverlayProps {
  sessionId: string
  useInput?: Hook<{ draft: string, attachmentIds: readonly string[], phase: string } | undefined>
  useSession?: Hook<{ running?: boolean, removed?: boolean, subagent?: unknown }>
  inputActions?: InputActions
}

/** 宽度 ≤ 600 或主要靠触摸操作时，用手机方案。 */
const PHONE_QUERY = '(width <= 600px), (pointer: coarse)'
/** 按住不动这么久才开始录音，短按仍是放光标 / 弹键盘。 */
const HOLD_DELAY_MS = 400
/** 电脑：按住期间鼠标移动超过这个距离，当作在选字，不录音。 */
const MOVE_TOLERANCE_PX = 6
/** 手机：录音开始前手指移动超过这个距离，当作在滚动，不录音。 */
const TOUCH_SLOP_PX = 10
/** 手机：录音中手指上移超过这个距离，松手就取消。 */
const CANCEL_SWIPE_PX = 60

/** 输入框为空时的提示文字（只替换官方默认那一句）。 */
const HINT_DESKTOP = (official: string) => `${official}, 按住鼠标语音输入`
const HINT_PHONE = () => '按住说话，轻点打字'

function usePhone(): boolean {
  const [phone, setPhone] = useState(() => window.matchMedia(PHONE_QUERY).matches)
  useEffect(() => {
    const media = window.matchMedia(PHONE_QUERY)
    const update = () => setPhone(media.matches)
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])
  return phone
}

/**
 * 输入卡片里的「按住说话」：
 * - 电脑：在输入框文字区按住鼠标左键不动 0.4 秒开始录，松开结束；移动鼠标就是选字，不录。
 *   识别结果插到光标处。
 * - 手机：键盘没弹出（输入框没获得焦点）时，在输入框上按住 0.4 秒开始录，松手结束，上滑取消；
 *   轻点一下照常弹出键盘打字。键盘弹出后长按就是系统的选字、粘贴。识别结果追加到草稿末尾。
 * 两端都不自动发送。
 */
export function HoldOverlay({ sessionId, useInput, useSession, inputActions }: HoldOverlayProps) {
  const anchor = useRef<HTMLDivElement>(null)
  const [card, setCard] = useState<HTMLElement | null>(null)
  const phone = usePhone()
  const phase = usePhase(sessionId)
  const inputPlain = useInput?.(input => input?.phase === 'plain') ?? false
  const unavailable = useSession?.(session => session.removed === true || (session.subagent ?? null) !== null) ?? true

  const entry = sessionEntry(sessionId)
  entry.actions = inputActions
  entry.insertAt = phone ? 'end' : 'caret'
  entry.draftEnd = () => draftEnd(card)

  useLayoutEffect(() => {
    setCard(anchor.current?.closest<HTMLElement>('[data-composer-card]') ?? null)
  }, [])

  // 切走会话或卸载时丢掉录音
  useEffect(() => () => { entry.controller.cancel(true) }, [sessionId, entry])

  const allowed = !unavailable && inputActions !== undefined && inputPlain
  useDesktopHold(card, sessionId, !phone && allowed)
  usePhoneHold(card, sessionId, phone && allowed)
  usePlaceholder(card, allowed ? (phone ? HINT_PHONE : HINT_DESKTOP) : undefined)
  useNoAutoKeyboard(card, sessionId, phone && allowed)
  useBlurOnKeyboardClose(card, phone && allowed)
  useEscapeCancel(sessionId, phase)

  useEffect(() => {
    if (card === null) return
    const touch = phone && allowed
    card.toggleAttribute('data-vh-touch', touch)
    return () => card.removeAttribute('data-vh-touch')
  }, [card, phone, allowed])

  useEffect(() => {
    if (card === null) return
    card.toggleAttribute('data-vh-holding', phase.kind === 'requesting' || phase.kind === 'recording')
    return () => card.removeAttribute('data-vh-holding')
  }, [card, phase.kind])

  return (
    <div ref={anchor} className="vh-anchor">
      {phase.kind !== 'idle' && <Status phase={phase} phone={phone} sessionId={sessionId} />}
    </div>
  )
}

function editorOf(card: HTMLElement | null): HTMLElement | null {
  return card?.querySelector<HTMLElement>('[data-input-scroll] [contenteditable]') ?? null
}

/**
 * 草稿末尾在官方坐标里的位置：草稿里只有纯文字时等于文字长度。
 * 有引用 chip 等装饰节点时坐标对不上，返回 undefined（退回插到光标处）。
 */
function draftEnd(card: HTMLElement | null): number | undefined {
  const editor = editorOf(card)
  if (editor === null) return undefined
  if (editor.querySelector('[data-lexical-decorator]') !== null) return undefined
  const paragraphs = Array.from(editor.children)
  const text = paragraphs.map(p => p.textContent ?? '').join('\n')
  return text.length
}

/**
 * 官方提示文字：只在显示官方默认那一句时换成我们的提示（禁用、已归档、计划模式等其他提示保留原文）。
 * 官方每次渲染会写回自己的值，所以用 MutationObserver 跟着改。
 */
function usePlaceholder(card: HTMLElement | null, hintFor: ((official: string) => string) | undefined): void {
  useEffect(() => {
    if (card === null || hintFor === undefined) return
    const DEFAULTS = new Set([
      '发消息或创建任务, / 调用指令, @ 文件或对话',
      'Message or run a task, / commands, @ files or sessions',
    ])
    const originals = new Map<Element, string>()
    const hints = new Set<string>()
    let applying = false
    const apply = () => {
      if (applying) return
      applying = true
      try {
        const editor = editorOf(card)
        if (editor !== null) {
          const value = editor.getAttribute('data-placeholder')
          if (value !== null && DEFAULTS.has(value)) {
            const hint = hintFor(value)
            hints.add(hint)
            originals.set(editor, value)
            editor.setAttribute('data-placeholder', hint)
            if (editor.getAttribute('aria-label') === value) editor.setAttribute('aria-label', hint)
          }
        }
        const shown = card.querySelector('[data-composer-placeholder]')
        if (shown !== null && shown.textContent !== null && DEFAULTS.has(shown.textContent)) {
          const hint = hintFor(shown.textContent)
          hints.add(hint)
          originals.set(shown, shown.textContent)
          shown.textContent = hint
        }
      } finally {
        applying = false
      }
    }
    apply()
    const observer = new MutationObserver(apply)
    observer.observe(card, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['data-placeholder'] })
    return () => {
      observer.disconnect()
      for (const [element, value] of originals) {
        if (!element.isConnected) continue
        if (element.hasAttribute('data-composer-placeholder')) {
          if (hints.has(element.textContent ?? '')) element.textContent = value
        } else if (hints.has(element.getAttribute('data-placeholder') ?? '')) {
          element.setAttribute('data-placeholder', value)
          if (hints.has(element.getAttribute('aria-label') ?? '')) element.setAttribute('aria-label', value)
        }
      }
    }
  }, [card, hintFor])
}

/** 手指在输入卡片里按下后这么久之内获得的焦点，算用户自己点的。 */
const USER_FOCUS_WINDOW_MS = 1000

/**
 * 手机：官方打开对话时会自动聚焦输入框，安卓上会直接弹出键盘，就没法按住说话了。
 * 这里只放行「手指刚在输入卡片里按过」之后的聚焦（轻点输入框、点 / 按钮等），
 * 其他自动聚焦（打开对话、切换对话）立刻取消，键盘不弹。键盘已经在时不受影响。
 */
function useNoAutoKeyboard(card: HTMLElement | null, sessionId: string, enabled: boolean): void {
  useEffect(() => {
    if (card === null || !enabled) return
    let touchedAt = -Infinity
    const onDown = () => { touchedAt = Date.now() }
    const onFocus = (event: FocusEvent) => {
      const editor = editorOf(card)
      if (editor === null || !(event.target instanceof Node) || !editor.contains(event.target)) return
      if (Date.now() - touchedAt <= USER_FOCUS_WINDOW_MS) return
      editor.blur()
    }
    card.addEventListener('pointerdown', onDown, true)
    card.addEventListener('touchstart', onDown, { capture: true, passive: true })
    card.addEventListener('focusin', onFocus)
    // 挂上之前就已经被自动聚焦了（首次打开对话）：也收起来
    const editor = editorOf(card)
    if (editor !== null && (document.activeElement === editor || editor.contains(document.activeElement))) editor.blur()
    return () => {
      card.removeEventListener('pointerdown', onDown, true)
      card.removeEventListener('touchstart', onDown, { capture: true })
      card.removeEventListener('focusin', onFocus)
    }
  }, [card, sessionId, enabled])
}

/** 可视区域比同宽度下见过的最大高度矮这么多，就当键盘是开着的。 */
const KEYBOARD_MIN_PX = 150

/**
 * 手机：键盘收起后（安卓返回键、键盘上的收起键），输入框仍然保留焦点和光标，
 * 长按就还是系统选字，没法按住说话。这里在键盘收起时让输入框失焦，回到「按住说话，轻点打字」。
 * 草稿内容和光标位置由编辑器自己保存，失焦不会丢字。
 */
function useBlurOnKeyboardClose(card: HTMLElement | null, enabled: boolean): void {
  useEffect(() => {
    if (card === null || !enabled) return
    const viewport = window.visualViewport
    if (!viewport) return
    let width = viewport.width
    let tallest = viewport.height
    let open = false
    const onResize = () => {
      if (Math.abs(viewport.width - width) > 1) {
        // 转屏：重新记基准
        width = viewport.width
        tallest = viewport.height
        open = false
        return
      }
      tallest = Math.max(tallest, viewport.height)
      const nowOpen = tallest - viewport.height > KEYBOARD_MIN_PX
      if (open && !nowOpen) {
        const editor = editorOf(card)
        if (editor !== null && (document.activeElement === editor || editor.contains(document.activeElement))) editor.blur()
      }
      open = nowOpen
    }
    viewport.addEventListener('resize', onResize)
    return () => viewport.removeEventListener('resize', onResize)
  }, [card, enabled])
}

/**
 * 手机：键盘没弹出时，在输入框上按住开始录。
 * 触摸开始时拦住系统默认行为（否则长按会弹出选字 / 粘贴菜单），所以轻点要我们自己把焦点和光标放回去。
 * 输入框已经获得焦点（键盘在）时完全不管，长按是系统的选字、粘贴。
 */
function usePhoneHold(card: HTMLElement | null, sessionId: string, enabled: boolean): void {
  useEffect(() => {
    if (card === null || !enabled) return
    const scroll = card.querySelector<HTMLElement>('[data-input-scroll]')
    if (scroll === null) return
    const controller = sessionEntry(sessionId).controller
    let touch: {
      id: number, x: number, y: number, timer: ReturnType<typeof setTimeout>,
      recording: boolean, armed: boolean, moved: boolean,
    } | undefined

    const editor = () => editorOf(card)
    const focused = () => {
      const el = editor()
      return el !== null && (document.activeElement === el || el.contains(document.activeElement))
    }
    const reset = () => {
      if (touch !== undefined) clearTimeout(touch.timer)
      touch = undefined
    }
    const onStart = (event: TouchEvent) => {
      if (event.touches.length !== 1) {
        if (touch?.recording) controller.cancel()
        reset()
        return
      }
      if (focused() || controller.busy) return
      const target = event.target as Element | null
      if (target?.closest('button, a, [role="button"], [data-lexical-decorator]')) return
      const point = event.touches[0]!
      // 拦住系统长按（选字、粘贴菜单、放大镜）；滚动、轻点由下面自己处理
      event.preventDefault()
      reset()
      touch = {
        id: point.identifier, x: point.clientX, y: point.clientY, recording: false, armed: false, moved: false,
        timer: setTimeout(() => {
          if (touch === undefined || touch.moved) return
          touch.recording = true
          if ('vibrate' in navigator) navigator.vibrate?.(15)
          controller.start()
        }, HOLD_DELAY_MS),
      }
    }
    const onMove = (event: TouchEvent) => {
      if (touch === undefined) return
      const point = Array.from(event.changedTouches).find(t => t.identifier === touch!.id)
      if (point === undefined) return
      event.preventDefault()
      if (touch.recording) {
        const armed = touch.y - point.clientY > CANCEL_SWIPE_PX
        if (armed !== touch.armed) {
          touch.armed = armed
          controller.armCancel(armed)
        }
        return
      }
      const dy = point.clientY - touch.y
      if (!touch.moved && Math.hypot(point.clientX - touch.x, dy) > TOUCH_SLOP_PX) {
        touch.moved = true
        clearTimeout(touch.timer)
      }
      // 拦了默认行为后草稿区不会自己滚，这里手动滚
      if (touch.moved) {
        scroll.scrollTop -= dy
        touch.y = point.clientY
      }
    }
    const onEnd = (event: TouchEvent) => {
      const current = touch
      if (current === undefined) return
      const point = Array.from(event.changedTouches).find(t => t.identifier === current.id)
      if (point === undefined) return
      event.preventDefault()
      reset()
      if (current.recording) {
        if (current.armed) controller.cancel()
        else void controller.finish()
        return
      }
      if (!current.moved) focusAt(editor(), point.clientX, point.clientY)
    }
    const onCancel = () => {
      if (touch?.recording) controller.cancel()
      reset()
    }
    const onContextMenu = (event: Event) => {
      if (!focused()) event.preventDefault()
    }
    scroll.addEventListener('touchstart', onStart, { passive: false })
    scroll.addEventListener('touchmove', onMove, { passive: false })
    scroll.addEventListener('touchend', onEnd, { passive: false })
    scroll.addEventListener('touchcancel', onCancel)
    scroll.addEventListener('contextmenu', onContextMenu)
    return () => {
      scroll.removeEventListener('touchstart', onStart)
      scroll.removeEventListener('touchmove', onMove)
      scroll.removeEventListener('touchend', onEnd)
      scroll.removeEventListener('touchcancel', onCancel)
      scroll.removeEventListener('contextmenu', onContextMenu)
      if (touch?.recording) controller.cancel(true)
      reset()
    }
  }, [card, sessionId, enabled])
}

/** 轻点：聚焦输入框（弹出键盘），光标放到手指点的位置；点在文字外面就放到末尾。 */
function focusAt(editor: HTMLElement | null, x: number, y: number): void {
  if (editor === null) return
  // 先按坐标算好光标位置（聚焦后布局可能因键盘弹出而变化）
  let range = caretRange(x, y)
  if (range === null || !editor.contains(range.startContainer)) {
    range = document.createRange()
    range.selectNodeContents(editor)
    range.collapse(false)
  }
  const place = () => {
    const selection = window.getSelection()
    if (selection === null || !range!.startContainer.isConnected) return
    selection.removeAllRanges()
    selection.addRange(range!)
  }
  editor.focus({ preventScroll: true })
  place()
  // 编辑器聚焦时会恢复它记住的选区，下一帧再放一次
  requestAnimationFrame(place)
}

function caretRange(x: number, y: number): Range | null {
  const doc = document as Document & {
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node, offset: number } | null
    caretRangeFromPoint?: (x: number, y: number) => Range | null
  }
  if (typeof doc.caretPositionFromPoint === 'function') {
    const position = doc.caretPositionFromPoint(x, y)
    if (position === null) return null
    const range = document.createRange()
    range.setStart(position.offsetNode, position.offset)
    range.collapse(true)
    return range
  }
  return doc.caretRangeFromPoint?.(x, y) ?? null
}

function useDesktopHold(card: HTMLElement | null, sessionId: string, enabled: boolean): void {
  useEffect(() => {
    if (card === null || !enabled) return
    const controller = sessionEntry(sessionId).controller
    let pending: { x: number, y: number, timer: ReturnType<typeof setTimeout>, recording: boolean } | undefined

    const clear = () => {
      if (pending !== undefined) clearTimeout(pending.timer)
      pending = undefined
      window.removeEventListener('pointermove', onMove, true)
      window.removeEventListener('pointerup', onUp, true)
      window.removeEventListener('pointercancel', onCancel, true)
    }
    const onDown = (event: PointerEvent) => {
      if (event.pointerType !== 'mouse' || event.button !== 0) return
      if (event.shiftKey || event.altKey || event.metaKey || event.ctrlKey || event.detail > 1) return
      const target = event.target as Element | null
      const editor = target?.closest('[data-input-scroll]')
      if (!editor || !card.contains(editor)) return
      // 点在引用 chip 等控件上不算
      if (target?.closest('button, a, [role="button"], [data-lexical-decorator]')) return
      if (editor.querySelector('[contenteditable="true"]') === null) return
      if (controller.busy) return
      clear()
      pending = {
        x: event.clientX,
        y: event.clientY,
        recording: false,
        timer: setTimeout(() => {
          if (pending === undefined) return
          pending.recording = true
          controller.start()
        }, HOLD_DELAY_MS),
      }
      window.addEventListener('pointermove', onMove, true)
      window.addEventListener('pointerup', onUp, true)
      window.addEventListener('pointercancel', onCancel, true)
    }
    const onMove = (event: PointerEvent) => {
      if (pending === undefined) return
      if (Math.hypot(event.clientX - pending.x, event.clientY - pending.y) <= MOVE_TOLERANCE_PX) return
      // 在拖动选字：录音还没开始就不录；已经开始就取消
      if (pending.recording) controller.cancel()
      clear()
    }
    const onUp = () => {
      const recording = pending?.recording === true
      clear()
      if (recording) void controller.finish()
    }
    const onCancel = () => {
      const recording = pending?.recording === true
      clear()
      if (recording) controller.cancel()
    }
    const onBlur = () => {
      if (pending?.recording) controller.cancel()
      clear()
    }
    card.addEventListener('pointerdown', onDown)
    window.addEventListener('blur', onBlur)
    return () => {
      card.removeEventListener('pointerdown', onDown)
      window.removeEventListener('blur', onBlur)
      if (pending?.recording) controller.cancel(true)
      clear()
    }
  }, [card, sessionId, enabled])
}

function useEscapeCancel(sessionId: string, phase: Phase): void {
  const active = phase.kind === 'requesting' || phase.kind === 'recording' || phase.kind === 'transcribing'
  useEffect(() => {
    if (!active) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      sessionEntry(sessionId).controller.cancel()
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [active, sessionId])
}


/** 剩这么多秒时开始显示倒计时。 */
const COUNTDOWN_SECONDS = 10

/** 卡片上方的状态条：准备中 / 声波 / 识别中 / 提示 / 待插入的结果。 */
function Status({ phase, phone, sessionId }: { phase: Phase, phone: boolean, sessionId: string }) {
  if (phase.kind === 'message') return <div className="vh-status" role="status">{phase.text}</div>
  if (phase.kind === 'requesting') return <div className="vh-status" role="status"><span className="vh-dot" />正在打开麦克风…</div>
  if (phase.kind === 'transcribing') return <div className="vh-status" role="status"><span className="vh-dot" />正在识别…</div>
  if (phase.kind === 'pending') return <PendingResult text={phase.text} sessionId={sessionId} />
  if (phase.kind !== 'recording') return null
  return <Recording phase={phase} phone={phone} />
}

function Recording({ phase, phone }: { phase: Extract<Phase, { kind: 'recording' }>, phone: boolean }) {
  const left = useSecondsLeft(phase.startedAt, phase.maxSeconds)
  const ending = left !== undefined && left <= COUNTDOWN_SECONDS
  const hint = phase.cancelArmed
    ? '松开手指，取消'
    : ending ? `${left} 秒后自动结束` : phone ? '上滑取消' : '松开结束 · 移动鼠标或 Esc 取消'
  return (
    <div className="vh-status vh-recording" data-armed={phase.cancelArmed || undefined} data-ending={ending || undefined} role="status">
      <span className="vh-rec" />
      <Waveform recording={phase.recording} />
      <span className="vh-hint">{hint}</span>
    </div>
  )
}

function useSecondsLeft(startedAt: number, maxSeconds: number): number | undefined {
  const compute = () => maxSeconds > 0 ? Math.max(0, Math.ceil(maxSeconds - (Date.now() - startedAt) / 1000)) : undefined
  const [left, setLeft] = useState(compute)
  useEffect(() => {
    setLeft(compute())
    const timer = setInterval(() => setLeft(compute()), 250)
    return () => clearInterval(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startedAt, maxSeconds])
  return left
}

/** 识别结果写不进输入框（比如正在提交）：结果留着，点「插入」再写，或丢弃。 */
function PendingResult({ text, sessionId }: { text: string, sessionId: string }) {
  const controller = sessionEntry(sessionId).controller
  return (
    <div className="vh-status vh-pending" role="status">
      <span className="vh-pending-text" title={text}>{text}</span>
      <button type="button" className="vh-action" onMouseDown={e => e.preventDefault()} onClick={() => controller.insertPending()}>插入</button>
      <button type="button" className="vh-action vh-quiet" aria-label="丢弃识别结果" onMouseDown={e => e.preventDefault()} onClick={() => controller.discardPending()}>丢弃</button>
    </div>
  )
}

function Waveform({ recording }: { recording: { amplitude(): number } }) {
  const svg = useRef<SVGSVGElement>(null)
  useEffect(() => {
    const lines = Array.from(svg.current?.querySelectorAll('line') ?? []).reverse()
    const levels = lines.map(() => 0)
    let frame = 0
    let last = -Infinity
    const draw = (now: number) => {
      if (now - last >= 50) {
        last = now
        levels.unshift(recording.amplitude())
        levels.length = lines.length
        lines.forEach((line, i) => {
          const h = 1 + Math.min(1, (levels[i] ?? 0) * 5) * 8
          line.setAttribute('y1', String(10 - h))
          line.setAttribute('y2', String(10 + h))
        })
      }
      frame = requestAnimationFrame(draw)
    }
    frame = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(frame)
  }, [recording])
  return (
    <svg ref={svg} className="vh-wave" viewBox="0 0 120 20" preserveAspectRatio="none" aria-hidden>
      {Array.from({ length: 20 }, (_, i) => (
        <line key={i} x1={i * 6 + 3} x2={i * 6 + 3} y1="9" y2="11" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
      ))}
    </svg>
  )
}
