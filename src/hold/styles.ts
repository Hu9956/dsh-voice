/**
 * 样式。官方元素的 class 带哈希，这里只按片段（_primary、_triggerAnchor、_activity）匹配；
 * DSH 改了输入栏结构时这几条可能失效，需要跟着改。
 */
export const css = `
/* 去掉官方语音输入的麦克风按钮（它所在的那一格一起收掉，不留空隙） */
[data-composer-card] [class*="_activity"]:has([class*="_triggerAnchor"]) { display: none !important; }

.vh-anchor { position: absolute; inset: 0 0 auto; height: 0; }

.vh-status {
  position: absolute; left: 50%; bottom: 8px; transform: translateX(-50%);
  display: flex; align-items: center; gap: 8px; max-width: calc(100% - 24px);
  padding: 6px 12px; border-radius: 999px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  font-size: 13px; line-height: 20px;
  color: var(--dsw-alias-label-primary, #f9fafb);
  background: var(--dsw-specific-menu, rgba(30, 32, 36, .96));
  box-shadow: var(--dsw-elevation-panel, 0 4px 16px rgba(0,0,0,.3));
  backdrop-filter: var(--dsw-menu-backdrop-filter, none);
  pointer-events: none; z-index: 5;
}
.vh-recording { color: var(--dsw-alias-state-business-primary, #4c8dff); }
.vh-recording[data-ending] .vh-hint { color: var(--dsw-alias-state-warning, #f5a524); }
.vh-pending { pointer-events: auto; gap: 6px; padding: 4px 6px 4px 12px; max-width: min(520px, calc(100% - 24px)); }
.vh-pending-text { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.vh-action {
  flex: none; border: none; cursor: pointer; border-radius: 999px; padding: 2px 10px; font: inherit; font-size: 12px;
  color: #fff; background: var(--dsw-alias-button-info-fill, #4c8dff);
}
.vh-action.vh-quiet { color: var(--dsw-alias-label-secondary, #a1a1aa); background: transparent; }
.vh-recording[data-armed] { color: var(--dsw-alias-state-danger, #f2555a); }
.vh-hint { color: var(--dsw-alias-label-secondary, #a1a1aa); font-size: 12px; }
.vh-wave { width: 72px; height: 20px; flex: none; }
.vh-rec { width: 8px; height: 8px; border-radius: 50%; background: var(--dsw-alias-state-danger, #f2555a); flex: none; animation: vh-pulse 1s ease-in-out infinite alternate; }
.vh-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--dsw-alias-state-business-primary, #4c8dff); flex: none; animation: vh-pulse 1s ease-in-out infinite alternate; }
@keyframes vh-pulse { from { opacity: .35 } to { opacity: 1 } }

/* 手机：键盘没弹出时，输入框上的长按归我们（不弹系统选字菜单、放大镜） */
[data-composer-card][data-vh-touch]:not(:focus-within) [data-input-scroll] {
  -webkit-touch-callout: none; -webkit-user-select: none; user-select: none; -webkit-tap-highlight-color: transparent;
}
[data-composer-card][data-vh-touch]:not(:focus-within) [data-input-scroll] * { -webkit-user-select: none; user-select: none; }

/* 录音中：输入框描一圈主题色 */
[data-composer-card][data-vh-holding] { box-shadow: 0 0 0 1.5px var(--dsw-alias-state-business-primary, #4c8dff), var(--dsw-elevation-soft, none); }
`
