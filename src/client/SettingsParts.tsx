import { useId, useState, type ReactNode } from 'react'

/** 带标题的设置卡片。 */
export function Card({ title, children, disabled }: { title?: string, children: ReactNode, disabled?: boolean }) {
  return (
    <section className="vr-set-section">
      {title !== undefined ? <h4 className="vr-settings-title">{title}</h4> : null}
      {/* fieldset 的 disabled 会让里面所有控件一起失效 */}
      <fieldset className="vr-set-card" disabled={disabled} data-disabled={disabled === true ? '' : undefined}>
        {children}
      </fieldset>
    </section>
  )
}

/** 卡片里可折叠的一组（调一次就不再动的设置）。 */
export function Fold({ summary, children }: { summary: string, children: ReactNode }) {
  return (
    <details className="vr-set-fold">
      <summary className="vr-set-fold-summary">{summary}</summary>
      {children}
    </details>
  )
}

/** 标题旁的小标签：本机运行 / 云端计费。 */
export function Badge({ kind }: { kind: 'local' | 'cloud' }) {
  return <span className="vr-badge" data-kind={kind}>{kind === 'local' ? '本机' : '云端·计费'}</span>
}

/**
 * 一行设置：左边标题 + 一句话说明（有长说明时带「详情」展开），右边是控件。
 * stack 为真时控件放到下面，占满整行（噪声测试用）。
 */
export function Row({ label, htmlFor, badge, hint, help, stack, children }: {
  label: string
  htmlFor?: string
  badge?: 'local' | 'cloud'
  hint?: string
  help?: string
  stack?: boolean
  children: ReactNode
}) {
  const [open, setOpen] = useState(false)
  const helpId = useId()
  return (
    <div className="vr-row" data-stack={stack === true ? '' : undefined}>
      <div className="vr-row-text">
        <div className="vr-row-head">
          {htmlFor === undefined
            ? <span className="vr-row-label">{label}</span>
            : <label className="vr-row-label" htmlFor={htmlFor}>{label}</label>}
          {badge !== undefined ? <Badge kind={badge} /> : null}
        </div>
        {hint !== undefined
          ? (
              <p className="vr-row-hint">
                {hint}
                {help !== undefined
                  ? (
                      <button type="button" className="vr-row-more" aria-expanded={open} aria-controls={helpId} onClick={() => setOpen(!open)}>
                        {open ? '收起' : '详情'}
                      </button>
                    )
                  : null}
              </p>
            )
          : null}
        {open && help !== undefined ? <p className="vr-row-help" id={helpId}>{help}</p> : null}
      </div>
      <div className="vr-row-control">{children}</div>
    </div>
  )
}

/** 开关：仍是 checkbox（读屏和键盘照旧），外观是 switch。 */
export function Switch({ id, checked, disabled, onChange }: {
  id: string
  checked: boolean
  disabled?: boolean
  onChange: (next: boolean) => void
}) {
  return (
    <input
      id={id}
      type="checkbox"
      role="switch"
      className="vr-switch"
      checked={checked}
      disabled={disabled}
      onChange={(e) => onChange(e.target.checked)}
    />
  )
}
