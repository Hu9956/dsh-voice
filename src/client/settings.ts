/**
 * 朗读设置（音色、模型、每轮最多念多少字）：存在服务端（~/.config/dsh-voice/voice-reply.json），
 * 电脑和手机打开的是同一份。这里缓存一份，给设置页和跟读用。
 */
import { useSyncExternalStore } from 'react'

const BASE = '/voice-reply'
/** 设置还没读到时的每轮字数上限（和服务端默认一致）。 */
const DEFAULT_TURN_LIMIT = 800
const DEFAULT_CALL_SILENCE_MS = 1200

export interface VoiceOption {
  id: string
  name: string
  gender?: string
  desc: string
  /** 设置页下拉里的分组（普通话、方言……）。 */
  group?: string
}

export interface ModelOption {
  id: string
  label: string
  price: string
  voices: VoiceOption[]
}

export interface Settings {
  model: string
  voice: string
  /** 每轮最多念多少字，0 表示不限。 */
  turnLimit: number
  /** 语音通话：停顿多久算说完（毫秒）。旧版服务端没有这一项。 */
  callSilenceMs?: number
  /** 语音通话：戴耳机时允许说话打断朗读。旧版服务端没有这一项。 */
  callBargeIn?: boolean
  /** 语音通话：听语气判断说完没有（smart-turn）。旧版服务端没有这一项。 */
  callSmartTurn?: boolean
  /** 语音通话：锁屏、切到后台后继续通话（不暂停）。旧版服务端没有这一项。 */
  callKeepOnLock?: boolean
  /** 语音通话：收音灵敏度，'lowest' | 'low' | 'medium' | 'high'。旧版服务端没有这一项。 */
  callSensitivity?: string
  /** 跟读（语音模式和通话）：每一步整段写完再念，不边写边念。旧版服务端没有这一项。 */
  speakWhole?: boolean
  /** 语音通话：用人声模型判断是不是在说话（风扇、空调声不算）。旧版服务端没有这一项。 */
  callVoiceModel?: boolean
  /** 语音通话：用百炼 qwen3-asr-flash 识别（关着用官方本机 SenseVoice）。旧版服务端没有这一项。 */
  callCloudAsr?: boolean
  /** 朗读语速（百炼 speech_rate，变速不变调），1 是正常。旧版服务端没有这一项。 */
  speechRate?: number
  /** 按住说话与朗读、通话可分别启停。 */
  holdEnabled?: boolean
  replyEnabled?: boolean
}

export interface SettingsView {
  /** Key 准备好了没有。 */
  ready: boolean
  error: string | null
  settings: Settings
  catalog: { models: ModelOption[], turnLimits: number[], callSilences?: number[], speechRates?: number[] }
  /** 人声模型文件的版本（拼进下载地址做缓存）。旧版服务端没有，也就没有人声模型。 */
  vadVersion?: string
}

export interface SettingsState {
  view: SettingsView | null
  /** 最近一次读设置失败的原因。 */
  error: string | null
}

let state: SettingsState = { view: null, error: null }
let loading: Promise<void> | null = null
let saveQueue: Promise<void> = Promise.resolve()
let pendingRate: { value: number, revision: number } | undefined
let rateRevision = 0
let confirmedRate: number | undefined
const listeners = new Set<() => void>()

function set(next: SettingsState): void {
  state = next
  for (const listener of listeners) listener()
}

async function request(init?: RequestInit, path = '/settings'): Promise<SettingsView> {
  const res = await fetch(`${BASE}${path}`, { credentials: 'same-origin', ...init })
  let data: unknown
  try {
    data = await res.json()
  } catch {
    data = undefined
  }
  if (!res.ok) {
    const error = (data as { error?: unknown } | undefined)?.error
    throw new Error(typeof error === 'string' ? error : `HTTP ${res.status}`)
  }
  return data as SettingsView
}

function acceptView(view: SettingsView): SettingsView {
  confirmedRate = view.settings.speechRate
  return pendingRate === undefined ? view : { ...view, settings: { ...view.settings, speechRate: pendingRate.value } }
}

/** 读设置（读过就用缓存，fresh 为 true 时重读）。失败不抛错，原因放在 useSettings().error。 */
export function loadSettings(fresh = false): Promise<void> {
  if (loading !== null) return loading
  if (state.view !== null && !fresh) return Promise.resolve()
  const run = (async () => {
    try {
      set({ view: acceptView(await request()), error: null })
    } catch (error) {
      set({ view: state.view, error: error instanceof Error ? error.message : String(error) })
    } finally {
      loading = null
    }
  })()
  loading = run
  return run
}

/** 改一部分设置。失败时抛错（带原因）。 */
export function saveSettings(patch: Partial<Settings>): Promise<SettingsView> {
  // 顺序发送，避免连续操作时较早的请求后到、覆盖最后一次选择。
  const result = saveQueue.then(async () => {
    const view = acceptView(await request({
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(patch),
    }))
    set({ view, error: null })
    return view
  })
  saveQueue = result.then(() => {}, () => {})
  return result
}

/** 保存百炼 Key，与其他设置共用队列；服务端只返回不含 Key 的设置视图。 */
export function saveApiKey(key: string): Promise<SettingsView> {
  const result = saveQueue.then(async () => {
    const view = acceptView(await request({
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ key }),
    }, '/key'))
    set({ view, error: null })
    return view
  })
  saveQueue = result.then(() => {}, () => {})
  return result
}

/** 当前的每轮字数上限，0 表示不限。 */
export function turnLimit(): number {
  return state.view?.settings.turnLimit ?? DEFAULT_TURN_LIMIT
}

/** 语音通话停顿多久算说完（毫秒）。 */
export function callSilenceMs(): number {
  return state.view?.settings.callSilenceMs ?? DEFAULT_CALL_SILENCE_MS
}

/** 语音通话里能不能说话打断朗读（默认关：外放时麦克风会录到朗读）。 */
export function callBargeIn(): boolean {
  return state.view?.settings.callBargeIn === true
}

/** 语音通话里要不要听语气判断说完没有（smart-turn，默认关）。 */
export function callSmartTurn(): boolean {
  return state.view?.settings.callSmartTurn === true
}

/** 语音通话的收音灵敏度（默认中档）。 */
export function callSensitivity(): string {
  return state.view?.settings.callSensitivity ?? 'medium'
}

/** 语音通话锁屏、切到后台后继续（默认关：暂停，回来点一下继续）。 */
export function callKeepOnLock(): boolean {
  return state.view?.settings.callKeepOnLock === true
}

/**
 * 语音通话用不用人声模型：服务端有模型文件（给了 vadVersion）且设置没关掉，返回版本号；否则 undefined。
 * 默认开。
 */
export function callVoiceModel(): string | undefined {
  const view = state.view
  if (typeof view?.vadVersion !== 'string' || view.settings.callVoiceModel === false) return undefined
  return view.vadVersion
}

/** 语音通话用百炼识别（默认关：用官方本机 SenseVoice）。 */
export function callCloudAsr(): boolean {
  return state.view?.settings.callCloudAsr === true
}

/** 当前朗读语速；服务端不支持（旧版）时 undefined，朗读就不带这个参数。 */
export function speechRate(): number | undefined {
  const rate = state.view?.settings.speechRate
  return typeof rate === 'number' ? rate : undefined
}

/** 能选的语速；旧版服务端没有，返回空数组。 */
export function speechRates(): number[] {
  return state.view?.catalog.speechRates ?? []
}

/**
 * 换语速：先改本地缓存（按钮马上变、下一段朗读马上用上），再存到服务端。
 * 存失败就退回原来的值，并把原因抛出去。
 */
export async function changeSpeechRate(rate: number): Promise<void> {
  const view = state.view
  if (view === null) return
  const revision = ++rateRevision
  pendingRate = { value: rate, revision }
  set({ view: { ...view, settings: { ...view.settings, speechRate: rate } }, error: null })
  try {
    await saveSettings({ speechRate: rate })
    if (pendingRate?.revision === revision) pendingRate = undefined
  } catch (error) {
    if (pendingRate?.revision === revision) {
      pendingRate = undefined
      const now = state.view
      if (now !== null) set({ view: { ...now, settings: { ...now.settings, speechRate: confirmedRate } }, error: error instanceof Error ? error.message : String(error) })
    }
    throw error
  }
}

/** 语速显示成「1.25×」这样。 */
export function formatRate(rate: number): string {
  return `${rate}×`
}

/** 跟读时每一步整段写完再念（默认关：边写边念）。 */
export function speakWhole(): boolean {
  return state.view?.settings.speakWhole === true
}

export function subscribeSettings(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function getSettingsState(): SettingsState {
  return state
}

export function useSettings(): SettingsState {
  return useSyncExternalStore(subscribeSettings, getSettingsState, getSettingsState)
}
