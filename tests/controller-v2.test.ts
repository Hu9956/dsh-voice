/**
 * 通话第二版：语音命令（「停」「进度怎么样」）、戴耳机时说话打断朗读、回声过滤。
 * 和 controller.test.ts 一样用假的环境跑。
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

class FakeEnv implements CallEnv {
  t = 1_000_000
  isRunning = false
  isSpeaking = false
  isSounding = false
  isPending = false
  transcripts: TranscribeResult[] = []
  sent: string[] = []
  tones: string[] = []
  said: string[] = []
  thinkingOn = false
  stops = 0
  agentStops = 0
  canStop = true
  ducked: boolean[] = []
  spoken = ''
  progressAsked: number[] = []

  now() { return this.t }
  running() { return this.isRunning }
  pending() { return this.isPending }
  speaking() { return this.isSpeaking }
  sounding() { return this.isSounding }
  stopSpeech() { this.stops++; this.isSpeaking = false; this.isSounding = false }
  say(text: string) { this.said.push(text) }
  tone(name: string) { this.tones.push(name) }
  toneBusy() { return false }
  thinking(on: boolean) { this.thinkingOn = on }
  async transcribe(): Promise<TranscribeResult> { return this.transcripts.shift() ?? { ok: true, text: '' } }
  send(text: string) { this.sent.push(text); return true }
  async setActive() { return true }
  ended() {}
  stopAgent() {
    if (!this.canStop) return false
    this.agentStops++
    this.isRunning = false
    return true
  }
  progress(elapsedMs: number) { this.progressAsked.push(elapsedMs); return '还在干活。' }
  recentSpeech() { return this.spoken }
  duck(on: boolean) { this.ducked.push(on) }
}

/** 没有 stopAgent / progress / recentSpeech / duck 的老环境（这些都是可选的）。 */
class BareEnv extends FakeEnv {}
// @ts-expect-error 测试：去掉可选方法
BareEnv.prototype.stopAgent = undefined

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

test('「先停一下」（点屏幕插话后，agent 还在跑）：让 agent 停，不发出去；这一轮结束再轮到你', async () => {
  const { call, env } = await connected()
  await busyTurn(call, env)
  call.tap()
  assert.equal(call.getView().phase, 'listening')
  await speak(call, env, '先停一下。')
  assert.equal(env.agentStops, 1)
  assert.deepEqual(env.sent, ['帮我把测试跑一遍'], '「停」不发给 agent')
  assert.equal(call.getView().notice, '已经让它停下')
  assert.notEqual(call.getView().phase, 'listening', '停下来之前不开麦')
  env.tones = []
  wait(call, env, 1200)
  assert.equal(call.getView().phase, 'listening')
  assert.deepEqual(env.tones, ['turn'])
})

test('agent 没在跑时说「停」：这是回答，照常发出去', async () => {
  const { call, env } = await connected()
  await speak(call, env, '停')
  assert.equal(env.agentStops, 0)
  assert.deepEqual(env.sent, ['停'])
})

test('「进度怎么样」：本地念一句进度，不发给 agent，不打断它', async () => {
  const { call, env } = await connected()
  await busyTurn(call, env)
  call.tap()
  wait(call, env, 400)
  await speak(call, env, '进度怎么样了？')
  assert.deepEqual(env.sent, ['帮我把测试跑一遍'])
  assert.equal(env.agentStops, 0)
  assert.deepEqual(env.said, ['还在干活。'])
  assert.equal(env.isRunning, true)
})

test('停不了（拿不到停止接口）：提示点屏幕上的停止按钮，继续听', async () => {
  const env = new FakeEnv()
  env.canStop = false
  const { call } = await connected(env)
  await busyTurn(call, env)
  call.tap()
  await speak(call, env, '停下来')
  assert.match(call.getView().notice, /停不了/)
  assert.equal(call.getView().phase, 'listening')
})

test('没开「说话打断」：念的时候说话不算', async () => {
  const { call, env } = await connected()
  await busyTurn(call, env)
  env.transcripts.push({ ok: true, text: '换个事' })
  feed(call, env, tone(1000, -20))
  feed(call, env, silence(1400))
  await flush()
  assert.deepEqual(env.sent, ['帮我把测试跑一遍'])
  assert.deepEqual(env.ducked, [])
  assert.equal(env.isSpeaking, true)
})

test('说话打断：一开口压低朗读；说的是新的话就停朗读、排队发出去', async () => {
  const { call, env } = await connected(new FakeEnv(), true)
  await busyTurn(call, env)
  env.transcripts.push({ ok: true, text: '算了，先帮我看看日志' })
  feed(call, env, tone(1000, -20))
  assert.deepEqual(env.ducked, [true], '开口就压低')
  feed(call, env, silence(1400))
  await flush()
  assert.deepEqual(env.sent, ['帮我把测试跑一遍', '算了，先帮我看看日志'])
  assert.equal(env.isSpeaking, false, '停了朗读')
  assert.equal(env.ducked.at(-1), false, '恢复音量')
  assert.equal(call.getView().heard, '算了，先帮我看看日志')
})

test('说话打断：录到的是朗读的回声，丢掉，朗读照常', async () => {
  const { call, env } = await connected(new FakeEnv(), true)
  await busyTurn(call, env)
  env.transcripts.push({ ok: true, text: '我先跑一下测试看看哪些没过' })
  feed(call, env, tone(1000, -20))
  feed(call, env, silence(1400))
  await flush()
  assert.deepEqual(env.sent, ['帮我把测试跑一遍'])
  assert.equal(env.isSpeaking, true, '朗读没停')
  assert.deepEqual(env.ducked, [true, false])
})

test('说话打断：「停」直接让 agent 停（短命令不做回声判断）', async () => {
  const { call, env } = await connected(new FakeEnv(), true)
  await busyTurn(call, env)
  env.transcripts.push({ ok: true, text: '停' })
  feed(call, env, tone(600, -20))
  feed(call, env, silence(1400))
  await flush()
  assert.equal(env.agentStops, 1)
  assert.equal(env.isSpeaking, false)
  assert.deepEqual(env.sent, ['帮我把测试跑一遍'])
})

test('说话打断：提问 / 审批在等时不收音', async () => {
  const { call, env } = await connected(new FakeEnv(), true)
  await busyTurn(call, env)
  env.isPending = true
  wait(call, env, 400)
  env.transcripts.push({ ok: true, text: '同意' })
  feed(call, env, tone(1000, -20))
  feed(call, env, silence(1400))
  await flush()
  assert.deepEqual(env.sent, ['帮我把测试跑一遍'])
  assert.deepEqual(env.ducked, [])
})

test('设置里随时开关「说话打断」', async () => {
  const { call, env } = await connected()
  assert.equal(call.getView().bargeIn, false)
  call.setBargeIn(true)
  assert.equal(call.getView().bargeIn, true)
  await busyTurn(call, env)
  env.transcripts.push({ ok: true, text: '换一个，先看日志' })
  feed(call, env, tone(1000, -20))
  feed(call, env, silence(1400))
  await flush()
  assert.equal(env.sent.length, 2)
})

test('老环境没有 stopAgent：「停」提示点停止按钮', async () => {
  const { call, env } = await connected(new BareEnv())
  await busyTurn(call, env)
  call.tap()
  await speak(call, env, '停')
  assert.match(call.getView().notice, /停不了/)
})
