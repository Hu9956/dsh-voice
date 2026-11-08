import type { Context } from '@deepseek-ai/cordis'
import { CallButton } from './CallButton'
import { CallPanel } from './CallPanel'
import { callCss } from './call-styles'
import { hangupCall, setSessions, setSpeech, setStatus, type SessionsApi, type SpeechRemote, type StatusStore } from './call/session'
import { SettingsSection } from './SettingsSection'
import { settingsCss } from './settings-styles'
import { SpeakButton } from './SpeakButton'
import { speaker } from './speaker'
import { isEnabled, onEnabledChange, setEnabled } from './store'
import { VOICE_EVENT, publishVoiceApi } from './bridge'
import { css } from './styles'
import { VoiceToggle } from './VoiceToggle'
import { applyHold } from '../hold'
import { getSettingsState, loadSettings, subscribeSettings } from './settings'
import { withReplyEnabled } from './reply-gate'

type SlotsApi = {
  inject(key: string, callback: () => () => void): void
  register(entry: { name: string, id?: string, order?: number }, component: unknown): () => void
}

const STYLE_ID = '@kewen/dsh-voice-reply'
const TOGGLE_SLOT = 'conversation.input.left'
const ACTIONS_SLOT = 'conversation.chat.assistant-actions'
/** 「插件」页里每个插件的详情页都会渲染这个 slot，组件里只认本插件。 */
const DETAIL_SLOT = 'plugins.detail.section'
/** 电话按钮挂在输入框右侧这一格，实际画在发送按钮的位置（见 CallButton.tsx）；认不出发送按钮时就在这一格显示小按钮。 */
const CALL_BUTTON_SLOT = 'conversation.input.right'
/** 通话面板挂在输入框的覆盖层里，通话中盖住输入框。 */
const CALL_PANEL_SLOT = 'conversation.input.overlay'
/** dsh-voice-hold 开始录音时在 window 上发的事件：一开口就停止朗读。 */
export const RECORDING_EVENT = 'dsh-voice-hold:recording'

export const inject = ['slots']

/**
 * 语音回复：输入框左侧加「语音模式」开关，打开后主代理边写边念；每条回复下方加喇叭按钮；
 * 「插件 → 语音朗读」详情页里换音色、模型，设每轮最多念多少字。
 * 合成走本插件的服务端（/voice-reply/*），Key 只在服务端。
 */
export function apply(ctx: Context): void {
  applyHold(ctx)
  ctx.effect(() => {
    void loadSettings()
    let previous = getSettingsState().view?.settings.replyEnabled !== false
    const unsubscribe = subscribeSettings(() => {
      const enabled = getSettingsState().view?.settings.replyEnabled !== false
      if (previous && !enabled) {
        speaker.stopAll()
        hangupCall()
      }
      previous = enabled
    })
    return unsubscribe
  }, 'voice: load feature settings')
  ctx.effect(() => {
    const style = document.createElement('style')
    style.dataset.pluginCss = STYLE_ID
    style.textContent = css + settingsCss + callCss
    document.head.appendChild(style)
    return () => style.remove()
  }, 'voice-reply: styles')

  // 手机浏览器要点按之后才能出声：语音模式开着时，页面上每次点按都顺手解锁
  ctx.effect(() => speaker.installUnlock(isEnabled), 'voice-reply: audio unlock')

  ctx.effect(() => {
    const stop = () => speaker.stopAll()
    window.addEventListener(RECORDING_EVENT, stop)
    return () => window.removeEventListener(RECORDING_EVENT, stop)
  }, 'voice-reply: stop on recording')

  ctx.effect(() => () => speaker.dispose(), 'voice-reply: release audio')

  // 对话信息面板（dsh-harness-plus）里的「自动朗读回复」开关读写这里；本插件停用时撤掉，面板那一行随之消失
  ctx.effect(() => {
    let unpublish: (() => void) | undefined
    const sync = () => {
      const enabled = getSettingsState().view?.settings.replyEnabled !== false
      if (enabled && !unpublish) unpublish = publishVoiceApi(window, { version: 1, autoRead: { get: isEnabled, set: setEnabled } })
      if (!enabled && unpublish) { unpublish(); unpublish = undefined }
    }
    sync()
    const unsubscribeSettings = subscribeSettings(sync)
    const unsubscribe = onEnabledChange(() => window.dispatchEvent(new Event(VOICE_EVENT)))
    return () => {
      unsubscribeSettings()
      unsubscribe()
      unpublish?.()
    }
  }, 'voice-reply: session info bridge')

  // 通话：识别走官方「语音输入」的 speech Remote（和按住说话一样），会话状态（在不在跑、有没有提问）走 uiSession
  ctx.inject(['remote.speech'], (scope) => {
    scope.effect(() => {
      setSpeech((scope.get('remote') as { speech: SpeechRemote }).speech)
      return () => setSpeech(undefined)
    }, 'voice-reply: speech remote')
  })
  ctx.inject(['uiSession'], (scope) => {
    scope.effect(() => {
      setStatus((scope.get('uiSession') as { sessionStatus: StatusStore }).sessionStatus)
      return () => setStatus(undefined)
    }, 'voice-reply: session status')
  })
  // 通话里说「停」：和输入框的停止按钮一样，经会话层 conversation.cancel() 让 agent 停下
  ctx.inject(['sessions'], (scope) => {
    scope.effect(() => {
      setSessions(scope.get('sessions') as SessionsApi)
      return () => setSessions(undefined)
    }, 'voice-reply: sessions')
  })
  ctx.effect(() => () => hangupCall(), 'voice-reply: hang up on unload')

  const slots = ctx.get('slots') as SlotsApi
  slots.inject(TOGGLE_SLOT, () => slots.register({ name: TOGGLE_SLOT, id: 'voice-reply-toggle', order: 50 }, withReplyEnabled(VoiceToggle)))
  slots.inject(ACTIONS_SLOT, () => slots.register({ name: ACTIONS_SLOT, id: 'voice-reply-speak', order: 140 }, withReplyEnabled(SpeakButton)))
  slots.inject(DETAIL_SLOT, () => slots.register({ name: DETAIL_SLOT, id: 'voice-reply-settings', order: 90 }, SettingsSection))
  slots.inject(CALL_BUTTON_SLOT, () => slots.register({ name: CALL_BUTTON_SLOT, id: 'voice-reply-call', order: 40 }, withReplyEnabled(CallButton)))
  slots.inject(CALL_PANEL_SLOT, () => slots.register({ name: CALL_PANEL_SLOT, id: 'voice-reply-call-panel', order: 200 }, withReplyEnabled(CallPanel)))
}
