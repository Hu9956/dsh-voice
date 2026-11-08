import assert from 'node:assert/strict'
import { test } from 'node:test'
import { CALL_KIND, CALL_TTL_MS, CallRegistry, callMessage, createPreStep, lastCallPhase } from '../src/call.js'

/** 假会话：events 是 user/message 的 data，nodes 是它们的下标。 */
function fakeSession(id, datas = []) {
  const log = datas.map((data) => ({ type: 'user/message', data }))
  return {
    id,
    surface: { nodes: log.map((_, i) => i) },
    eventAt: (seq) => log[seq],
    push(message) {
      log.push({ type: 'user/message', data: message })
      this.surface.nodes.push(log.length - 1)
    },
  }
}

const userMessage = (text) => ({ role: 'user', content: [{ type: 'text', text }], source: { kind: 'user' }, id: text })
const enter = (messages) => async () => ({ kind: 'enter', messages })

async function step(preStep, session, { step = 1, messages = [userMessage('hi')], decisionMessages } = {}) {
  const signal = new AbortController().signal
  return preStep({ agent: { session }, messages, step, signal }, enter(decisionMessages ?? messages))
}

test('通话中第一次进入步骤：在消息后面加开始提示', async () => {
  const calls = new CallRegistry()
  const preStep = createPreStep(calls)
  const session = fakeSession('session-aaaaaaaa')
  calls.set(session.id, true)
  const decision = await step(preStep, session)
  assert.equal(decision.messages.length, 2)
  assert.equal(decision.messages[0].id, 'hi')
  const added = decision.messages[1]
  assert.equal(added.role, 'user')
  assert.equal(added.source.kind, CALL_KIND)
  assert.equal(added.source.phase, 'start')
  assert.equal(added.source.form, 'notice')
  assert.match(added.content[0].text, /语音通话/)
  assert.ok(Object.isFrozen(added) && Object.isFrozen(added.content[0]))
})

test('已经加过开始提示：通话中不再重复加', async () => {
  const calls = new CallRegistry()
  const preStep = createPreStep(calls)
  const session = fakeSession('session-aaaaaaaa', [userMessage('a'), callMessage('start')])
  calls.set(session.id, true)
  const decision = await step(preStep, session)
  assert.equal(decision.messages.length, 1)
})

test('挂断后：加一次结束提示，之后不再加', async () => {
  const calls = new CallRegistry()
  const preStep = createPreStep(calls)
  const session = fakeSession('session-aaaaaaaa', [callMessage('start')])
  const first = await step(preStep, session)
  assert.equal(first.messages.at(-1).source.phase, 'end')
  session.push(first.messages.at(-1))
  const second = await step(preStep, session)
  assert.equal(second.messages.length, 1)
})

test('从没通过话的会话：什么都不加', async () => {
  const preStep = createPreStep(new CallRegistry())
  const decision = await step(preStep, fakeSession('session-bbbbbbbb', [userMessage('a')]))
  assert.equal(decision.messages.length, 1)
})

test('工具结果之后的步骤（没有新消息）也能在通话开始时加上', async () => {
  const calls = new CallRegistry()
  const preStep = createPreStep(calls)
  const session = fakeSession('session-aaaaaaaa')
  calls.set(session.id, true)
  const decision = await step(preStep, session, { step: 3, messages: [], decisionMessages: [] })
  assert.equal(decision.messages.length, 1)
  assert.equal(decision.messages[0].source.phase, 'start')
})

test('第一步什么消息都没有（不会发请求）：不加', async () => {
  const calls = new CallRegistry()
  const preStep = createPreStep(calls)
  const session = fakeSession('session-aaaaaaaa')
  calls.set(session.id, true)
  const decision = await step(preStep, session, { step: 1, messages: [], decisionMessages: [] })
  assert.equal(decision.messages.length, 0)
})

test('拒绝、取消、出错时原样放行', async () => {
  const calls = new CallRegistry()
  calls.set('session-aaaaaaaa', true)
  const preStep = createPreStep(calls)
  const reject = await preStep({ agent: { session: fakeSession('session-aaaaaaaa') }, messages: [], step: 1, signal: new AbortController().signal }, async () => ({ kind: 'reject' }))
  assert.deepEqual(reject, { kind: 'reject' })
  const aborted = new AbortController()
  aborted.abort()
  const decision = await preStep({ agent: { session: fakeSession('session-aaaaaaaa') }, messages: [userMessage('x')], step: 1, signal: aborted.signal }, enter([userMessage('x')]))
  assert.equal(decision.messages.length, 1)
  const broken = { id: 'session-aaaaaaaa', get surface() { throw new Error('boom') }, eventAt: () => undefined }
  const safe = await preStep({ agent: { session: broken }, messages: [userMessage('y')], step: 1, signal: new AbortController().signal }, enter([userMessage('y')]))
  assert.equal(safe.messages.length, 1)
  assert.match(calls.log.at(-1).error, /boom/)
})

test('子代理会话 id 不同：不会被加开始提示', async () => {
  const calls = new CallRegistry()
  calls.set('session-main0000', true)
  const preStep = createPreStep(calls)
  const decision = await step(preStep, fakeSession('subagent-11111111'))
  assert.equal(decision.messages.length, 1)
})

test('浏览器太久没报「还在」：当作挂断', () => {
  let now = 1000
  const calls = new CallRegistry(() => now)
  calls.set('session-aaaaaaaa', true)
  now += CALL_TTL_MS - 1
  assert.equal(calls.isActive('session-aaaaaaaa'), true)
  now += 2
  assert.equal(calls.isActive('session-aaaaaaaa'), false)
})

test('开发开关 force 里的会话当作在通话，debug 时记录判断', async () => {
  const records = []
  const calls = new CallRegistry(() => 1, () => ({ debug: true, force: ['session-forced00'] }), (r) => records.push(r))
  const preStep = createPreStep(calls)
  const decision = await step(preStep, fakeSession('session-forced00'))
  assert.equal(decision.messages.at(-1).source.phase, 'start')
  assert.ok(records.some((r) => r.inject === 'start'))
  assert.ok(records.some((r) => r.active === true && r.last === null))
})

test('lastCallPhase 只认通话提示', () => {
  assert.equal(lastCallPhase(fakeSession('s-aaaaaaaa', [userMessage('a')])), undefined)
  assert.equal(lastCallPhase(fakeSession('s-aaaaaaaa', [callMessage('start'), userMessage('a')])), 'start')
  assert.equal(lastCallPhase(fakeSession('s-aaaaaaaa', [callMessage('start'), callMessage('end')])), 'end')
  assert.equal(lastCallPhase(undefined), undefined)
})
