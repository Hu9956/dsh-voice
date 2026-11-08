/**
 * 人声检测要的静态文件：GET /voice-reply/vad/<名字>。只认下面这几个名字，不拼路径。
 *
 * - worker.js / core.js：工作线程脚本，很小，每次都重新取（升级插件后马上生效）。
 * - ort.mjs / ort.wasm / model.onnx：运行库和模型，URL 带 ?v=<插件版本>，浏览器缓存一年。
 *   支持 gzip 就发压缩过的（wasm 14 MB → 约 4 MB），压缩结果在内存里留一份。
 */
import { readFileSync } from 'node:fs'
import { gzipSync } from 'node:zlib'

const HERE = new URL('./', import.meta.url)
const VENDOR = new URL('../vendor/', import.meta.url)

const ASSETS = {
  'worker.js': { url: new URL('vad-worker.js', HERE), type: 'text/javascript; charset=utf-8', immutable: false },
  'core.js': { url: new URL('vad-core.js', HERE), type: 'text/javascript; charset=utf-8', immutable: false },
  'ort.mjs': { url: new URL('ort/ort.wasm.bundle.min.mjs', VENDOR), type: 'text/javascript; charset=utf-8', immutable: true },
  'ort.wasm': { url: new URL('ort/ort-wasm-simd-threaded.wasm', VENDOR), type: 'application/wasm', immutable: true },
  'model.onnx': { url: new URL('silero/silero_vad.onnx', VENDOR), type: 'application/octet-stream', immutable: true },
}

/** 插件版本：工作线程用它拼 ?v=，换版本就换缓存。 */
export const VAD_VERSION = (() => {
  try {
    return String(JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version ?? '0')
  } catch {
    return '0'
  }
})()

/** @type {Map<string, Buffer>} */
const gzipped = new Map()

/**
 * @param {string} name
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 */
export function serveVadAsset(name, req, res) {
  const asset = Object.hasOwn(ASSETS, name) ? ASSETS[name] : undefined
  if (asset === undefined) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
    res.end('not found')
    return
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { 'content-type': 'text/plain; charset=utf-8' })
    res.end('method not allowed')
    return
  }
  let body
  let encoding
  try {
    const acceptsGzip = /\bgzip\b/.test(String(req.headers['accept-encoding'] ?? ''))
    if (acceptsGzip) {
      body = gzipped.get(name)
      if (body === undefined) {
        body = gzipSync(readFileSync(asset.url))
        if (asset.immutable) gzipped.set(name, body)
      }
      encoding = 'gzip'
    } else {
      body = readFileSync(asset.url)
    }
  } catch (error) {
    res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' })
    res.end(`读取失败：${error instanceof Error ? error.message : String(error)}`)
    return
  }
  res.writeHead(200, {
    'content-type': asset.type,
    'content-length': body.length,
    'cache-control': asset.immutable ? 'private, max-age=31536000, immutable' : 'no-cache',
    vary: 'Accept-Encoding',
    ...encoding === undefined ? {} : { 'content-encoding': encoding },
  })
  res.end(req.method === 'HEAD' ? undefined : body)
}
