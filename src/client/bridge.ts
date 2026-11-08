/**
 * 和 dsh-harness-plus「对话信息」面板之间的约定（不 import 任何东西，方便测试）。
 *
 * - 本插件在 window.__dshVoiceReply 登记「自动朗读回复」开关，变化时发 VOICE_EVENT。
 *   harness-plus 读到它就在面板里画一行开关；读不到（本插件没装或已停用）就不画。
 * - harness-plus 的面板挂载时在 window.__dshHarnessPlus 上标 sessionInfo.voice = true，发 HARNESS_EVENT。
 *   本插件看到它，输入框里就不放常驻开关，只在正在念 / 声音被拦住 / 出错时临时冒出一个按钮。
 *   看不到（harness-plus 没装、已停用、旧版）就退回原来的常驻开关，开关不会丢。
 */
export const VOICE_EVENT = 'dsh-voice-reply:change'
export const HARNESS_EVENT = 'dsh-harness-plus:change'

export interface VoiceReplyApi {
  version: 1
  autoRead: {
    get(): boolean
    set(on: boolean): void
  }
}

type Win = {
  __dshVoiceReply?: VoiceReplyApi
  __dshHarnessPlus?: { version?: number, sessionInfo?: { voice?: boolean } }
  dispatchEvent(event: Event): boolean
}

/** 在 window 上登记开关；返回撤销函数（只撤自己登记的那个）。 */
export function publishVoiceApi(win: Win, api: VoiceReplyApi): () => void {
  win.__dshVoiceReply = api
  win.dispatchEvent(new Event(VOICE_EVENT))
  return () => {
    if (win.__dshVoiceReply === api) delete win.__dshVoiceReply
    win.dispatchEvent(new Event(VOICE_EVENT))
  }
}

/** harness-plus 的对话信息面板在不在、有没有「自动朗读」那一行。 */
export function hostHasVoiceRow(win: Partial<Win>): boolean {
  try {
    const host = win.__dshHarnessPlus
    return host?.version === 1 && host.sessionInfo?.voice === true
  } catch {
    return false
  }
}

/**
 * 输入框里的喇叭现在该是什么样。
 * - hidden：面板里有开关，又没在念、没被拦、没出错，输入框里什么都不放
 * - unlock：手机浏览器拦住了声音，显示「轻点开启声音」（这一下点按就是解锁要的手势）
 * - stop：正在念，点一下停
 * - error：朗读出错（面板模式下临时冒出来，点一下清掉）
 * - on / off：没有面板时的常驻开关
 */
export type ToggleView = 'hidden' | 'unlock' | 'stop' | 'error' | 'on' | 'off'

export function toggleView(s: { panel: boolean, enabled: boolean, speaking: boolean, blocked: boolean, error: boolean }): ToggleView {
  if (s.blocked) return 'unlock'
  if (s.speaking) return 'stop'
  if (s.panel) return s.error ? 'error' : 'hidden'
  return s.enabled ? 'on' : 'off'
}
