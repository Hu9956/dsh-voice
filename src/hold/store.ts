import { useSyncExternalStore } from 'react'
import { HoldController, type Phase, type SpeechRemote } from './controller'

/** 输入框动作里本插件用到的部分（官方 InputActions）。 */
export interface InputActions {
  captureInsertion(): Record<string, unknown>
  insertText(text: string, span: Record<string, unknown>): boolean
}

interface Entry {
  controller: HoldController
  phase: Phase
  actions?: InputActions
  /** 插入位置：'caret' 插到光标处（电脑），'end' 追加到草稿末尾（手机）。 */
  insertAt: 'caret' | 'end'
  /** 草稿末尾的位置；草稿里有引用 chip 时算不准，返回 undefined 退回光标处。 */
  draftEnd?: () => number | undefined
  listeners: Set<() => void>
}

let speech: SpeechRemote | undefined
const entries = new Map<string, Entry>()

export function setSpeech(remote: SpeechRemote | undefined): void { speech = remote }

/** 每个会话一份录音状态。 */
export function sessionEntry(sessionId: string): Entry {
  let entry = entries.get(sessionId)
  if (entry !== undefined) return entry
  const created: Entry = {
    phase: { kind: 'idle' },
    insertAt: 'caret',
    listeners: new Set(),
    controller: undefined as unknown as HoldController,
  }
  const notify = () => created.listeners.forEach(listener => listener())
  created.controller = new HoldController(() => speech, {
    setPhase(phase) {
      created.phase = phase
      notify()
    },
    insert(text) {
      const actions = created.actions
      if (actions === undefined) return false
      const span = caretSpan(actions)
      const end = created.insertAt === 'end' ? created.draftEnd?.() : undefined
      return actions.insertText(text, end === undefined ? span : { ...span, start: end, end })
    },
  })
  entries.set(sessionId, created)
  return created
}

export function usePhase(sessionId: string): Phase {
  const entry = sessionEntry(sessionId)
  return useSyncExternalStore(subscriber(entry), () => entry.phase)
}

const subscribers = new WeakMap<Entry, (listener: () => void) => () => void>()
function subscriber(entry: Entry) {
  let subscribe = subscribers.get(entry)
  if (subscribe === undefined) {
    subscribe = (listener) => {
      entry.listeners.add(listener)
      return () => { entry.listeners.delete(listener) }
    }
    subscribers.set(entry, subscribe)
  }
  return subscribe
}

/** 当前光标位置；有选中文字时收成选区末尾，避免识别结果把选中的字替换掉。 */
function caretSpan(actions: InputActions): Record<string, unknown> {
  const span = actions.captureInsertion()
  if (typeof span.start === 'number' && typeof span.end === 'number' && span.start !== span.end) {
    return { ...span, start: Math.max(span.start, span.end), end: Math.max(span.start, span.end) }
  }
  return span
}

export function disposeAll(): void {
  for (const entry of entries.values()) entry.controller.dispose()
  entries.clear()
}
