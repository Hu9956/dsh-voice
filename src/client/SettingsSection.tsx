import {
  Badge as DshBadge,
  Banner,
  Button,
  Input,
  LoadingState,
  PasswordInput,
  Select,
  Slider,
  type SelectOption,
} from '@kewen/dsh-ui'
import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from 'react'
import { NoiseMeter } from './NoiseMeter'
import { Card, Fold, Row, Switch } from './SettingsParts'
import { HoldSettings } from './HoldSettings'
import { speaker } from './speaker'
import {
  changeSpeechRate,
  formatRate,
  loadSettings,
  saveApiKey,
  saveSettings,
  useSettings,
  type ModelOption,
  type ProviderOption,
  type Settings,
  type VoiceOption,
} from './settings'
import { useSpeakerVersion } from './store'

const PKG = '@kewen/dsh-voice'
const PREVIEW_TAG = 'settings-preview'
/** 试听用的默认话：中英混合，听得出 useEffect、WebSocket 这类词念得怎么样。 */
const PREVIEW_TEXT = '你好，我是你的语音助手。这个方案整体可行，我建议先把 useEffect 里的请求挪到服务端，再用 WebSocket 推送结果。'

const SENSITIVITY_OPTIONS: readonly SelectOption<string>[] = [
  { value: 'lowest', label: '很低', description: '风扇、空调声大' },
  { value: 'low', label: '低' },
  { value: 'medium', label: '中' },
  { value: 'high', label: '高' },
]

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
  return (
    <div className="vr-settings">
      <Card title="语音输入">
        <HoldSettings />
      </Card>
      <SettingsPanel />
    </div>
  )
}

function SettingsPanel() {
  const { view, error } = useSettings()
  useSpeakerVersion()
  const id = useId()
  /** 刚选、还没保存完的值：先显示出来，保存失败再退回。 */
  const [draft, setDraft] = useState<Partial<Settings>>({})
  const [previewText, setPreviewText] = useState('')
  const [status, setStatus] = useState<{ kind: 'saved' | 'error', text: string } | null>(null)

  useEffect(() => {
    void loadSettings(true)
  }, [])

  const providers = view?.catalog.providers ?? []
  const models = view?.catalog.models ?? []
  const currentModelId = draft.model ?? view?.settings.model ?? ''
  const activeModel: ModelOption | undefined = models.find((m) => m.id === currentModelId) ?? models[0]
  const activeProviderId = activeModel?.provider ?? providers[0]?.id
  const activeProvider: ProviderOption | undefined = providers.find((p) => p.id === activeProviderId) ?? providers[0]
  const providerModels = useMemo(() => {
    if (!activeProviderId) return models
    const scoped = models.filter((m) => m.provider === activeProviderId)
    return scoped.length > 0 ? scoped : models
  }, [models, activeProviderId])
  const providerSelectOptions = useMemo<SelectOption<string>[]>(
    () => providers.map((p) => ({
      value: p.id,
      label: `${p.label}${p.ready ? '（已配 Key）' : ''}`,
      description: p.description,
    })),
    [providers],
  )
  const voiceSelectOptions = useMemo(() => toVoiceOptions(activeModel?.voices ?? []), [activeModel])
  const modelSelectOptions = useMemo<SelectOption<string>[]>(
    () => providerModels.map((m) => ({ value: m.id, label: m.label, description: m.price })),
    [providerModels],
  )
  const turnLimitOptions = useMemo<SelectOption<string>[]>(
    () => (view?.catalog.turnLimits ?? []).map((n) => ({ value: String(n), label: n === 0 ? '不限' : `${n} 字` })),
    [view?.catalog.turnLimits],
  )

  if (view === null) {
    return (
      <Card title="朗读与通话">
        {error === null
          ? <LoadingState title="正在读取设置…" className="vr-card-loading" />
          : (
              <div className="vr-card-banner">
                <Banner
                  tone="error"
                  action={<Button variant="outline" size="sm" onClick={() => void loadSettings(true)}>重试</Button>}
                >
                  读不到设置：{error}
                </Banner>
              </div>
            )}
      </Card>
    )
  }

  const current: Settings = { ...view.settings, ...draft }
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

  const onProvider = (nextProviderId: string) => {
    const target = models.find((m) => m.provider === nextProviderId)
    if (target !== undefined) onModel(target.id)
  }

  const onPreview = (overrideText?: string) => {
    speaker.unlock()
    speaker.clearError()
    if (previewing && overrideText === undefined) {
      speaker.stopAll()
      return
    }
    speaker.stopAll()
    const raw = (overrideText ?? previewText).trim()
    const u = speaker.start(PREVIEW_TAG, { voice: current.voice, model: current.model })
    u.append(raw === '' ? PREVIEW_TEXT : raw)
    u.finish()
  }

  const on = current.replyEnabled !== false
  const s = view.settings
  const rates = view.catalog.speechRates ?? []
  const silences = view.catalog.callSilences ?? []
  const hasCallEntries = silences.length > 0 || typeof s.callSensitivity === 'string' || typeof s.callCloudAsr === 'boolean' || typeof s.callBargeIn === 'boolean' || typeof s.callSmartTurn === 'boolean' || typeof s.callKeepOnLock === 'boolean'
  const hasListening = typeof s.callSensitivity === 'string' || (typeof s.callVoiceModel === 'boolean' && typeof view.vadVersion === 'string')

  return (
    <>
      <Card title={providers.length > 0 ? '语音服务' : '百炼 API Key'}>
        {providers.length > 1
          ? (
              <Row
                label="服务商"
                htmlFor={`${id}-provider`}
                hint="没有阿里云账号可直接选 DeepSeek；经常用选阿里百炼更省钱、音色也多。"
              >
                <Select
                  id={`${id}-provider`}
                  ariaLabel="服务商"
                  value={activeProvider?.id ?? ''}
                  options={providerSelectOptions}
                  onChange={onProvider}
                  className="vr-select-wide"
                />
              </Row>
            )
          : null}
        <ApiKeyForm
          key={activeProvider?.id ?? 'default'}
          provider={activeProvider}
          hasProviders={providers.length > 0}
          fallbackReady={view.ready}
        />
      </Card>
      <Card title="朗读与通话">
        <Row label="启用朗读与通话" htmlFor={`${id}-reply-enabled`} hint="关闭后停止朗读并挂断通话，按住说话不受影响。">
          <Switch
            id={`${id}-reply-enabled`}
            label="启用朗读与通话"
            checked={on}
            onChange={(next) => void save({ replyEnabled: next })}
          />
        </Row>
        {!view.ready && view.error !== null
          ? (
              <div className="vr-card-banner">
                <Banner tone="warn">{view.error}</Banner>
              </div>
            )
          : null}
      </Card>

      <Card title="朗读" disabled={!on}>
        <Row label="音色" htmlFor={`${id}-voice`}>
          <Select
            id={`${id}-voice`}
            ariaLabel="音色"
            disabled={!on}
            value={current.voice}
            options={voiceSelectOptions}
            onChange={(next) => void save({ voice: next })}
            className="vr-select-wide"
          />
          <Button
            variant={previewing ? 'outline' : 'toolbar'}
            size="md"
            disabled={!on}
            onClick={() => onPreview()}
          >
            {previewing ? '停止' : '试听'}
          </Button>
        </Row>

        <Row
          label="试听内容"
          htmlFor={`${id}-preview-text`}
          hint="留空则使用默认中英混排示例句，输入自定义文本按回车可直接试听。"
        >
          <Input
            id={`${id}-preview-text`}
            disabled={!on}
            value={previewText}
            placeholder={PREVIEW_TEXT}
            onChange={(event) => setPreviewText(event.target.value)}
            onEnter={(val) => onPreview(val)}
            className="vr-preview-input"
          />
        </Row>

        <Row label="模型" htmlFor={providerModels.length > 1 ? `${id}-model` : undefined}>
          {providerModels.length > 1
            ? (
                <Select
                  id={`${id}-model`}
                  ariaLabel="模型"
                  disabled={!on}
                  value={current.model}
                  options={modelSelectOptions}
                  onChange={onModel}
                  className="vr-select-mid"
                />
              )
            : (
                <DshBadge variant="subtle">
                  {activeModel === undefined ? current.model : `${activeModel.label}（${activeModel.price}）`}
                </DshBadge>
              )}
        </Row>

        {rates.length > 0 && typeof s.speechRate === 'number'
          ? (
              <Row
                label="语速"
                htmlFor={`${id}-rate`}
                hint="从下一段起生效，音调不变。"
                help="百炼由服务端直接合成快语速，DeepSeek 在浏览器端变速不变调；正在念的那一段不会变，通话胶囊上也有按钮能直接切。"
              >
                <Slider
                  id={`${id}-rate`}
                  aria-label="语速"
                  disabled={!on}
                  min={0}
                  max={Math.max(0, rates.length - 1)}
                  step={1}
                  value={Math.max(0, rates.indexOf(current.speechRate ?? 1))}
                  formatValue={(idx) => {
                    const r = rates[idx] ?? current.speechRate ?? 1
                    return r === 1 ? '1×（正常）' : formatRate(r)
                  }}
                  onChange={(idx) => {
                    const next = rates[idx]
                    if (next !== undefined && next !== current.speechRate) void save({ speechRate: next })
                  }}
                  wrapperClassName="vr-slider"
                />
              </Row>
            )
          : null}

        <Row label="每轮最多念" htmlFor={`${id}-limit`} hint="念到这么多字就停，提示「后面的内容请看屏幕」。" help="每条回复下面的小喇叭不受这个限制。">
          <Select
            id={`${id}-limit`}
            ariaLabel="每轮最多念"
            disabled={!on}
            value={String(current.turnLimit)}
            options={turnLimitOptions}
            onChange={(val) => void save({ turnLimit: Number(val) })}
            className="vr-select-compact"
          />
        </Row>

        {typeof s.speakWhole === 'boolean'
          ? (
              <Row
                label="整段写完再念"
                htmlFor={`${id}-whole`}
                hint="语调更连贯，但要多等一会儿才开口。关着是边写边念。"
                help="打开后，等它写完一段再整段念，长回复可能要等十几秒。调工具之前说的话照样先念。语音模式和通话都按这个来。"
              >
                <Switch
                  id={`${id}-whole`}
                  label="整段写完再念"
                  checked={current.speakWhole === true}
                  onChange={(next) => void save({ speakWhole: next })}
                />
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
                      label="云端识别"
                      htmlFor={`${id}-cloud-asr`}
                      badge="cloud"
                      hint={activeProviderId === 'deepseek' ? '识别更准，录音会上传到 DeepSeek。出错自动改用本机。' : '识别更准，录音会上传到阿里云百炼。出错自动改用本机。'}
                      help="通话里你说的话用当前所选服务商识别（DeepSeek ASR 或百炼 qwen3-asr-flash，比本机的 SenseVoice 准），共用朗读的同一个 Key，按时长计费。关掉就只用本机识别（官方「语音输入」）。只影响通话，按住说话不变，马上生效。"
                    >
                      <Switch
                        id={`${id}-cloud-asr`}
                        label="云端识别"
                        checked={current.callCloudAsr === true}
                        onChange={(next) => void save({ callCloudAsr: next })}
                      />
                    </Row>
                  )
                : null}

              {silences.length > 0
                ? (
                    <Row label="通话停顿" htmlFor={`${id}-silence`} hint="停顿这么久就当作说完，自动发出去。常被打断就调长。" help="也可以说完直接点「说完了」。">
                      <Slider
                        id={`${id}-silence`}
                        aria-label="通话停顿"
                        disabled={!on}
                        min={0}
                        max={Math.max(0, silences.length - 1)}
                        step={1}
                        value={Math.max(0, silences.indexOf(current.callSilenceMs ?? 1200))}
                        formatValue={(idx) => {
                          const ms = silences[idx] ?? current.callSilenceMs ?? 1200
                          return `${(ms / 1000).toFixed(1)} 秒`
                        }}
                        onChange={(idx) => {
                          const next = silences[idx]
                          if (next !== undefined && next !== current.callSilenceMs) void save({ callSilenceMs: next })
                        }}
                        wrapperClassName="vr-slider"
                      />
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
                      <Switch
                        id={`${id}-smart`}
                        label="听语气断句"
                        checked={current.callSmartTurn === true}
                        onChange={(next) => void save({ callSmartTurn: next })}
                      />
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
                      <Switch
                        id={`${id}-barge`}
                        label="说话打断"
                        checked={current.callBargeIn === true}
                        onChange={(next) => void save({ callBargeIn: next })}
                      />
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
                      <Switch
                        id={`${id}-keep`}
                        label="锁屏后继续"
                        checked={current.callKeepOnLock === true}
                        onChange={(next) => void save({ callKeepOnLock: next })}
                      />
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
                              <Switch
                                id={`${id}-voice-model`}
                                label="只听人声"
                                checked={current.callVoiceModel !== false}
                                onChange={(next) => void save({ callVoiceModel: next })}
                              />
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
                                <Select
                                  id={`${id}-sensitivity`}
                                  ariaLabel="收音灵敏度"
                                  disabled={!on}
                                  value={current.callSensitivity ?? 'medium'}
                                  options={SENSITIVITY_OPTIONS}
                                  onChange={(next) => void save({ callSensitivity: next })}
                                  className="vr-select-mid"
                                />
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
        ? <Banner tone={status.kind === 'error' ? 'error' : 'ok'}>{status.text}</Banner>
        : null}
      {speaker.lastError !== null
        ? <Banner tone="error">朗读出错：{speaker.lastError}</Banner>
        : null}
    </>
  )
}

function ApiKeyForm({ provider, hasProviders, fallbackReady }: { provider?: ProviderOption, hasProviders: boolean, fallbackReady: boolean }) {
  const id = useId()
  const input = useRef<HTMLInputElement>(null)
  const [key, setKey] = useState('')
  const [saving, setSaving] = useState(false)
  const [invalid, setInvalid] = useState(false)
  const [status, setStatus] = useState<{ kind: 'saved' | 'error', text: string } | null>(null)

  const ready = provider?.ready ?? fallbackReady
  const keyLabel = provider?.keyLabel ?? '百炼 API Key'
  const hint = provider?.keyHint ?? '请使用百炼中国（北京）地域的 API Key。输入的 Key 将发送到 DSH 服务端保存。'

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (saving) return
    if (key.trim() === '') {
      setInvalid(true)
      setStatus({ kind: 'error', text: `请输入 ${keyLabel}。` })
      input.current?.focus()
      return
    }
    setSaving(true)
    setStatus(null)
    try {
      await saveApiKey(key, provider?.id)
      setKey('')
      setStatus({ kind: 'saved', text: `${keyLabel} 已保存。` })
    } catch (error) {
      setStatus({ kind: 'error', text: `没保存上：${error instanceof Error ? error.message : String(error)}` })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Row
      label={hasProviders ? keyLabel : 'API Key'}
      htmlFor={`${id}-key`}
      statusBadge={<DshBadge variant={ready ? 'ok' : 'subtle'}>{ready ? '已配置' : '未配置'}</DshBadge>}
      hint={hint}
      stack
    >
      <form className="vr-key-form" onSubmit={(event) => void submit(event)} noValidate>
        <PasswordInput
          ref={input}
          id={`${id}-key`}
          name="apiKey"
          autoComplete="off"
          placeholder={ready ? '输入新 Key 以替换现有密钥' : 'sk-...'}
          value={key}
          disabled={saving}
          invalid={invalid}
          aria-describedby={status ? `${id}-status` : undefined}
          onChange={(event) => {
            setKey(event.target.value)
            setInvalid(false)
            setStatus(null)
          }}
          trailingAction={(
            <Button type="submit" variant="primary" size="md" loading={saving}>
              {ready ? '替换' : '保存'}
            </Button>
          )}
        />
        {status !== null && (
          <Banner id={`${id}-status`} tone={status.kind === 'error' ? 'error' : 'ok'} className="vr-inline-banner">
            {status.text}
          </Banner>
        )}
      </form>
    </Row>
  )
}

/** 音色下拉选项：保留音色名称、性别、分组与精简介绍。 */
function toVoiceOptions(voices: readonly VoiceOption[]): SelectOption<string>[] {
  const hasGroups = new Set(voices.map((v) => v.group ?? '')).size > 1
  return voices.map((v) => {
    const meta = [
      hasGroups && v.group ? v.group : undefined,
      v.gender,
      brief(v.desc ?? ''),
    ].filter((part): part is string => Boolean(part && part.trim() !== '')).join(' · ')
    return {
      value: v.id,
      label: `${v.name}（${v.id}）`,
      description: meta || undefined,
    }
  })
}

/** 下拉里一行放不下长介绍：截短。 */
function brief(text: string): string {
  return text.length > 18 ? `${text.slice(0, 18)}…` : text
}
