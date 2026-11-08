/**
 * 主代理出错重试时，DSH 把这一步已经写出的文字清空、重新写。
 * 已经念过的句子不再念；说法变了，从变了的那句话开头接着念。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Speakify } from '../src/client/speakify.ts'

test('重试后原样重写：念过的不再念', () => {
  const s = new Speakify()
  assert.equal(s.push('你好。我们先看文件。'), '你好。我们先看文件。')
  assert.equal(s.push(''), '') // 重试：这一步的文字被清空
  assert.equal(s.push('你好。我们先看文件。'), '')
  assert.equal(s.push('你好。我们先看文件。然后改代码。', true), '然后改代码。')
})

test('重试后说法变了：从变了的那句开头接着念', () => {
  const s = new Speakify()
  assert.equal(s.push('你好。我们先看文件。'), '你好。我们先看文件。')
  assert.equal(s.push(''), '')
  assert.equal(s.push('你好。我们先改代码。', true), '我们先改代码。')
})

test('重试后一次写出好几句：只念新的', () => {
  const s = new Speakify()
  assert.equal(s.push('第一句。'), '第一句。')
  assert.equal(s.push('第一句。第二句。'), '第二句。')
  assert.equal(s.push(''), '')
  assert.equal(s.push('第一句。第二句。第三句。'), '第三句。')
})

test('连着重试两次也不重复', () => {
  const s = new Speakify()
  assert.equal(s.push('甲。乙。丙。'), '甲。乙。丙。')
  assert.equal(s.push(''), '')
  assert.equal(s.push('甲。乙。'), '')
  assert.equal(s.push(''), '')
  assert.equal(s.push('甲。乙。丙。丁。'), '丁。')
})

test('重试后不再说一遍「代码见屏幕」', () => {
  const s = new Speakify()
  const text = '看这里：\n```js\nlet a = 1\n```\n'
  assert.equal(s.push(text), '看这里：代码见屏幕。')
  assert.equal(s.push(''), '')
  assert.equal(s.push(`${text}说完了。`, true), '说完了。')
})

test('调用工具前先交出半行，之后接着写不算重写', () => {
  const s = new Speakify()
  assert.equal(s.push('我先看一下文件', true), '我先看一下文件。')
  assert.equal(s.push('我先看一下文件\n看完了，没问题。', true), '看完了，没问题。')
})
