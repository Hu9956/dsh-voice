import { useCallback } from 'react'
import { SpeakerIcon } from './icons'
import { Speakify } from './speakify'
import { speaker } from './speaker'
import { useSpeakerVersion } from './store'

type Hook<S> = <T>(select: (state: S) => T) => T

/** conversation.chat.assistant-actions 拿到的 props（只声明用到的）。 */
export interface SpeakButtonProps {
  messageId: string
  useChat?: Hook<unknown>
}

/** 手动朗读一条回复最多念这么多字。 */
const MANUAL_LIMIT = 5000

interface LegacyNodeLike {
  kind?: string
  messageId?: string
  blocks?: readonly { kind?: string, text?: unknown }[]
}

/** 和官方「复制」按钮取同样的文字：这条回复所有 text 块拼起来。 */
function textOf(snapshot: unknown, messageId: string): string {
  const nodes = (snapshot as { legacy?: { nodes?: readonly LegacyNodeLike[] } } | undefined)?.legacy?.nodes
  if (!nodes) return ''
  for (const node of nodes) {
    if (node.kind !== 'assistant' || node.messageId !== messageId) continue
    return (node.blocks ?? [])
      .filter((block) => block.kind === 'text' && typeof block.text === 'string')
      .map((block) => block.text as string)
      .join('')
  }
  return ''
}

/** 回复下方的喇叭：点一下念这条回复，再点一下停。 */
export function SpeakButton({ messageId, useChat }: SpeakButtonProps) {
  useSpeakerVersion()
  const select = useCallback((snapshot: unknown) => textOf(snapshot, messageId), [messageId])
  const text = useChat?.(select) ?? ''
  const tag = `message:${messageId}`
  if (text.trim() === '') return null
  const speaking = speaker.isSpeaking(tag)

  const onClick = () => {
    speaker.unlock()
    speaker.clearError()
    speaker.stopAll()
    if (speaking) return
    const spoken = new Speakify().push(text, true).slice(0, MANUAL_LIMIT)
    if (spoken === '') return
    const u = speaker.start(tag)
    u.append(spoken)
    u.finish()
  }

  const label = speaking ? '停止朗读' : '朗读这条回复'
  return (
    <button
      type="button"
      className="vr-speak"
      data-speaking={speaking ? '' : undefined}
      aria-label={label}
      title={label}
      onClick={onClick}
    >
      <SpeakerIcon mode={speaking ? 'stop' : 'on'} />
    </button>
  )
}
