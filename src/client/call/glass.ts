/**
 * 通话胶囊照抄输入框卡片的玻璃：把卡片和它 ::before 的计算样式换成胶囊用的 CSS 变量。
 *
 * 输入框外观有好几套（官方原版实色；harness-plus 的单层 / 双层 / 待办栏；手机上 mobile-plus 再覆盖一层），
 * 磨砂有时画在卡片的 ::before 上（单层），有时画在外框上（双层，卡片本身是半透明渐变）。
 * 这里不写死哪一套，读实际画出来的样式。层次和卡片一样：
 *   磨砂层（卡片 ::before 的底色 + backdrop-filter）→ 卡片底色 / 渐变 → 内细边（inset 阴影、描边）。
 * 外投影单独给出（胶囊 overflow: hidden，外投影要画在胶囊自己身上）。
 *
 * 纯函数，不 import 别的模块，Node 里能直接测。
 */

/** 卡片自己的计算样式（只取用到的）。 */
export interface CardLook {
  backgroundColor: string
  backgroundImage: string
  boxShadow: string
  borderWidth: string
  borderStyle: string
  borderColor: string
  /** 左上角圆角（计算值，如 26px）。 */
  borderRadius?: string
  /** 圆角形状（round / superellipse(…)）；浏览器不支持时是空字符串。 */
  cornerShape?: string
}

/** 卡片 ::before 的计算样式。 */
export interface UnderLook {
  content: string
  backgroundColor: string
  backgroundImage: string
  backdropFilter: string
}

/** 「没有阴影」：要放进逗号分隔的阴影列表里，不能用 none。 */
export const NO_SHADOW = '0 0 #0000'

const TRANSPARENT = /^(transparent|rgba\(\s*0\s*,\s*0\s*,\s*0\s*,\s*0\s*\)|#0000(0000)?)$/i

function isTransparent(color: string): boolean {
  const value = color.trim()
  return value === '' || TRANSPARENT.test(value)
}

/** 按顶层逗号拆阴影列表（rgba(…) 里的逗号不拆）。 */
export function splitShadows(value: string): string[] {
  const out: string[] = []
  let depth = 0
  let start = 0
  for (let i = 0; i < value.length; i++) {
    const ch = value[i]
    if (ch === '(') depth++
    else if (ch === ')') depth = Math.max(0, depth - 1)
    else if (ch === ',' && depth === 0) {
      out.push(value.slice(start, i).trim())
      start = i + 1
    }
  }
  out.push(value.slice(start).trim())
  return out.filter((shadow) => shadow !== '' && shadow !== 'none')
}

/** 卡片的样子 → 胶囊的 CSS 变量（名字见 call-styles.ts 的 .vr-call-panel）。 */
export function glassVars(card: CardLook, under: UnderLook | undefined): Record<string, string> {
  const inset: string[] = []
  const outer: string[] = []
  // 描边换成一圈内阴影：位置一样，又不改胶囊的尺寸
  const width = Number.parseFloat(card.borderWidth)
  if (width > 0 && card.borderStyle !== 'none' && card.borderStyle !== 'hidden' && !isTransparent(card.borderColor)) {
    inset.push(`inset 0 0 0 ${card.borderWidth.trim()} ${card.borderColor.trim()}`)
  }
  for (const shadow of splitShadows(card.boxShadow)) (/\binset\b/.test(shadow) ? inset : outer).push(shadow)
  const drawn = under !== undefined && under.content !== 'none' && under.content !== 'normal'
  const vars: Record<string, string> = {}
  // 圆角跟卡片一样（单层 26、双层 17…）；读不到就不写，胶囊保持两头半圆
  const radius = (card.borderRadius ?? '').trim().split(/\s+/)[0] ?? ''
  if (/^\d+(\.\d+)?px$/.test(radius) && Number.parseFloat(radius) > 0) vars['--vr-glass-radius'] = radius
  const shape = (card.cornerShape ?? '').trim()
  if (shape !== '') vars['--vr-glass-corner'] = shape
  return {
    ...vars,
    '--vr-glass-face': card.backgroundColor.trim() || 'transparent',
    '--vr-glass-face-image': card.backgroundImage.trim() || 'none',
    '--vr-glass-inset': inset.length > 0 ? inset.join(', ') : NO_SHADOW,
    '--vr-glass-outer': outer.length > 0 ? outer.join(', ') : NO_SHADOW,
    '--vr-glass-under': drawn ? under.backgroundColor.trim() || 'transparent' : 'transparent',
    '--vr-glass-under-image': drawn ? under.backgroundImage.trim() || 'none' : 'none',
    '--vr-glass-blur': drawn ? under.backdropFilter.trim() || 'none' : 'none',
  }
}
