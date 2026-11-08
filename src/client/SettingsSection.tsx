import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { NoiseMeter } from './NoiseMeter'
import { Card, Fold, Row, Switch } from './SettingsParts'
import { HoldSettings } from './HoldSettings'
import { speaker } from './speaker'
import { changeSpeechRate, formatRate, loadSettings, saveApiKey, saveSettings, useSettings, type ModelOption, type Settings, type VoiceOption } from './settings'
import { useSpeakerVersion } from './store'

const PKG = '@kewen/dsh-voice'
const PREVIEW_TAG = 'settings-preview'
/** 试听用的话：中英混合，听得出 useEffect、WebSocket 这类词念得怎么样。 */
const PREVIEW_TEXT = '你好，我是你的语音助手。这个方案整体可行，我建议先把 useEffect 里的请求挪到服务端，再用 WebSocket 推送结果。'

/** 官方 plugins.detail.section 的 subject（三种形状）。 */
type Subject =
  | { kind: 'bundle', pkg: { name: string } }
  | { kind: 'row', pkg: { name: string }, row: unknown }
  | { kind: 'item', id: string }

/**
 * 「插件」页里本插件详情的「朗读设置」分区。该 slot 在每个插件的详情页都渲染，
 * 只认本插件的 bundle 页（行配置页 kind: 'row' 也带 pkg，不限定的话会重复出现）。
 */
export function SettingsSection({ subject }: { subject?: Subject }) {
  if (subject?.kind !== 'bundle' || subject.pkg.name !== PKG) return null
  return <div className="vr-settings"><Card title="语音输入"><HoldSettings /></Card><SettingsPanel /></div>
}

function SettingsPanel() {
  const { view, error } = useSettings()
  useSpeakerVersion()
  const id = useId()
  /** 刚选、还没保存完的值：先显示出来，保存失败再退回。 */
  const [draft, setDraft] = useState<Partial<Settings>>({})
  const [status, setStatus] = useState<{ kind: 'saved' | 'error', text: string } | null>(null)

  useEffect(() => {
    void loadSettings(true)
  }, [])

  if (view === null) {
    return (
      <Card title="朗读与通话">
        {error === null
          ? <p className="vr-settings-note">正在读取设置…</p>
          : (
              <div className="vr-settings-control">
                <p className="vr-settings-note vr-settings-error">读不到设置：{error}</p>
                <button type="button" className="vr-settings-button" onClick={() => void loadSettings(true)}>重试</button>
              </div>
            )}
      </Card>
    )
  }

  const current: Settings = { ...view.settings, ...draft }
  const models = view.catalog.models
  const model: ModelOption | undefined = models.find((m) => m.id === current.model) ?? models[0]
  const previewing = speaker.isSpeaking(PREVIEW_TAG)

  const save = async (patch: Partial<Settings>) => {
    setDraft((d) => ({ ...d, ...patch }))
    setStatus(null)
    try {
      if (typeof patch.speechRate === 'number') await changeSpeechRate(patch.speechRate)
      else await saveSettings(patch)
      setDraft((d) => {
        const next = { ...d }
        for (const key of Object.keys(patch) as (keyof Settings)[]) if (next[key] === patch[key]) delete next[key]
        return next
      })
      setStatus({ kind: 'saved', text: '已保存，下一段朗读开始生效。' })
    } catch (e) {
      setDraft({})
      setStatus({ kind: 'error', text: `没保存上：${e instanceof Error ? e.message : String(e)}` })
    }
  }

  const onModel = (next: string) => {
    const target = models.find((m) => m.id === next)
    if (target === undefined) return
    // 换模型时音色要配套：原来的音色新模型没有，就换成新模型的第一个
    const voice = target.voices.some((v) => v.id === current.voice) ? current.voice : target.voices[0]?.id
    void save(voice === undefined ? { model: next } : { model: next, voice })
  }

  const onPreview = () => {
    speaker.unlock()
    speaker.clearError()
    if (previewing) {
      speaker.stopAll()
      return
    }
    speaker.stopAll()
    const u = speaker.start(PREVIEW_TAG, { voice: current.voice, model: current.model })
    u.append(PREVIEW_TEXT)
    u.finish()
  }

  const on = current.replyEnabled !== false
  const s = view.settings
  const hasCallEntries = view.catalog.callSilences !== undefined || typeof s.callSensitivity === 'string' || typeof s.callCloudAsr === 'boolean' || typeof s.callBargeIn === 'boolean' || typeof s.callSmartTurn === 'boolean' || typeof s.callKeepOnLock === 'boolean'
  const hasListening = typeof s.callSensitivity === 'string' || (typeof s.callVoiceModel === 'boolean' && typeof view.vadVersion === 'string')

  return (
    <>
      <Card title="百炼 API Key">
        <ApiKeyForm ready={view.ready} />
      </Card>
      <Card title="朗读与通话">
        <Row label="启用朗读与通话" htmlFor={`${id}-reply-enabled`} hint="关闭后停止朗读并挂断通话，按住说话不受影响。">
          <Switch id={`${id}-reply-enabled`} checked={on} onChange={(next) => void save({ replyEnabled: next })} />
        </Row>
        {!view.ready && view.error !== null ? <p className="vr-settings-note vr-settings-error">{view.error}</p> : null}
      </Card>

      <Card title="朗读" disabled={!on}>
        <Row label="音色" htmlFor={`${id}-voice`}>
          <select id={`${id}-voice`} className="vr-settings-select" value={current.voice} onChange={(e) => void save({ voice: e.target.value })}>
            {voiceOptions(model?.voices ?? [])}
          </select>
          <button type="button" className="vr-settings-button" onClick={onPreview}>{previewing ? '停止' : '试听'}</button>
        </Row>

        <Row label="模型" htmlFor={models.length > 1 ? `${id}-model` : undefined}>
          {models.length > 1
            ? (
                <select id={`${id}-model`} className="vr-settings-select" value={current.model} onChange={(e) => onModel(e.target.value)}>
                  {models.map((m) => <option key={m.id} value={m.id}>{`${m.label}（${m.price}）`}</option>)}
                </select>
              )
            : <span className="vr-settings-value">{model === undefined ? current.model : `${model.label}（${model.price}）`}</span>}
        </Row>

        {view.catalog.speechRates !== undefined && view.catalog.speechRates.length > 0 && typeof s.speechRate === 'number'
          ? (
              <Row label="语速" htmlFor={`${id}-rate`} hint="从下一段起生效，音调不变。" help="由百炼直接合成快的声音，正在念的那一段不会变。通话胶囊上也有按钮能直接切。">
                <select id={`${id}-rate`} className="vr-settings-select" value={String(current.speechRate ?? 1)} onChange={(e) => void save({ speechRate: Number(e.target.value) })}>
                  {view.catalog.speechRates.map((r) => <option key={r} value={String(r)}>{r === 1 ? '1×（正常）' : formatRate(r)}</option>)}
                </select>
              </Row>
            )
          : null}

        <Row label="每轮最多念" htmlFor={`${id}-limit`} hint="念到这么多字就停，提示「后面的内容请看屏幕」。" help="每条回复下面的小喇叭不受这个限制。">
          <select id={`${id}-limit`} className="vr-settings-select" value={String(current.turnLimit)} onChange={(e) => void save({ turnLimit: Number(e.target.value) })}>
            {view.catalog.turnLimits.map((n) => <option key={n} value={String(n)}>{n === 0 ? '不限' : `${n} 字`}</option>)}
          </select>
        </Row>

        {typeof s.speakWhole === 'boolean'
          ? (
              <Row
                label="整段写完再念"
                htmlFor={`${id}-whole`}
                hint="语调更连贯，但要多等一会儿才开口。关着是边写边念。"
                help="打开后，等它写完一段再整段念，长回复可能要等十几秒。调工具之前说的话照样先念。语音模式和通话都按这个来。"
              >
                <Switch id={`${id}-whole`} checked={current.speakWhole === true} onChange={(next) => void save({ speakWhole: next })} />
              </Row>
            )
          : null}
      </Card>

      {hasCallEntries
        ? (
            <Card title="通话" disabled={!on}>
              {typeof s.callCloudAsr === 'boolean'
                ? (
                    <Row
                      label="百炼识别"
                      htmlFor={`${id}-cloud-asr`}
                      badge="cloud"
                      hint="识别更准，录音会上传到阿里云。出错自动改用本机。"
                      help="通话里你说的话用百炼 qwen3-asr-flash 识别（比本机的 SenseVoice 准），用朗读的同一个 Key，按秒计费。关掉就只用本机识别（官方「语音输入」）。只影响通话，按住说话不变，马上生效。"
                    >
                      <Switch id={`${id}-cloud-asr`} checked={current.callCloudAsr === true} onChange={(next) => void save({ callCloudAsr: next })} />
                    </Row>
                  )
                : null}

              {view.catalog.callSilences !== undefined && view.catalog.callSilences.length > 0
                ? (
                    <Row label="通话停顿" htmlFor={`${id}-silence`} hint="停顿这么久就当作说完，自动发出去。常被打断就调长。" help="也可以说完直接点「说完了」。">
                      <select id={`${id}-silence`} className="vr-settings-select" value={String(current.callSilenceMs ?? 1200)} onChange={(e) => void save({ callSilenceMs: Number(e.target.value) })}>
                        {view.catalog.callSilences.map((ms) => <option key={ms} value={String(ms)}>{`${(ms / 1000).toFixed(1)} 秒`}</option>)}
                      </select>
                    </Row>
                  )
                : null}

              {typeof s.callSmartTurn === 'boolean'
                ? (
                    <Row
                      label="听语气断句"
                      htmlFor={`${id}-smart`}
                      badge="local"
                      hint="停顿半秒后判断是说完了还是在想，在想就再等。"
                      help="用本机 smart-turn 模型听语气：像说完了就马上发出去，像还在想就接着等，最多等 3 秒。每次判断约 0.3 秒，不联网、不花钱。"
                    >
                      <Switch id={`${id}-smart`} checked={current.callSmartTurn === true} onChange={(next) => void save({ callSmartTurn: next })} />
                    </Row>
                  )
                : null}

              {typeof s.callBargeIn === 'boolean'
                ? (
                    <Row
                      label="说话打断"
                      htmlFor={`${id}-barge`}
                      hint="戴耳机时打开。外放时别开，麦克风会录到朗读的声音。"
                      help="它在念或在干活时，你直接开口就能打断；说「停」能让它停下，说「进度怎么样」会念一句进度。"
                    >
                      <Switch id={`${id}-barge`} checked={current.callBargeIn === true} onChange={(next) => void save({ callBargeIn: next })} />
                    </Row>
                  )
                : null}

              {typeof s.callKeepOnLock === 'boolean'
                ? (
                    <Row
                      label="锁屏后继续"
                      htmlFor={`${id}-keep`}
                      hint="锁屏或切到别的 App 时通话不暂停。"
                      help="照常收音、发送、朗读。手机系统要是把麦克风或声音停了，通话会自动暂停，回来点一下继续。手机放进口袋时，摩擦声、旁边人说话也可能被识别发出去，用的时候留意。"
                    >
                      <Switch id={`${id}-keep`} checked={current.callKeepOnLock === true} onChange={(next) => void save({ callKeepOnLock: next })} />
                    </Row>
                  )
                : null}

              {hasListening
                ? (
                    <Fold summary="收音设置">
                      {typeof s.callVoiceModel === 'boolean' && typeof view.vadVersion === 'string'
                        ? (
                            <Row
                              label="只听人声"
                              htmlFor={`${id}-voice-model`}
                              badge="local"
                              hint="风扇、空调、键盘声不当成你在说话。下一通电话生效。"
                              help="在本机用 Silero 模型判断是不是人在说话，停下来就能断句。电视、旁人说话仍然会被听进去。第一次通话要下载约 6 MB（之后有缓存），不联网、不花钱。"
                            >
                              <Switch id={`${id}-voice-model`} checked={current.callVoiceModel !== false} onChange={(next) => void save({ callVoiceModel: next })} />
                            </Row>
                          )
                        : null}

                      {typeof s.callSensitivity === 'string'
                        ? (
                            <>
                              <Row
                                label="收音灵敏度"
                                htmlFor={`${id}-sensitivity`}
                                hint="说完了发不出去就调低，常听不到你就调高。"
                                help="声音要比环境底噪响多少才算你在说话。键盘、风扇、旁边有人说话被当成你还在说，就调低；说话轻、常听不到，就调高。「很低」给风扇、空调声很大的环境用，要说得响一点。"
                              >
                                <select id={`${id}-sensitivity`} className="vr-settings-select" value={current.callSensitivity ?? 'medium'} onChange={(e) => void save({ callSensitivity: e.target.value })}>
                                  <option value="lowest">很低（风扇、空调声大）</option>
                                  <option value="low">低</option>
                                  <option value="medium">中</option>
                                  <option value="high">高</option>
                                </select>
                              </Row>
                              <Row label="环境噪声" hint="先安静 3 秒看建议，再说一句看多快变回「安静」。别在通话中测。" stack>
                                <NoiseMeter sensitivity={current.callSensitivity ?? 'medium'} silenceMs={current.callSilenceMs ?? 1200} />
                              </Row>
                            </>
                          )
                        : null}
                    </Fold>
                  )
                : null}
            </Card>
          )
        : null}

      {status !== null
        ? <p className={status.kind === 'error' ? 'vr-settings-note vr-settings-error' : 'vr-settings-note vr-settings-ok'} role="status">{status.text}</p>
        : null}
      {speaker.lastError !== null ? <p className="vr-settings-note vr-settings-error">朗读出错：{speaker.lastError}</p> : null}
    </>
  )
}

function ApiKeyForm({ ready }: { ready: boolean }) {
  const id = useId()
  const input = useRef<HTMLInputElement>(null)
  const [key, setKey] = useState('')
  const [saving, setSaving] = useState(false)
  const [invalid, setInvalid] = useState(false)
  const [status, setStatus] = useState<{ kind: 'saved' | 'error', text: string } | null>(null)

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (saving) return
    if (key.trim() === '') {
      setInvalid(true)
      setStatus({ kind: 'error', text: '请输入百炼 API Key。' })
      input.current?.focus()
      return
    }
    setSaving(true)
    setStatus(null)
    try {
      await saveApiKey(key)
      setKey('')
      setStatus({ kind: 'saved', text: 'API Key 已保存。' })
    } catch (error) {
      setStatus({ kind: 'error', text: `没保存上：${error instanceof Error ? error.message : String(error)}` })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="vr-row" data-stack="">
      <div className="vr-row-text">
        <label className="vr-row-label" htmlFor={`${id}-key`}>API Key（{ready ? '已配置' : '未配置'}）</label>
        <p className="vr-row-hint" id={`${id}-hint`}>请使用百炼中国（北京）地域的 API Key。输入的 Key 将发送到 DSH 服务端保存。</p>
      </div>
      <form className="vr-key-form" onSubmit={(event) => void submit(event)} noValidate>
        <div className="vr-key-controls">
          <input
            ref={input}
            id={`${id}-key`}
            className="vr-settings-input"
            type="password"
            name="apiKey"
            autoComplete="off"
            value={key}
            disabled={saving}
            aria-describedby={`${id}-hint ${id}-status`}
            aria-invalid={invalid || undefined}
            onChange={(event) => { setKey(event.target.value); setInvalid(false); setStatus(null) }}
          />
          <button type="submit" className="vr-settings-button" disabled={saving}>
            {ready ? '替换' : '保存'}{saving ? '中…' : ''}
          </button>
        </div>
        <p id={`${id}-status`} className={status?.kind === 'error' ? 'vr-settings-note vr-settings-error' : 'vr-settings-note vr-settings-ok'} role="status">{status?.text ?? ''}</p>
      </form>
    </div>
  )
}

/** 音色下拉：多于一组（普通话、方言……）时分组显示。 */
function voiceOptions(voices: readonly VoiceOption[]) {
  const option = (v: VoiceOption) => (
    <option key={v.id} value={v.id}>{`${v.name}（${v.id}${v.gender === undefined ? '' : `，${v.gender}`}）· ${brief(v.desc ?? '')}`}</option>
  )
  const groups = new Map<string, VoiceOption[]>()
  for (const v of voices) {
    const key = v.group ?? ''
    const list = groups.get(key)
    if (list === undefined) groups.set(key, [v])
    else list.push(v)
  }
  if (groups.size <= 1) return voices.map(option)
  return [...groups].map(([group, list]) => <optgroup key={group} label={group === '' ? '其他' : group}>{list.map(option)}</optgroup>)
}

/** 下拉里一行放不下长介绍：截短。 */
function brief(text: string): string {
  return text.length > 22 ? `${text.slice(0, 22)}…` : text
}
