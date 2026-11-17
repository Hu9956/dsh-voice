import {
  Badge as DshBadge,
  Card as DshCard,
  CardRow,
  Fold as DshFold,
  StandaloneSwitch,
} from '@kewen/dsh-ui'
import { createContext, useContext, useId, useState, type ReactNode } from 'react'

const CardDisabledContext = createContext(false)

export function useCardDisabled(): boolean {
  return useContext(CardDisabledContext)
}

/** 带标题的设置卡片：基于 @kewen/dsh-ui Card，外包原生 fieldset 保证一键禁用态语义。 */
export function Card({ title, children, disabled }: { title?: string, children: ReactNode, disabled?: boolean }) {
  const isDisabled = disabled === true
  return (
    <section className="vr-set-section">
      {title !== undefined ? <h4 className="vr-settings-title">{title}</h4> : null}
      <CardDisabledContext.Provider value={isDisabled}>
        <fieldset className="vr-set-fieldset" disabled={isDisabled} data-disabled={isDisabled ? '' : undefined}>
          <DshCard className="vr-set-card">
            {children}
          </DshCard>
        </fieldset>
      </CardDisabledContext.Provider>
    </section>
  )
}

/** 卡片里可折叠的一组（调一次就不再动的设置）：采用 @kewen/dsh-ui Fold 平滑 0fr → 1fr 展开。 */
export function Fold({ summary, children }: { summary: string, children: ReactNode }) {
  return (
    <DshFold title={summary} className="vr-set-fold">
      {children}
    </DshFold>
  )
}

/** 标题旁的小标签：本机运行 / 云端计费。 */
export function Badge({ kind }: { kind: 'local' | 'cloud' }) {
  return (
    <DshBadge variant={kind === 'local' ? 'subtle' : 'warn'}>
      {kind === 'local' ? '本机' : '云端·计费'}
    </DshBadge>
  )
}

/**
 * 一行设置：基于 @kewen/dsh-ui CardRow，左边标题 + 一句话说明（有长说明时带「详情」展开），右边是控件。
 * stack 为真时控件放到下面，占满整行（API Key 表单与噪声测试用）。
 */
export function Row({ label, htmlFor, badge, hint, help, stack, statusBadge, children }: {
  label: string
  htmlFor?: string
  badge?: 'local' | 'cloud'
  statusBadge?: ReactNode
  hint?: string
  help?: string
  stack?: boolean
  children: ReactNode
}) {
  const [open, setOpen] = useState(false)
  const helpId = useId()
  const titleNode = (
    <span className="vr-row-head">
      {htmlFor === undefined
        ? <span>{label}</span>
        : <label htmlFor={htmlFor}>{label}</label>}
      {badge !== undefined ? <Badge kind={badge} /> : null}
      {statusBadge ?? null}
    </span>
  )
  const descNode = hint !== undefined
    ? (
        <span>
          {hint}
          {help !== undefined
            ? (
                <button
                  type="button"
                  className="vr-row-more"
                  aria-expanded={open}
                  aria-controls={helpId}
                  onClick={() => setOpen(!open)}
                >
                  {open ? '收起' : '详情'}
                </button>
              )
            : null}
        </span>
      )
    : undefined

  if (stack === true) {
    return (
      <CardRow title={titleNode} description={descNode} stack className="vr-row">
        {open && help !== undefined ? <p className="vr-row-help" id={helpId}>{help}</p> : null}
        <div className="vr-row-stack-body">{children}</div>
      </CardRow>
    )
  }

  return (
    <CardRow
      title={titleNode}
      description={descNode}
      action={<div className="vr-row-control">{children}</div>}
      className="vr-row"
    >
      {open && help !== undefined ? <p className="vr-row-help" id={helpId}>{help}</p> : null}
    </CardRow>
  )
}

/** 开关：采用 @kewen/dsh-ui StandaloneSwitch（36×20 正圆弧胶囊 + 反色滑块）。 */
export function Switch({ id, label, checked, disabled, onChange }: {
  id: string
  label?: string
  checked: boolean
  disabled?: boolean
  onChange: (next: boolean) => void
}) {
  const cardDisabled = useCardDisabled()
  return (
    <StandaloneSwitch
      id={id}
      label={label}
      checked={checked}
      disabled={Boolean(disabled || cardDisabled)}
      onChange={onChange}
    />
  )
}
