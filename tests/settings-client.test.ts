import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { runInNewContext } from 'node:vm'
import { createElement, type ComponentType } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { changeSpeechRate, loadSettings, speechRate } from '../src/client/settings.ts'

const localRequire = createRequire(import.meta.url)

test('连续切换语速按顺序保存，失败时退回最近一次成功的值', async () => {
  const originalFetch = globalThis.fetch
  let stored = 1
  const pending: Array<{ rate: number, resolve: (response: Response) => void }> = []
  const view = () => ({ ready: true, error: null, settings: { model: 'm', voice: 'v', turnLimit: 800, speechRate: stored }, catalog: { models: [], turnLimits: [], speechRates: [1, 1.25, 1.5, 2] } })
  globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
    if (init?.method !== 'POST') return Response.json(view())
    const rate = JSON.parse(String(init.body)).speechRate as number
    return new Promise<Response>((resolve) => pending.push({ rate, resolve }))
  }) as typeof fetch
  const tick = () => new Promise<void>((resolve) => setImmediate(resolve))
  try {
    await loadSettings(true)
    const first = changeSpeechRate(1.25)
    const second = changeSpeechRate(1.5)
    assert.equal(speechRate(), 1.5)
    await tick()
    assert.deepEqual(pending.map((p) => p.rate), [1.25])
    stored = 1.25
    pending.shift()!.resolve(Response.json(view()))
    await first
    await tick()
    assert.equal(speechRate(), 1.5)
    assert.deepEqual(pending.map((p) => p.rate), [1.5])
    pending.shift()!.resolve(Response.json({ error: '保存失败' }, { status: 500 }))
    await assert.rejects(second, /保存失败/)
    assert.equal(speechRate(), 1.25)
    const third = changeSpeechRate(2)
    await tick()
    stored = 2
    pending.shift()!.resolve(Response.json(view()))
    await third
    assert.equal(speechRate(), 2)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('SettingsSection 全面接入 @kewen/dsh-ui 原语：Card / CardRow / Fold / Select / PasswordInput / Input / Slider / StandaloneSwitch / Button，零原生 <select>', async () => {
  const mockView = {
    ready: true,
    error: null,
    vadVersion: '1.0.0',
    settings: {
      holdEnabled: true,
      replyEnabled: true,
      model: 'cosyvoice-v2',
      voice: 'longxiaochun_v2',
      turnLimit: 800,
      speechRate: 1.25,
      speakWhole: false,
      callCloudAsr: true,
      callSilenceMs: 1200,
      callSmartTurn: true,
      callBargeIn: false,
      callKeepOnLock: false,
      callVoiceModel: true,
      callSensitivity: 'medium',
    },
    catalog: {
      providers: [
        {
          id: 'deepseek',
          label: 'DeepSeek',
          description: '直接用 DeepSeek API Key，免开阿里云',
          keyLabel: 'DeepSeek API Key',
          keyHint: '填写 DeepSeek 开放平台的 API Key。',
          ready: true,
        },
        {
          id: 'dashscope',
          label: '阿里百炼',
          description: '1 元 / 万字符 · 48 种音色与方言',
          keyLabel: '百炼 API Key',
          keyHint: '请使用百炼北京地域的 API Key。',
          ready: false,
        },
      ],
      models: [
        {
          id: 'cosyvoice-v2',
          provider: 'deepseek',
          label: 'CosyVoice v2',
          price: '2 元 / 万字',
          voices: [
            { id: 'longxiaochun_v2', name: '龙小淳', gender: '女', group: '普通话', desc: '温和自然女声' },
            { id: 'longshu_v2', name: '龙书', gender: '男', group: '播音', desc: '沉稳新闻男声' },
          ],
        },
        {
          id: 'qwen-tts',
          provider: 'deepseek',
          label: 'Qwen TTS',
          price: '1.5 元 / 万字',
          voices: [
            { id: 'Cherry', name: 'Cherry', gender: '女', desc: '清脆女声' },
          ],
        },
      ],
      turnLimits: [300, 500, 800, 1500, 3000, 0],
      speechRates: [1, 1.25, 1.5, 2],
      callSilences: [800, 1000, 1200, 1500, 2000, 3000],
    },
  }

  let loaded: Record<string, any> | undefined
  const bundleCode = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
  runInNewContext(bundleCode, {
    window: {
      __ModuleLoader__: {
        load(entry: { id: string, factory: (req: (id: string) => unknown) => Record<string, any> }) {
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
      addEventListener() {},
      removeEventListener() {},
    },
    fetch: async () => Response.json(mockView),
    URL,
    encodeURIComponent,
    setTimeout,
    clearTimeout,
  })

  assert.ok(loaded, 'lib/client.js 成功加载')
  const SettingsSection = loaded.SettingsSection as ComponentType<{ subject?: any }>
  const subject = { kind: 'bundle', pkg: { name: '@kewen/dsh-voice' } }

  // 非本插件 bundle 页不渲染
  assert.equal(
    renderToStaticMarkup(createElement(SettingsSection, { subject: { kind: 'bundle', pkg: { name: '@kewen/other' } } })),
    '',
  )

  // 未加载完成时渲染 @kewen/dsh-ui LoadingState
  const loadingHtml = renderToStaticMarkup(createElement(SettingsSection, { subject }))
  assert.match(loadingHtml, /dsh-loading/, '读取中采用 LoadingState 原语')

  // 加载完整设置后校验全部 @kewen/dsh-ui 原语落位
  await (loaded.loadSettings as (force?: boolean) => Promise<void>)(true)
  const html = renderToStaticMarkup(createElement(SettingsSection, { subject }))

  assert.doesNotMatch(html, /<select\b/i, '严禁残留任何原生 <select> 下拉框')
  assert.match(html, /dsh-card/, '分组卡片采用 Card')
  assert.match(html, /dsh-card-row/, '设置行采用 CardRow')
  assert.match(html, /dsh-fold/, '收音设置采用 Fold 折叠面板')
  assert.match(html, /dsh-pwd-box/, '百炼 API Key 采用 PasswordInput')
  assert.match(html, /dsh-pwd-eye/, 'PasswordInput 带显隐眼睛按钮')
  assert.match(html, /dsh-select/, '音色/模型/字数上限/灵敏度采用自定义胶囊 Select')
  assert.match(html, /dsh-input/, '自定义试听词句采用胶囊 Input')
  assert.match(html, /dsh-range/, '语速与通话停顿采用连续刻度 Slider')
  assert.match(html, /dsh-slider-val[^>]*>1\.25×/, '语速 Slider 等宽数值回显 1.25×')
  assert.match(html, /dsh-slider-val[^>]*>1\.2 秒/, '通话停顿 Slider 等宽数值回显 1.2 秒')
  assert.match(html, /hs-fb-switch/, '布尔开关采用 StandaloneSwitch')
  assert.match(html, /dsh-badge/, '已配置/本机/云端标签采用 Badge')
  assert.match(html, /语音服务/, '顶部卡片升级为「语音服务」支持双服务商切换')
  assert.match(html, /DeepSeek API Key/, '展示当前选中服务商的 API Key 标题')
  assert.match(html, /云端识别/, '通话识别升级为跟随服务商的「云端识别」')
  assert.match(html, /测一下环境噪声/, '环境噪声测试入口保留完整')
})
