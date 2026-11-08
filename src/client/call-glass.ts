/**
 * 胶囊跟着输入框卡片的玻璃走：读卡片（和它 ::before）的计算样式，写成 CSS 变量挂在胶囊的位置（.vr-call-seat）上。
 * 换外观（插件页切单层 / 双层 / 原版、玻璃款式、调透明度）、换深浅色、手机横竖屏时重新读。
 * 换算规则见 call/glass.ts。
 */
import { glassVars } from './call/glass'

/** 外观变了以后，等过渡动画走完再读一次。 */
const SETTLE_MS = 450

function backdrop(style: CSSStyleDeclaration): string {
  return style.getPropertyValue('backdrop-filter') || style.getPropertyValue('-webkit-backdrop-filter')
}

/** 开始跟随；返回停止跟随的函数（会把写上去的变量拿掉）。 */
export function mirrorGlass(card: HTMLElement, host: HTMLElement): () => void {
  let frame = 0
  let timer: ReturnType<typeof setTimeout> | undefined
  let written: string[] = []

  const apply = () => {
    frame = 0
    if (!card.isConnected || !host.isConnected) return
    const look = getComputedStyle(card)
    const under = getComputedStyle(card, '::before')
    const vars = glassVars(
      {
        backgroundColor: look.backgroundColor,
        backgroundImage: look.backgroundImage,
        boxShadow: look.boxShadow,
        borderWidth: look.borderTopWidth,
        borderStyle: look.borderTopStyle,
        borderColor: look.borderTopColor,
        borderRadius: Number.parseFloat(look.borderTopLeftRadius) > 0 ? look.borderTopLeftRadius : look.borderBottomLeftRadius,
        cornerShape: look.getPropertyValue('corner-shape'),
      },
      {
        content: under.content,
        backgroundColor: under.backgroundColor,
        backgroundImage: under.backgroundImage,
        backdropFilter: backdrop(under),
      },
    )
    // 上次写了、这次没有的（比如圆角读不到了）先拿掉，免得留着旧值
    for (const name of written) if (!(name in vars)) host.style.removeProperty(name)
    written = Object.keys(vars)
    for (const [name, value] of Object.entries(vars)) host.style.setProperty(name, value)
  }

  const schedule = () => {
    if (frame === 0) frame = requestAnimationFrame(apply)
    clearTimeout(timer)
    timer = setTimeout(apply, SETTLE_MS)
  }

  apply()
  // 外观开关写在 <html> / <body> 的属性上；插件样式表热替换时 <head> 里的 <style> 会变
  const observer = new MutationObserver(schedule)
  observer.observe(document.documentElement, { attributes: true })
  observer.observe(document.body, { attributes: true })
  observer.observe(card, { attributes: true, attributeFilter: ['class', 'style'] })
  observer.observe(document.head, { childList: true, subtree: true, characterData: true })
  const dark = typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-color-scheme: dark)') : undefined
  dark?.addEventListener('change', schedule)
  window.addEventListener('resize', schedule)
  // 胶囊可能比插件样式先出来：过一会儿再读一次
  timer = setTimeout(apply, SETTLE_MS)

  return () => {
    observer.disconnect()
    dark?.removeEventListener('change', schedule)
    window.removeEventListener('resize', schedule)
    cancelAnimationFrame(frame)
    clearTimeout(timer)
    for (const name of written) host.style.removeProperty(name)
  }
}
