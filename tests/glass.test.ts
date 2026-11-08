/**
 * 通话胶囊照抄输入框卡片的玻璃：计算样式 → CSS 变量。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { glassVars, NO_SHADOW, splitShadows, type CardLook, type UnderLook } from '../src/client/call/glass.ts'

const card = (patch: Partial<CardLook> = {}): CardLook => ({
  backgroundColor: 'rgba(0, 0, 0, 0)',
  backgroundImage: 'none',
  boxShadow: 'none',
  borderWidth: '0px',
  borderStyle: 'none',
  borderColor: 'rgb(0, 0, 0)',
  ...patch,
})

const noUnder: UnderLook = { content: 'none', backgroundColor: 'rgba(0, 0, 0, 0)', backgroundImage: 'none', backdropFilter: 'none' }

test('splitShadows：rgba 里的逗号不拆，none 和空的去掉', () => {
  assert.deepEqual(
    splitShadows('rgba(255, 255, 255, 0.22) 0px 0.5px 0px 0px inset, rgba(0, 0, 0, 0.4) 0px 0px 0px 0.5px'),
    ['rgba(255, 255, 255, 0.22) 0px 0.5px 0px 0px inset', 'rgba(0, 0, 0, 0.4) 0px 0px 0px 0.5px'],
  )
  assert.deepEqual(splitShadows('none'), [])
  assert.deepEqual(splitShadows(''), [])
})

test('单层（手机款）：磨砂在卡片 ::before 上，卡片透明；内细边、外投影分开', () => {
  const vars = glassVars(
    card({
      borderWidth: '1px',
      borderStyle: 'solid',
      borderColor: 'rgba(0, 0, 0, 0)',
      boxShadow: 'rgba(255, 255, 255, 0.22) 0px 0.5px 0px 0px inset, rgba(255, 255, 255, 0.12) 0px 0px 0px 0.5px inset, rgba(0, 0, 0, 0.4) 0px 0px 0px 0.5px',
    }),
    { content: '""', backgroundColor: 'rgba(38, 38, 41, 0.6)', backgroundImage: 'none', backdropFilter: 'blur(18px) saturate(1.6)' },
  )
  assert.equal(vars['--vr-glass-blur'], 'blur(18px) saturate(1.6)')
  assert.equal(vars['--vr-glass-under'], 'rgba(38, 38, 41, 0.6)')
  assert.equal(vars['--vr-glass-face'], 'rgba(0, 0, 0, 0)')
  assert.equal(vars['--vr-glass-inset'], 'rgba(255, 255, 255, 0.22) 0px 0.5px 0px 0px inset, rgba(255, 255, 255, 0.12) 0px 0px 0px 0.5px inset', '透明描边不画')
  assert.equal(vars['--vr-glass-outer'], 'rgba(0, 0, 0, 0.4) 0px 0px 0px 0.5px')
})

test('双层：卡片是半透明渐变 + 描边，::before 没画（磨砂在外框上）', () => {
  const gradient = 'linear-gradient(rgba(30, 31, 36, 0.55), rgba(30, 31, 36, 0.95))'
  const vars = glassVars(
    card({
      backgroundImage: gradient,
      borderWidth: '1px',
      borderStyle: 'solid',
      borderColor: 'rgba(255, 255, 255, 0.06)',
      boxShadow: 'rgba(0, 0, 0, 0.15) 0px 1px 2px 0px, rgba(0, 0, 0, 0.16) 0px 2px 8px 0px',
    }),
    noUnder,
  )
  assert.equal(vars['--vr-glass-face-image'], gradient)
  assert.equal(vars['--vr-glass-inset'], 'inset 0 0 0 1px rgba(255, 255, 255, 0.06)', '描边换成一圈内阴影')
  assert.equal(vars['--vr-glass-outer'], 'rgba(0, 0, 0, 0.15) 0px 1px 2px 0px, rgba(0, 0, 0, 0.16) 0px 2px 8px 0px')
  assert.equal(vars['--vr-glass-blur'], 'none')
  assert.equal(vars['--vr-glass-under'], 'transparent')
})

test('原版：实色底、没有阴影时用占位阴影（放进逗号列表不能是 none）', () => {
  const vars = glassVars(card({ backgroundColor: 'rgb(37, 38, 43)' }), noUnder)
  assert.equal(vars['--vr-glass-face'], 'rgb(37, 38, 43)')
  assert.equal(vars['--vr-glass-inset'], NO_SHADOW)
  assert.equal(vars['--vr-glass-outer'], NO_SHADOW)
  assert.equal(vars['--vr-glass-blur'], 'none')
})

test('::before 的 content 是 normal（没生成）也当没画', () => {
  const vars = glassVars(card(), { content: 'normal', backgroundColor: 'rgb(255, 0, 0)', backgroundImage: 'none', backdropFilter: 'blur(4px)' })
  assert.equal(vars['--vr-glass-blur'], 'none')
  assert.equal(vars['--vr-glass-under'], 'transparent')
})

test('圆角：取卡片左上角的圆角和圆角形状；读不到或不是 px 就不写（胶囊用两头半圆）', () => {
  const vars = glassVars(card({ borderRadius: '26px', cornerShape: 'round' }), noUnder)
  assert.equal(vars['--vr-glass-radius'], '26px')
  assert.equal(vars['--vr-glass-corner'], 'round')
  const elliptic = glassVars(card({ borderRadius: '17px 17px', cornerShape: 'superellipse(1.5)' }), noUnder)
  assert.equal(elliptic['--vr-glass-radius'], '17px')
  assert.equal(elliptic['--vr-glass-corner'], 'superellipse(1.5)')
  const none = glassVars(card({ borderRadius: '0px', cornerShape: '' }), noUnder)
  assert.equal(none['--vr-glass-radius'], undefined)
  assert.equal(none['--vr-glass-corner'], undefined)
  assert.equal(glassVars(card({ borderRadius: '50%' }), noUnder)['--vr-glass-radius'], undefined)
})
