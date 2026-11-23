/**
 * 输入框为空时的提示文字与内联麦克风图标（只替换官方默认那一句；禁用、已归档、计划模式等其他提示保留原文）。
 * 电脑端保留 <div data-composer-placeholder> 原有的首个文本节点不动，仅在末尾追加内联 <span data-vh-ph>，
 * 既不破坏 React 文本对账，也继续复用官方单行 ellipsis 截断；编辑器 aria-label 保持纯文本供屏幕阅读器朗读。
 */

export type PlaceholderMode = 'desktop' | 'phone'

export const PLACEHOLDER_DEFAULTS = new Set([
  '发消息或创建任务, / 调用指令, @ 文件或对话',
  'Message or run a task, / commands, @ files or sessions',
])

export const DESKTOP_VOICE_LABEL = '按住鼠标说话'
export const PHONE_VOICE_LABEL = '按住说话，轻点打字'

const SVG_NS = 'http://www.w3.org/2000/svg'

export function plainHintFor(official: string, mode: PlaceholderMode): string {
  return mode === 'phone' ? PHONE_VOICE_LABEL : `${official}, ${DESKTOP_VOICE_LABEL}`
}

function createPlaceholderMic(doc: Document, mode: PlaceholderMode): SVGSVGElement {
  const svg = doc.createElementNS(SVG_NS, 'svg')
  svg.setAttribute('class', 'vh-ph-mic')
  svg.setAttribute('viewBox', '0 0 16 16')
  svg.setAttribute('fill', 'none')
  svg.setAttribute('stroke', 'currentColor')
  svg.setAttribute('stroke-width', mode === 'phone' ? '1' : '1.35')
  svg.setAttribute('stroke-linecap', 'round')
  svg.setAttribute('stroke-linejoin', 'round')
  svg.setAttribute('aria-hidden', 'true')
  const rect = doc.createElementNS(SVG_NS, 'rect')
  const path = doc.createElementNS(SVG_NS, 'path')
  if (mode === 'phone') {
    // 手机端字号强制 16px（1em = 16px）：对齐官方 Regular 图标线宽 1，且全部边落在 .5 半像素中心以消除 2x/3x 亚像素发虚发粗
    rect.setAttribute('x', '5.5')
    rect.setAttribute('y', '1.5')
    rect.setAttribute('width', '5')
    rect.setAttribute('height', '8')
    rect.setAttribute('rx', '2.5')
    path.setAttribute('d', 'M3.5 7a4.5 4.5 0 0 0 9 0M8 11.5v3M5.5 14.5h5')
  } else {
    rect.setAttribute('x', '5.6')
    rect.setAttribute('y', '1.75')
    rect.setAttribute('width', '4.8')
    rect.setAttribute('height', '7.65')
    rect.setAttribute('rx', '2.4')
    path.setAttribute('d', 'M3.4 7a4.6 4.6 0 0 0 9.2 0M8 11.6v2.65M5.6 14.25h4.8')
  }
  svg.append(rect, path)
  return svg
}

function createPlaceholderBadge(doc: Document, mode: PlaceholderMode): HTMLSpanElement {
  const span = doc.createElement('span')
  span.className = 'vh-ph'
  span.setAttribute('data-vh-ph', mode)
  if (mode === 'desktop') {
    span.append(', ', createPlaceholderMic(doc, mode), DESKTOP_VOICE_LABEL)
  } else {
    span.append(createPlaceholderMic(doc, mode), PHONE_VOICE_LABEL)
  }
  return span
}

export interface PlaceholderController {
  apply(): void
  restore(): void
}

export function createPlaceholderController(
  card: HTMLElement,
  editorOf: (card: HTMLElement) => HTMLElement | null,
  mode: PlaceholderMode,
): PlaceholderController {
  const originals = new Map<Element, string>()
  const hints = new Set<string>()
  let applying = false

  const apply = () => {
    if (applying) return
    applying = true
    try {
      const editor = editorOf(card)
      if (editor !== null) {
        const value = editor.getAttribute('data-placeholder')
        if (value !== null && PLACEHOLDER_DEFAULTS.has(value)) {
          const hint = plainHintFor(value, mode)
          hints.add(hint)
          originals.set(editor, value)
          editor.setAttribute('data-placeholder', hint)
          if (editor.getAttribute('aria-label') === value) editor.setAttribute('aria-label', hint)
        }
      }

      const shown = card.querySelector('[data-composer-placeholder]')
      if (shown !== null) {
        const badge = shown.querySelector('[data-vh-ph]')
        if (badge !== null) {
          if (mode === 'desktop') {
            const head = shown.firstChild !== badge ? (shown.firstChild?.nodeValue ?? '') : ''
            if (!PLACEHOLDER_DEFAULTS.has(head)) badge.remove()
            else originals.set(shown, head)
          }
        } else {
          const raw = shown.textContent
          if (raw !== null && PLACEHOLDER_DEFAULTS.has(raw)) {
            originals.set(shown, raw)
            const nextBadge = createPlaceholderBadge(shown.ownerDocument, mode)
            if (mode === 'desktop') shown.appendChild(nextBadge)
            else shown.replaceChildren(nextBadge)
          }
        }
      }
    } finally {
      applying = false
    }
  }

  const restore = () => {
    for (const [element, value] of originals) {
      if (!element.isConnected) continue
      if (element.hasAttribute('data-composer-placeholder')) {
        if (element.querySelector('[data-vh-ph]') !== null) element.textContent = value
      } else if (hints.has(element.getAttribute('data-placeholder') ?? '')) {
        element.setAttribute('data-placeholder', value)
        if (hints.has(element.getAttribute('aria-label') ?? '')) element.setAttribute('aria-label', value)
      }
    }
  }

  return { apply, restore }
}
