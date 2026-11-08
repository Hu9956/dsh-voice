import type { Context } from '@deepseek-ai/cordis'
import { getSettingsState, loadSettings, subscribeSettings } from '../client/settings'
import { HoldOverlay } from './HoldOverlay'
import type { SpeechRemote } from './controller'
import { disposeAll, setSpeech } from './store'
import { css } from './styles'

type SlotsApi = {
  inject(key: string, callback: () => () => void): void
  register(entry: { name: string, id?: string, order?: number }, component: unknown): () => void
}

const STYLE_ID = '@kewen/dsh-voice-hold'
const OVERLAY_SLOT = 'conversation.input.overlay'

/**
 * 按住说话复用官方「语音输入」提供的 speech Remote。
 * 设置尚未加载、或旧设置没有 holdEnabled 时默认启用。
 */
export function applyHold(ctx: Context): void {
  const slots = ctx.get('slots') as SlotsApi
  let enabled = getSettingsState().view?.settings.holdEnabled !== false
  let slotAvailable = false
  let unregister: (() => void) | undefined
  let style: HTMLStyleElement | undefined
  let disposed = false

  const syncOverlay = () => {
    if (!disposed && enabled && slotAvailable) {
      unregister ??= slots.register({ name: OVERLAY_SLOT, id: 'voice-hold', order: 100 }, HoldOverlay)
    } else {
      unregister?.()
      unregister = undefined
    }
  }

  ctx.effect(() => {
    const update = () => {
      if (disposed) return
      enabled = getSettingsState().view?.settings.holdEnabled !== false
      if (enabled && style === undefined) {
        style = document.createElement('style')
        style.dataset.pluginCss = STYLE_ID
        style.textContent = css
        document.head.appendChild(style)
      } else if (!enabled && style !== undefined) {
        style.remove()
        style = undefined
      }
      syncOverlay()
      if (!enabled) disposeAll()
    }
    const unsubscribe = subscribeSettings(update)
    update()
    void loadSettings()
    return () => {
      disposed = true
      unsubscribe()
      syncOverlay()
      style?.remove()
      style = undefined
      disposeAll()
    }
  }, 'voice-hold: settings and lifecycle')

  ctx.inject(['remote.speech'], (scope) => {
    scope.effect(() => {
      setSpeech((scope.get('remote') as { speech: SpeechRemote }).speech)
      return () => setSpeech(undefined)
    }, 'voice-hold: speech remote')
  })

  slots.inject(OVERLAY_SLOT, () => {
    slotAvailable = true
    syncOverlay()
    return () => {
      slotAvailable = false
      syncOverlay()
    }
  })
}
