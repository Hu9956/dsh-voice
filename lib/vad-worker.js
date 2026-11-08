/**
 * 浏览器里跑人声检测的工作线程（模块 Worker），不占页面主线程。
 * 从本插件的 /voice-reply/vad/ 取运行库和模型（来源和许可证见 vendor/NOTICE.md），不联网。
 *
 * 收：{ type: 'init', version } → 回 { type: 'ready' } 或 { type: 'error', message }
 *     { type: 'audio', samples: Float32Array, rate } → 回 { type: 'prob', p }（每 32ms 一个）
 *     { type: 'reset' }
 */
import { Downsampler, SileroStream } from './core.js'

let stream
let down
let queue = Promise.resolve()

async function init(version) {
  const v = encodeURIComponent(String(version ?? ''))
  const asset = (name) => new URL(`${name}?v=${v}`, self.location.href).href
  const ort = await import(asset('ort.mjs'))
  ort.env.wasm.numThreads = 1
  ort.env.wasm.proxy = false
  ort.env.wasm.wasmPaths = { wasm: asset('ort.wasm') }
  const res = await fetch(asset('model.onnx'), { credentials: 'same-origin' })
  if (!res.ok) throw new Error(`人声模型下载失败（${res.status}）`)
  const session = await ort.InferenceSession.create(new Uint8Array(await res.arrayBuffer()))
  stream = new SileroStream(ort, session)
}

self.onmessage = (event) => {
  const message = event.data
  if (message?.type === 'init') {
    queue = init(message.version).then(
      () => self.postMessage({ type: 'ready' }),
      (error) => self.postMessage({ type: 'error', message: error instanceof Error ? error.message : String(error) }),
    )
    return
  }
  if (message?.type === 'reset') {
    queue = queue.then(() => {
      stream?.reset()
      down?.reset()
    })
    return
  }
  if (message?.type === 'audio') {
    const { samples, rate } = message
    queue = queue.then(async () => {
      if (stream === undefined) return
      if (down === undefined || down.ratio !== rate / 16000) down = new Downsampler(rate)
      for (const p of await stream.push(down.push(samples))) self.postMessage({ type: 'prob', p })
    }).catch(() => {})
  }
}
