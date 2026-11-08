/**
 * smart-turn 推理的工作线程：算特征、跑模型，不占 DSH 主线程（一次约 0.3 秒）。
 * 运行库和模型都在插件自带的 vendor/ 里（来源和许可证见 vendor/NOTICE.md），不联网。
 *
 * 收：{ id, samples: Float32Array（16 kHz） }
 * 回：{ id, p }（说完的概率 0–1）或 { id, error }
 */
import { readFileSync } from 'node:fs'
import { parentPort } from 'node:worker_threads'
import { logMelFeatures, N_FRAMES, N_MELS } from './turn-features.js'

const VENDOR = new URL('../vendor/', import.meta.url)
const MODEL = new URL('smart-turn/smart-turn-v3.2-cpu.onnx', VENDOR)

const ort = await import(new URL('ort/ort.node.min.mjs', VENDOR).href)
ort.env.wasm.numThreads = 1
const session = await ort.InferenceSession.create(readFileSync(MODEL))
const input = session.inputNames[0]
const output = session.outputNames[0]

parentPort.postMessage({ ready: true })

parentPort.on('message', async (message) => {
  const { id, samples } = message
  try {
    const features = logMelFeatures(samples)
    const tensor = new ort.Tensor('float32', features, [1, N_MELS, N_FRAMES])
    const result = await session.run({ [input]: tensor })
    const p = Number(result[output].data[0])
    parentPort.postMessage({ id, p: Number.isFinite(p) ? p : 0 })
  } catch (error) {
    parentPort.postMessage({ id, error: error instanceof Error ? error.message : String(error) })
  }
})
