/**
 * 朗读设置（GET/POST /voice-reply/settings）和试听时临时换音色（open 带 voice）。
 * 设置的读写都在临时文件夹里做，不碰真正的 ~/.config/dsh-voice。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHandler, BASE_PATH, CONFIG_DIR } from '../src/index.js'

async function serve(options) {
  const handler = createHandler({ admit: () => true, ...options })
  const server = createServer((req, res) => {
    void handler.handle(req, res)
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address()
  return {
    base: `http://127.0.0.1:${port}${BASE_PATH}`,
    async close() {
      handler.disposeAll()
      server.closeAllConnections?.()
      await new Promise((resolve) => server.close(resolve))
    },
  }
}

function tempDir() {
  return mkdtempSync(join(tmpdir(), 'voice-reply-test-'))
}

function post(url, body, type = 'application/json') {
  return fetch(url, {
    method: 'POST',
    headers: { 'content-type': type },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

const FAKE_KEY = 'sk-test-not-a-real-key'

test('没有 Key 时设置页照样能读：默认设置、可选值和说明', async () => {
  const app = await serve({ configDir: tempDir() })
  try {
    const res = await fetch(`${app.base}/settings`)
    assert.equal(res.status, 200)
    const data = await res.json()
    assert.equal(data.ready, false)
    assert.match(data.error, /dashscope\.key/)
    assert.deepEqual(data.settings, { model: 'qwen3-tts-flash-realtime', voice: 'Cherry', turnLimit: 800, callSilenceMs: 1200, callBargeIn: false, callSmartTurn: false, callKeepOnLock: false, speakWhole: false, callSensitivity: 'medium', callVoiceModel: true, callCloudAsr: false, speechRate: 1, holdEnabled: true, replyEnabled: true })
    assert.equal(typeof data.vadVersion, 'string')
    assert.deepEqual(data.catalog.callSilences, [800, 1000, 1200, 1500, 2000, 3000])
    assert.equal(data.catalog.models.length, 1)
    const ids = data.catalog.models[0].voices.map((v) => v.id)
    assert.equal(ids.length, 48)
    assert.equal(new Set(ids).size, 48, '音色 id 不能重复')
    assert.ok(ids.includes('Serena'))
    assert.deepEqual(data.catalog.turnLimits, [300, 500, 800, 1500, 3000, 0])
  } finally {
    await app.close()
  }
})

test('两个功能独立开关，保留旧设置并在重读时生效', async () => {
  const dir = tempDir()
  const file = join(dir, 'voice-reply.json')
  writeFileSync(file, JSON.stringify({ voice: 'Serena', turnLimit: 1500 }))
  const app = await serve({ configDir: dir })
  try {
    let settings = (await (await fetch(`${app.base}/settings`)).json()).settings
    assert.equal(settings.holdEnabled, true)
    assert.equal(settings.replyEnabled, true)
    let res = await post(`${app.base}/settings`, { holdEnabled: false })
    assert.equal(res.status, 200)
    settings = (await res.json()).settings
    assert.equal(settings.holdEnabled, false)
    assert.equal(settings.replyEnabled, true)
    assert.equal(settings.voice, 'Serena')
    res = await post(`${app.base}/settings`, { replyEnabled: false })
    assert.equal(res.status, 200)
    settings = (await (await fetch(`${app.base}/settings`)).json()).settings
    assert.equal(settings.holdEnabled, false)
    assert.equal(settings.replyEnabled, false)
    assert.equal(settings.turnLimit, 1500)
    assert.equal((await post(`${app.base}/settings`, { holdEnabled: 'false' })).status, 400)
    assert.equal((await post(`${app.base}/settings`, { holdEnabled: true })).status, 200)
    settings = (await (await fetch(`${app.base}/settings`)).json()).settings
    assert.equal(settings.holdEnabled, true)
    assert.equal(settings.replyEnabled, false)
  } finally {
    await app.close()
  }
})

test('设置接口不会把 Key 发给浏览器', async () => {
  const dir = tempDir()
  writeFileSync(join(dir, 'dashscope.key'), `${FAKE_KEY}\n`, { mode: 0o600 })
  const app = await serve({ configDir: dir })
  try {
    const res = await fetch(`${app.base}/settings`)
    const text = await res.text()
    assert.equal(res.status, 200)
    assert.equal(JSON.parse(text).ready, true)
    assert.equal(text.includes(FAKE_KEY), false)
  } finally {
    await app.close()
  }
})

test('设置页保存和替换 Key，服务端即时使用且不回显', async () => {
  const dir = tempDir()
  let usedKey
  const app = await serve({ configDir: dir, cloudTranscribe: async ({ key }) => { usedKey = key; return '测试' } })
  try {
    for (const key of [FAKE_KEY, 'replacement-test-key']) {
      const res = await post(`${app.base}/key`, { key: ` ${key} ` })
      const text = await res.text()
      assert.equal(res.status, 200)
      assert.equal(JSON.parse(text).ready, true)
      assert.equal(text.includes(key), false)
      assert.equal(readFileSync(join(dir, 'dashscope.key'), 'utf8').trim(), key)
      assert.equal(statSync(join(dir, 'dashscope.key')).mode & 0o777, 0o600)
      assert.equal((await (await fetch(`${app.base}/settings`)).text()).includes(key), false)
      const asr = await post(`${app.base}/asr`, { audio: 'AAAA' })
      assert.equal(asr.status, 200)
      assert.equal(usedKey, key)
    }
    for (const key of ['', '   ', 'bad key', 'bad\nkey', 42, 'a'.repeat(1025)]) {
      assert.equal((await post(`${app.base}/key`, { key })).status, 400)
      assert.equal(readFileSync(join(dir, 'dashscope.key'), 'utf8').trim(), 'replacement-test-key')
    }
    assert.equal((await post(`${app.base}/key`, JSON.stringify({ key: FAKE_KEY }), 'text/plain')).status, 415)
    assert.equal((await fetch(`${app.base}/key`)).status, 405)
  } finally {
    await app.close()
  }
})

test('设置也要先通过登录校验', async () => {
  const app = await serve({ configDir: tempDir(), admit: () => false })
  try {
    const res = await fetch(`${app.base}/settings`)
    assert.equal(res.status, 401)
    await res.text()
    assert.equal((await post(`${app.base}/key`, { key: FAKE_KEY })).status, 401)
  } finally {
    await app.close()
  }
})

test('改设置：写进 voice-reply.json，保留手写的其它字段，文件只有本人能读写', async () => {
  const dir = tempDir()
  const file = join(dir, 'voice-reply.json')
  writeFileSync(file, JSON.stringify({ host: 'dashscope.aliyuncs.com', note: '手写的' }))
  const app = await serve({ configDir: dir })
  try {
    const res = await post(`${app.base}/settings`, { voice: 'Serena', turnLimit: 1500, callSilenceMs: 2000, speakWhole: true, callSensitivity: 'low' })
    assert.equal(res.status, 200)
    const data = await res.json()
    assert.equal(data.settings.voice, 'Serena')
    assert.equal(data.settings.turnLimit, 1500)
    assert.equal(data.settings.callSilenceMs, 2000)
    assert.equal(data.settings.speakWhole, true)
    assert.equal(data.settings.callSensitivity, 'low')
    const saved = JSON.parse(readFileSync(file, 'utf8'))
    assert.equal(saved.voice, 'Serena')
    assert.equal(saved.turnLimit, 1500)
    assert.equal(saved.callSilenceMs, 2000)
    assert.equal(saved.speakWhole, true)
    assert.equal(saved.note, '手写的')
    assert.equal(saved.host, 'dashscope.aliyuncs.com')
    assert.equal(statSync(file).mode & 0o777, 0o600)
    const again = await (await fetch(`${app.base}/settings`)).json()
    assert.equal(again.settings.voice, 'Serena')
    assert.equal(again.settings.turnLimit, 1500)
    const lowest = await post(`${app.base}/settings`, { callSensitivity: 'lowest' })
    assert.equal(lowest.status, 200)
    assert.equal((await lowest.json()).settings.callSensitivity, 'lowest')
  } finally {
    await app.close()
  }
})

test('不在可选范围内的值一律拒绝，文件不动', async () => {
  const dir = tempDir()
  const app = await serve({ configDir: dir })
  try {
    for (const body of [{ voice: 'NoSuchVoice' }, { model: 'cosyvoice-v3-flash' }, { turnLimit: 999 }, { turnLimit: '800' }, { callSilenceMs: 50 }, { callSilenceMs: '1200' }, { speakWhole: 'yes' }, { speakWhole: 1 }, { callSensitivity: 'loud' }, { callSensitivity: 1 }, { speechRate: 3 }, { speechRate: '1.5' }, ['voice']]) {
      const res = await post(`${app.base}/settings`, body)
      assert.equal(res.status, 400, JSON.stringify(body))
      await res.text()
    }
    assert.equal(existsSync(join(dir, 'voice-reply.json')), false)
  } finally {
    await app.close()
  }
})

test('改设置只收 application/json（防跨站）', async () => {
  const dir = tempDir()
  const app = await serve({ configDir: dir })
  try {
    const res = await post(`${app.base}/settings`, JSON.stringify({ voice: 'Serena' }), 'text/plain')
    assert.equal(res.status, 415)
    await res.text()
    assert.equal(existsSync(join(dir, 'voice-reply.json')), false)
  } finally {
    await app.close()
  }
})

test('试听时临时换音色：不认识的音色、模型直接拒绝，不连百炼', async () => {
  const dir = tempDir()
  writeFileSync(join(dir, 'dashscope.key'), `${FAKE_KEY}\n`, { mode: 0o600 })
  const app = await serve({ configDir: dir })
  try {
    const badVoice = await post(`${app.base}/open`, { id: 'test-unknown-voice-1', voice: 'NoSuchVoice' })
    assert.equal(badVoice.status, 400)
    await badVoice.text()
    const badModel = await post(`${app.base}/open`, { id: 'test-unknown-model-1', model: 'cosyvoice-v3-flash' })
    assert.equal(badModel.status, 400)
    await badModel.text()
  } finally {
    await app.close()
  }
})

function parseFrames(bytes) {
  let offset = 0
  let pcmBytes = 0
  let last = null
  let error = null
  while (offset + 5 <= bytes.length) {
    const view = new DataView(bytes.buffer, bytes.byteOffset + offset)
    const type = view.getUint8(0)
    const length = view.getUint32(1)
    const payload = bytes.subarray(offset + 5, offset + 5 + length)
    offset += 5 + length
    last = type
    if (type === 1) pcmBytes += payload.length
    else if (type === 2) error = new TextDecoder().decode(payload)
  }
  return { pcmBytes, last, error }
}

const HAS_KEY = existsSync(join(CONFIG_DIR, 'dashscope.key'))

test('真实调用：试听时临时换成 Serena，收到 PCM 和结束帧', { skip: process.env.DSH_VOICE_LIVE_TEST !== '1' ? '云端测试默认关闭；设 DSH_VOICE_LIVE_TEST=1 才调用百炼' : HAS_KEY ? false : '没有百炼 Key', timeout: 30000 }, async () => {
  const app = await serve({})
  try {
    const id = `test-voice-${Date.now()}`
    const opened = await post(`${app.base}/open`, { id, voice: 'Serena', model: 'qwen3-tts-flash-realtime' })
    const openText = await opened.text()
    assert.equal(opened.status, 200, openText)
    const audio = fetch(`${app.base}/audio?id=${id}`)
    const appended = await post(`${app.base}/append`, { id, text: '你好，这是试听。' })
    assert.equal(appended.status, 200)
    await appended.text()
    const finished = await post(`${app.base}/finish`, { id })
    assert.equal(finished.status, 200)
    await finished.text()
    const res = await audio
    assert.equal(res.status, 200)
    const frames = parseFrames(new Uint8Array(await res.arrayBuffer()))
    assert.equal(frames.error, null)
    assert.ok(frames.pcmBytes > 10000, `pcm bytes ${frames.pcmBytes}`)
    assert.equal(frames.last, 3)
  } finally {
    await app.close()
  }
})

test('语速：存进设置，catalog 给出可选档位', async () => {
  const dir = tempDir()
  const app = await serve({ configDir: dir })
  try {
    let data = await (await fetch(`${app.base}/settings`)).json()
    assert.deepEqual(data.catalog.speechRates, [1, 1.25, 1.5, 2])
    const res = await post(`${app.base}/settings`, { speechRate: 1.5 })
    assert.equal(res.status, 200)
    data = await res.json()
    assert.equal(data.settings.speechRate, 1.5)
    assert.equal(JSON.parse(readFileSync(join(dir, 'voice-reply.json'), 'utf8')).speechRate, 1.5)
  } finally {
    await app.close()
  }
})
