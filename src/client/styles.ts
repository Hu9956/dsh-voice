/** 两个按钮的样式：输入框左侧的「语音模式」开关，回复下方的喇叭。颜色与圆角跟 DSH / @kewen/dsh-ui 令牌走。 */
export const css = `
.vr-toggle, .vr-speak {
  position: relative;
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
  .vr-toggle:hover, .vr-speak:hover {
    color: var(--dsw-alias-label-primary);
    background: var(--dsw-alias-interactive-bg-hover);
  }
  .vr-toggle[data-transient]:hover {
    background: var(--dsh-toolbar-fill-hover);
  }
}
.vr-toggle:focus-visible, .vr-speak:focus-visible {
  outline: 2px solid var(--dsh-focus-ring-color, var(--dsw-alias-state-business-primary));
  outline-offset: 2px;
}
.vr-toggle[data-on] { color: var(--dsw-alias-state-business-primary); }
.vr-toggle[data-speaking], .vr-speak[data-speaking] { color: var(--dsw-alias-state-business-primary); }
.vr-toggle[data-speaking]::after, .vr-speak[data-speaking]::after {
  content: ''; position: absolute; inset: 3px;
  border-radius: 6px;
  corner-shape: var(--dsh-corner-shape, var(--dsw-corner-shape, round));
  border: 1.5px solid currentColor; opacity: .5;
}
.vr-toggle[data-error]::before {
  content: ''; position: absolute; top: 4px; right: 4px; width: 6px; height: 6px;
  border-radius: 50%; corner-shape: round;
  background: var(--dsw-alias-state-error-primary);
}
/* 面板模式下临时冒出的按钮：和输入框里「+」、权限按钮一样的正圆软底 */
.vr-toggle[data-transient] {
  width: 28px; height: 28px; border-radius: 50%; corner-shape: round;
  background: var(--dsh-toolbar-fill);
}
.vr-toggle[data-transient][data-speaking]::after { inset: 2px; border-radius: 50%; corner-shape: round; }
.vr-toggle[data-transient][data-blocked] { width: auto; padding: 0 10px 0 8px; gap: 4px; border-radius: 999px; corner-shape: round; }
`
