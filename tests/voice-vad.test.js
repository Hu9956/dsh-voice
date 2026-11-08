/**
 * 人声模型（Silero VAD）：重采样、模型推理、静态文件路由。
 * 模型用插件自带的 vendor/ 文件，Node 里用 ort.node 版跑（和浏览器里的 wasm 是同一个文件）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { gunzipSync } from 'node:zlib'
import { Downsampler, SileroStream, VAD_RATE } from '../src/vad-core.js'
import { serveVadAsset, VAD_VERSION } from '../src/vad-assets.js'

const VENDOR = new URL('../vendor/', import.meta.url)

function readWav(url) {
  const buf = readFileSync(url)
  let off = 12
  while (buf.toString('ascii', off, off + 4) !== 'data') off += 8 + buf.readUInt32LE(off + 4)
  const n = buf.readUInt32LE(off + 4) / 2
  const out = new Float32Array(n)
  for (let i = 0; i < n; i++) out[i] = buf.readInt16LE(off + 8 + i * 2) / 32768
  return out
}

/** 风扇似的噪声：低频为主的随机噪声 + 120 Hz 嗡声，按 RMS 定音量。伪随机，结果可复现。 */
function fan(length, rms, seed = 7) {
  const out = new Float32Array(length)
  let s = seed
  let b = 0
  for (let i = 0; i < length; i++) {
    s = (s * 1103515245 + 12345) % 2147483648
    b = 0.98 * b + (s / 1073741824 - 1) * 0.2
    out[i] = b + 0.3 * Math.sin(2 * Math.PI * 120 * i / VAD_RATE)
  }
  let sum = 0
  for (const v of out) sum += v * v
  const scale = rms / Math.sqrt(sum / length)
  for (let i = 0; i < length; i++) out[i] *= scale
  return out
}

const rmsOf = (a) => Math.sqrt(a.reduce((x, v) => x + v * v, 0) / a.length)

async function silero() {
  const ort = await import(new URL('ort/ort.node.min.mjs', VENDOR).href)
  ort.env.wasm.numThreads = 1
  const session = await ort.InferenceSession.create(readFileSync(new URL('silero/silero_vad.onnx', VENDOR)))
  return new SileroStream(ort, session)
}

test('Downsampler：分块和一次性转出来一样，48k → 16k 长度对', () => {
  const input = new Float32Array(48000)
  for (let i = 0; i < input.length; i++) input[i] = Math.sin(i / 7)
  const whole = new Downsampler(48000).push(input)
  const d = new Downsampler(48000)
  const parts = []
  // 不整除的块长（像 ScriptProcessor 的 2048）
  for (let at = 0; at < input.length; at += 2048) parts.push(d.push(input.subarray(at, at + 2048)))
  const chunked = Float32Array.from(parts.flatMap((p) => [...p]))
  assert.equal(whole.length, 16000)
  assert.equal(chunked.length, whole.length)
  for (let i = 0; i < whole.length; i++) assert.ok(Math.abs(chunked[i] - whole[i]) < 1e-6)
  // 44.1k 不整除
  const d2 = new Downsampler(44100)
  let n = 0
  for (let at = 0; at < 44100; at += 2048) n += d2.push(new Float32Array(Math.min(2048, 44100 - at))).length
  assert.ok(Math.abs(n - 16000) <= 1)
})

test('Silero：人声概率高；同样响（甚至更响）的风扇声概率低', async () => {
  const stream = await silero()
  const speech = readWav(new URL('fixtures/turn-complete.wav', import.meta.url))
  const probs = await stream.push(speech)
  const voiced = probs.filter((p) => p >= 0.5).length / probs.length
  assert.ok(voiced > 0.5, `人声窗占比 ${voiced}`)

  stream.reset()
  // 噪声比这句话还响 5 dB
  const noiseProbs = await stream.push(fan(VAD_RATE * 3, rmsOf(speech) * 10 ** (5 / 20)))
  const loudest = Math.max(...noiseProbs)
  assert.ok(loudest < 0.5, `噪声最高概率 ${loudest}`)
})

test('Silero：不够一窗的采样留到下一次', async () => {
  const stream = await silero()
  assert.equal((await stream.push(new Float32Array(500))).length, 0)
  assert.equal((await stream.push(new Float32Array(30))).length, 1)
  assert.equal((await stream.push(new Float32Array(1024))).length, 2)
})

async function withAssets(run) {
  const server = createServer((req, res) => serveVadAsset(new URL(req.url, 'http://x').pathname.slice(1), req, res))
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  try {
    await run(`http://127.0.0.1:${server.address().port}`)
  } finally {
    server.closeAllConnections?.()
    await new Promise((resolve) => server.close(resolve))
  }
}

test('静态文件：只认白名单，wasm 带缓存头且能压缩', async () => {
  assert.match(VAD_VERSION, /^\d+\.\d+\.\d+/)
  await withAssets(async (base) => {
    assert.equal((await fetch(`${base}/../index.js`)).status, 404)
    assert.equal((await fetch(`${base}/nope`)).status, 404)
    assert.equal((await fetch(`${base}/worker.js`, { method: 'POST' })).status, 405)

    const worker = await fetch(`${base}/worker.js`)
    assert.equal(worker.status, 200)
    assert.match(worker.headers.get('content-type'), /javascript/)
    assert.equal(worker.headers.get('cache-control'), 'no-cache')
    assert.match(await worker.text(), /SileroStream/)

    // 用 node:http 拿原始字节，确认确实压缩了
    const raw = await new Promise((resolve, reject) => {
      import('node:http').then(({ get }) => get(`${base}/ort.wasm?v=1`, { headers: { 'accept-encoding': 'gzip' } }, (res) => {
        const chunks = []
        res.on('data', (c) => chunks.push(c))
        res.on('end', () => resolve({ headers: res.headers, body: Buffer.concat(chunks) }))
      }).on('error', reject))
    })
    assert.equal(raw.headers['content-type'], 'application/wasm')
    assert.equal(raw.headers['content-encoding'], 'gzip')
    assert.match(raw.headers['cache-control'], /immutable/)
    const wasm = gunzipSync(raw.body)
    assert.ok(raw.body.length < wasm.length / 2)
    assert.deepEqual([...wasm.subarray(0, 4)], [0, 0x61, 0x73, 0x6d])
  })
})
