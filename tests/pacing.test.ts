/**
 * 跟读节奏：整段念什么时候交出文字，一轮字数上限怎么按句截。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { splitSentences, stepReady, TurnBudget } from '../src/client/pacing.ts'

test('切句：中英文句末标点，连着的标点和收尾引号算在同一句', () => {
  assert.deepEqual(splitSentences('好的。我先看看文件！真的吗？！'), ['好的。', '我先看看文件！', '真的吗？！'])
  assert.deepEqual(splitSentences('他说：“好的。”然后走了。'), ['他说：“好的。”', '然后走了。'])
  assert.deepEqual(splitSentences('Done. Next step'), ['Done.', ' Next step'])
  assert.deepEqual(splitSentences('版本 1.5 已发布。'), ['版本 1.5 已发布。'])
  assert.deepEqual(splitSentences('等一下……好了'), ['等一下……', '好了'])
  assert.deepEqual(splitSentences(''), [])
})

test('边写边念：任何时候都能交出去', () => {
  assert.equal(stepReady(false, { done: false, flush: false }), true)
})

test('整段念：还在写不交；写完或开始调工具才交', () => {
  assert.equal(stepReady(true, { done: false, flush: false }), false)
  assert.equal(stepReady(true, { done: false, flush: true }), true)
  assert.equal(stepReady(true, { done: true, flush: false }), true)
})

test('不限字数：原样交出', () => {
  const budget = new TurnBudget()
  assert.deepEqual(budget.take('第一句。第二句。', 0), { text: '第一句。第二句。', over: false })
  assert.deepEqual(budget.take('', 0), { text: '', over: false })
})

test('整段一次交出很多字：念到上限的那句为止，后面截掉', () => {
  const budget = new TurnBudget()
  // 每句 5 个字，上限 8：第一句后 5 < 8，第二句念完到 10，第三句不念
  assert.deepEqual(budget.take('一二三四。五六七八。九十一二。', 8), { text: '一二三四。五六七八。', over: true })
  // 已经到上限：后面的都不念
  assert.deepEqual(budget.take('还有。', 8), { text: '', over: true })
})

test('边写边念一句一句交：和整段交截在同一个地方', () => {
  const budget = new TurnBudget()
  assert.deepEqual(budget.take('一二三四。', 8), { text: '一二三四。', over: false })
  assert.deepEqual(budget.take('五六七八。', 8), { text: '五六七八。', over: false })
  assert.deepEqual(budget.take('九十一二。', 8), { text: '', over: true })
})

test('新一轮重新计数', () => {
  const budget = new TurnBudget()
  budget.take('一二三四五六七八九十。', 5)
  budget.reset()
  assert.deepEqual(budget.take('再来。', 5), { text: '再来。', over: false })
})
