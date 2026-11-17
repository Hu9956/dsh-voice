/**
 * 通话识别（可选）：用云端识别把一句话转成文字，替代官方本机的 SenseVoice。
 * - 阿里百炼（dashscope）：走 OpenAI 兼容接口 qwen3-asr-flash，音频以 data URL 放进 input_audio。
 * - DeepSeek（deepseek）：走 POST /v1/tools/asr，multipart/form-data 上传 WAV。
 * Key 只在 Host 用，不会下发给浏览器。
 */

export const ASR_MODEL = 'qwen3-asr-flash'
export const ASR_TIMEOUT_MS = 10_000

export class AsrError extends Error {}

/**
 * @param {{ provider?: 'dashscope' | 'deepseek', key: string, host: string, wavBase64: string, fetchImpl?: typeof fetch, timeoutMs?: number }} options
 * @returns {Promise<string>} 识别出的文字（可能为空）
 */
export async function cloudTranscribe({ provider = 'dashscope', key, host, wavBase64, fetchImpl = fetch, timeoutMs = ASR_TIMEOUT_MS }) {
  if (provider === 'deepseek') {
    return transcribeDeepSeek({ key, host, wavBase64, fetchImpl, timeoutMs })
  }
  return transcribeDashScope({ key, host, wavBase64, fetchImpl, timeoutMs })
}

async function transcribeDashScope({ key, host, wavBase64, fetchImpl, timeoutMs }) {
  let res
  try {
    res = await fetchImpl(`https://${host}/compatible-mode/v1/chat/completions`, {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model: ASR_MODEL,
        messages: [{ role: 'user', content: [{ type: 'input_audio', input_audio: { data: `data:audio/wav;base64,${wavBase64}` } }] }],
        stream: false,
        asr_options: { enable_itn: true },
      }),
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (error) {
    const name = error instanceof Error ? error.name : ''
    throw new AsrError(name === 'TimeoutError' || name === 'AbortError' ? '百炼识别超时' : `连不上百炼：${error instanceof Error ? error.message : String(error)}`)
  }
  let data
  try {
    data = await res.json()
  } catch {
    data = undefined
  }
  if (!res.ok) {
    const message = data?.error?.message ?? data?.message ?? `HTTP ${res.status}`
    throw new AsrError(`百炼识别失败：${String(message).slice(0, 200)}`)
  }
  const content = data?.choices?.[0]?.message?.content
  if (typeof content === 'string') return content.trim()
  if (Array.isArray(content)) return content.map((part) => (typeof part?.text === 'string' ? part.text : '')).join('').trim()
  throw new AsrError('百炼识别返回的格式不对')
}

async function transcribeDeepSeek({ key, host, wavBase64, fetchImpl, timeoutMs }) {
  const wav = Buffer.from(wavBase64, 'base64')
  const form = new FormData()
  form.append('file', new Blob([wav], { type: 'audio/wav' }), 'speech.wav')
  let res
  try {
    res = await fetchImpl(`https://${host}/v1/tools/asr`, {
      method: 'POST',
      headers: { authorization: `Bearer ${key}` },
      body: form,
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (error) {
    const name = error instanceof Error ? error.name : ''
    throw new AsrError(name === 'TimeoutError' || name === 'AbortError' ? 'DeepSeek 识别超时' : `连不上 DeepSeek：${error instanceof Error ? error.message : String(error)}`)
  }
  let data
  try {
    data = await res.json()
  } catch {
    data = undefined
  }
  if (!res.ok) {
    if (res.status === 401) throw new AsrError('DeepSeek 识别失败：API Key 无效')
    if (res.status === 402) throw new AsrError('DeepSeek 识别失败：账户余额不足')
    if (res.status === 429) throw new AsrError('DeepSeek 识别失败：并发请求超限，稍后再试')
    const message = data?.error?.message ?? data?.message ?? `HTTP ${res.status}`
    throw new AsrError(`DeepSeek 识别失败：${String(message).slice(0, 200)}`)
  }
  if (typeof data?.text === 'string') return data.text.trim()
  throw new AsrError('DeepSeek 识别返回的格式不对')
}
