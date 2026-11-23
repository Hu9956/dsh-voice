/**
 * 按住说话胶囊样式（统一原版待办栏毛玻璃 + @kewen/dsh-ui 胶囊按钮）。
 * 官方元素的 class 带哈希，这里只按片段（_primary、_triggerAnchor、_activity）匹配；
 * DSH 改了输入栏结构时这几条可能失效，需要跟着改。
 */
export const css = `
/* 去掉官方语音输入的麦克风按钮（它所在的那一格一起收掉，不留空隙） */
[data-composer-card] [class*="_activity"]:has([class*="_triggerAnchor"]) { display: none !important; }

.vh-anchor { position: absolute; inset: 0 0 auto; height: 0; }

.vh-ph-mic {
  display: inline-block;
  width: 1em; height: 1em;
  margin: 0 2px 0 -1px;
  vertical-align: -0.15em;
}
[data-vh-ph="phone"] .vh-ph-mic {
  margin-left: -2px;
}

.vh-status {
  box-sizing: border-box;
  position: absolute; left: 50%; bottom: 8px; transform: translateX(-50%);
  isolation: isolate;
  display: flex; align-items: center; gap: 8px; max-width: calc(100% - 24px);
  min-height: var(--dsh-control-md, 36px);
  padding: 4px 14px;
  border-radius: 999px;
  corner-shape: round;
  white-space: nowrap;
  font-size: var(--dsh-text-md, 13px); line-height: 20px;
  color: var(--dsw-alias-label-primary);
  background: transparent;
  -webkit-backdrop-filter: none;
  backdrop-filter: none;
  box-shadow: var(--dsh-glass-outer, var(--dsh-glass-shadow));
  transition: bottom var(--dsh-dur-hover, 120ms) ease;
  pointer-events: none; z-index: 5;
}
.vh-status::before {
  content: ''; position: absolute; inset: 0; z-index: -1; pointer-events: none;
  border-radius: inherit;
  corner-shape: round;
  background: var(--dsh-capsule-surface-fill, var(--dsw-menu-surface-fill));
  -webkit-backdrop-filter: var(--dsh-capsule-backdrop-filter, blur(8px) saturate(1.3));
  backdrop-filter: var(--dsh-capsule-backdrop-filter, blur(8px) saturate(1.3));
  box-shadow: var(--dsh-glass-inset, none);
}
[data-composer-seat] [class*="_root"]:has(.vh-status) {
  z-index: 6 !important;
}
[data-composer-seat]:has([data-goal-bar]) .vh-status {
  bottom: 44px;
}
[data-composer-seat]:has([data-testid="todo-panel"]) .vh-status {
  bottom: 46px;
}
[data-composer-seat]:has([data-goal-bar]):has([data-testid="todo-panel"]) .vh-status {
  bottom: 82px;
}
.vh-msg-text { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.vh-recording { color: var(--dsw-alias-state-business-primary); }
.vh-recording[data-ending] .vh-hint {
  color: var(--dsh-state-warn-text, var(--dsw-alias-state-warn-primary));
  font-variant-numeric: tabular-nums;
}
.vh-pending {
  pointer-events: auto;
  gap: 6px;
  padding: 4px 4px 4px 14px;
  max-width: min(520px, calc(100% - 24px));
}
.vh-pending-text { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.vh-action { flex: none; }
.vh-recording[data-armed] { color: var(--dsw-alias-state-error-primary); }
.vh-hint { color: var(--dsw-alias-label-secondary); font-size: var(--dsh-text-sm, 12px); }
.vh-wave {
  display: block;
  width: 72px; height: 20px; flex: none;
  backface-visibility: hidden;
}
.vh-rec {
  width: 8px; height: 8px; border-radius: 50%; corner-shape: round;
  background: var(--dsw-alias-state-error-primary); flex: none;
}
.vh-dot {
  width: 8px; height: 8px; border-radius: 50%; corner-shape: round;
  background: var(--dsw-alias-state-business-primary); flex: none;
}

/* 手机：键盘没弹出时，输入框上的长按归我们（不弹系统选字菜单、放大镜） */
[data-composer-card][data-vh-touch]:not(:focus-within) [data-input-scroll] {
  -webkit-touch-callout: none; -webkit-user-select: none; user-select: none; -webkit-tap-highlight-color: transparent;
}
[data-composer-card][data-vh-touch]:not(:focus-within) [data-input-scroll] * { -webkit-user-select: none; user-select: none; }

/* 录音中：输入框描一圈主题色 */
[data-composer-card][data-vh-holding] {
  box-shadow: 0 0 0 1.5px var(--dsw-alias-state-business-primary), var(--dsw-elevation-soft, none);
}
@media (prefers-reduced-transparency: reduce), (prefers-contrast: more) {
  .vh-status {
    box-shadow: 0 0 0 1px var(--dsw-alias-border-l4), var(--dsw-elevation-prominent);
  }
  .vh-status::before {
    background: var(--dsh-surface-floating, var(--dsw-alias-bg-layer-2));
    -webkit-backdrop-filter: none;
    backdrop-filter: none;
    box-shadow: none;
  }
}
html[data-dsh-reduce-trans] .vh-status {
  box-shadow: 0 0 0 1px var(--dsw-alias-border-l4), var(--dsw-elevation-prominent);
}
html[data-dsh-reduce-trans] .vh-status::before {
  background: var(--dsh-surface-floating, var(--dsw-alias-bg-layer-2));
  -webkit-backdrop-filter: none;
  backdrop-filter: none;
  box-shadow: none;
}
`
