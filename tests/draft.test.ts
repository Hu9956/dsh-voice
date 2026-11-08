/**
 * 通话中输入框里有字时，识别出来的话怎么接到草稿末尾。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isComposing, joinDraft } from '../src/client/call/draft.ts'

test('中文直接接上，不加空格', () => {
  assert.equal(joinDraft('帮我看一下', '那个日志'), '帮我看一下那个日志')
  assert.equal(joinDraft('帮我看一下，', '那个日志'), '帮我看一下，那个日志')
})

test('两边都是英文字母或数字：中间加一个空格', () => {
  assert.equal(joinDraft('run the', 'tests'), 'run the tests')
  assert.equal(joinDraft('版本 0.7', '0 以后'), '版本 0.7 0 以后')
})

test('草稿末尾已经有空白：不再加', () => {
  assert.equal(joinDraft('run the ', 'tests'), 'run the tests')
  assert.equal(joinDraft('第一行\n', '第二行'), '第一行\n第二行')
})

test('英文接中文、中文接英文：直接接上', () => {
  assert.equal(joinDraft('看一下', 'README'), '看一下README')
  assert.equal(joinDraft('open', '设置'), 'open设置')
})

test('识别出来的话去掉首尾空白；空的不改草稿；草稿只有空白就换成这句', () => {
  assert.equal(joinDraft('帮我', '  看看  '), '帮我看看')
  assert.equal(joinDraft('帮我', '   '), '帮我')
  assert.equal(joinDraft('  ', '看看'), '看看')
})

test('有字或有附件算在打字；只有空白不算', () => {
  assert.equal(isComposing({ draft: 'a', attachmentIds: [] }), true)
  assert.equal(isComposing({ draft: '', attachmentIds: ['x'] }), true)
  assert.equal(isComposing({ draft: ' \n ', attachmentIds: [] }), false)
  assert.equal(isComposing(undefined), false)
})
