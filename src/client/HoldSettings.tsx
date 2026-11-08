import { useEffect, useId, useState } from 'react'
import { Row, Switch } from './SettingsParts'
import { loadSettings, saveSettings, useSettings } from './settings'

/** 可嵌入语音插件设置页的按住说话开关。 */
export function HoldSettings() {
  const { view, error } = useSettings()
  const id = useId()
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  useEffect(() => { void loadSettings() }, [])

  const change = async (holdEnabled: boolean) => {
    setSaving(true)
    setSaveError(null)
    try {
      await saveSettings({ holdEnabled })
    } catch (cause) {
      setSaveError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <Row label="按住说话" htmlFor={id} hint="在输入框按住说话，松开后识别并插入草稿。关闭后恢复官方语音输入按钮。">
        <Switch id={id} checked={view?.settings.holdEnabled !== false} disabled={view === null || saving} onChange={(next) => void change(next)} />
      </Row>
      {view === null && error !== null && <p className="vr-settings-note vr-settings-error">读不到设置：{error}</p>}
      {saveError !== null && <p className="vr-settings-note vr-settings-error" role="alert">没保存上：{saveError}</p>}
    </>
  )
}
