/**
 * 通话胶囊与按住说话玻璃、样式挂载仲裁、曲率双轨与全局拖拽护盾测试。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { runInNewContext } from 'node:vm'
import { createElement, type ComponentType } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { validateCssString } from '../../packages/dsh-ui/scripts/check-tokens.mjs'
import { glassVars, NO_SHADOW, splitShadows, type CardLook, type UnderLook } from '../src/client/call/glass.ts'
import { css as baseCss } from '../src/client/styles.ts'
import { callCss } from '../src/client/call-styles.ts'
import { settingsCss } from '../src/client/settings-styles.ts'
import { css as holdCss } from '../src/hold/styles.ts'

const localRequire = createRequire(import.meta.url)

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

test('原版待办栏共享玻璃：卡片自身带 backdrop-filter 且 ::before 没画时直接复用卡片模糊', () => {
  const vars = glassVars(
    card({
      backgroundColor: 'rgba(26, 26, 26, 0.66)',
      backdropFilter: 'blur(8px) saturate(1.3)',
    }),
    noUnder,
  )
  assert.equal(vars['--vr-glass-blur'], 'blur(8px) saturate(1.3)')
  assert.equal(vars['--vr-glass-face'], 'rgba(26, 26, 26, 0.66)')
})

test('单层分拆阴影：外层卡片持有 --dsh-glass-outer、::before 持有 --dsh-glass-inset，glassVars 合并两层不遗漏', () => {
  const vars = glassVars(
    card({
      boxShadow: 'rgba(0, 0, 0, 0.4) 0px 0px 0px 0.5px, rgba(0, 0, 0, 0.14) 0px 8px 28px -8px',
    }),
    {
      content: '""',
      backgroundColor: 'rgba(26, 26, 26, 0.66)',
      backgroundImage: 'none',
      backdropFilter: 'blur(8px) saturate(1.3)',
      boxShadow: 'rgba(255, 255, 255, 0.09) 0px 0.5px 0px 0px inset, rgba(255, 255, 255, 0.08) 0px 0px 0px 0.5px inset',
    },
  )
  assert.equal(vars['--vr-glass-blur'], 'blur(8px) saturate(1.3)')
  assert.equal(vars['--vr-glass-under'], 'rgba(26, 26, 26, 0.66)')
  assert.equal(vars['--vr-glass-inset'], 'rgba(255, 255, 255, 0.09) 0px 0.5px 0px 0px inset, rgba(255, 255, 255, 0.08) 0px 0px 0px 0.5px inset')
  assert.equal(vars['--vr-glass-outer'], 'rgba(0, 0, 0, 0.4) 0px 0px 0px 0.5px, rgba(0, 0, 0, 0.14) 0px 8px 28px -8px')
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

test('圆角：取卡片左上角的圆角和圆角形状；读不到或不是 px 就不写（胶囊用宿主面板圆角）', () => {
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

test('运行时全量样式表 100% 通过 check-tokens，统一采用原版待办栏毛玻璃与曲率双轨规则', () => {
  for (const [name, sheet] of [
    ['styles.ts', baseCss],
    ['call-styles.ts', callCss],
    ['settings-styles.ts', settingsCss],
    ['hold/styles.ts', holdCss],
  ] as const) {
    assert.deepEqual(validateCssString(sheet, { file: name }), [], `${name} 应零门禁违规`)
    assert.doesNotMatch(sheet, /:root\s*\{[^}]*--dsw-corner-shape/, `${name} 严禁篡改 :root --dsw-corner-shape`)
  }

  // 通话悬浮胶囊与按住说话状态条均对齐 8px 胶囊/输入框毛玻璃配方（拒绝误绑 13px --dsh-menu-*），
  // 且按住说话状态条、通话提示条均将 backdrop-filter 隔离到 ::before 伪元素，声波改用纯 scaleY 合成层
  for (const sheet of [callCss, holdCss]) {
    assert.match(sheet, /--dsh-capsule-surface-fill/)
    assert.match(sheet, /--dsh-capsule-backdrop-filter/)
    assert.doesNotMatch(sheet, /--dsh-menu-backdrop-filter/)
    assert.match(sheet, /blur\(8px\)\s+saturate\(1\.3\)/)
    assert.match(sheet, /--dsh-glass-shadow/)
  }

  assert.match(holdCss, /\.vh-status\s*\{[^}]*backdrop-filter:\s*none/)
  assert.match(holdCss, /\.vh-status::before\s*\{[^}]*backdrop-filter:[^}]*--dsh-capsule-backdrop-filter/)
  assert.match(holdCss, /\[data-composer-seat\]:has\(\[data-goal-bar\]\)\s+\.vh-status\s*\{[^}]*bottom:\s*44px/)
  assert.match(holdCss, /\[data-composer-seat\]:has\(\[data-testid="todo-panel"\]\)\s+\.vh-status\s*\{[^}]*bottom:\s*46px/)
  assert.match(holdCss, /\[data-composer-seat\]:has\(\[data-goal-bar\]\):has\(\[data-testid="todo-panel"\]\)\s+\.vh-status\s*\{[^}]*bottom:\s*82px/)
  assert.match(holdCss, /\.vh-wave\s*\{[^}]*width:\s*72px;\s*height:\s*20px/)

  assert.match(callCss, /\.vr-call-notice\s*\{[^}]*backdrop-filter:\s*none/)
  assert.match(callCss, /\.vr-call-notice::before\s*\{[^}]*backdrop-filter:[^}]*--dsh-capsule-backdrop-filter/)
  assert.match(callCss, /\.vr-call-panel\s*\{[^}]*overflow:\s*visible/)
  assert.match(callCss, /\.vr-call-wave\s*\{[^}]*border-radius:\s*inherit;\s*corner-shape:\s*inherit/)
  assert.doesNotMatch(callCss, /\.vr-call-avatar::before\s*\{[^}]*filter:\s*blur/)
  for (const sheet of [baseCss, settingsCss, holdCss, callCss]) {
    assert.doesNotMatch(sheet, /will-change:\s*opacity/)
    assert.doesNotMatch(sheet, /will-change:\s*transform/)
    assert.doesNotMatch(sheet, /animation:[^;]*\binfinite\b/)
    assert.doesNotMatch(sheet, /\bvh-pulse\b|\bvr-call-soft\b|\bvr-call-breathe\b|\bvr-pulse\b|\bvr-blocked-pulse\b/)
  }

  // 客户端与 hold 源码零字符勾选/叉号，lib/client.js 零外部 @kewen/dsh-ui 引用
  for (const relDir of ['../src/client/', '../src/hold/']) {
    const dirUrl = new URL(relDir, import.meta.url)
    for (const name of readdirSync(dirUrl)) {
      if (!name.endsWith('.ts') && !name.endsWith('.tsx')) continue
      const text = readFileSync(new URL(name, dirUrl), 'utf8')
      assert.doesNotMatch(text, /[✓✕✗✔✖]/u, `${relDir}${name} 不得使用字符勾叉图标`)
    }
  }

  const bundle = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
  assert.doesNotMatch(bundle, /\brequire\s*\(\s*['"]@kewen\/dsh-ui/)
  assert.doesNotMatch(bundle, /\bfrom\s+['"]@kewen\/dsh-ui/)
})

test('样式引用计数挂载、通话挂断 danger-solid 按钮与 beginGlobalDrag 悬浮拖拽护盾验证', () => {
  type FakeStyle = {
    tagName: string
    textContent: string
    dataset: Record<string, string>
    attrs: Map<string, string>
    setAttribute(k: string, v: string): void
    getAttribute(k: string): string | null
    remove(): void
  }
  const headChildren: FakeStyle[] = []
  const makeStyle = (): FakeStyle => {
    const attrs = new Map<string, string>()
    const node: FakeStyle = {
      tagName: 'STYLE',
      textContent: '',
      dataset: {},
      attrs,
      setAttribute(k, v) { attrs.set(k, v) },
      getAttribute(k) { return attrs.get(k) ?? null },
      remove() {
        const idx = headChildren.indexOf(node)
        if (idx >= 0) headChildren.splice(idx, 1)
      },
    }
    return node
  }

  const winListeners = new Map<string, Set<(ev: any) => void>>()
  const docElement = {
    dataset: {} as Record<string, string>,
    setAttribute(k: string, v: string) {
      if (k.startsWith('data-')) {
        const camel = k.slice(5).replace(/-([a-z])/g, (_, c: string) => c.toUpperCase())
        this.dataset[camel] = v
      }
    },
    removeAttribute(k: string) {
      if (k.startsWith('data-')) {
        const camel = k.slice(5).replace(/-([a-z])/g, (_, c: string) => c.toUpperCase())
        delete this.dataset[camel]
      }
    },
  }

  const fakeWin = {
    innerWidth: 1200,
    innerHeight: 800,
    __ModuleLoader__: {
      load(entry: { id: string, factory: (req: (id: string) => unknown) => Record<string, any> }) {
        assert.equal(entry.id, '@kewen/dsh-voice')
        loaded = entry.factory((specifier: string) => {
          if (
            specifier === 'react'
            || specifier === 'react/jsx-runtime'
            || specifier === 'react-dom'
            || specifier === 'react-dom/client'
          ) {
            return localRequire(specifier)
          }
          throw new Error(`Unexpected runtime require: ${specifier}`)
        })
      },
    },
    addEventListener(type: string, fn: (ev: any) => void) {
      let set = winListeners.get(type)
      if (!set) { set = new Set(); winListeners.set(type, set) }
      set.add(fn)
    },
    removeEventListener(type: string, fn: (ev: any) => void) {
      winListeners.get(type)?.delete(fn)
    },
    dispatch(type: string, ev: any) {
      for (const fn of [...(winListeners.get(type) ?? [])]) fn(ev)
    },
  }

  const fakeDoc = {
    defaultView: fakeWin,
    documentElement: docElement,
    head: {
      children: headChildren,
      appendChild(node: FakeStyle) { headChildren.push(node); return node },
    },
    createElement() { return makeStyle() },
  }

  let loaded: Record<string, any> | undefined
  const bundleCode = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
  runInNewContext(bundleCode, {
    window: fakeWin,
    document: fakeDoc,
    Element: class FakeElement {},
    URL,
    encodeURIComponent,
    setTimeout,
    clearTimeout,
  })

  assert.ok(loaded, 'lib/client.js 成功加载')

  // 1) mountDshUiStyles + injectPluginStyles 引用计数与幂等清理
  const disposeA = loaded.injectStyles() as () => void
  const disposeB = loaded.injectStyles() as () => void
  const tokensStyle = headChildren.find(n => n.getAttribute('data-dsh-ui') === 'tokens')
  const pluginStyle = headChildren.find(n => n.getAttribute('data-plugin-css') === '@kewen/dsh-voice-reply')
  assert.ok(tokensStyle, '挂载 @kewen/dsh-ui tokens 块')
  assert.ok(pluginStyle, '挂载 @kewen/dsh-voice-reply 样式块')
  assert.equal(tokensStyle.getAttribute('data-refs'), '2')
  disposeA()
  disposeA()
  assert.equal(tokensStyle.getAttribute('data-refs'), '1', '幂等卸载仅递减一次共享引用计数')
  disposeB()
  assert.equal(headChildren.length, 0, '全部引用释放后样式块清空')

  // 2) CallPanelInner 渲染验证：挂断按钮采用 danger-solid 胶囊原语，「说完了」与静音采用 toolbar 胶囊原语
  const CallPanelInner = loaded.CallPanelInner as ComponentType<{ view: any, composing: boolean }>
  const panelHtml = renderToStaticMarkup(createElement(CallPanelInner, {
    view: { phase: 'hearing', muted: false, heard: '', notice: '' },
    composing: false,
  }))
  assert.match(panelHtml, /hs-btn-danger-solid[^"]*vr-call-hangup/, '挂断按钮采用 danger-solid 原语')
  assert.match(panelHtml, /hs-btn-toolbar[^"]*vr-call-done/, '说完了按钮采用 toolbar 原语')
  assert.match(panelHtml, /hs-btn-toolbar[^"]*vr-call-icon/, '静音按钮采用 toolbar 圆形胶囊')

  // 3) startCallPanelDrag + beginGlobalDrag：跨过 6px 阈值开启 html[data-dsh-dragging] 护盾并拦截松手误触 click
  const panelListeners = new Map<string, Set<(ev: any) => void>>()
  const styleProps = new Map<string, string>()
  const fakePanel = {
    ownerDocument: fakeDoc,
    dataset: {} as Record<string, string>,
    style: {
      setProperty(k: string, v: string) { styleProps.set(k, v) },
      removeProperty(k: string) { styleProps.delete(k) },
    },
    getBoundingClientRect: () => ({ left: 300, top: 600, width: 420, height: 60 }),
    addEventListener(type: string, fn: (ev: any) => void) {
      let set = panelListeners.get(type)
      if (!set) { set = new Set(); panelListeners.set(type, set) }
      set.add(fn)
    },
    removeEventListener(type: string, fn: (ev: any) => void) {
      panelListeners.get(type)?.delete(fn)
    },
    dispatch(type: string, ev: any) {
      for (const fn of [...(panelListeners.get(type) ?? [])]) fn(ev)
    },
  }

  const stopDrag = loaded.startCallPanelDrag(fakePanel) as () => void
  fakePanel.dispatch('pointerdown', { button: 0, pointerId: 7, clientX: 400, clientY: 620, target: null })
  assert.equal(docElement.dataset.dshDragging, undefined, '未超过 6px 阈值前不进入拖拽锁')

  fakeWin.dispatch('pointermove', { pointerId: 7, clientX: 440, clientY: 560, preventDefault() {} })
  assert.equal(docElement.dataset.dshDragging, '', '拖拽跨越阈值立即激活 beginGlobalDrag 屏蔽 iframe')
  assert.equal(fakePanel.dataset.floating, '')
  assert.equal(fakePanel.dataset.dragging, '')
  assert.equal(styleProps.get('--vr-drag-x'), '40px')
  assert.equal(styleProps.get('--vr-drag-y'), '-60px')

  fakeWin.dispatch('pointerup', { pointerId: 7 })
  assert.equal(docElement.dataset.dshDragging, undefined, '松手后立即释放全局拖拽护盾')
  assert.equal(fakePanel.dataset.dragging, undefined)
  assert.equal(fakePanel.dataset.floating, '', '悬浮偏移保持有效')

  let clickPrevented = false
  fakePanel.dispatch('click', {
    preventDefault() { clickPrevented = true },
    stopPropagation() {},
  })
  assert.equal(clickPrevented, true, '拖拽结束后的尾随 click 被拦截，避免误触发通话暂停/打断')

  fakePanel.dispatch('dblclick', { target: null })
  assert.equal(fakePanel.dataset.floating, undefined, '双击面板复位回输入框上方')
  assert.equal(styleProps.has('--vr-drag-x'), false)

  stopDrag()
})
