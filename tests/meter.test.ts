/**
 * 通话胶囊的波浪和头像：每个状态用什么样子、跟哪路声音，音量换算和平滑。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { IDLE_LEVEL, levelOf, mixRgb, PALETTES, parseHex, rms, smooth, sourceOf, targetLevel, toneOf } from '../src/client/call/meter.ts'

test('状态分成几种样子', () => {
  assert.equal(toneOf('listening'), 'listen')
  assert.equal(toneOf('hearing'), 'listen')
  assert.equal(toneOf('transcribing'), 'think')
  assert.equal(toneOf('thinking'), 'think')
  assert.equal(toneOf('working'), 'think')
  assert.equal(toneOf('speaking'), 'speak')
  assert.equal(toneOf('needs-you'), 'alert')
  for (const phase of ['connecting', 'muted', 'paused', 'ended'] as const) assert.equal(toneOf(phase), 'off', phase)
})

test('你说话跟麦克风，它念的时候跟朗读，在想时自己流动，静音是平线', () => {
  assert.equal(sourceOf('listen'), 'mic')
  assert.equal(sourceOf('speak'), 'out')
  assert.equal(sourceOf('think'), 'idle')
  assert.equal(sourceOf('alert'), 'idle')
  assert.equal(sourceOf('off'), 'none')
})

test('它念的时候不看麦克风：回声不会把波浪带起来', () => {
  const loudMic = { mic: 0.3, out: 0 }
  assert.equal(targetLevel('speak', loudMic), IDLE_LEVEL.speak)
  assert.ok(targetLevel('listen', loudMic) > 0.8)
  assert.ok(targetLevel('speak', { mic: 0, out: 0.3 }) > 0.8)
  assert.equal(targetLevel('off', { mic: 0.3, out: 0.3 }), 0, '静音、暂停：平线')
  assert.equal(targetLevel('think', { mic: 0.3, out: 0.3 }), IDLE_LEVEL.think)
})

test('音量换算：-55 dB 以下是 0，-15 dB 以上是 1', () => {
  assert.equal(levelOf(0), 0)
  assert.equal(levelOf(Number.NaN), 0)
  assert.equal(levelOf(10 ** (-60 / 20)), 0)
  assert.equal(levelOf(10 ** (-10 / 20)), 1)
  assert.ok(Math.abs(levelOf(10 ** (-35 / 20)) - 0.5) < 1e-9)
})

test('均方根', () => {
  assert.equal(rms(new Float32Array(0)), 0)
  assert.ok(Math.abs(rms(new Float32Array([0.5, -0.5, 0.5, -0.5])) - 0.5) < 1e-7)
})

test('起得快、落得慢', () => {
  const up = smooth(0, 1, 16)
  const down = 1 - smooth(1, 0, 16)
  assert.ok(up > down * 2, `起 ${up}，落 ${down}`)
  assert.equal(smooth(0.3, 1, 0), 0.3)
  assert.ok(Math.abs(smooth(0, 1, 10_000) - 1) < 1e-6)
})

test('调色板都是能解析的颜色；混色按比例', () => {
  for (const [tone, colors] of Object.entries(PALETTES)) {
    for (const hex of colors) assert.ok(parseHex(hex) !== undefined, `${tone} ${hex}`)
  }
  assert.deepEqual(parseHex('#ff8000'), [255, 128, 0])
  assert.equal(parseHex('red'), undefined)
  assert.deepEqual(mixRgb([0, 0, 0], [200, 100, 50], 0.5), [100, 50, 25])
  assert.deepEqual(mixRgb([0, 0, 0], [200, 100, 50], 2), [200, 100, 50])
})

test('浅色主题：在听 / 在想 / 在说用加深的粉彩，需要你和静音两边一样；各状态颜色分得开', async () => {
  const { paletteOf, LIGHT_PALETTES } = await import('../src/client/call/meter.ts')
  for (const tone of ['listen', 'think', 'speak'] as const) assert.notDeepEqual(paletteOf(tone, false), paletteOf(tone, true), tone)
  assert.deepEqual(paletteOf('alert', false), paletteOf('alert', true))
  assert.deepEqual(paletteOf('off', false), paletteOf('off', true))
  assert.deepEqual(PALETTES.think, ['#d9c8f0', '#f3c6d8', '#cfe3f5'], '在想是淡紫配粉')
  assert.notDeepEqual(paletteOf('listen', true), paletteOf('speak', true), '在听和在说要分得开')
  assert.notDeepEqual(paletteOf('listen', true), paletteOf('think', true), '在听和在想要分得开')
  for (const colors of Object.values(LIGHT_PALETTES)) for (const hex of colors) assert.ok(parseHex(hex) !== undefined, hex)
})
