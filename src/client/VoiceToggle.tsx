import { useEffect, useRef } from 'react'
import { AUTO_READ_TAG, Follower, parseTurn, selectTurn } from './follow'
import { SpeakerIcon } from './icons'
import { loadSettings } from './settings'
import { speaker } from './speaker'
import { setEnabled, useEnabled, useHostVoiceRow, useSpeakerVersion } from './store'
import { toggleView } from './bridge'
import { useCallActive } from './call/session'

type UseChat = <T>(selector: (snapshot: unknown) => T) => T

/** conversation.input.left 拿到的标准 Session props（只声明用到的）。 */
interface VoiceToggleProps {
  sessionId?: string
  useChat?: UseChat
}

const noChat: UseChat = (selector) => selector(undefined)
const nothing = (): string => ''

/**
 * 输入框左边的喇叭：打开「自动朗读回复」后，主代理的回复边写边念（跟读也在这个组件里跑）。
 * - 有 dsh-harness-plus 的对话信息面板时，开关在面板里；这里平时不画，只在正在念（停止）、
 *   声音被拦住（轻点开启声音）、出错时临时冒出来，见 bridge.ts 的 toggleView。
 * - 没有面板时还是原来的常驻开关。
 * - 正在念时变成方块，点一下停（这一轮剩下的不念了，下一轮照常）。
 * - 手机上声音被浏览器拦住时显示「轻点开启声音」，点一下就恢复（这一下点按本身就是解锁要的手势）。
 */
export function VoiceToggle({ sessionId, useChat }: VoiceToggleProps) {
  const enabled = useEnabled()
  // 对话信息面板（dsh-harness-plus）里有开关时，这里只做临时的停止 / 解锁按钮
  const panel = useHostVoiceRow()
  // 通话中由通话自己跟读，这里让位，免得同一段念两遍
  const calling = useCallActive()
  const following = enabled && !calling
  useSpeakerVersion()
  // 关着时不订阅对话内容，免得每写一个字都重渲染
  const signature = (useChat ?? noChat)(following ? selectTurn : nothing)
  const follower = useRef<Follower | null>(null)

  useEffect(() => {
    void loadSettings()
  }, [])

  useEffect(() => {
    if (!following) return
    const current = new Follower()
    follower.current = current
    return () => {
      current.detach()
      if (follower.current === current) follower.current = null
    }
  }, [following, sessionId])

  useEffect(() => {
    follower.current?.update(parseTurn(signature))
  }, [signature, following, sessionId])

  const blocked = speaker.blocked
  // 面板模式下只管自动朗读：手动点回复下方喇叭念的那条，那个喇叭自己会变成停止，这里不再重复放一个
  const speaking = !blocked && (panel ? speaker.isSpeakingPrefix(AUTO_READ_TAG) : speaker.isSpeaking())
  const error = blocked ? null : speaker.lastError
  const view = toggleView({ panel, enabled, speaking, blocked, error: error !== null })
  // 上面的 hook 必须照常跑（自动朗读的跟读在这里），只是不画按钮
  if (view === 'hidden') return null

  const transient = panel
  const mode = view === 'stop' ? 'stop' : view === 'off' ? 'off' : 'on'
  const title = view === 'unlock'
    ? '浏览器暂时不让出声，轻点这里开启声音'
    : error !== null
      ? `朗读出错：${error}${transient ? '。点一下关掉提示' : ''}`
      : view === 'stop'
        ? '停止朗读'
        : enabled
          ? '自动朗读已打开（所有对话），回复边写边念。点一下关闭'
          : '打开自动朗读（所有对话）：回复边写边念'

  const onClick = () => {
    speaker.unlock()
    if (blocked) return
    speaker.clearError()
    if (speaking) speaker.stopAll()
    // 面板模式下这里只是临时的停止 / 解锁 / 出错提示，开关在对话信息面板里
    else if (!transient) setEnabled(!enabled)
  }

  return (
    <button
      type="button"
      className="vr-toggle"
      data-transient={transient ? '' : undefined}
      data-on={enabled && !transient ? '' : undefined}
      data-speaking={speaking ? '' : undefined}
      data-blocked={blocked ? '' : undefined}
      data-error={error !== null ? '' : undefined}
      aria-pressed={transient ? undefined : enabled}
      aria-label={title}
      title={title}
      onClick={onClick}
    >
      <SpeakerIcon mode={mode} />
      {blocked ? <span className="vr-toggle-label">轻点开启声音</span> : null}
    </button>
  )
}
