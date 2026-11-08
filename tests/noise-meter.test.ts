/**
 * 设置页「测一下环境噪声」：底噪估计和档位建议。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { LevelHistory, adviceFor } from '../src/client/call/noise-meter.ts'

test('底噪取低分位：中间夹着说话也不被拉高', () => {
  const h = new LevelHistory(3000, 0.2)
  for (let i = 0; i < 40; i++) h.push(-40, 50)
  for (let i = 0; i < 20; i++) h.push(-15, 50)
  assert.equal(h.floorDb(), -40)
})

test('只记最近 windowMs：旧的安静被挤掉，底噪跟上新环境', () => {
  const h = new LevelHistory(1000, 0.2)
  for (let i = 0; i < 20; i++) h.push(-60, 50)
  for (let i = 0; i < 20; i++) h.push(-35, 50)
  assert.equal(h.floorDb(), -35)
  assert.equal(h.coveredMs, 1000)
})

test('没数据时 null；坏值不记', () => {
  const h = new LevelHistory()
  assert.equal(h.floorDb(), null)
  h.push(Number.NaN, 50)
  h.push(-40, 0)
  assert.equal(h.floorDb(), null)
  h.push(-40, 50)
  h.clear()
  assert.equal(h.floorDb(), null)
})

test('建议：安静用中，风扇大用低或很低，太吵提示按钮', () => {
  assert.equal(adviceFor(-60, 'medium'), '现在的「中」档合适。')
  assert.equal(adviceFor(-60, 'low'), '建议用「中」档。')
  assert.match(adviceFor(-60, 'high'), /说话轻/)
  assert.equal(adviceFor(-36, 'low'), '现在的「低」档合适。', '-36 时低档门限 -24，说话中比底噪高 8 dB，刚好够')
  assert.equal(adviceFor(-33, 'low'), '建议用「很低」档。', '-33 时低档只剩 5 dB')
  assert.match(adviceFor(-20, 'lowest'), /说完了/)
})
