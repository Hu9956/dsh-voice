/**
 * 通话第二版：smart-turn（听语气判断说完没有）接进状态机。
 * 判断用假的 turnComplete，什么时候回答、回答什么都由测试控制。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { CallController, type CallEnv, type TranscribeResult } from '../src/client/call/controller.ts'

const RATE = 16000

function tone(ms: number, db: number): Float32Array {
  const n = Math.round(RATE * ms / 1000)
  const amp = Math.sqrt(2) * 10 ** (db / 20)
  const out = new Float32Array(n)
  for (let i = 0; i < n; i++) out[i] = amp * Math.sin(2 * Math.PI * 220 * i / RATE)
  return out
}
const silence = (ms: number) => new Float32Array(Math.round(RATE * ms / 1000))

interface Pending { resolve(p: number): void, reject(e: Error): void, samples: number }

class FakeEnv implements CallEnv {
  t = 1_000_000
  transcripts: TranscribeResult[] = []
  transcribed: number[] = []
  sent: string[] = []
  judged: Pending[] = []

  now() { return this.t }
  running() { return false }
  pending() { return false }
  speaking() { return false }
  sounding() { return false }
  stopSpeech() {}
  say() {}
  tone() {}
  toneBusy() { return false }
  thinking() {}
  async transcribe(samples: Float32Array): Promise<TranscribeResult> {
    this.transcribed.push(this.t)
    void samples
    return this.transcripts.shift() ?? { ok: true, text: '' }
  }
  send(text: string) { this.sent.push(text); return true }
  async setActive() { return true }
  ended() {}
  turnComplete(samples: Float32Array): Promise<number> {
    return new Promise((resolve, reject) => { this.judged.push({ resolve, reject, samples: samples.length }) })
  }
}

/** 没有 turnComplete 的老环境。 */
class BareEnv extends FakeEnv {}
// @ts-expect-error 测试：去掉可选方法
BareEnv.prototype.turnComplete = undefined

const flush = () => new Promise<void>((resolve) => setImmediate(resolve))

function feed(call: CallController, env: FakeEnv, samples: Float32Array) {
  for (let at = 0; at < samples.length; at += 320) {
    call.audio(samples.subarray(at, Math.min(samples.length, at + 320)))
    env.t += 20
  }
}

async function connected(env: FakeEnv, smartTurn: boolean, silenceMs = 1200) {
  const call = new CallController(env, RATE, { silenceMs, smartTurn })
  call.start()
  await flush()
  call.micReady()
  feed(call, env, silence(400))
  return call
}

test('判断说完了：停顿 0.5 秒就发出去，不用等 1.2 秒', async () => {
  const env = new FakeEnv()
  const call = await connected(env, true)
  env.transcripts.push({ ok: true, text: '帮我看一下日志' })
  feed(call, env, tone(1000, -20))
  feed(call, env, silence(520))
  assert.equal(env.judged.length, 1, '停顿 0.5 秒问一次')
  assert.ok(env.judged[0]!.samples > RATE * 0.9, '带着这句话的音频')
  env.judged[0]!.resolve(0.93)
  await flush()
  await flush()
  assert.deepEqual(env.sent, ['帮我看一下日志'])
  assert.equal(call.getView().phase, 'thinking')
})

test('判断没说完：1.2 秒也不切，接着说的话并进同一句', async () => {
  const env = new FakeEnv()
  const call = await connected(env, true)
  env.transcripts.push({ ok: true, text: '帮我看一下，那个日志里面的报错' })
  feed(call, env, tone(1000, -20))
  feed(call, env, silence(600))
  env.judged[0]!.resolve(0.12)
  await flush()
  feed(call, env, silence(1200)) // 一共停了 1.8 秒，以前早就切了
  assert.equal(env.transcribed.length, 0, '没说完就不识别')
  feed(call, env, tone(800, -20)) // 想好了，接着说
  feed(call, env, silence(520))
  assert.equal(env.judged.length, 2)
  env.judged[1]!.resolve(0.9)
  await flush()
  await flush()
  assert.equal(env.transcribed.length, 1, '两段并成一句识别')
  assert.deepEqual(env.sent, ['帮我看一下，那个日志里面的报错'])
})

test('判断没说完、又一直不说话：最多等 3 秒照样发', async () => {
  const env = new FakeEnv()
  const call = await connected(env, true)
  env.transcripts.push({ ok: true, text: '就这样' })
  feed(call, env, tone(1000, -20))
  feed(call, env, silence(600))
  env.judged[0]!.resolve(0.2)
  await flush()
  feed(call, env, silence(2000))
  assert.equal(env.transcribed.length, 0)
  feed(call, env, silence(600))
  await flush()
  assert.equal(env.transcribed.length, 1, '停够 3 秒结束')
  assert.deepEqual(env.sent, ['就这样'])
})

test('判断还没回来就又开口：那次判断作废', async () => {
  const env = new FakeEnv()
  const call = await connected(env, true)
  env.transcripts.push({ ok: true, text: '先看日志再看配置' })
  feed(call, env, tone(1000, -20))
  feed(call, env, silence(520))
  feed(call, env, tone(600, -20)) // 判断还没回来，已经接着说了
  env.judged[0]!.resolve(0.99)
  await flush()
  assert.equal(env.transcribed.length, 0, '过期的「说完了」不算')
  feed(call, env, silence(520))
  env.judged[1]!.resolve(0.95)
  await flush()
  await flush()
  assert.equal(env.transcribed.length, 1)
})

test('判断出错：提示一次，这通电话改回按停顿判断', async () => {
  const env = new FakeEnv()
  const call = await connected(env, true)
  env.transcripts.push({ ok: true, text: '你好' })
  feed(call, env, tone(1000, -20))
  feed(call, env, silence(520))
  env.judged[0]!.reject(new Error('worker crashed'))
  await flush()
  assert.match(call.getView().notice, /按停顿判断/)
  feed(call, env, silence(700)) // 一共 1.2 秒：按设置的停顿结束
  await flush()
  assert.equal(env.transcribed.length, 1)
  assert.deepEqual(env.sent, ['你好'])
  // 之后的句子不再问
  await flush()
  env.transcripts.push({ ok: true, text: '再见' })
  feed(call, env, tone(1000, -20))
  feed(call, env, silence(1300))
  assert.equal(env.judged.length, 1)
})

test('设置里没开 smart-turn：停顿时长照旧，不问', async () => {
  const env = new FakeEnv()
  const call = await connected(env, false)
  env.transcripts.push({ ok: true, text: '你好' })
  feed(call, env, tone(1000, -20))
  feed(call, env, silence(1300))
  await flush()
  assert.equal(env.judged.length, 0)
  assert.deepEqual(env.sent, ['你好'])
})

test('老环境没有 turnComplete：开了也不生效', async () => {
  const env = new BareEnv()
  const call = await connected(env, true)
  env.transcripts.push({ ok: true, text: '你好' })
  feed(call, env, tone(1000, -20))
  feed(call, env, silence(1300))
  await flush()
  assert.deepEqual(env.sent, ['你好'])
})

test('设置的停顿比 3 秒还长：没说完时按设置的来', async () => {
  const env = new FakeEnv()
  const call = await connected(env, true, 3000)
  call.setSilenceMs(4000)
  env.transcripts.push({ ok: true, text: '嗯' + '好的' })
  feed(call, env, tone(1000, -20))
  feed(call, env, silence(600))
  env.judged[0]!.resolve(0.1)
  await flush()
  feed(call, env, silence(3000))
  assert.equal(env.transcribed.length, 0, '3.6 秒还没到 4 秒')
  feed(call, env, silence(600))
  await flush()
  assert.equal(env.transcribed.length, 1)
})
