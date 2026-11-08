/**
 * Host 路由测试。最后一项会真的调用百炼（念一小句，约 20 个字），
 * 没有 key 文件时自动跳过。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { createHandler, BASE_PATH } from '../src/index.js'

async function withServer(options, run) {
  const handler = createHandler(options)
  const server = createServer((req, res) => {
    if (req.url?.startsWith(BASE_PATH)) handler.handle(req, res)
    else { res.writeHead(404); res.end() }
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${server.address().port}${BASE_PATH}`
  try {
    await run(base)
  } finally {
    handler.disposeAll()
    server.closeAllConnections?.()
    await new Promise((resolve) => server.close(resolve))
  }
}

const post = (base, path, body, type = 'application/json') =>
  fetch(`${base}/${path}`, { method: 'POST', headers: { 'content-type': type }, body: JSON.stringify(body) })

/** 读完整个音频流，按帧拆开。 */
async function readFrames(res) {
  const bytes = Buffer.from(await res.arrayBuffer())
  const frames = []
  let at = 0
  while (at + 5 <= bytes.length) {
    const type = bytes[at]
    const length = bytes.readUInt32BE(at + 1)
    frames.push({ type, payload: bytes.subarray(at + 5, at + 5 + length) })
    at += 5 + length
  }
  return frames
}

test('没通过登录校验就拒绝', async () => {
  await withServer({ admit: () => false }, async (base) => {
    const res = await post(base, 'open', { id: 'abcdefgh-1234' })
    assert.equal(res.status, 401)
  })
})

test('写请求只收 application/json（防跨站）', async () => {
  await withServer({ admit: () => true }, async (base) => {
    const res = await post(base, 'open', { id: 'abcdefgh-1234' }, 'text/plain')
    assert.equal(res.status, 415)
  })
})

test('id 格式不对就拒绝', async () => {
  await withServer({ admit: () => true }, async (base) => {
    const res = await post(base, 'open', { id: '../x' })
    assert.equal(res.status, 400)
  })
})

test('没有 key 时 open 返回 503 和说明', async () => {
  await withServer({ admit: () => true, settings: () => ({ error: '没有找到百炼 API Key' }) }, async (base) => {
    const res = await post(base, 'open', { id: 'abcdefgh-1234' })
    assert.equal(res.status, 503)
    assert.match((await res.json()).error, /API Key/)
  })
})

test('不认识的 utterance 返回 404', async () => {
  await withServer({ admit: () => true }, async (base) => {
    const res = await fetch(`${base}/audio?id=abcdefgh-1234`)
    assert.equal(res.status, 404)
  })
})

const hasKey = existsSync(join(homedir(), '.config', 'dsh-voice', 'dashscope.key'))

test('真实调用：分两次追加文字，收到 PCM 和结束帧', { skip: process.env.DSH_VOICE_LIVE_TEST !== '1' ? '云端测试默认关闭；设 DSH_VOICE_LIVE_TEST=1 才调用百炼' : !hasKey && '没有百炼 key' }, async () => {
  await withServer({ admit: () => true }, async (base) => {
    const id = `test-${Date.now()}`
    assert.equal((await post(base, 'open', { id })).status, 200)
    const audio = fetch(`${base}/audio?id=${id}`)
    assert.equal((await post(base, 'append', { id, text: '你好，' })).status, 200)
    assert.equal((await post(base, 'append', { id, text: '这是插件的测试。' })).status, 200)
    assert.equal((await post(base, 'finish', { id })).status, 200)
    const res = await audio
    assert.equal(res.status, 200)
    const frames = await readFrames(res)
    const errors = frames.filter((f) => f.type === 2).map((f) => f.payload.toString('utf8'))
    assert.deepEqual(errors, [])
    const pcmBytes = frames.filter((f) => f.type === 1).reduce((sum, f) => sum + f.payload.length, 0)
    assert.ok(pcmBytes > 24000, `PCM 太少：${pcmBytes} 字节`)
    assert.equal(frames.at(-1)?.type, 3)
  })
})
