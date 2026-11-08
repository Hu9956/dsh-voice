/** 两个按钮的样式：输入框左侧的「语音模式」开关，回复下方的喇叭。颜色跟 DSH 的主题变量走。 */
export const css = `
.vr-toggle, .vr-speak {
  position: relative;
  display: inline-flex; align-items: center; justify-content: center;
  width: 28px; height: 28px; padding: 0; flex: none;
  border: none; border-radius: 8px; cursor: pointer;
  color: var(--dsw-alias-label-secondary, #a1a1aa);
  background: transparent;
  transition: background-color .12s ease, color .12s ease;
}
.vr-toggle:hover, .vr-speak:hover {
  color: var(--dsw-alias-label-primary, #f9fafb);
  background: color-mix(in srgb, currentColor 10%, transparent);
}
.vr-toggle:focus-visible, .vr-speak:focus-visible {
  outline: 2px solid var(--dsw-alias-state-business-primary, #4c8dff);
  outline-offset: 1px;
}
.vr-toggle[data-on] { color: var(--dsw-alias-state-business-primary, #4c8dff); }
.vr-toggle[data-speaking], .vr-speak[data-speaking] { color: var(--dsw-alias-state-business-primary, #4c8dff); }
.vr-toggle[data-speaking]::after, .vr-speak[data-speaking]::after {
  content: ''; position: absolute; inset: 3px; border-radius: 7px;
  border: 1.5px solid currentColor; opacity: .5;
  animation: vr-pulse 1s ease-in-out infinite alternate;
}
.vr-toggle[data-error]::before {
  content: ''; position: absolute; top: 4px; right: 4px; width: 6px; height: 6px; border-radius: 50%;
  background: var(--dsw-alias-state-danger, #f2555a);
}
/* 面板模式下临时冒出的按钮：和输入框里「+」、权限按钮一样的圆形灰底 */
.vr-toggle[data-transient] {
  width: 28px; height: 28px; border-radius: 50%; corner-shape: round;
  background: color-mix(in srgb, var(--dsw-alias-label-primary, #f9fafb) 6%, transparent);
}
.vr-toggle[data-transient]:hover { background: color-mix(in srgb, var(--dsw-alias-label-primary, #f9fafb) 10%, transparent); }
.vr-toggle[data-transient][data-speaking]::after { inset: 2px; border-radius: 50%; corner-shape: round; }
.vr-toggle[data-transient][data-blocked] { width: auto; padding: 0 10px 0 8px; gap: 4px; border-radius: 14px; }
@keyframes vr-pulse { from { opacity: .2 } to { opacity: .7 } }
@media (prefers-reduced-motion: reduce) {
  .vr-toggle[data-speaking]::after, .vr-speak[data-speaking]::after { animation: none; }
}
`
