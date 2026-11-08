/**
 * 百炼识别：解析返回、出错分类（用假的 fetch），以及 /asr 路由（注入假的识别函数）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AsrError, cloudTranscribe } from '../src/asr.js'
import { createHandler, BASE_PATH } from '../src/index.js'

const ok = (body) => async () => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })

test('cloudTranscribe：取出文字；Key 放在 Authorization，音频是 data URL', async () => {
  let seen
  const fetchImpl = async (url, init) => {
    seen = { url, init }
    return ok({ choices: [{ message: { content: ' 你好。 ' } }] })()
  }
  const text = await cloudTranscribe({ key: 'k', host: 'dashscope.aliyuncs.com', wavBase64: 'AAAA', fetchImpl })
  assert.equal(text, '你好。')
  assert.equal(seen.url, 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions')
  assert.equal(seen.init.headers.authorization, 'Bearer k')
  const body = JSON.parse(seen.init.body)
  assert.equal(body.model, 'qwen3-asr-flash')
  assert.equal(body.messages[0].content[0].input_audio.data, 'data:audio/wav;base64,AAAA')
})

test('cloudTranscribe：HTTP 出错、格式不对、连不上都抛 AsrError', async () => {
  const bad = async () => new Response(JSON.stringify({ error: { message: 'Arrearage' } }), { status: 400 })
  await assert.rejects(cloudTranscribe({ key: 'k', host: 'h', wavBase64: 'A', fetchImpl: bad }), (e) => e instanceof AsrError && /Arrearage/.test(e.message))
  await assert.rejects(cloudTranscribe({ key: 'k', host: 'h', wavBase64: 'A', fetchImpl: ok({ choices: [] }) }), AsrError)
  const down = async () => { throw new TypeError('fetch failed') }
  await assert.rejects(cloudTranscribe({ key: 'k', host: 'h', wavBase64: 'A', fetchImpl: down }), (e) => e instanceof AsrError && /连不上/.test(e.message))
})

async function withServer(options, run) {
  const handler = createHandler(options)
  const server = createServer((req, res) => handler.handle(req, res))
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  try {
    await run(`http://127.0.0.1:${server.address().port}${BASE_PATH}`)
  } finally {
    handler.disposeAll()
    server.closeAllConnections?.()
    await new Promise((resolve) => server.close(resolve))
  }
}

test('/asr：转给识别函数，用设置里的 Key 和 host；坏音频、没 Key 都拒绝', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'vr-asr-'))
  writeFileSync(join(dir, 'dashscope.key'), 'secret\n')
  let got
  const cloudTranscribe = async (o) => { got = o; return '测试' }
  await withServer({ admit: () => true, configDir: dir, cloudTranscribe }, async (base) => {
    const post = (body) => fetch(`${base}/asr`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    const res = await post({ audio: 'UklGRg==' })
    assert.equal(res.status, 200)
    assert.deepEqual(await res.json(), { text: '测试' })
    assert.equal(got.key, 'secret')
    assert.equal(got.host, 'dashscope.aliyuncs.com')
    assert.equal((await post({ audio: 'not base64!' })).status, 400)
    assert.equal((await fetch(`${base}/asr`)).status, 405)
  })
  const empty = mkdtempSync(join(tmpdir(), 'vr-asr-'))
  await withServer({ admit: () => true, configDir: empty, cloudTranscribe }, async (base) => {
    const res = await fetch(`${base}/asr`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ audio: 'UklGRg==' }) })
    assert.equal(res.status, 503)
  })
})
