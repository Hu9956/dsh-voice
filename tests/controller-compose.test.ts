/**
 * 通话中输入框里有字：识别出来的话接到草稿末尾，不自动发。
 * 和 controller.test.ts 一样用假的环境跑。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { APPEND_FAILED_NOTICE, APPENDED_NOTICE, CallController, type CallEnv, type TranscribeResult } from '../src/client/call/controller.ts'

const RATE = 16000

function tone(ms: number, db: number): Float32Array {
  const n = Math.round(RATE * ms / 1000)
  const amp = Math.sqrt(2) * 10 ** (db / 20)
  const out = new Float32Array(n)
  for (let i = 0; i < n; i++) out[i] = amp * Math.sin(2 * Math.PI * 220 * i / RATE)
  return out
}
const silence = (ms: number) => new Float32Array(Math.round(RATE * ms / 1000))

class FakeEnv implements CallEnv {
  t = 1_000_000
  isRunning = false
  isSpeaking = false
  isSounding = false
  isPending = false
  transcripts: TranscribeResult[] = []
  sent: string[] = []
  tones: string[] = []
  thinkingOn = false
  stops = 0
  agentStops = 0
  ducked: boolean[] = []
  spoken = ''
  /** 输入框里的草稿。 */
  draft = ''
  appendOk = true
  appended: string[] = []

  now() { return this.t }
  running() { return this.isRunning }
  pending() { return this.isPending }
  speaking() { return this.isSpeaking }
  sounding() { return this.isSounding }
  stopSpeech() { this.stops++; this.isSpeaking = false; this.isSounding = false }
  say() {}
  tone(name: string) { this.tones.push(name) }
  toneBusy() { return false }
  thinking(on: boolean) { this.thinkingOn = on }
  async transcribe(): Promise<TranscribeResult> { return this.transcripts.shift() ?? { ok: true, text: '' } }
  send(text: string) { this.sent.push(text); return true }
  composing() { return this.draft.trim() !== '' }
  appendDraft(text: string) {
    if (!this.appendOk) return false
    this.appended.push(text)
    this.draft += text
    return true
  }
  async setActive() { return true }
  ended() {}
  stopAgent() { this.agentStops++; this.isRunning = false; return true }
  recentSpeech() { return this.spoken }
  duck(on: boolean) { this.ducked.push(on) }
}

const flush = () => new Promise<void>((resolve) => setImmediate(resolve))

function feed(call: CallController, env: FakeEnv, samples: Float32Array) {
  for (let at = 0; at < samples.length; at += 320) {
    call.audio(samples.subarray(at, Math.min(samples.length, at + 320)))
    env.t += 20
    if ((env.t / 20) % 10 === 0) call.tick()
  }
}

function wait(call: CallController, env: FakeEnv, ms: number) {
  for (let left = ms; left > 0; left -= 200) {
    env.t += 200
    call.tick()
  }
}

async function connected(env: FakeEnv = new FakeEnv(), bargeIn = false) {
  const call = new CallController(env, RATE, { silenceMs: 1200, bargeIn })
  call.start()
  await flush()
  call.micReady()
  feed(call, env, silence(400))
  return { call, env }
}

async function speak(call: CallController, env: FakeEnv, text: string) {
  env.transcripts.push({ ok: true, text })
  feed(call, env, tone(1000, -20))
  feed(call, env, silence(1400))
  await flush()
}

/** 发出一句、agent 开始跑并开始念。 */
async function busyTurn(call: CallController, env: FakeEnv) {
  await speak(call, env, '帮我把测试跑一遍')
  env.isRunning = true
  wait(call, env, 1000)
  env.isSpeaking = true
  env.isSounding = true
  env.spoken = '好，我先跑一下测试，看看哪些没过。'
  wait(call, env, 600)
}

test('输入框里有字：说的话接到草稿末尾，不发、不响提示音，接着听', async () => {
  const env = new FakeEnv()
  env.draft = '帮我看一下'
  const { call } = await connected(env)
  await speak(call, env, '那个日志')
  assert.deepEqual(env.sent, [])
  assert.deepEqual(env.appended, ['那个日志'])
  assert.deepEqual(env.tones, ['connect'], '不响「发出去了」')
  assert.equal(call.getView().phase, 'listening')
  assert.equal(call.getView().notice, APPENDED_NOTICE)
})

test('输入框里有字时录到的是语气词（多半是键盘声）：不提示「没听清」', async () => {
  const env = new FakeEnv()
  env.draft = '帮我看一下'
  const { call } = await connected(env)
  await speak(call, env, '嗯')
  assert.deepEqual(env.appended, [])
  assert.equal(call.getView().notice, '')
  assert.equal(call.getView().phase, 'listening')
})

test('输入框空着时照旧：语气词提示「没听清」，正常的话自动发', async () => {
  const { call, env } = await connected()
  await speak(call, env, '嗯')
  assert.equal(call.getView().notice, '没听清，请再说一遍')
  await speak(call, env, '帮我看一下日志')
  assert.deepEqual(env.sent, ['帮我看一下日志'])
  assert.deepEqual(env.appended, [])
})

test('接不进草稿（比如正在用命令）：提示再说一遍，不发', async () => {
  const env = new FakeEnv()
  env.draft = '/goal 做完'
  env.appendOk = false
  const { call } = await connected(env)
  await speak(call, env, '然后再测一遍')
  assert.deepEqual(env.sent, [])
  assert.equal(call.getView().notice, APPEND_FAILED_NOTICE)
  assert.equal(call.getView().phase, 'listening')
})

test('草稿发出去（清空）以后：说的话又自动发了', async () => {
  const env = new FakeEnv()
  env.draft = '帮我'
  const { call } = await connected(env)
  await speak(call, env, '看看日志')
  assert.deepEqual(env.appended, ['看看日志'])
  env.draft = ''
  await speak(call, env, '再跑一下测试')
  assert.deepEqual(env.sent, ['再跑一下测试'])
})

test('说话打断时输入框里有字：停朗读、接到草稿末尾、不发；这一轮照常等它结束', async () => {
  const { call, env } = await connected(new FakeEnv(), true)
  await busyTurn(call, env)
  env.draft = '我打的字'
  env.transcripts.push({ ok: true, text: '算了，先帮我看看日志' })
  feed(call, env, tone(1000, -20))
  feed(call, env, silence(1400))
  await flush()
  assert.deepEqual(env.sent, ['帮我把测试跑一遍'], '没有多发一条')
  assert.deepEqual(env.appended, ['算了，先帮我看看日志'])
  assert.equal(env.isSpeaking, false, '停了朗读')
  assert.equal(env.ducked.at(-1), false, '恢复音量')
  assert.equal(call.getView().notice, APPENDED_NOTICE)
  assert.notEqual(call.getView().phase, 'listening', 'agent 还在跑：接着等它')
  env.isRunning = false
  env.tones = []
  wait(call, env, 1200)
  assert.equal(call.getView().phase, 'listening')
  assert.deepEqual(env.tones, ['turn'])
})

test('输入框里有字时说「停」：照样让 agent 停下，不接进草稿', async () => {
  const { call, env } = await connected()
  await busyTurn(call, env)
  call.tap()
  env.draft = '我打的字'
  await speak(call, env, '先停一下。')
  assert.equal(env.agentStops, 1)
  assert.deepEqual(env.appended, [])
  assert.deepEqual(env.sent, ['帮我把测试跑一遍'])
})
