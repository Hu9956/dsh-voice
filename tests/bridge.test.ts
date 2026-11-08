import { test } from 'node:test'
import assert from 'node:assert/strict'
import { HARNESS_EVENT, VOICE_EVENT, hostHasVoiceRow, publishVoiceApi, toggleView, type VoiceReplyApi } from '../src/client/bridge.ts'

function fakeWin() {
  const events: string[] = []
  return { events, dispatchEvent(e: Event) { events.push(e.type); return true } } as Record<string, unknown> & { events: string[], dispatchEvent(e: Event): boolean }
}

test('event names are the agreed ones', () => {
  assert.equal(VOICE_EVENT, 'dsh-voice-reply:change')
  assert.equal(HARNESS_EVENT, 'dsh-harness-plus:change')
})

test('publish puts the api on window and fires; dispose removes only its own', () => {
  const win = fakeWin()
  let on = false
  const api: VoiceReplyApi = { version: 1, autoRead: { get: () => on, set: (v) => { on = v } } }
  const dispose = publishVoiceApi(win as never, api)
  assert.equal(win.__dshVoiceReply, api)
  assert.deepEqual(win.events, [VOICE_EVENT])
  ;(win.__dshVoiceReply as VoiceReplyApi).autoRead.set(true)
  assert.equal(on, true)
  dispose()
  assert.equal(win.__dshVoiceReply, undefined)
  assert.deepEqual(win.events, [VOICE_EVENT, VOICE_EVENT])

  // 别人后登记的不被撤掉
  const other: VoiceReplyApi = { version: 1, autoRead: { get: () => false, set: () => {} } }
  const dispose2 = publishVoiceApi(win as never, api)
  win.__dshVoiceReply = other
  dispose2()
  assert.equal(win.__dshVoiceReply, other)
})

test('host voice row needs version 1 and sessionInfo.voice', () => {
  assert.equal(hostHasVoiceRow({}), false)
  assert.equal(hostHasVoiceRow({ __dshHarnessPlus: { version: 1 } }), false)
  assert.equal(hostHasVoiceRow({ __dshHarnessPlus: { version: 2, sessionInfo: { voice: true } } }), false)
  assert.equal(hostHasVoiceRow({ __dshHarnessPlus: { version: 1, sessionInfo: { voice: false } } }), false)
  assert.equal(hostHasVoiceRow({ __dshHarnessPlus: { version: 1, sessionInfo: { voice: true } } }), true)
})

const base = { panel: false, enabled: false, speaking: false, blocked: false, error: false }

test('without panel: persistent on/off switch', () => {
  assert.equal(toggleView(base), 'off')
  assert.equal(toggleView({ ...base, enabled: true }), 'on')
  assert.equal(toggleView({ ...base, enabled: true, speaking: true }), 'stop')
  assert.equal(toggleView({ ...base, enabled: true, blocked: true }), 'unlock')
})

test('with panel: hidden unless speaking, blocked or error', () => {
  const p = { ...base, panel: true }
  assert.equal(toggleView(p), 'hidden')
  assert.equal(toggleView({ ...p, enabled: true }), 'hidden')
  assert.equal(toggleView({ ...p, enabled: true, speaking: true }), 'stop')
  // 手动点回复下面的喇叭念时也冒出来（输入框里随时能停）
  assert.equal(toggleView({ ...p, speaking: true }), 'stop')
  assert.equal(toggleView({ ...p, enabled: true, blocked: true }), 'unlock')
  assert.equal(toggleView({ ...p, error: true }), 'error')
  // 被拦住优先于正在念
  assert.equal(toggleView({ ...p, blocked: true, speaking: true }), 'unlock')
})
