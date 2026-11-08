/**
 * 通话识别（可选）：用百炼 qwen3-asr-flash 把一句话转成文字，替代官方本机的 SenseVoice。
 * 走 OpenAI 兼容接口，音频以 data URL 放进 input_audio。Key 只在 Host 用。
 */

export const ASR_MODEL = 'qwen3-asr-flash'
export const ASR_TIMEOUT_MS = 10_000

export class AsrError extends Error {}

/**
 * @param {{ key: string, host: string, wavBase64: string, fetchImpl?: typeof fetch, timeoutMs?: number }} options
 * @returns {Promise<string>} 识别出的文字（可能为空）
 */
export async function cloudTranscribe({ key, host, wavBase64, fetchImpl = fetch, timeoutMs = ASR_TIMEOUT_MS }) {
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
