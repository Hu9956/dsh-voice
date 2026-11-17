/**
 * 「轻点开启声音」提示与「插件」详情页的「语音设置」分区布局样式。
 * 基础控件（Card / CardRow / Fold / Select / PasswordInput / Input / Slider / Meter / StandaloneSwitch / Button / Badge / Banner）
 * 全部复用 @kewen/dsh-ui 原语，此处仅承载业务编排间距与自适应布局，严格零裸色、100% 悬停守卫与曲率双轨。
 */
export const settingsCss = `
.vr-toggle[data-blocked] {
  display: inline-flex; align-items: center; gap: 4px; width: auto; padding: 0 10px 0 6px;
  border-radius: 999px; corner-shape: round;
  color: var(--dsw-alias-state-business-primary);
  background: var(--dsw-alias-interactive-bg-hover);
}
.vr-toggle-label { font-size: var(--dsh-text-sm, 12px); line-height: 16px; white-space: nowrap; }

.vr-settings { display: flex; flex-direction: column; gap: 20px; }
.vr-set-section { display: flex; flex-direction: column; gap: 8px; min-width: 0; }
.vr-settings-title {
  margin: 0;
  font-size: var(--dsh-text-lg, 14px);
  font-weight: 500;
  line-height: 20px;
  color: var(--dsw-alias-label-primary);
}
.vr-set-fieldset {
  margin: 0; padding: 0; border: none; min-width: 0;
}
.vr-set-fieldset[data-disabled] { opacity: .55; }
.vr-set-fieldset:disabled, .vr-set-fieldset:disabled * { cursor: not-allowed; }

.vr-row-head { display: inline-flex; align-items: center; flex-wrap: wrap; gap: 8px; }
.vr-row-head label { cursor: pointer; }
.vr-row-help {
  margin: 4px 0 0;
  font-size: var(--dsh-text-sm, 12px);
  line-height: 18px;
  color: var(--dsw-alias-label-secondary);
}
.vr-row-more {
  margin-left: 6px; padding: 0; border: none; background: none; cursor: pointer;
  font: inherit; color: var(--dsw-alias-state-business-primary);
  border-radius: var(--dsw-radius-xs, 4px);
  corner-shape: var(--dsh-corner-shape, var(--dsw-corner-shape, round));
}
@media (hover: hover) {
  .vr-row-more:hover { text-decoration: underline; }
}
.vr-row-more:focus-visible {
  outline: 2px solid var(--dsh-focus-ring-color, var(--dsw-alias-state-business-primary));
  outline-offset: 2px;
}

.vr-row-control {
  display: flex; align-items: center; justify-content: flex-end; gap: 8px;
  min-width: 0;
}
.vr-row-stack-body { width: 100%; min-width: 0; padding-top: 2px; }

.vr-select-wide { width: 260px; max-width: 100%; }
.vr-select-mid { width: 210px; max-width: 100%; }
.vr-select-compact { width: 132px; max-width: 100%; }
.vr-preview-input { width: 292px; max-width: 100%; }
.vr-slider { width: 220px; max-width: 100%; }

.vr-key-form { display: flex; flex-direction: column; gap: 8px; width: 100%; min-width: 0; }
.vr-card-banner { padding: 0 14px 12px; }
.vr-card-loading { margin: 8px; }
.vr-inline-banner { margin-top: 2px; }

.vr-settings-control { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; min-width: 0; }
.vr-settings-note {
  margin: 0;
  font-size: var(--dsh-text-sm, 12px);
  line-height: 18px;
  color: var(--dsw-alias-label-secondary);
}
.vr-settings-error { color: var(--dsw-alias-state-error-primary); }
.vr-settings-ok { color: var(--dsw-alias-state-business-primary); }

.vr-meter { display: flex; flex-direction: column; gap: 8px; flex: 1; min-width: 0; max-width: 440px; }
.vr-meter-level { width: 100%; }

@media (max-width: 600px) {
  .vr-row:not(.is-stack):not(:has(.hs-fb-switch)) {
    flex-wrap: wrap;
  }
  .vr-row:not(.is-stack):not(:has(.hs-fb-switch)) > .dsh-card-action {
    width: 100%;
  }
  .vr-row:not(.is-stack):not(:has(.hs-fb-switch)) .vr-row-control {
    width: 100%;
    justify-content: flex-start;
  }
  .vr-select-wide, .vr-select-mid, .vr-preview-input, .vr-slider {
    flex: 1 1 auto;
    width: auto;
  }
}
`
