/**
 * 通话状态机：用假的环境（时间、agent 状态、朗读、识别、发送都可控）把整个循环跑一遍。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { CallController, FALLBACK_HINT, NEED_YOU_TEXT, type CallEnv, type TranscribeResult } from '../src/client/call/controller.ts'

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
  hostOk = true
  transcripts: TranscribeResult[] = []
  sent: string[] = []
  sendOk = true
  tones: string[] = []
  said: string[] = []
  thinkingOn = false
  stops = 0
  active: boolean[] = []
  endedWith: string | null = null
  transcribeCalls = 0

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
  async transcribe(): Promise<TranscribeResult> {
    this.transcribeCalls++
    return this.transcripts.shift() ?? { ok: true, text: '' }
  }
  send(text: string) { if (this.sendOk) this.sent.push(text); return this.sendOk }
  async setActive(active: boolean) { this.active.push(active); return this.hostOk }
  ended(reason: string) { this.endedWith = reason }
}

const flush = () => new Promise<void>((resolve) => setImmediate(resolve))

/** 一段一段喂音频，时间跟着走，每 200ms 调一次 tick。 */
function feed(call: CallController, env: FakeEnv, samples: Float32Array) {
  const step = 320 // 20ms
  for (let at = 0; at < samples.length; at += step) {
    call.audio(samples.subarray(at, Math.min(samples.length, at + step)))
    env.t += 20
    if ((env.t / 20) % 10 === 0) call.tick()
  }
}

/** 让时间过去 ms，每 200ms tick 一次。 */
function wait(call: CallController, env: FakeEnv, ms: number) {
  for (let left = ms; left > 0; left -= 200) {
    env.t += 200
    call.tick()
  }
}

async function connected(env = new FakeEnv()) {
  const call = new CallController(env, RATE, { silenceMs: 1200 })
  call.start()
  await flush()
  call.micReady()
  feed(call, env, silence(400)) // 校准底噪
  return { call, env }
}

/** 说一句话（1 秒），停够，等识别。 */
async function speak(call: CallController, env: FakeEnv, text: string) {
  env.transcripts.push({ ok: true, text })
  feed(call, env, tone(1000, -20))
  feed(call, env, silence(1400))
  await flush()
}

/** agent 跑一轮：开始跑、念一段、跑完、念完。 */
function agentTurn(call: CallController, env: FakeEnv) {
  env.isRunning = true
  wait(call, env, 2000)
  env.isSpeaking = true
  env.isSounding = true
  wait(call, env, 1000)
  env.isRunning = false
  wait(call, env, 1000)
  env.isSpeaking = false
  env.isSounding = false
  wait(call, env, 1200)
}

test('接通：放接通音，轮到你说', async () => {
  const { call, env } = await connected()
  assert.deepEqual(env.active, [true])
  assert.deepEqual(env.tones, ['connect'])
  assert.equal(call.getView().phase, 'listening')
})

test('完整一轮：说话 → 识别 → 发出 → 思考音 → 朗读 → 提示音 → 再听', async () => {
  const { call, env } = await connected()
  env.transcripts.push({ ok: true, text: '帮我看一下日志' })
  feed(call, env, tone(1000, -20))
  assert.equal(call.getView().phase, 'hearing')
  feed(call, env, silence(1400))
  await flush()
  assert.deepEqual(env.sent, ['帮我看一下日志'])
  assert.equal(call.getView().heard, '帮我看一下日志')
  assert.ok(env.tones.includes('ack'))
  call.tick()
  assert.equal(call.getView().phase, 'thinking')
  assert.equal(env.thinkingOn, true)

  env.isRunning = true
  wait(call, env, 1000)
  assert.equal(env.thinkingOn, true, '还没开口，思考音一直响')
  env.isSpeaking = true
  env.isSounding = true
  call.tick()
  assert.equal(env.thinkingOn, false, '一出声思考音就停')
  assert.equal(call.getView().phase, 'speaking')

  env.isRunning = false
  wait(call, env, 2000)
  assert.equal(call.getView().phase, 'speaking', '还在念就不轮到你')
  env.isSpeaking = false
  env.isSounding = false
  wait(call, env, 400)
  assert.ok(!env.tones.includes('turn'), '要安静一小会儿才算结束')
  wait(call, env, 800)
  assert.equal(env.tones.at(-1), 'turn')
  assert.equal(call.getView().phase, 'listening')
})

test('连续 5 轮不碰键盘', async () => {
  const { call, env } = await connected()
  for (let round = 1; round <= 5; round++) {
    await speak(call, env, `第${round}句`)
    assert.equal(env.sent.length, round, `第 ${round} 轮发出去了`)
    agentTurn(call, env)
    assert.equal(call.getView().phase, 'listening', `第 ${round} 轮后轮到你`)
  }
  assert.deepEqual(env.sent, ['第1句', '第2句', '第3句', '第4句', '第5句'])
  assert.equal(env.tones.filter((t) => t === 'turn').length, 5)
})

test('朗读、等待时麦克风收到的声音一律不算', async () => {
  const { call, env } = await connected()
  await speak(call, env, '你好')
  env.isRunning = true
  env.isSpeaking = true
  env.isSounding = true
  feed(call, env, tone(1500, -15))
  feed(call, env, silence(1500))
  await flush()
  assert.equal(env.transcribeCalls, 1, '只识别了第一句')
})

test('识别为空或只有语气词：不发，继续听', async () => {
  const { call, env } = await connected()
  await speak(call, env, '')
  assert.deepEqual(env.sent, [])
  assert.equal(call.getView().phase, 'listening')
  await speak(call, env, '嗯。')
  assert.deepEqual(env.sent, [])
  assert.equal(call.getView().notice, '没听清，请再说一遍')
  await speak(call, env, '好')
  assert.deepEqual(env.sent, ['好'], '一个「好」是正常回答，要发')
})

test('识别失败：提示，继续听', async () => {
  const { call, env } = await connected()
  env.transcripts.push({ ok: false, error: '模型没准备好' })
  feed(call, env, tone(1000, -20))
  feed(call, env, silence(1400))
  await flush()
  assert.equal(call.getView().phase, 'listening')
  assert.match(call.getView().notice, /模型没准备好/)
})

test('点一下屏幕：停朗读，马上轮到你；agent 照常跑', async () => {
  const { call, env } = await connected()
  await speak(call, env, '讲个长的')
  env.isRunning = true
  env.isSpeaking = true
  env.isSounding = true
  call.tick()
  assert.equal(call.getView().phase, 'speaking')
  call.tap()
  assert.equal(env.stops, 1)
  assert.equal(call.getView().phase, 'listening')
  env.transcripts.push({ ok: true, text: '换个话题' })
  feed(call, env, tone(1000, -20))
  feed(call, env, silence(1400))
  await flush()
  assert.deepEqual(env.sent, ['讲个长的', '换个话题'], 'agent 还在跑时说的话也发出去（排队）')
})

test('「说完了」：不用等停顿，立刻识别发出', async () => {
  const { call, env } = await connected()
  env.transcripts.push({ ok: true, text: '就这些' })
  feed(call, env, tone(800, -20))
  call.done()
  await flush()
  assert.deepEqual(env.sent, ['就这些'])
})

test('agent 弹出提问或审批：响一声、读一次提示，处理完再继续', async () => {
  const { call, env } = await connected()
  await speak(call, env, '删掉旧文件')
  env.isRunning = true
  wait(call, env, 600)
  env.isPending = true
  wait(call, env, 2000)
  assert.equal(call.getView().phase, 'needs-you')
  assert.deepEqual(env.said, [NEED_YOU_TEXT], '只读一次')
  assert.equal(env.tones.filter((t) => t === 'need').length, 1)
  env.isPending = false
  env.isRunning = false
  wait(call, env, 1200)
  assert.equal(call.getView().phase, 'listening')
})

test('接通时 agent 正在跑：等它这一轮完再轮到你', async () => {
  const env = new FakeEnv()
  env.isRunning = true
  const call = new CallController(env, RATE)
  call.start()
  await flush()
  call.micReady()
  wait(call, env, 1000)
  assert.equal(call.getView().phase, 'working')
  assert.equal(env.thinkingOn, false, '不是我们发的，不放思考音')
  env.isRunning = false
  wait(call, env, 1200)
  assert.equal(call.getView().phase, 'listening')
})

test('agent 长时间干活不说话：思考音最多 20 秒，之后每 15 秒轻响一下', async () => {
  const { call, env } = await connected()
  await speak(call, env, '跑个全量测试')
  env.isRunning = true
  wait(call, env, 19_000)
  assert.equal(env.thinkingOn, true)
  wait(call, env, 2000)
  assert.equal(env.thinkingOn, false)
  assert.equal(call.getView().phase, 'working')
  const before = env.tones.filter((t) => t === 'tick').length
  wait(call, env, 31_000)
  assert.equal(env.tones.filter((t) => t === 'tick').length - before, 2)
})

test('后台不认通话：每条消息末尾带一句提示', async () => {
  const env = new FakeEnv()
  env.hostOk = false
  const { call } = await connected(env)
  await speak(call, env, '在吗')
  assert.deepEqual(env.sent, [`在吗\n\n${FALLBACK_HINT}`])
})

test('发出去了 agent 却一直没跑：8 秒后提示没发出去，轮到你', async () => {
  const { call, env } = await connected()
  await speak(call, env, '你好')
  wait(call, env, 5000)
  assert.notEqual(call.getView().phase, 'listening', '还没到 8 秒，再等等')
  wait(call, env, 4000)
  assert.equal(call.getView().phase, 'listening')
  assert.equal(call.getView().notice, '好像没发出去，请再说一遍')
})

test('草稿写不进去（正在提交等）：提示，继续听', async () => {
  const { call, env } = await connected()
  env.sendOk = false
  await speak(call, env, '你好')
  assert.equal(call.getView().phase, 'listening')
  assert.equal(call.getView().notice, '没发出去，请再说一遍')
})

test('静音：说话不算；取消静音照常', async () => {
  const { call, env } = await connected()
  call.toggleMute()
  assert.equal(call.getView().phase, 'muted')
  env.transcripts.push({ ok: true, text: '不该发' })
  feed(call, env, tone(1000, -20))
  feed(call, env, silence(1400))
  await flush()
  assert.equal(env.transcribeCalls, 0)
  call.toggleMute()
  env.transcripts.length = 0
  await speak(call, env, '现在可以了')
  assert.deepEqual(env.sent, ['现在可以了'])
})

test('切到后台暂停：不收音；点一下继续', async () => {
  const { call, env } = await connected()
  call.pause()
  assert.equal(call.getView().phase, 'paused')
  feed(call, env, tone(1000, -20))
  feed(call, env, silence(1400))
  await flush()
  assert.equal(env.transcribeCalls, 0)
  call.tap()
  assert.equal(call.getView().phase, 'listening')
})

test('锁屏后系统停了麦克风：暂停的原因一直留着，点继续才消失', async () => {
  const { call, env } = await connected()
  call.pause('锁屏后系统停了麦克风或声音，点这里继续')
  assert.equal(call.isPaused, true)
  wait(call, env, 60_000)
  assert.equal(call.getView().phase, 'paused')
  assert.equal(call.getView().notice, '锁屏后系统停了麦克风或声音，点这里继续', '用户在锁屏时看不到，回来要还在')
  call.tap()
  assert.equal(call.isPaused, false)
  assert.equal(call.getView().notice, '')
  assert.equal(call.getView().phase, 'listening')
})

test('锁屏后继续通话：不暂停时照常一轮接一轮', async () => {
  const { call, env } = await connected()
  // 没调 pause（session 判断麦克风和朗读都还在）：和前台一样
  await speak(call, env, '帮我看一下日志')
  assert.deepEqual(env.sent, ['帮我看一下日志'])
  agentTurn(call, env)
  assert.equal(env.tones.at(-1), 'turn')
  assert.equal(call.getView().phase, 'listening')
})

test('挂断：停朗读、放挂断音、告诉后台、通知外面收尾；之后什么都不做', async () => {
  const { call, env } = await connected()
  await speak(call, env, '先这样')
  env.isSpeaking = true
  call.hangup()
  assert.equal(env.stops, 1)
  assert.equal(env.tones.at(-1), 'hangup')
  await flush()
  assert.deepEqual(env.active, [true, false])
  assert.equal(env.endedWith, '')
  assert.equal(call.getView().phase, 'ended')
  feed(call, env, tone(1000, -20))
  wait(call, env, 2000)
  assert.equal(env.transcribeCalls, 1)
})

test('识别中挂断：识别结果回来也不发', async () => {
  const { call, env } = await connected()
  let release: (r: TranscribeResult) => void = () => {}
  env.transcribe = () => { env.transcribeCalls++; return new Promise((resolve) => { release = resolve }) }
  feed(call, env, tone(1000, -20))
  feed(call, env, silence(1400))
  assert.equal(call.getView().phase, 'transcribing')
  call.hangup()
  release({ ok: true, text: '晚到的' })
  await flush()
  assert.deepEqual(env.sent, [])
})

test('每 30 秒告诉后台一次「还在通话」', async () => {
  const { call, env } = await connected()
  wait(call, env, 61_000)
  await flush()
  assert.equal(env.active.filter(Boolean).length, 3)
})
