/**
 * 语音通话的样式：输入框右侧的电话按钮，通话中出现在输入框上方（可自由拖拽悬浮）的胶囊面板。
 * 统一采用 @kewen/dsh-ui 8px 胶囊/待办共享毛玻璃配方（--dsh-capsule-surface-fill / --dsh-capsule-backdrop-filter / --dsh-glass-shadow）与曲率双轨规则。
 * 头像柔光球和画布声波的颜色来自 meter.ts 的光学声学调色板 PALETTES / LIGHT_PALETTES。
 */
import { LIGHT_PALETTES, PALETTES, type Tone } from './call/meter.ts'

const darkToneVars = (Object.keys(PALETTES) as Tone[]).map((tone) => {
  const [c1, c2, c3] = PALETTES[tone]
  return `.vr-call-panel[data-tone="${tone}"] { --vr-c1: ${c1}; --vr-c2: ${c2}; --vr-c3: ${c3}; } /* dsh-allow-color */`
})
/** 浅色主题（body 上没有 data-ds-dark-theme）单独换的那几个，选择器更具体，盖过上面的。 */
const lightToneVars = (Object.keys(LIGHT_PALETTES) as Tone[]).map((tone) => {
  const [c1, c2, c3] = LIGHT_PALETTES[tone]!
  return `body:not([data-ds-dark-theme]) .vr-call-panel[data-tone="${tone}"] { --vr-c1: ${c1}; --vr-c2: ${c2}; --vr-c3: ${c3}; } /* dsh-allow-color */`
})
const toneVars = [...darkToneVars, ...lightToneVars].join('\n')

const [off1, off2, off3] = PALETTES.off

export const callCss = `
.vr-call-wrap { position: relative; display: inline-flex; flex: none; }
.vr-call {
  display: inline-flex; align-items: center; justify-content: center;
  width: 28px; height: 28px; padding: 0; flex: none;
  border: none;
  border-radius: var(--dsw-radius-sm, 8px);
  corner-shape: var(--dsh-corner-shape, var(--dsw-corner-shape, round));
  cursor: pointer;
  color: var(--dsw-alias-label-secondary);
  background: transparent;
  transition: background-color var(--dsh-dur-hover, 120ms) ease, color var(--dsh-dur-hover, 120ms) ease;
}
@media (hover: hover) {
  .vr-call:hover {
    color: var(--dsw-alias-label-primary);
    background: var(--dsw-alias-interactive-bg-hover);
  }
}
.vr-call:focus-visible {
  outline: 2px solid var(--dsh-focus-ring-color, var(--dsw-alias-state-business-primary));
  outline-offset: 2px;
}
.vr-call[data-active] { color: var(--dsw-alias-state-error-primary); }
.vr-call-notice {
  position: absolute; right: 0; bottom: calc(100% + 8px); z-index: 6;
  isolation: isolate;
  width: max-content; max-width: min(320px, 80vw); padding: 6px 12px;
  border-radius: var(--dsw-radius-md, 10px);
  corner-shape: var(--dsh-corner-shape, var(--dsw-corner-shape, round));
  font-size: var(--dsh-text-sm, 12px); line-height: 18px; white-space: normal;
  color: var(--dsw-alias-label-primary);
  background: transparent;
  -webkit-backdrop-filter: none;
  backdrop-filter: none;
  box-shadow: var(--dsh-glass-outer, var(--dsh-glass-shadow));
  pointer-events: none;
}
.vr-call-notice::before {
  content: ''; position: absolute; inset: 0; z-index: -1; pointer-events: none;
  border-radius: inherit; corner-shape: inherit;
  background: var(--dsh-capsule-surface-fill, var(--dsw-menu-surface-fill));
  -webkit-backdrop-filter: var(--dsh-capsule-backdrop-filter, blur(8px) saturate(1.3));
  backdrop-filter: var(--dsh-capsule-backdrop-filter, blur(8px) saturate(1.3));
  box-shadow: var(--dsh-glass-inset, none);
}

/* 颜色注册成 <color>，换状态时能渐变（不支持的浏览器直接切换） */
@property --vr-c1 { syntax: '<color>'; inherits: true; initial-value: ${off1}; } /* dsh-allow-color */
@property --vr-c2 { syntax: '<color>'; inherits: true; initial-value: ${off2}; } /* dsh-allow-color */
@property --vr-c3 { syntax: '<color>'; inherits: true; initial-value: ${off3}; } /* dsh-allow-color */

.vr-call-anchor { position: absolute; width: 0; height: 0; overflow: hidden; }
/* 发送按钮位置的电话（CallButton.tsx）：占位元素不占布局，被换掉的那个官方发送按钮藏起来 */
.vr-call-send-seat { display: contents; }
[data-composer-card] [data-vr-replaced] { display: none !important; }
/* 发送位置的电话：听筒朝左（左右镜像） */
.vr-call-send svg { transform: scaleX(-1); }
/* 胶囊的位置：插在输入框卡片前面，和卡片一样宽 */
.vr-call-seat {
  position: relative;
  box-sizing: border-box; flex: none;
  width: 100%; max-width: var(--dsh-composer-card-max-width, 100%);
  margin: 0 0 8px;
}
.vr-call-panel {
  --vr-c1: ${off1}; --vr-c2: ${off2}; --vr-c3: ${off3}; /* dsh-allow-color */
  --vr-surface: var(--dsh-capsule-surface-fill, var(--dsw-menu-surface-fill));
  position: relative; isolation: isolate; overflow: visible; box-sizing: border-box;
  display: flex; align-items: center; gap: 8px;
  min-height: 60px; padding: 8px 10px 8px 8px;
  transform: translate3d(var(--vr-drag-x, 0px), var(--vr-drag-y, 0px), 0);
  /* 圆角和圆角形状优先跟随输入框卡片（call-glass.ts），默认对齐宿主面板曲率 */
  border-radius: var(--vr-glass-radius, var(--dsw-radius-panel, 28px));
  corner-shape: var(--vr-glass-corner, var(--dsh-corner-shape, var(--dsw-corner-shape, round)));
  background: transparent;
  color: var(--dsw-alias-label-primary);
  box-shadow:
    var(--vr-glass-outer, var(--dsh-glass-outer, var(--dsh-glass-shadow))),
    0 4px 18px color-mix(in srgb, var(--vr-c2) 14%, transparent);
  transition: --vr-c1 .4s ease, --vr-c2 .4s ease, --vr-c3 .4s ease;
}
/* 自由拖拽悬浮态：统一收敛至原版待办栏毛玻璃与标准浮层阴影，抬高叠层防止被消息流遮挡 */
.vr-call-panel[data-floating] {
  z-index: 30;
  box-shadow:
    var(--dsh-glass-outer, var(--dsh-glass-shadow)),
    0 6px 24px color-mix(in srgb, var(--vr-c2) 18%, transparent);
}
.vr-call-panel[data-dragging] {
  cursor: grabbing;
  user-select: none;
}
.vr-call-panel[data-dragging] .vr-call-main {
  cursor: grabbing;
}
/* 玻璃：和输入框卡片同样两层，兜底使用统一 8px 胶囊毛玻璃配方（--dsh-capsule-surface-fill + --dsh-capsule-backdrop-filter） */
.vr-call-panel::before, .vr-call-panel::after {
  content: ''; position: absolute; inset: 0; z-index: -1; pointer-events: none;
  border-radius: inherit;
  corner-shape: inherit;
}
.vr-call-panel::before {
  background-color: var(--vr-glass-under, transparent);
  background-image: var(--vr-glass-under-image, none);
  -webkit-backdrop-filter: var(--vr-glass-blur, var(--dsh-capsule-backdrop-filter, blur(8px) saturate(1.3)));
  backdrop-filter: var(--vr-glass-blur, var(--dsh-capsule-backdrop-filter, blur(8px) saturate(1.3)));
}
.vr-call-panel::after {
  background-color: var(--vr-glass-face, var(--vr-surface));
  background-image: var(--vr-glass-face-image, none);
  box-shadow: var(--vr-glass-inset, var(--dsh-glass-inset, none));
}
.vr-call-panel[data-floating]::before {
  background-color: transparent;
  background-image: none;
  -webkit-backdrop-filter: var(--dsh-capsule-backdrop-filter, blur(8px) saturate(1.3));
  backdrop-filter: var(--dsh-capsule-backdrop-filter, blur(8px) saturate(1.3));
}
.vr-call-panel[data-floating]::after {
  background-color: var(--dsh-capsule-surface-fill, var(--dsw-menu-surface-fill));
  background-image: none;
  box-shadow: var(--dsh-glass-inset, none);
}
${toneVars}
.vr-call-wave { position: absolute; inset: 0; z-index: 0; width: 100%; height: 100%; pointer-events: none; border-radius: inherit; corner-shape: inherit; backface-visibility: hidden; }
.vr-call-main, .vr-call-actions { position: relative; z-index: 1; }
.vr-call-main {
  display: flex; align-items: center; gap: 12px; flex: 1 1 auto; min-width: 0; height: 44px;
  /* 和胶囊严格同心：外圆角减去内边距 */
  padding: 0 8px 0 0; border: none;
  border-radius: max(12px, calc(var(--vr-glass-radius, var(--dsw-radius-panel, 28px)) - 8px));
  corner-shape: var(--vr-glass-corner, var(--dsh-corner-shape, var(--dsw-corner-shape, round)));
  cursor: grab; text-align: left;
  color: inherit; background: transparent; font: inherit;
}
.vr-call-main:focus-visible {
  outline: 2px solid var(--dsh-focus-ring-color, var(--dsw-alias-state-business-primary));
  outline-offset: -2px;
}

/* 头像：柔和暖色声学光球，永久锁定正圆 corner-shape: round */
.vr-call-avatar {
  --vr-level: 0;
  position: relative; flex: none; width: 40px; height: 40px;
  transform: scale(calc(.94 + var(--vr-level) * .14));
}
.vr-call-avatar::before {
  content: ''; position: absolute; inset: -8px; z-index: -1; pointer-events: none;
  border-radius: 50%; corner-shape: round;
  background: radial-gradient(circle, color-mix(in srgb, var(--vr-c2) 68%, transparent) 0%, color-mix(in srgb, var(--vr-c2) 28%, transparent) 44%, transparent 74%);
  opacity: calc(.12 + var(--vr-level) * .55);
}
.vr-call-avatar-ring {
  position: absolute; inset: 0;
  border-radius: 50%; corner-shape: round;
  background: radial-gradient(circle at 36% 30%, var(--vr-c1), var(--vr-c2) 85%);
}
.vr-call-panel[data-tone="off"] .vr-call-avatar-ring { opacity: .7; }

.vr-call-text { display: flex; flex-direction: column; min-width: 0; }
.vr-call-status { font-size: var(--dsh-text-lg, 14px); line-height: 20px; font-weight: 500; }
.vr-call-sub {
  font-size: var(--dsh-text-sm, 12px); line-height: 18px; color: var(--dsw-alias-label-secondary);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.vr-call-sub[data-notice="warn"] { color: var(--dsh-state-warn-text, var(--dsw-alias-state-warn-primary)); }
.vr-call-actions { display: flex; align-items: center; gap: 6px; flex: none; }
.vr-call-btn[hidden], .hs-btn.vr-call-btn[hidden] { display: none; }
.vr-call-icon, .hs-btn.vr-call-icon {
  width: 36px; min-width: 36px; padding: 0;
  border-radius: 50%; corner-shape: round;
}
.vr-call-icon[data-on] { color: var(--dsh-state-warn-text, var(--dsw-alias-state-warn-primary)); }
/* 语速按钮：和圆按钮等高，数字等宽防止换档抖动 */
.vr-call-rate, .hs-btn.vr-call-rate {
  min-width: 48px; padding: 0 10px;
  font-variant-numeric: tabular-nums; font-weight: 600; font-size: var(--dsh-text-sm, 12px);
}
.vr-call-rate[data-on] { color: var(--dsw-alias-state-business-primary); }
@media (max-width: 480px) {
  .vr-call-panel { min-height: 56px; gap: 6px; padding: 6px 8px 6px 6px; }
  .vr-call-avatar { width: 36px; height: 36px; }
  .vr-call-main { gap: 10px; }
  .vr-call-actions { gap: 4px; }
}
@media (prefers-reduced-transparency: reduce), (prefers-contrast: more) {
  .vr-call-notice {
    box-shadow: 0 0 0 1px var(--dsw-alias-border-l4), var(--dsw-elevation-prominent);
  }
  .vr-call-notice::before {
    background: var(--dsh-surface-floating, var(--dsw-alias-bg-layer-2));
    -webkit-backdrop-filter: none;
    backdrop-filter: none;
    box-shadow: none;
  }
  .vr-call-panel,
  .vr-call-panel[data-floating] {
    box-shadow: 0 0 0 1px var(--dsw-alias-border-l4), var(--dsw-elevation-panel);
  }
  .vr-call-panel::before,
  .vr-call-panel[data-floating]::before {
    -webkit-backdrop-filter: none;
    backdrop-filter: none;
    background: transparent;
  }
  .vr-call-panel::after,
  .vr-call-panel[data-floating]::after {
    background: var(--dsh-surface-floating, var(--dsw-alias-bg-layer-2));
    box-shadow: none;
  }
}
html[data-dsh-reduce-trans] .vr-call-notice {
  box-shadow: 0 0 0 1px var(--dsw-alias-border-l4), var(--dsw-elevation-prominent);
}
html[data-dsh-reduce-trans] .vr-call-notice::before {
  background: var(--dsh-surface-floating, var(--dsw-alias-bg-layer-2));
  -webkit-backdrop-filter: none;
  backdrop-filter: none;
  box-shadow: none;
}
html[data-dsh-reduce-trans] .vr-call-panel,
html[data-dsh-reduce-trans] .vr-call-panel[data-floating] {
  box-shadow: 0 0 0 1px var(--dsw-alias-border-l4), var(--dsw-elevation-panel);
}
html[data-dsh-reduce-trans] .vr-call-panel::before,
html[data-dsh-reduce-trans] .vr-call-panel[data-floating]::before {
  -webkit-backdrop-filter: none;
  backdrop-filter: none;
  background: transparent;
}
html[data-dsh-reduce-trans] .vr-call-panel::after,
html[data-dsh-reduce-trans] .vr-call-panel[data-floating]::after {
  background: var(--dsh-surface-floating, var(--dsw-alias-bg-layer-2));
  box-shadow: none;
}
@media (prefers-reduced-motion: reduce) {
  .vr-call-avatar, .vr-call-avatar-ring { animation: none !important; }
  .vr-call-avatar { transform: none; }
  .vr-call-panel { transition: none; }
}
`
