import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Speakify } from '../src/client/speakify.ts'

/** 模拟流式：每次多给几个字，收集全部输出。 */
function stream(text: string, step = 3): string[] {
  const s = new Speakify()
  const out: string[] = []
  for (let at = step; at < text.length + step; at += step) {
    const piece = s.push(text.slice(0, Math.min(at, text.length)), false)
    if (piece !== '') out.push(piece)
  }
  const rest = s.push(text, true)
  if (rest !== '') out.push(rest)
  return out
}

test('句末标点就交出去，不等换行', () => {
  const s = new Speakify()
  assert.equal(s.push('好的，我看了一下。这个方', false), '好的，我看了一下。')
  assert.equal(s.push('好的，我看了一下。这个方案可行', false), '')
  assert.equal(s.push('好的，我看了一下。这个方案可行', true), '这个方案可行。')
})

test('代码块只说一次「代码见屏幕」，内容不念', () => {
  const text = '看这段：\n```ts\nconst a = 1\nconst b = 2\n```\n就这样。\n'
  assert.deepEqual(stream(text).join(''), '看这段：代码见屏幕。就这样。')
})

test('连续表格只说一次', () => {
  const text = '对比如下\n| 方案 | 价格 |\n|---|---|\n| A | 1 元 |\n| B | 2 元 |\n\n选 A。\n'
  assert.equal(stream(text).join(''), '对比如下。表格见屏幕。选 A。')
})

test('链接念文字，裸网址念「链接」，去掉标题列表加粗', () => {
  const text = '## 结论\n- **推荐** [百炼](https://example.com)\n- 文档在 https://help.aliyun.com/x 里\n'
  assert.equal(stream(text).join(''), '结论。推荐 百炼。文档在 链接 里。')
})

test('行内代码：短的照念，路径念文件名', () => {
  const text = '把 `useEffect` 里的请求挪到 `src/client/speaker.ts` 里。\n'
  assert.equal(stream(text).join(''), '把 useEffect 里的请求挪到 speaker.ts 里。')
})

test('行内代码没闭合时不在里面断句', () => {
  const s = new Speakify()
  assert.equal(s.push('运行 `a. b', false), '')
  assert.equal(s.push('运行 `a. b` 就行。', false), '运行 a. b 就行。')
})

test('小数点不会被当成句号', () => {
  const s = new Speakify()
  assert.equal(s.push('版本是 1.5', false), '')
  assert.equal(s.push('版本是 1.5 吗？', false), '版本是 1.5 吗？')
})

test('原文变短（重试）就从头处理', () => {
  const s = new Speakify()
  assert.equal(s.push('第一句。', false), '第一句。')
  assert.equal(s.push('重来。', false), '重来。')
})
