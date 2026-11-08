/**
 * 通话断句（Vad）和音频格式（wav）的测试：用合成的「静音 + 正弦波」当说话。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Vad, holdGapDb, rmsDb, suggestSensitivity, thresholdFor, type VadEvent } from '../src/client/call/vad.ts'
import { decodeWav, encodeWav, resample, toBase64 } from '../src/client/call/wav.ts'

const RATE = 16000

/** 一段指定音量（dBFS，RMS）的正弦波。 */
function tone(ms: number, db: number, freq = 220): Float32Array {
  const n = Math.round(RATE * ms / 1000)
  const amplitude = Math.SQRT2 * 10 ** (db / 20)
  const out = new Float32Array(n)
  for (let i = 0; i < n; i++) out[i] = amplitude * Math.sin(2 * Math.PI * freq * i / RATE)
  return out
}

/** 一段指定音量的随机噪声（伪随机，结果可复现）。 */
function noise(ms: number, db: number, seed = 1): Float32Array {
  const n = Math.round(RATE * ms / 1000)
  const amplitude = Math.sqrt(3) * 10 ** (db / 20)
  const out = new Float32Array(n)
  let s = seed
  for (let i = 0; i < n; i++) {
    s = (s * 1103515245 + 12345) % 2147483648
    out[i] = amplitude * (s / 1073741824 - 1)
  }
  return out
}

function silence(ms: number): Float32Array {
  return new Float32Array(Math.round(RATE * ms / 1000))
}

function concat(...parts: Float32Array[]): Float32Array {
  const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0))
  let at = 0
  for (const p of parts) {
    out.set(p, at)
    at += p.length
  }
  return out
}

/** 按 20ms 一块喂进去（和浏览器里差不多），收集全部事件。 */
function feed(vad: Vad, samples: Float32Array, chunk = 320): VadEvent[] {
  const events: VadEvent[] = []
  for (let at = 0; at < samples.length; at += chunk) events.push(...vad.push(samples.subarray(at, at + chunk)))
  return events
}

const kinds = (events: VadEvent[]) => events.map((e) => e.kind)

test('rmsDb：正弦波的音量算得对', () => {
  assert.ok(Math.abs(rmsDb(tone(200, -20)) - -20) < 0.2)
  assert.equal(rmsDb(silence(20)), -100)
})

test('只有静音：什么都不发生', () => {
  const vad = new Vad({ sampleRate: RATE })
  assert.deepEqual(feed(vad, silence(3000)), [])
  assert.equal(vad.isSpeaking, false)
})

test('说一秒再停 1.5 秒：开口一次、说完一次，音频带开头缓冲，结尾静音截掉', () => {
  const vad = new Vad({ sampleRate: RATE })
  const events = feed(vad, concat(silence(1000), tone(1000, -20), silence(1500)))
  assert.deepEqual(kinds(events), ['start', 'end'])
  const end = events[1] as Extract<VadEvent, { kind: 'end' }>
  assert.equal(end.forced, false)
  assert.ok(end.speechMs >= 900 && end.speechMs <= 1100, `speechMs=${end.speechMs}`)
  const ms = end.samples.length / RATE * 1000
  // 300ms 开头缓冲 + 1000ms 说话 + 200ms 结尾
  assert.ok(ms >= 1400 && ms <= 1600, `音频 ${ms}ms`)
})

test('停顿没到 silenceMs 就继续说：还是一句', () => {
  const vad = new Vad({ sampleRate: RATE })
  const events = feed(vad, concat(silence(500), tone(600, -20), silence(700), tone(600, -22), silence(1500)))
  assert.deepEqual(kinds(events), ['start', 'end'])
})

test('停顿时长可调：调短后同样的停顿会切成两句', () => {
  const vad = new Vad({ sampleRate: RATE })
  vad.setSilenceMs(500)
  const events = feed(vad, concat(silence(500), tone(600, -20), silence(700), tone(600, -22), silence(1500)))
  assert.deepEqual(kinds(events), ['start', 'end', 'start', 'end'])
})

test('不到 0.4 秒的声音（咳嗽、敲桌子）丢掉', () => {
  const vad = new Vad({ sampleRate: RATE })
  const events = feed(vad, concat(silence(500), tone(200, -15), silence(1500)))
  assert.deepEqual(kinds(events), ['start', 'discard'])
})

test('「说完了」：说话中途手动结束，立刻交出', () => {
  const vad = new Vad({ sampleRate: RATE })
  const events = feed(vad, concat(silence(500), tone(800, -20)))
  assert.deepEqual(kinds(events), ['start'])
  const done = vad.finish()
  assert.deepEqual(kinds(done), ['end'])
  assert.equal((done[0] as Extract<VadEvent, { kind: 'end' }>).forced, true)
  assert.deepEqual(vad.finish(), [], '没在说话时什么都不做')
})

test('一句太长：到上限直接截断交出', () => {
  const vad = new Vad({ sampleRate: RATE, maxSpeechMs: 2000 })
  const events = feed(vad, concat(silence(300), tone(3000, -20)))
  assert.deepEqual(kinds(events).slice(0, 2), ['start', 'end'])
  assert.equal((events[1] as Extract<VadEvent, { kind: 'end' }>).forced, true)
})

test('有底噪（风扇）：底噪本身不算说话，比底噪响得多的声音照样识别', () => {
  const vad = new Vad({ sampleRate: RATE })
  assert.deepEqual(feed(vad, noise(3000, -45)), [], '底噪不触发')
  assert.ok(vad.noiseFloorDb > -50 && vad.noiseFloorDb < -40, `底噪估计 ${vad.noiseFloorDb}`)
  const speech = tone(1000, -22)
  const bg = noise(1000, -45, 7)
  for (let i = 0; i < speech.length; i++) speech[i] = (speech[i] ?? 0) + (bg[i] ?? 0)
  const events = feed(vad, concat(speech, noise(1500, -45, 9)))
  assert.deepEqual(kinds(events), ['start', 'end'])
})

test('一开麦就说话：校准完照样能识别这句', () => {
  const vad = new Vad({ sampleRate: RATE })
  const events = feed(vad, concat(tone(1500, -20), silence(1500)))
  assert.deepEqual(kinds(events), ['start', 'end'])
})

test('reset：丢掉说了一半的，不交出', () => {
  const vad = new Vad({ sampleRate: RATE })
  feed(vad, concat(silence(300), tone(600, -20)))
  assert.equal(vad.isSpeaking, true)
  vad.reset()
  assert.equal(vad.isSpeaking, false)
  assert.deepEqual(feed(vad, silence(1500)), [])
})

test('wav：48k 重采样到 16k，编码后能原样读回', () => {
  const input = new Float32Array(48000).map((_, i) => 0.5 * Math.sin(2 * Math.PI * 200 * i / 48000))
  const down = resample(input, 48000)
  assert.equal(down.length, 16000)
  const bytes = encodeWav(down)
  assert.equal(bytes.length, 44 + 32000)
  const back = decodeWav(bytes)
  assert.ok(back !== null)
  assert.equal(back.sampleRate, 16000)
  assert.equal(back.samples.length, 16000)
  assert.ok(Math.abs((back.samples[100] ?? 0) - (down[100] ?? 0)) < 1e-3)
})

test('wav：24k（朗读用的播放采样率）重采样到 16k；8k 升到 16k', () => {
  assert.equal(resample(new Float32Array(24000), 24000).length, 16000)
  assert.equal(resample(new Float32Array(8000), 8000).length, 16000)
})

test('wav：不是 16 位 PCM 的文件读不出来', () => {
  assert.equal(decodeWav(new Uint8Array(10)), null)
  const bytes = encodeWav(new Float32Array(10))
  bytes[34] = 8
  assert.equal(decodeWav(bytes), null)
})

test('toBase64 和 Buffer 结果一致（大于一块的长度）', () => {
  const bytes = new Uint8Array(70000).map((_, i) => i % 251)
  assert.equal(toBase64(bytes), Buffer.from(bytes).toString('base64'))
})

test('pause：说话中停顿到 checkMs 报一次，带到目前为止的音频；finishIf 用这个 token 提前结束', () => {
  const vad = new Vad({ sampleRate: RATE, silenceMs: 3000, checkMs: 500 })
  const events = feed(vad, concat(silence(300), tone(1000, -20), silence(600)))
  assert.deepEqual(kinds(events), ['start', 'pause'])
  const pause = events[1] as Extract<VadEvent, { kind: 'pause' }>
  assert.ok(pause.samples.length / RATE > 1.0 && pause.samples.length / RATE < 1.6, `pause 音频 ${pause.samples.length / RATE}s`)
  const ended = vad.finishIf(pause.token)
  assert.deepEqual(kinds(ended), ['end'])
  assert.equal(vad.isSpeaking, false)
  assert.deepEqual(vad.finishIf(pause.token), [], '用过的 token 再用无效')
})

test('pause：停顿后又开口，之前的 token 作废；再停顿再报一次', () => {
  const vad = new Vad({ sampleRate: RATE, silenceMs: 3000, checkMs: 500 })
  const first = feed(vad, concat(silence(300), tone(800, -20), silence(600)))
  const token = (first.find((e) => e.kind === 'pause') as Extract<VadEvent, { kind: 'pause' }>).token
  const second = feed(vad, concat(tone(800, -20), silence(600)))
  assert.deepEqual(vad.finishIf(token), [], '又开口了，旧 token 不算')
  assert.deepEqual(kinds(second), ['pause'])
  const fresh = (second[0] as Extract<VadEvent, { kind: 'pause' }>).token
  assert.deepEqual(kinds(vad.finishIf(fresh)), ['end'])
})

test('pause：不管它，照样按 silenceMs 结束；checkMs 为 0 时不报', () => {
  const vad = new Vad({ sampleRate: RATE, silenceMs: 1500, checkMs: 500 })
  assert.deepEqual(kinds(feed(vad, concat(silence(300), tone(1000, -20), silence(1800)))), ['start', 'pause', 'end'])
  const off = new Vad({ sampleRate: RATE, silenceMs: 1200 })
  assert.deepEqual(kinds(feed(off, concat(silence(300), tone(1000, -20), silence(1500)))), ['start', 'end'])
})

test('pause：太短的声音（不到 minSpeechMs）不报', () => {
  const vad = new Vad({ sampleRate: RATE, silenceMs: 1500, checkMs: 300 })
  assert.deepEqual(kinds(feed(vad, concat(silence(300), tone(200, -20), silence(1800)))), ['start', 'discard'])
})

function events(vad: Vad, samples: Float32Array): VadEvent[] {
  const out: VadEvent[] = []
  for (let at = 0; at < samples.length; at += 320) out.push(...vad.push(samples.subarray(at, Math.min(samples.length, at + 320))))
  return out
}

test('停顿中只响一下（敲键盘）：不把停顿计时清零，照常按时说完', () => {
  const vad = new Vad({ sampleRate: RATE, silenceMs: 1200 })
  const got = events(vad, concat(silence(400), tone(1000, -20), silence(600), tone(40, -20), silence(640)))
  assert.deepEqual(got.map((e) => e.kind), ['start', 'end'], '40ms 的响声之后又停 0.64 秒，加起来够 1.2 秒就结束')
})

test('停顿中又连续说了一小段：重新计停顿', () => {
  const vad = new Vad({ sampleRate: RATE, silenceMs: 1200 })
  const got = events(vad, concat(silence(400), tone(1000, -20), silence(600), tone(200, -20), silence(700)))
  assert.deepEqual(got.map((e) => e.kind), ['start'], '又说了 0.2 秒，后面只停 0.7 秒，还没说完')
})

test('收音灵敏度：低档时中等音量不算说话，高档时更轻的也算', () => {
  const quiet = concat(silence(400), tone(1000, -46))
  const low = new Vad({ sampleRate: RATE })
  low.setSensitivity('low')
  assert.deepEqual(events(low, quiet).map((e) => e.kind), [], '低档门限最低 -44，-46 不算')
  const medium = new Vad({ sampleRate: RATE })
  assert.deepEqual(events(medium, quiet).map((e) => e.kind), ['start'], '中档门限最低 -50，-46 算开口')
  const veryQuiet = concat(silence(400), tone(1000, -52))
  const high = new Vad({ sampleRate: RATE })
  high.setSensitivity('high')
  assert.deepEqual(events(high, veryQuiet).map((e) => e.kind), ['start'], '高档门限最低 -54，-52 也算')
  // 同样没听过声音的两个比：底噪一样，门限只看档位
  const bad = new Vad({ sampleRate: RATE })
  bad.setSensitivity('nope')
  assert.equal(bad.thresholdDb, new Vad({ sampleRate: RATE }).thresholdDb, '不认识的档位按中档')
})

test('门限上限跟着档位走：底噪 -34 时中档门限压到 -28，低档能到 -24，很低能到 -18', () => {
  assert.equal(thresholdFor('medium', -34), -28)
  assert.equal(thresholdFor('low', -34), -24)
  assert.equal(thresholdFor('lowest', -34), -18)
  assert.equal(thresholdFor('high', -70), -54, '安静时按下限')
})

test('风扇声大（-36 的噪声）：中档开口后一直结束不了，很低档不当成说话', () => {
  const fan = noise(4000, -36, 7)
  const medium = new Vad({ sampleRate: RATE })
  medium.setSensitivity('medium')
  // 先让底噪学到 -36，再来一阵稍大的波动
  const wobble = concat(fan, noise(2000, -26, 9))
  assert.ok(events(medium, wobble).map((e) => e.kind).includes('start'), '中档：-26 的波动就算开口')
  const lowest = new Vad({ sampleRate: RATE })
  lowest.setSensitivity('lowest')
  assert.deepEqual(events(lowest, wobble).map((e) => e.kind), [], '很低档：同样的波动不算')
  // 很低档照样能听到正常说话，停下来也能结束
  const speech = concat(noise(4000, -36, 3), tone(1200, -12), noise(1600, -36, 5))
  const lowest2 = new Vad({ sampleRate: RATE })
  lowest2.setSensitivity('lowest')
  assert.deepEqual(events(lowest2, speech).map((e) => e.kind), ['start', 'end'])
})

test('按底噪建议档位', () => {
  assert.equal(suggestSensitivity(-60), 'medium')
  assert.equal(suggestSensitivity(-38), 'low')
  assert.equal(suggestSensitivity(-34), 'lowest')
  assert.equal(suggestSensitivity(-20), null, '再吵就只能手动点「说完了」')
  assert.ok(holdGapDb('lowest', -30) >= 8)
})

test('人声概率：够响但不是人声（风扇），不算开口', () => {
  const vad = new Vad({ sampleRate: RATE, silenceMs: 600 })
  vad.voiceProb = 0.05
  const events = feed(vad, concat(silence(400), noise(2000, -20)))
  assert.deepEqual(kinds(events), [])
  assert.equal(vad.isSpeaking, false)
})

test('人声概率：说话中风扇声还够响，但不是人声，照样能结束这句', () => {
  const vad = new Vad({ sampleRate: RATE, silenceMs: 600 })
  const events: VadEvent[] = []
  vad.voiceProb = 0
  events.push(...feed(vad, noise(400, -40)))
  vad.voiceProb = 0.9
  events.push(...feed(vad, tone(800, -20)))
  assert.deepEqual(kinds(events), ['start'])
  // 说完了，风扇（-30，比说话门限减迟滞还响）还在
  vad.voiceProb = 0.1
  events.push(...feed(vad, noise(1000, -30)))
  assert.deepEqual(kinds(events), ['start', 'end'])
})

test('人声概率：没给（模型没加载）时照旧只看音量', () => {
  const vad = new Vad({ sampleRate: RATE, silenceMs: 600 })
  assert.equal(vad.voiceProb, undefined)
  const events = feed(vad, concat(silence(400), tone(800, -20), silence(800)))
  assert.deepEqual(kinds(events), ['start', 'end'])
})

test('人声概率：短促的「停」（约 300ms）不被当成太短丢掉，即使概率晚到 100ms', () => {
  const vad = new Vad({ sampleRate: RATE, silenceMs: 800 })
  const events: VadEvent[] = []
  const parts: [Float32Array, number][] = [[silence(600), 0], [tone(100, -20), 0], [tone(200, -20), 1], [silence(100), 1], [silence(1200), 0]]
  for (const [samples, p] of parts) {
    vad.voiceProb = p
    events.push(...feed(vad, samples))
  }
  assert.deepEqual(kinds(events), ['start', 'end'])
})
