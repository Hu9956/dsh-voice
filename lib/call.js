/**
 * 语音通话的后台部分：
 * - 登记哪些会话正在通话（浏览器接通、挂断时告诉我们，通话中每隔一会儿报一次「还在」）。
 * - 通过 agent/pre-step，在通话会话进入下一步时给模型加一段通话提示；挂断后加一句「通话结束」。
 *
 * 提示以普通的带来源 user/message 进入会话记录（和官方 agent-instructions 一样），
 * 聊天里折叠成一行「上下文注入」。要不要加，看会话记录里最后一条通话提示是开始还是结束，
 * 跟现在是否在通话比：不一样才加。这样 Host 重启、某一步被取消都不会重复或漏掉。
 * 只看登记过的会话 id，子代理会话 id 不同，不会被加上开始提示。
 */
import { randomUUID } from 'node:crypto'

export const CALL_KIND = 'voice-call'
/** 浏览器这么久没报「还在」，就当通话已经断了（手机没电、断网、直接关页面）。 */
export const CALL_TTL_MS = 90_000

export const START_PROMPT = `<system-reminder>
用户和你开始了语音通话。用户的话由语音识别转成文字，可能有同音错字，意思不清楚就直接问。你写的正文会被逐句读出来。

通话期间：
- 口语化，用短句，先说结论。不要用列表、表格、标题来组织要说的话。代码、表格、长内容照常写在屏幕上，口头只说结论和下一步。
- 要调用工具干活之前，先用一句话告诉用户你要做什么（比如「好，我先看一下日志」），然后马上调用。每次换个说法；结果出来之前不要暗示结果。
- 删除文件、发消息、提交、部署这类不好撤销的操作，先口头说明要做什么，等用户同意再做。
- 需要用户做选择时，直接用一句话问，不要弹提问表单；用户在通话里看不到表单。
- 回复尽量短，用户想听细节会追问。

这些要求一直有效，直到出现「语音通话已结束」的提示。
</system-reminder>`

export const END_PROMPT = `<system-reminder>
语音通话已结束。恢复正常的书面回复方式，之前通话期间的口语化要求不再适用。
</system-reminder>`

const SUMMARY = { start: '语音通话开始', end: '语音通话结束' }

/** 一条通话提示消息（结构和官方 createUserMessage 一样：带 id、冻结）。 */
export function callMessage(phase) {
  const message = {
    role: 'user',
    content: [{ type: 'text', text: phase === 'start' ? START_PROMPT : END_PROMPT }],
    source: { kind: CALL_KIND, form: 'notice', phase, summary: SUMMARY[phase] },
    id: randomUUID(),
  }
  return deepFreeze(message)
}

function deepFreeze(value) {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const key of Object.keys(value)) deepFreeze(value[key])
    Object.freeze(value)
  }
  return value
}

function phaseOf(message) {
  const source = message?.source
  if (source?.kind !== CALL_KIND) return undefined
  return source.phase === 'start' || source.phase === 'end' ? source.phase : undefined
}

/** 会话记录里最后一条通话提示是开始还是结束；从来没有过就是 undefined。 */
export function lastCallPhase(session) {
  const nodes = session?.surface?.nodes
  if (!Array.isArray(nodes) || typeof session.eventAt !== 'function') return undefined
  for (let i = nodes.length - 1; i >= 0; i--) {
    const event = session.eventAt(nodes[i])
    if (event?.type !== 'user/message') continue
    const phase = phaseOf(event.data)
    if (phase !== undefined) return phase
  }
  return undefined
}

/** 没开开发自测时的默认值。 */
export const DEV_OFF = Object.freeze({ debug: false, force: Object.freeze([]) })

/** 哪些会话正在通话。 */
export class CallRegistry {
  /**
   * @param {() => number} now
   * @param {() => { debug: boolean, force: readonly string[] }} dev 开发自测开关（call-test.json）：
   *   debug 时每次 pre-step 的判断都交给 onDebug；force 里的会话不经浏览器也当作在通话。
   * @param {(entry: object) => void} [onDebug]
   */
  constructor(now = () => Date.now(), dev = () => DEV_OFF, onDebug = undefined) {
    this.now = now
    this.dev = dev
    this.onDebug = onDebug
    /** @type {Map<string, number>} sessionId → 最后一次报「还在」的时间 */
    this.calls = new Map()
    /** 调试用：最近几次 pre-step 的判断。 */
    this.log = []
  }

  set(sessionId, active) {
    if (active) this.calls.set(sessionId, this.now())
    else this.calls.delete(sessionId)
  }

  isActive(sessionId) {
    if (this.dev().force.includes(sessionId)) return true
    const seen = this.calls.get(sessionId)
    if (seen === undefined) return false
    if (this.now() - seen > CALL_TTL_MS) {
      this.calls.delete(sessionId)
      return false
    }
    return true
  }

  note(entry) {
    const record = { time: this.now(), ...entry }
    this.log.push(record)
    if (this.log.length > 20) this.log.shift()
    if (this.dev().debug) {
      try { this.onDebug?.(record) } catch { /* 调试输出失败不影响对话 */ }
    }
  }

  /** 只在开发自测时记：每一次 pre-step 看到了什么。 */
  trace(entry) {
    if (!this.dev().debug) return
    try { this.onDebug?.({ time: this.now(), ...entry }) } catch { /* 同上 */ }
  }
}

/**
 * agent/pre-step 监听器。先让后面的监听器做完决定，再看要不要把通话提示接在这一步的消息后面。
 * 自己出任何错都原样放行，不能因为语音插件把正常对话卡住。
 * @param {CallRegistry} registry
 */
export function createPreStep(registry) {
  return async (payload, next) => {
    const decision = await next()
    try {
      const { agent, messages, step, signal } = payload
      if (decision?.kind !== 'enter' || signal?.aborted) return decision
      // 和官方模型切换提示同一个条件：这一步不会发模型请求时不加
      if (decision.messages.length === 0 && (step === 1 || messages.length > 0)) return decision
      const session = agent?.session
      const sessionId = session?.id
      if (typeof sessionId !== 'string') return decision
      const active = registry.isActive(sessionId)
      if (decision.messages.some((message) => phaseOf(message) !== undefined)) return decision
      const last = lastCallPhase(session)
      registry.trace({ sessionId, step, active, last: last ?? null, entering: decision.messages.length })
      const wanted = active ? 'start' : last === 'start' ? 'end' : undefined
      if (wanted === undefined || wanted === last) return decision
      registry.note({ sessionId, step, inject: wanted })
      return { ...decision, messages: [...decision.messages, callMessage(wanted)] }
    } catch (error) {
      registry.note({ error: error instanceof Error ? error.message : String(error) })
      return decision
    }
  }
}
