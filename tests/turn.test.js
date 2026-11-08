/**
 * smart-turn（听语气判断说完没有）：特征提取、工作线程推理和 POST /voice-reply/turn。
 * 用插件自带的 vendor/ 里的运行库和模型，真的跑一遍；录音是百炼合成的「用一句话说一下你现在用的是什么模型」，
 * 完整的一句和只留前 55% 的半句。
 */
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHandler, BASE_PATH } from '../src/index.js'
import { SmartTurn, pcm16ToFloat } from '../src/turn.js'
import { logMelFeatures, N_FRAMES, N_MELS } from '../src/turn-features.js'

const here = new URL('./fixtures/', import.meta.url)
/** WAV 去掉 44 字节头，剩下 16 kHz 单声道 PCM16。 */
const pcm = (name) => readFileSync(new URL(name, here)).subarray(44)
const COMPLETE = pcm('turn-complete.wav')
const CUT = pcm('turn-cut.wav')

const turn = new SmartTurn()
after(() => turn.stop())

async function serve(options) {
  const handler = createHandler({ admit: () => true, configDir: mkdtempSync(join(tmpdir(), 'voice-reply-turn-')), turn, ...options })
  const server = createServer((req, res) => { void handler.handle(req, res) })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address()
  return {
    base: `http://127.0.0.1:${port}${BASE_PATH}`,
    async close() {
      server.closeAllConnections?.()
      await new Promise((resolve) => server.close(resolve))
    },
  }
}

const post = (url, body, type = 'application/json') => fetch(url, {
  method: 'POST',
  headers: { 'content-type': type },
  body: typeof body === 'string' ? body : JSON.stringify(body),
})

test('特征：80 × 800，取值在 Whisper 的范围里；不到 8 秒在前面补零', () => {
  const feats = logMelFeatures(pcm16ToFloat(COMPLETE.toString('base64')))
  assert.equal(feats.length, N_MELS * N_FRAMES)
  let min = Infinity
  let max = -Infinity
  for (const v of feats) {
    min = Math.min(min, v)
    max = Math.max(max, v)
  }
  assert.ok(max <= 2 && min >= -1, `范围 ${min}..${max}`)
  // 补零在前：这段录音 2.88 秒，前 5 秒多全是补的零，那里的两帧完全一样；最后一帧是说话，和它们不同
  const frame = (f) => Array.from({ length: N_MELS }, (_, m) => feats[m * N_FRAMES + f])
  const a = frame(10)
  const b = frame(300)
  const last = frame(N_FRAMES - 50)
  assert.ok(a.every((v, m) => Math.abs(v - b[m]) < 1e-6), '补零区的帧都一样')
  assert.ok(a.some((v, m) => Math.abs(v - last[m]) > 0.05), '说话的帧和补零区不同')
})

test('推理：完整的一句判断为说完了，半句判断为没说完', { timeout: 30_000 }, async () => {
  const complete = await turn.predict(pcm16ToFloat(COMPLETE.toString('base64')))
  const cut = await turn.predict(pcm16ToFloat(CUT.toString('base64')))
  assert.ok(complete > 0.8, `完整 ${complete}`)
  assert.ok(cut < 0.2, `半句 ${cut}`)
})

test('POST /turn：回说完了的概率', { timeout: 30_000 }, async () => {
  const app = await serve()
  try {
    const res = await post(`${app.base}/turn`, { audio: COMPLETE.toString('base64') })
    assert.equal(res.status, 200)
    const data = await res.json()
    assert.ok(data.probability > 0.8, JSON.stringify(data))
    const cut = await (await post(`${app.base}/turn`, { audio: CUT.toString('base64') })).json()
    assert.ok(cut.probability < 0.2, JSON.stringify(cut))
  } finally {
    await app.close()
  }
})

test('POST /turn：没音频、太短、不是 JSON 都拒绝；要先通过登录校验', async () => {
  const app = await serve()
  try {
    for (const [body, status] of [[{}, 400], [{ audio: '' }, 400], [{ audio: Buffer.alloc(100).toString('base64') }, 400]]) {
      const res = await post(`${app.base}/turn`, body)
      assert.equal(res.status, status, JSON.stringify(body))
      await res.text()
    }
    const plain = await post(`${app.base}/turn`, 'x', 'text/plain')
    assert.equal(plain.status, 415)
    await plain.text()
  } finally {
    await app.close()
  }
  const locked = await serve({ admit: () => false })
  try {
    const res = await post(`${locked.base}/turn`, { audio: COMPLETE.toString('base64') })
    assert.equal(res.status, 401)
    await res.text()
  } finally {
    await locked.close()
  }
})

test('POST /turn：推理出错回 503（浏览器据此改回按停顿判断）', async () => {
  const broken = { predict: async () => { throw new Error('模型文件不见了') }, stop() {} }
  const app = await serve({ turn: broken })
  try {
    const res = await post(`${app.base}/turn`, { audio: COMPLETE.toString('base64') })
    assert.equal(res.status, 503)
    assert.match((await res.json()).error, /模型文件不见了/)
  } finally {
    await app.close()
  }
})
