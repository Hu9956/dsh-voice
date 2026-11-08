/**
 * 语音通话的样式：输入框右侧的电话按钮，通话中出现在输入框上方的胶囊。
 * 颜色跟 DSH 的主题变量走；官方元素只用稳定的 data 属性（data-composer-card）定位。
 * 头像柔光球和波浪的颜色来自 meter.ts 的 PALETTES / LIGHT_PALETTES（画布也用这一份）。
 */
import { LIGHT_PALETTES, PALETTES, type Tone } from './call/meter'

const darkToneVars = (Object.keys(PALETTES) as Tone[]).map((tone) => {
  const [c1, c2, c3] = PALETTES[tone]
  return `.vr-call-panel[data-tone="${tone}"] { --vr-c1: ${c1}; --vr-c2: ${c2}; --vr-c3: ${c3}; }`
})
/** 浅色主题（body 上没有 data-ds-dark-theme）单独换的那几个，选择器更具体，盖过上面的。 */
const lightToneVars = (Object.keys(LIGHT_PALETTES) as Tone[]).map((tone) => {
  const [c1, c2, c3] = LIGHT_PALETTES[tone]!
  return `body:not([data-ds-dark-theme]) .vr-call-panel[data-tone="${tone}"] { --vr-c1: ${c1}; --vr-c2: ${c2}; --vr-c3: ${c3}; }`
})
const toneVars = [...darkToneVars, ...lightToneVars].join('\n')

const [off1, off2, off3] = PALETTES.off

export const callCss = `
.vr-call-wrap { position: relative; display: inline-flex; flex: none; }
.vr-call {
  display: inline-flex; align-items: center; justify-content: center;
  width: 28px; height: 28px; padding: 0; flex: none;
  border: none; border-radius: 8px; cursor: pointer;
  color: var(--dsw-alias-label-secondary, #a1a1aa);
  background: transparent;
  transition: background-color .12s ease, color .12s ease;
}
.vr-call:hover { color: var(--dsw-alias-label-primary, #f9fafb); background: color-mix(in srgb, currentColor 10%, transparent); }
.vr-call:focus-visible { outline: 2px solid var(--dsw-alias-state-business-primary, #4c8dff); outline-offset: 1px; }
.vr-call[data-active] { color: var(--dsw-alias-state-danger, #f2555a); }
.vr-call-notice {
  position: absolute; right: 0; bottom: calc(100% + 8px); z-index: 6;
  width: max-content; max-width: min(320px, 80vw); padding: 6px 10px; border-radius: 8px;
  font-size: 12px; line-height: 18px; white-space: normal;
  color: var(--dsw-alias-label-primary, #f9fafb);
  background: var(--dsw-specific-menu, rgba(30, 32, 36, .96));
  box-shadow: var(--dsw-elevation-panel, 0 4px 16px rgba(0,0,0,.3));
  pointer-events: none;
}

/* 颜色注册成 <color>，换状态时能渐变（不支持的浏览器直接切换） */
@property --vr-c1 { syntax: '<color>'; inherits: true; initial-value: ${off1}; }
@property --vr-c2 { syntax: '<color>'; inherits: true; initial-value: ${off2}; }
@property --vr-c3 { syntax: '<color>'; inherits: true; initial-value: ${off3}; }

.vr-call-anchor { position: absolute; width: 0; height: 0; overflow: hidden; }
/* 发送按钮位置的电话（CallButton.tsx）：占位元素不占布局，被换掉的那个官方发送按钮藏起来 */
.vr-call-send-seat { display: contents; }
[data-composer-card] [data-vr-replaced] { display: none !important; }
/* 发送位置的电话：听筒朝左（左右镜像） */
.vr-call-send svg { transform: scaleX(-1); }
/* 胶囊的位置：插在输入框卡片前面，和卡片一样宽 */
.vr-call-seat {
  box-sizing: border-box; flex: none;
  width: 100%; max-width: var(--dsh-composer-card-max-width, 100%);
  margin: 0 0 8px;
}
.vr-call-panel {
  --vr-c1: ${off1}; --vr-c2: ${off2}; --vr-c3: ${off3};
  --vr-surface: var(--dsw-alias-bg-l1, var(--dsw-specific-menu, #1e2024));
  position: relative; isolation: isolate; overflow: hidden; box-sizing: border-box;
  display: flex; align-items: center; gap: 8px;
  min-height: 60px; padding: 8px 10px 8px 8px;
  /* 圆角和圆角形状照抄输入框卡片（call-glass.ts 写的变量）；默认对齐官方超椭圆 */
  border-radius: var(--vr-glass-radius, 999px);
  corner-shape: var(--vr-glass-corner, var(--dsw-corner-shape, superellipse(1.5)));
  background: transparent;
  color: var(--dsw-alias-label-primary, #f9fafb);
  /* 外投影照抄输入框卡片（call-glass.ts 写的变量），再加一圈很淡的状态色光晕 */
  box-shadow:
    var(--vr-glass-outer, 0 0 #0000),
    0 4px 18px color-mix(in srgb, var(--vr-c2) 14%, transparent);
  transition: --vr-c1 .4s ease, --vr-c2 .4s ease, --vr-c3 .4s ease;
}
/* 玻璃：和输入框卡片同样两层。::before 是磨砂层（卡片 ::before 的底色 + 模糊），::after 是卡片底色 / 渐变和内细边。
   磨砂画在伪元素上，不写在胶囊身上（backdrop-filter 会给后代造包含块，见 harness-plus glass.css.ts 的说明）。
   读不到卡片时（变量都没有）：实色底 + 一圈状态色细边，和以前一样。 */
.vr-call-panel::before, .vr-call-panel::after {
  content: ''; position: absolute; inset: 0; z-index: -1; pointer-events: none;
  border-radius: inherit; corner-shape: var(--vr-glass-corner, var(--dsw-corner-shape, superellipse(1.5)));
}
.vr-call-panel::before {
  background-color: var(--vr-glass-under, transparent);
  background-image: var(--vr-glass-under-image, none);
  -webkit-backdrop-filter: var(--vr-glass-blur, none);
  backdrop-filter: var(--vr-glass-blur, none);
}
.vr-call-panel::after {
  background-color: var(--vr-glass-face, var(--vr-surface));
  background-image: var(--vr-glass-face-image, none);
  box-shadow: var(--vr-glass-inset, inset 0 0 0 1px color-mix(in srgb, var(--vr-c2) 28%, transparent));
}
${toneVars}
.vr-call-wave { position: absolute; inset: 0; z-index: 0; width: 100%; height: 100%; pointer-events: none; }
.vr-call-main, .vr-call-actions { position: relative; z-index: 1; }
.vr-call-main {
  display: flex; align-items: center; gap: 12px; flex: 1 1 auto; min-width: 0; height: 44px;
  /* 和胶囊同心：胶囊圆角减去内边距 */
  padding: 0 8px 0 0; border: none; border-radius: max(12px, calc(var(--vr-glass-radius, 999px) - 8px));
  corner-shape: var(--vr-glass-corner, var(--dsw-corner-shape, superellipse(1.5)));
  cursor: pointer; text-align: left;
  color: inherit; background: transparent; font: inherit;
}
.vr-call-main:focus-visible { outline: 2px solid var(--dsw-alias-state-business-primary, #4c8dff); outline-offset: -2px; }

/* 头像：一团柔和的暖色光球，不转、没有硬边，靠慢慢呼吸和随音量的柔光表达状态。
    DSH 主题给所有元素默认 corner-shape: superellipse（圆角方形），这里要改回真正的圆 */
.vr-call-avatar::before, .vr-call-avatar-ring { corner-shape: round; }
.vr-call-avatar {
  --vr-level: 0;
  position: relative; flex: none; width: 40px; height: 40px;
  transform: scale(calc(.94 + var(--vr-level) * .14));
}
.vr-call-avatar::before {
  content: ''; position: absolute; inset: -4px; z-index: -1; border-radius: 50%;
  background: radial-gradient(circle, var(--vr-c2) 30%, transparent 72%);
  filter: blur(8px);
  opacity: calc(.12 + var(--vr-level) * .55);
}
.vr-call-avatar-ring {
  position: absolute; inset: 0; border-radius: 50%;
  background: radial-gradient(circle at 36% 30%, var(--vr-c1), var(--vr-c2) 85%);
  animation: vr-call-soft 4.5s ease-in-out infinite;
}
.vr-call-panel[data-tone="think"] .vr-call-avatar-ring { animation-duration: 2.2s; }
.vr-call-panel[data-tone="speak"] .vr-call-avatar-ring { animation-duration: 3s; }
.vr-call-panel[data-tone="alert"] .vr-call-avatar { animation: vr-call-breathe .9s ease-in-out infinite alternate; }
.vr-call-panel[data-tone="off"] .vr-call-avatar-ring { animation: none; opacity: .7; }
.vr-call-panel[data-phase="connecting"] .vr-call-avatar { animation: vr-call-breathe 1.2s ease-in-out infinite alternate; }

.vr-call-text { display: flex; flex-direction: column; min-width: 0; }
.vr-call-status { font-size: 14px; line-height: 20px; font-weight: 500; }
.vr-call-sub {
  font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-secondary, #a1a1aa);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.vr-call-sub[data-notice="warn"] { color: var(--dsw-alias-state-warning, #f5a524); }
.vr-call-actions { display: flex; align-items: center; gap: 6px; flex: none; }
.vr-call-btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 4px;
  height: 36px; padding: 0 12px; border: none; border-radius: 18px; cursor: pointer;
  font: inherit; font-size: 13px;
  color: var(--dsw-alias-label-primary, #f9fafb);
  /* 半透明，透出胶囊的玻璃（波浪两头收窄，到按钮这里最多高 4px 左右，不会透上来） */
  background: color-mix(in srgb, var(--dsw-alias-label-primary, #f9fafb) 10%, transparent);
}
/* DSH 主题默认把圆角画成圆角方形：按钮和胶囊要真正的圆 */
.vr-call-btn { corner-shape: round; }
.vr-call-btn[hidden] { display: none; }
.vr-call-btn:focus-visible { outline: 2px solid var(--dsw-alias-state-business-primary, #4c8dff); outline-offset: 1px; }
.vr-call-icon { width: 36px; padding: 0; border-radius: 50%; }
.vr-call-icon[data-on] { color: var(--dsw-alias-state-warning, #f5a524); }
.vr-call-hangup { color: #fff; background: var(--dsw-alias-state-danger, #f2555a); }
/* 语速按钮：和圆按钮一样高，宽度够放「1.25×」，数字等宽免得换档时跳 */
.vr-call-rate { min-width: 48px; padding: 0 8px; font-variant-numeric: tabular-nums; font-weight: 600; font-size: 12px; }
.vr-call-rate[data-on] { color: var(--dsw-alias-state-business-primary, #4c8dff); }
@keyframes vr-call-soft { 0%, 100% { scale: 1 } 50% { scale: 1.07 } }
@keyframes vr-call-breathe { from { opacity: .5 } to { opacity: 1 } }
@media (max-width: 480px) {
  .vr-call-panel { min-height: 56px; gap: 6px; padding: 6px 8px 6px 6px; }
  .vr-call-avatar { width: 36px; height: 36px; }
  .vr-call-main { gap: 10px; }
  .vr-call-actions { gap: 4px; }
}
@media (prefers-reduced-motion: reduce) {
  .vr-call-avatar, .vr-call-avatar-ring { animation: none !important; }
  .vr-call-avatar { transform: none; }
  .vr-call-panel { transition: none; }
}
`
