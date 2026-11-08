import { useSyncExternalStore } from 'react'
import { speaker } from './speaker'
import { HARNESS_EVENT, hostHasVoiceRow } from './bridge'

/** 「语音模式」开关，存在本机浏览器里，所有对话共用。 */
const STORAGE_KEY = '@kewen/dsh-voice-reply:enabled'
const listeners = new Set<() => void>()

function read(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

let enabled = read()

export function isEnabled(): boolean {
  return enabled
}

export function setEnabled(next: boolean): void {
  if (next === enabled) return
  enabled = next
  try {
    window.localStorage.setItem(STORAGE_KEY, next ? '1' : '0')
  } catch {
    // 存不了就只在这次打开里有效
  }
  for (const listener of listeners) listener()
}

function subscribeEnabled(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useEnabled(): boolean {
  return useSyncExternalStore(subscribeEnabled, isEnabled, isEnabled)
}

/** 外部（对话信息面板）改开关时也通知订阅者。 */
export function onEnabledChange(listener: () => void): () => void {
  return subscribeEnabled(listener)
}

function subscribeHost(listener: () => void): () => void {
  window.addEventListener(HARNESS_EVENT, listener)
  return () => window.removeEventListener(HARNESS_EVENT, listener)
}
const readHost = (): boolean => hostHasVoiceRow(window as unknown as Parameters<typeof hostHasVoiceRow>[0])

/** dsh-harness-plus 的对话信息面板里有没有「自动朗读」那一行。 */
export function useHostVoiceRow(): boolean {
  return useSyncExternalStore(subscribeHost, readHost, () => false)
}

/** 播放状态一变就重渲染（返回值本身不用，读 speaker 上的字段）。 */
export function useSpeakerVersion(): number {
  return useSyncExternalStore(
    (listener) => speaker.subscribe(listener),
    () => speaker.getVersion(),
    () => speaker.getVersion(),
  )
}
