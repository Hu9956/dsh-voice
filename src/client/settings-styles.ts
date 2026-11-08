/**
 * 「轻点开启声音」提示，和「插件」页本插件详情里的「朗读设置」分区。
 * 设置分区的版式对齐官方详情分区（14px/500 标题、12px 间距），颜色只用官方的 --dsw-* 变量。
 */
export const settingsCss = `
.vr-toggle[data-blocked] {
  display: inline-flex; align-items: center; gap: 4px; width: auto; padding: 0 10px 0 6px;
  border-radius: 999px;
  color: var(--dsw-alias-state-business-primary, #4c8dff);
  background: var(--dsw-alias-interactive-bg-hover, rgba(76, 141, 255, .12));
  animation: vr-blocked-pulse 1.2s ease-in-out infinite alternate;
}
.vr-toggle-label { font-size: 12px; line-height: 16px; white-space: nowrap; }
@keyframes vr-blocked-pulse { from { opacity: .6 } to { opacity: 1 } }
@media (prefers-reduced-motion: reduce) { .vr-toggle[data-blocked] { animation: none; } }

.vr-settings { display: flex; flex-direction: column; gap: 20px; }
.vr-set-section { display: flex; flex-direction: column; gap: 8px; min-width: 0; }
.vr-settings-title { margin: 0; font-size: 14px; font-weight: 500; line-height: 20px; color: var(--dsw-alias-label-primary); }
.vr-set-card {
  display: flex; flex-direction: column; min-width: 0; margin: 0; padding: 0 16px;
  border: 1px solid var(--dsw-alias-border-l2, rgba(128, 128, 128, .3)); border-radius: 12px;
}
.vr-set-card[data-disabled] { opacity: .5; }
.vr-set-card > .vr-settings-note { padding: 8px 0; }
.vr-row { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 12px 0; }
.vr-row + .vr-row, .vr-set-fold > .vr-row:first-of-type { border-top: 1px solid var(--dsw-alias-border-l2, rgba(128, 128, 128, .3)); }
.vr-row-text { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.vr-row-head { display: flex; align-items: center; gap: 8px; }
.vr-row-label { font-size: 13px; line-height: 20px; color: var(--dsw-alias-label-primary); }
.vr-row-hint, .vr-row-help { margin: 0; font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-secondary, #a1a1aa); }
.vr-row-help { padding-top: 2px; }
.vr-row-more {
  margin-left: 6px; padding: 0; border: none; background: none; cursor: pointer;
  font: inherit; color: var(--dsw-alias-state-business-primary, #4c8dff);
}
.vr-row-control { flex: 0 1 auto; display: flex; align-items: center; justify-content: flex-end; gap: 8px; min-width: 0; max-width: 60%; }
.vr-row[data-stack] { flex-direction: column; align-items: stretch; gap: 8px; }
.vr-row[data-stack] .vr-row-control { max-width: none; justify-content: flex-start; }
.vr-badge {
  flex: none; padding: 0 6px; border-radius: 999px; font-size: 11px; line-height: 16px;
  color: var(--dsw-alias-label-secondary, #a1a1aa);
  border: 1px solid var(--dsw-alias-border-l2, rgba(128, 128, 128, .3));
}
.vr-badge[data-kind="cloud"] { color: var(--dsw-alias-state-warning, #e0a030); border-color: currentColor; }
.vr-set-fold { border-top: 1px solid var(--dsw-alias-border-l2, rgba(128, 128, 128, .3)); }
.vr-set-fold-summary {
  padding: 12px 0; cursor: pointer; font-size: 13px; line-height: 20px; color: var(--dsw-alias-label-secondary, #a1a1aa);
}
.vr-set-fold[open] > .vr-set-fold-summary { color: var(--dsw-alias-label-primary); }
.vr-set-fold-summary:focus-visible, .vr-row-more:focus-visible, .vr-switch:focus-visible {
  outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary, #4c8dff));
  outline-offset: 2px; border-radius: 4px;
}
.vr-switch {
  appearance: none; -webkit-appearance: none; flex: none; position: relative; margin: 0; cursor: pointer;
  width: 36px; height: 20px; border-radius: 999px;
  background: var(--dsw-alias-border-l2, rgba(128, 128, 128, .45));
  transition: background .15s;
}
.vr-switch::after {
  content: ''; position: absolute; top: 2px; left: 2px; width: 16px; height: 16px; border-radius: 50%;
  background: #fff; transition: transform .15s;
}
.vr-switch:checked { background: var(--dsw-alias-state-business-primary, #4c8dff); }
.vr-switch:checked::after { transform: translateX(16px); }
.vr-switch:disabled { cursor: not-allowed; }
.vr-set-card:disabled, .vr-set-card:disabled * { cursor: not-allowed; }
@media (prefers-reduced-motion: reduce) { .vr-switch, .vr-switch::after { transition: none; } }
.vr-key-form { display: flex; flex-direction: column; gap: 6px; width: 100%; min-width: 0; }
.vr-key-controls { display: flex; align-items: center; gap: 8px; min-width: 0; }
.vr-settings-select, .vr-settings-input {
  flex: 0 1 280px; min-width: 0; height: 32px; padding: 0 8px; border-radius: 8px;
  font: inherit; font-size: 13px;
  color: var(--dsw-alias-label-primary);
  background: var(--dsw-alias-bg-elevated, transparent);
  border: 1px solid var(--dsw-alias-border-l2, rgba(128, 128, 128, .3));
}
.vr-settings-value { font-size: 13px; line-height: 20px; color: var(--dsw-alias-label-primary); }
.vr-settings-button {
  flex: none; height: 32px; padding: 0 14px; border: none; border-radius: 8px; cursor: pointer;
  font: inherit; font-size: 13px; color: #fff;
  background: var(--dsw-alias-button-info-fill, #4c8dff);
}
.vr-settings-select:focus-visible, .vr-settings-input:focus-visible, .vr-settings-button:focus-visible {
  outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary, #4c8dff));
  outline-offset: 2px;
}
.vr-settings-note { margin: 0; font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-secondary, #a1a1aa); }
.vr-settings-error { color: var(--dsw-alias-state-danger, #f2555a); }
.vr-settings-ok { color: var(--dsw-alias-state-business-primary, #4c8dff); }
.vr-meter { display: flex; flex-direction: column; gap: 6px; flex: 1; min-width: 0; }
.vr-meter .vr-settings-value[data-speaking] { color: var(--dsw-alias-state-business-primary, #4c8dff); }
.vr-meter-bar {
  position: relative; height: 8px; max-width: 380px; border-radius: 999px; overflow: hidden;
  background: var(--dsw-alias-border-l2, rgba(128, 128, 128, .3));
}
.vr-meter-fill {
  position: absolute; inset: 0 auto 0 0; border-radius: inherit;
  background: var(--dsw-alias-label-secondary, #a1a1aa);
  transition: width .12s linear;
}
.vr-meter-fill[data-speaking] { background: var(--dsw-alias-state-business-primary, #4c8dff); }
.vr-meter-mark { position: absolute; top: 0; bottom: 0; width: 2px; margin-left: -1px; }
.vr-meter-mark[data-kind="floor"] { background: var(--dsw-alias-label-primary, #e4e4e7); opacity: .5; }
.vr-meter-mark[data-kind="threshold"] { background: var(--dsw-alias-state-danger, #f2555a); }
@media (prefers-reduced-motion: reduce) { .vr-meter-fill { transition: none; } }
@media (max-width: 560px) {
  .vr-row { flex-wrap: wrap; }
  .vr-row-control { max-width: none; flex: 1 1 100%; justify-content: flex-start; }
  .vr-row:has(.vr-switch) .vr-row-control { flex: none; }
  .vr-row:has(.vr-switch) { flex-wrap: nowrap; }
  .vr-settings-select { flex: 1 1 auto; }
}
`
