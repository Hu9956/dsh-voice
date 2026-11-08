import { test } from 'node:test'
import assert from 'node:assert/strict'
import { changeSpeechRate, loadSettings, speechRate } from '../src/client/settings.ts'

test('连续切换语速按顺序保存，失败时退回最近一次成功的值', async () => {
  const originalFetch = globalThis.fetch
  let stored = 1
  const pending: Array<{ rate: number, resolve: (response: Response) => void }> = []
  const view = () => ({ ready: true, error: null, settings: { model: 'm', voice: 'v', turnLimit: 800, speechRate: stored }, catalog: { models: [], turnLimits: [], speechRates: [1, 1.25, 1.5, 2] } })
  globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
    if (init?.method !== 'POST') return Response.json(view())
    const rate = JSON.parse(String(init.body)).speechRate as number
    return new Promise<Response>((resolve) => pending.push({ rate, resolve }))
  }) as typeof fetch
  const tick = () => new Promise<void>((resolve) => setImmediate(resolve))
  try {
    await loadSettings(true)
    const first = changeSpeechRate(1.25)
    const second = changeSpeechRate(1.5)
    assert.equal(speechRate(), 1.5)
    await tick()
    assert.deepEqual(pending.map((p) => p.rate), [1.25])
    stored = 1.25
    pending.shift()!.resolve(Response.json(view()))
    await first
    await tick()
    assert.equal(speechRate(), 1.5)
    assert.deepEqual(pending.map((p) => p.rate), [1.5])
    pending.shift()!.resolve(Response.json({ error: '保存失败' }, { status: 500 }))
    await assert.rejects(second, /保存失败/)
    assert.equal(speechRate(), 1.25)
    const third = changeSpeechRate(2)
    await tick()
    stored = 2
    pending.shift()!.resolve(Response.json(view()))
    await third
    assert.equal(speechRate(), 2)
  } finally {
    globalThis.fetch = originalFetch
  }
})
