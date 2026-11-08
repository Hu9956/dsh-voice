/**
 * 通话胶囊底部的波浪和左边头像的光边：一个 requestAnimationFrame 循环，每帧直接取麦克风 / 朗读的音量，
 * 画到 canvas 上，并把音量写进头像的 --vr-level（不经过 React 重渲染）。
 *
 * - 你说话时跟麦克风，它念的时候跟朗读，在想 / 在干活时低幅度慢慢流动，静音、暂停变成平线（见 meter.ts）。
 * - 换状态时颜色在 0.4 秒里渐变过去。
 * - 系统开了「减少动态效果」：不流动，只按状态画一条静止的波浪。
 */
import { useEffect, useLayoutEffect, useRef } from 'react'
import type { CallPhase } from './call/controller'
import { IDLE_LEVEL, mixRgb, paletteOf, parseHex, smooth, targetLevel, toneOf, type Tone } from './call/meter'
import { currentCall } from './call/session'

type Rgb = [number, number, number]

const COLOR_FADE_MS = 400
/** 一帧最多按这么久算（切回前台时别一下跳太远）。 */
const MAX_DT_MS = 100
/** 波浪最高到胶囊高度的这么多（再高就压到字了）。 */
const MAX_AMP_RATIO = 0.42
/** 波浪的基线离底边这么远（平线时看得到）。 */
const BASELINE_INSET = 4
const STEP_PX = 4

function rgbOf(tone: Tone, dark: boolean): Rgb[] {
  return paletteOf(tone, dark).map((hex) => parseHex(hex) ?? [128, 128, 128])
}

/** DSH 深色主题时 body 上有 data-ds-dark-theme（和 call-styles.ts 的选择器一致）。 */
function isDark(): boolean {
  return document.body.hasAttribute('data-ds-dark-theme')
}

function rgba([r, g, b]: Rgb, alpha: number): string {
  return `rgba(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)}, ${alpha.toFixed(3)})`
}

interface Layer {
  /** 横向有几个起伏。 */
  freq: number
  /** 流动速度（正负是方向）。 */
  speed: number
  offset: number
  /** 相对高度。 */
  scale: number
  alpha: number
  /** 用调色板里的哪两种颜色（左 → 右）。 */
  from: number
  to: number
  /** 这一层的波峰描一条亮线。 */
  stroke: boolean
}

const LAYERS: readonly Layer[] = [
  { freq: 1.3, speed: 0.9, offset: 0, scale: 1, alpha: 0.2, from: 2, to: 0, stroke: false },
  { freq: 1.9, speed: -1.3, offset: 2, scale: 0.72, alpha: 0.24, from: 0, to: 1, stroke: false },
  { freq: 1.05, speed: 0.6, offset: 4, scale: 0.88, alpha: 0.3, from: 1, to: 2, stroke: true },
]

function draw(ctx: CanvasRenderingContext2D, w: number, h: number, dpr: number, level: number, time: number, colors: Rgb[]): void {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, w, h)
  if (w <= 0 || h <= 0) return
  const base = h - BASELINE_INSET
  const amp = level * h * MAX_AMP_RATIO
  for (const layer of LAYERS) {
    const points: number[] = []
    for (let x = 0; x <= w + STEP_PX; x += STEP_PX) {
      const u = Math.min(1, x / w)
      // 两头收窄，中间鼓起来
      const envelope = Math.sin(Math.PI * u) ** 1.5
      const wave = 0.55 + 0.45 * Math.sin(2 * Math.PI * (layer.freq * u + layer.speed * time) + layer.offset)
      points.push(Math.min(x, w), base - amp * layer.scale * envelope * wave)
    }
    const across = ctx.createLinearGradient(0, 0, w, 0)
    across.addColorStop(0, rgba(colors[layer.from]!, 0))
    across.addColorStop(0.2, rgba(colors[layer.from]!, layer.alpha))
    across.addColorStop(0.8, rgba(colors[layer.to]!, layer.alpha))
    across.addColorStop(1, rgba(colors[layer.to]!, 0))
    ctx.beginPath()
    ctx.moveTo(0, h)
    for (let i = 0; i < points.length; i += 2) ctx.lineTo(points[i]!, points[i + 1]!)
    ctx.lineTo(w, h)
    ctx.closePath()
    ctx.fillStyle = across
    ctx.fill()
    if (!layer.stroke) continue
    const line = ctx.createLinearGradient(0, 0, w, 0)
    line.addColorStop(0, rgba(colors[layer.from]!, 0))
    line.addColorStop(0.25, rgba(colors[layer.from]!, 0.85))
    line.addColorStop(0.75, rgba(colors[layer.to]!, 0.85))
    line.addColorStop(1, rgba(colors[layer.to]!, 0))
    ctx.beginPath()
    ctx.moveTo(points[0]!, points[1]!)
    for (let i = 2; i < points.length; i += 2) ctx.lineTo(points[i]!, points[i + 1]!)
    ctx.lineWidth = 1.5
    ctx.lineJoin = 'round'
    ctx.strokeStyle = line
    ctx.shadowColor = rgba(colors[1]!, 0.6)
    ctx.shadowBlur = 6
    ctx.stroke()
    ctx.shadowBlur = 0
  }
}

/** 返回给 canvas（波浪）和头像用的 ref。 */
export function useCallVisual(phase: CallPhase) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const avatarRef = useRef<HTMLSpanElement>(null)
  const tone = toneOf(phase)
  const toneRef = useRef<Tone>(tone)
  useLayoutEffect(() => { toneRef.current = tone }, [tone])

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d') ?? null
    if (canvas === null || ctx === null) return
    const reduce = typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-reduced-motion: reduce)') : undefined

    let width = 0
    let height = 0
    let dpr = 1
    let dirty = true
    const resize = () => {
      dpr = Math.min(2, window.devicePixelRatio || 1)
      width = canvas.clientWidth
      height = canvas.clientHeight
      canvas.width = Math.max(1, Math.round(width * dpr))
      canvas.height = Math.max(1, Math.round(height * dpr))
      dirty = true
    }
    resize()
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(resize) : undefined
    observer?.observe(canvas)

    let shown = toneRef.current
    let dark = isDark()
    let from = rgbOf(shown, dark)
    let to = from
    let fade = 1
    let level = 0
    let time = 0
    let last = performance.now()
    let frame = 0

    const step = (now: number) => {
      frame = requestAnimationFrame(step)
      const dt = Math.min(MAX_DT_MS, Math.max(0, now - last))
      last = now
      const current = toneRef.current
      const nowDark = isDark()
      if (current !== shown || nowDark !== dark) {
        // 从现在显示的颜色渐变过去（上一次渐变没走完也接得上）；换深浅主题也一样
        from = from.map((c, i) => mixRgb(c, to[i]!, fade))
        to = rgbOf(current, nowDark)
        fade = 0
        shown = current
        dark = nowDark
        dirty = true
      }
      const still = reduce?.matches === true
      const fading = fade < 1
      fade = still ? 1 : Math.min(1, fade + dt / COLOR_FADE_MS)
      const previous = level
      if (still) {
        level = IDLE_LEVEL[current]
      } else {
        const target = targetLevel(current, currentCall()?.levels() ?? { mic: 0, out: 0 })
        level = smooth(level, target, dt)
        time += (dt / 1000) * (0.25 + level * 0.9) * (current === 'think' ? 1.6 : 1)
      }
      avatarRef.current?.style.setProperty('--vr-level', level.toFixed(3))
      // 平线、静止时不用每帧重画
      const moving = !still && level > 0.002
      if (!dirty && !fading && !moving && Math.abs(level - previous) < 0.001) return
      dirty = false
      const colors = from.map((c, i) => mixRgb(c, to[i]!, fade))
      draw(ctx, width, height, dpr, level, time, colors)
    }
    frame = requestAnimationFrame(step)
    return () => {
      cancelAnimationFrame(frame)
      observer?.disconnect()
    }
  }, [])

  return { canvasRef, avatarRef, tone }
}
