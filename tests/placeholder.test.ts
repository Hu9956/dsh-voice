/**
 * 输入框空草稿占位符：内联麦克风 SVG 锚点、桌面/手机端文案、非默认状态保留与卸载恢复测试。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  createPlaceholderController,
  DESKTOP_VOICE_LABEL,
  PHONE_VOICE_LABEL,
  plainHintFor,
} from '../src/hold/placeholder.ts'

class FakeNode {
  nodeType = 1
  nodeValue: string | null = null
  parentNode: FakeElement | null = null
  ownerDocument!: FakeDocument
  isConnected = true

  remove(): void {
    if (this.parentNode !== null) {
      const idx = this.parentNode.childNodes.indexOf(this)
      if (idx >= 0) this.parentNode.childNodes.splice(idx, 1)
      this.parentNode = null
    }
  }
}

class FakeText extends FakeNode {
  override nodeType = 3
  constructor(text: string, doc: FakeDocument) {
    super()
    this.nodeValue = text
    this.ownerDocument = doc
  }
}

class FakeElement extends FakeNode {
  tagName: string
  namespaceURI: string | null
  className = ''
  attrs = new Map<string, string>()
  childNodes: FakeNode[] = []

  constructor(tagName: string, doc: FakeDocument, ns: string | null = null) {
    super()
    this.tagName = tagName
    this.ownerDocument = doc
    this.namespaceURI = ns
  }

  get firstChild(): FakeNode | null {
    return this.childNodes[0] ?? null
  }

  get textContent(): string {
    return this.childNodes
      .map(child => (child instanceof FakeText ? (child.nodeValue ?? '') : (child as FakeElement).textContent))
      .join('')
  }

  set textContent(value: string) {
    for (const child of this.childNodes) child.parentNode = null
    this.childNodes = value === '' ? [] : [new FakeText(value, this.ownerDocument)]
    for (const child of this.childNodes) child.parentNode = this
  }

  setAttribute(name: string, value: string): void {
    this.attrs.set(name, value)
    if (name === 'class') this.className = value
  }

  getAttribute(name: string): string | null {
    if (name === 'class' && !this.attrs.has('class') && this.className !== '') return this.className
    return this.attrs.get(name) ?? null
  }

  hasAttribute(name: string): boolean {
    return this.attrs.has(name)
  }

  appendChild<T extends FakeNode>(node: T): T {
    node.remove()
    node.parentNode = this
    this.childNodes.push(node)
    return node
  }

  append(...items: Array<FakeNode | string>): void {
    for (const item of items) {
      this.appendChild(typeof item === 'string' ? new FakeText(item, this.ownerDocument) : item)
    }
  }

  replaceChildren(...items: Array<FakeNode | string>): void {
    for (const child of this.childNodes) child.parentNode = null
    this.childNodes = []
    this.append(...items)
  }

  querySelector(selector: string): FakeElement | null {
    const matchAttr = selector.match(/^\[([a-z0-9-]+)\]$/)
    const matchTag = selector.match(/^[a-z0-9-]+$/i)
    const walk = (el: FakeElement): FakeElement | null => {
      for (const child of el.childNodes) {
        if (child instanceof FakeElement) {
          if (matchAttr && child.hasAttribute(matchAttr[1]!)) return child
          if (matchTag && child.tagName === matchTag[0]) return child
          const hit = walk(child)
          if (hit !== null) return hit
        }
      }
      return null
    }
    return walk(this)
  }
}

class FakeDocument {
  createElement(tag: string): FakeElement {
    return new FakeElement(tag, this)
  }
  createElementNS(ns: string, tag: string): FakeElement {
    return new FakeElement(tag, this, ns)
  }
}

function makeFixture(initialText = '发消息或创建任务, / 调用指令, @ 文件或对话') {
  const doc = new FakeDocument()
  const card = doc.createElement('div')
  card.setAttribute('data-composer-card', '')
  const editor = doc.createElement('div')
  editor.setAttribute('contenteditable', 'true')
  editor.setAttribute('data-placeholder', initialText)
  editor.setAttribute('aria-label', initialText)
  const shown = doc.createElement('div')
  shown.setAttribute('data-composer-placeholder', '')
  shown.textContent = initialText
  card.append(editor, shown)
  return { doc, card, editor, shown }
}

test('桌面端：保留官方首文本节点，追加内联麦克风 SVG 与「按住鼠标说话」，aria-label 保持纯文本', () => {
  const official = '发消息或创建任务, / 调用指令, @ 文件或对话'
  const { card, editor, shown } = makeFixture(official)
  const firstTextNode = shown.firstChild!
  const ctrl = createPlaceholderController(
    card as unknown as HTMLElement,
    () => editor as unknown as HTMLElement,
    'desktop',
  )

  ctrl.apply()
  ctrl.apply() // 幂等重入不重复追加

  assert.equal(shown.firstChild, firstTextNode, '保留 React 持有的首个文本节点引用')
  assert.equal(shown.childNodes.length, 2)
  assert.equal(shown.textContent, `${official}, ${DESKTOP_VOICE_LABEL}`)

  const badge = shown.querySelector('[data-vh-ph]')
  assert.ok(badge, '挂载内联标记容器')
  assert.equal(badge.getAttribute('data-vh-ph'), 'desktop')

  const svg = badge.querySelector('svg')
  assert.ok(svg, '包含内联麦克风 SVG')
  assert.equal(svg.namespaceURI, 'http://www.w3.org/2000/svg')
  assert.equal(svg.getAttribute('class'), 'vh-ph-mic')
  assert.equal(svg.getAttribute('stroke'), 'currentColor')
  assert.equal(svg.getAttribute('stroke-width'), '1.35')
  assert.equal(svg.getAttribute('aria-hidden'), 'true')

  const expectedPlain = plainHintFor(official, 'desktop')
  assert.equal(editor.getAttribute('data-placeholder'), expectedPlain)
  assert.equal(editor.getAttribute('aria-label'), expectedPlain)

  ctrl.restore()
  assert.equal(shown.querySelector('[data-vh-ph]'), null)
  assert.equal(shown.textContent, official)
  assert.equal(editor.getAttribute('data-placeholder'), official)
  assert.equal(editor.getAttribute('aria-label'), official)
})

test('手机端：显示前置麦克风 SVG +「按住说话，轻点打字」，卸载后恢复官方原文', () => {
  const official = 'Message or run a task, / commands, @ files or sessions'
  const { card, editor, shown } = makeFixture(official)
  const ctrl = createPlaceholderController(
    card as unknown as HTMLElement,
    () => editor as unknown as HTMLElement,
    'phone',
  )

  ctrl.apply()
  ctrl.apply()

  const badge = shown.querySelector('[data-vh-ph]')
  assert.ok(badge)
  assert.equal(badge.getAttribute('data-vh-ph'), 'phone')
  const phoneSvg = badge.querySelector('svg')
  assert.ok(phoneSvg)
  assert.equal(phoneSvg.getAttribute('stroke-width'), '1', '手机端 16px 字号对齐官方 Regular 1px 描边')
  assert.equal(shown.textContent, PHONE_VOICE_LABEL)
  assert.equal(editor.getAttribute('data-placeholder'), PHONE_VOICE_LABEL)
  assert.equal(editor.getAttribute('aria-label'), PHONE_VOICE_LABEL)

  ctrl.restore()
  assert.equal(shown.textContent, official)
  assert.equal(editor.getAttribute('data-placeholder'), official)
  assert.equal(editor.getAttribute('aria-label'), official)
})

test('非默认提示（如已归档、禁用、计划模式）保持原样；官方后续切到非默认提示时不误恢复旧值', () => {
  const archived = '会话已归档，无法继续输入'
  const { card, editor, shown } = makeFixture(archived)
  const ctrl = createPlaceholderController(
    card as unknown as HTMLElement,
    () => editor as unknown as HTMLElement,
    'desktop',
  )

  ctrl.apply()
  assert.equal(shown.querySelector('[data-vh-ph]'), null)
  assert.equal(shown.textContent, archived)
  assert.equal(editor.getAttribute('data-placeholder'), archived)

  // 先在默认提示下生效，随后宿主通过 textContent 切换为归档文案
  const live = makeFixture('发消息或创建任务, / 调用指令, @ 文件或对话')
  const liveCtrl = createPlaceholderController(
    live.card as unknown as HTMLElement,
    () => live.editor as unknown as HTMLElement,
    'desktop',
  )
  liveCtrl.apply()
  assert.ok(live.shown.querySelector('[data-vh-ph]'))

  live.shown.textContent = archived
  live.editor.setAttribute('data-placeholder', archived)
  live.editor.setAttribute('aria-label', archived)
  liveCtrl.apply()
  assert.equal(live.shown.querySelector('[data-vh-ph]'), null)
  assert.equal(live.shown.textContent, archived)

  liveCtrl.restore()
  assert.equal(live.shown.textContent, archived, '卸载时不得把归档提示覆盖回旧默认文案')
  assert.equal(live.editor.getAttribute('data-placeholder'), archived)
})
