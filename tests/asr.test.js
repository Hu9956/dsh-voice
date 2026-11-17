/**
 * 云端识别（百炼 qwen3-asr-flash 与 DeepSeek /v1/tools/asr）：解析返回、出错分类（用假的 fetch），以及 /asr 路由。
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

test('cloudTranscribe（百炼）：取出文字；Key 放在 Authorization，音频是 data URL', async () => {
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

test('cloudTranscribe（百炼）：HTTP 出错、格式不对、连不上都抛 AsrError', async () => {
  const bad = async () => new Response(JSON.stringify({ error: { message: 'Arrearage' } }), { status: 400 })
  await assert.rejects(cloudTranscribe({ key: 'k', host: 'h', wavBase64: 'A', fetchImpl: bad }), (e) => e instanceof AsrError && /Arrearage/.test(e.message))
  await assert.rejects(cloudTranscribe({ key: 'k', host: 'h', wavBase64: 'A', fetchImpl: ok({ choices: [] }) }), AsrError)
  const down = async () => { throw new TypeError('fetch failed') }
  await assert.rejects(cloudTranscribe({ key: 'k', host: 'h', wavBase64: 'A', fetchImpl: down }), (e) => e instanceof AsrError && /连不上/.test(e.message))
})

test('cloudTranscribe（DeepSeek）：以 multipart FormData 上传 WAV 并解析 text，区分 401/402/429', async () => {
  let seen
  const fetchImpl = async (url, init) => {
    seen = { url, init }
    return ok({ request_id: 'req-1', text: ' 上海今天天气怎么样？ ', duration_ms: 2100 })()
  }
  const text = await cloudTranscribe({ provider: 'deepseek', key: 'ds-key', host: 'api.deepseek.com', wavBase64: 'UklGRg==', fetchImpl })
  assert.equal(text, '上海今天天气怎么样？')
  assert.equal(seen.url, 'https://api.deepseek.com/v1/tools/asr')
  assert.equal(seen.init.headers.authorization, 'Bearer ds-key')
  assert.ok(seen.init.body instanceof FormData)
  const file = seen.init.body.get('file')
  assert.ok(file instanceof Blob)
  assert.equal(file.size, 4)

  const statusResp = (status) => async () => new Response(JSON.stringify({ error: { message: 'err' } }), { status })
  await assert.rejects(
    cloudTranscribe({ provider: 'deepseek', key: 'k', host: 'api.deepseek.com', wavBase64: 'UklGRg==', fetchImpl: statusResp(401) }),
    (e) => e instanceof AsrError && /API Key 无效/.test(e.message),
  )
  await assert.rejects(
    cloudTranscribe({ provider: 'deepseek', key: 'k', host: 'api.deepseek.com', wavBase64: 'UklGRg==', fetchImpl: statusResp(402) }),
    (e) => e instanceof AsrError && /余额不足/.test(e.message),
  )
  await assert.rejects(
    cloudTranscribe({ provider: 'deepseek', key: 'k', host: 'api.deepseek.com', wavBase64: 'UklGRg==', fetchImpl: statusResp(429) }),
    (e) => e instanceof AsrError && /并发请求超限/.test(e.message),
  )
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

test('/asr：随当前服务商把对应的 provider、Key 和 host 转给识别函数；坏音频、没 Key 都拒绝', async () => {
  // 已有百炼 Key 时默认走百炼
  const dir = mkdtempSync(join(tmpdir(), 'vr-asr-'))
  writeFileSync(join(dir, 'dashscope.key'), 'secret\n')
  let got
  const mockTranscribe = async (o) => { got = o; return '测试' }
  await withServer({ admit: () => true, configDir: dir, cloudTranscribe: mockTranscribe }, async (base) => {
    const post = (body) => fetch(`${base}/asr`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    const res = await post({ audio: 'UklGRg==' })
    assert.equal(res.status, 200)
    assert.deepEqual(await res.json(), { text: '测试' })
    assert.equal(got.provider, 'dashscope')
    assert.equal(got.key, 'secret')
    assert.equal(got.host, 'dashscope.aliyuncs.com')
    assert.equal((await post({ audio: 'not base64!' })).status, 400)
    assert.equal((await fetch(`${base}/asr`)).status, 405)
  })

  // 新装只配了 DeepSeek Key 时默认走 DeepSeek
  const dsDir = mkdtempSync(join(tmpdir(), 'vr-asr-ds-'))
  writeFileSync(join(dsDir, 'deepseek.key'), 'ds-secret\n')
  await withServer({ admit: () => true, configDir: dsDir, cloudTranscribe: mockTranscribe }, async (base) => {
    const res = await fetch(`${base}/asr`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ audio: 'UklGRg==' }) })
    assert.equal(res.status, 200)
    assert.deepEqual(await res.json(), { text: '测试' })
    assert.equal(got.provider, 'deepseek')
    assert.equal(got.key, 'ds-secret')
    assert.equal(got.host, 'api.deepseek.com')
  })

  const empty = mkdtempSync(join(tmpdir(), 'vr-asr-'))
  await withServer({ admit: () => true, configDir: empty, cloudTranscribe: mockTranscribe }, async (base) => {
    const res = await fetch(`${base}/asr`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ audio: 'UklGRg==' }) })
    assert.equal(res.status, 503)
  })
})
