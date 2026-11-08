import { test } from 'node:test'
import assert from 'node:assert/strict'
import { commandOf, isEcho, normalizeCommand, parseProgress, progressText, selectProgress } from '../src/client/call/intent.ts'

test('「停」的各种说法都算停', () => {
  for (const text of ['停', '停！', '停一下', '先停一下吧', '好，先停下来', '嗯，别做了', '取消', '不用做了', '那你先别干了', '打住。']) {
    assert.equal(commandOf(text), 'stop', text)
  }
})

test('问进度的各种说法', () => {
  for (const text of ['进度怎么样？', '现在进展如何', '做到哪了', '你还在干什么', '怎么样了', '好了没', '还要多久啊', '弄完了没', '你在忙啥呢']) {
    assert.equal(commandOf(text), 'progress', text)
  }
})

test('普通的话不当命令（包括带「停」「进度」字样的长句）', () => {
  for (const text of [
    '帮我看看停车场的代码',
    '这个进度条怎么做',
    '停止按钮放在哪里比较好',
    '暂停',
    '好的谢谢',
    '把取消按钮改成红色',
    '现在几点了',
    '你好',
  ]) {
    assert.equal(commandOf(text), undefined, text)
  }
})

test('normalizeCommand：去掉标点和前后的语气词', () => {
  assert.equal(normalizeCommand('好，那你先停一下吧！'), '先停一下')
  assert.equal(normalizeCommand('嗯嗯，取消了啊'), '取消')
})

test('回声：识别出的话就在刚念过的内容里', () => {
  const said = '好，我先看一下日志。日志里有三个报错，都是连接超时。'
  assert.equal(isEcho('日志里有三个报错', said), true)
  assert.equal(isEcho('都是连接超时', said), true)
  // 识别有错字，大部分两字组合还在
  assert.equal(isEcho('日志里有三个报错都是连接朝时', said), true)
})

test('不是回声：用户说的是新的话', () => {
  const said = '好，我先看一下日志。日志里有三个报错，都是连接超时。'
  assert.equal(isEcho('那你帮我把超时改成三十秒', said), false)
  assert.equal(isEcho('换个话题，今天天气怎么样', said), false)
  assert.equal(isEcho('好', said), false, '一个字不判断')
  assert.equal(isEcho('看一下', ''), false, '没念过东西就不是回声')
})

test('进度：在跑时说用时、步数、刚才在干什么、最近一句', () => {
  const text = progressText({ steps: 7, lastTool: 'bash', lastSaid: '我先跑一下测试。' }, 95_000, true)
  assert.equal(text, '还在干活，已经 1 分 35 秒，走了 7 步。刚才在跑命令。它最近说：我先跑一下测试。')
  assert.equal(progressText(undefined, 12_000, true), '还在干活，已经 12 秒。')
  assert.equal(progressText(undefined, 0, false), '它这一轮已经做完了。')
  assert.match(progressText({ steps: 1, lastTool: 'mystery_tool', lastSaid: '' }, 60_000, true), /用 mystery_tool/)
})

test('selectProgress：从聊天快照里取最新一轮的步数、工具、最后一句', () => {
  const nodes = new Map<unknown, unknown>([
    ['a', { kind: 'assistant-step', data: { blocks: [{ kind: 'text', text: '好，我先看一下。' }, { kind: 'tool-call', name: 'read' }] } }],
    ['u', { kind: 'user' }],
    ['b', { kind: 'assistant-step', data: { blocks: [{ kind: 'reasoning', text: '想一想' }, { kind: 'text', text: '找到了。**接下来**改一下配置；' }, { kind: 'tool-call', name: 'edit' }] } }],
  ])
  const snapshot = {
    timeline: { turnOrder: ['t1', 't2'] },
    locations: { getTurn: (turn: unknown) => (turn === 't2' ? ['a', 'u', 'b'] : []) },
    nodes: { get: (key: unknown) => nodes.get(key) },
  }
  const progress = parseProgress(selectProgress(snapshot))
  assert.deepEqual(progress, { steps: 2, lastTool: 'edit', lastSaid: '接下来改一下配置；' })
  assert.equal(selectProgress({}), '')
  assert.equal(selectProgress(null), '')
})

test('进度：「现在的进度如何」「目前进展到哪了」也算', () => {
  assert.equal(commandOf('现在的进度如何。'), 'progress')
  assert.equal(commandOf('目前进展到哪了？'), 'progress')
  assert.equal(commandOf('进度如何'), 'progress')
  assert.equal(commandOf('现在的进度条代码在哪'), undefined)
})
