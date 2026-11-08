/**
 * @kewen/dsh-voice-reply Host 入口：替浏览器连阿里云百炼的实时语音合成（qwen3-tts-flash-realtime）。
 *
 * Key 在设置页提交后存到服务端（~/.config/dsh-voice/dashscope.key），不会回传给浏览器。
 * 一次「朗读」对应一个 utterance，生命周期：
 *   POST /voice-reply/open    { id }          服务端连上百炼并配好音色；可带 voice / model，试听时临时换
 *   GET  /voice-reply/audio?id=               分帧推回音频，直到这段念完
 *   POST /voice-reply/append  { id, text }    追加要念的文字（可多次）
 *   POST /voice-reply/finish  { id }          没有更多文字了，念完剩下的就结束
 *   POST /voice-reply/cancel  { id }          立刻停
 *   GET|POST /voice-reply/settings            读 / 改朗读设置（存在 ~/.config/dsh-voice/voice-reply.json）
 * 音频帧：1 字节类型 + 4 字节长度（大端）+ 数据。类型 1 = PCM（24kHz 单声道 16 位小端），
 * 2 = 错误（JSON），3 = 结束。
 */
import { appendFileSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { CallRegistry, createPreStep } from './call.js'
import { pcm16ToFloat, SmartTurn } from './turn.js'
import { serveVadAsset, VAD_VERSION } from './vad-assets.js'
import { AsrError, cloudTranscribe } from './asr.js'

export const name = 'dsh-voice'

export const BASE_PATH = '/voice-reply'
/** Key 和设置都放这里（不在 DSH 的 profile 里，重装 DSH 不会丢）。 */
export const CONFIG_DIR = join(homedir(), '.config', 'dsh-voice')
/** 百炼 API Key，必需。 */
const KEY_NAME = 'dashscope.key'
/** 朗读设置（音色、模型、每轮上限），可选；插件页里改，会写回这里。 */
const SETTINGS_NAME = 'voice-reply.json'

const DEFAULT_HOST = 'dashscope.aliyuncs.com'
/** host 只能手改设置文件：只收主机名，防止拼进奇怪的 URL。 */
const HOST_PATTERN = /^[A-Za-z0-9.-]+$/
/** 每轮最多念多少字，0 = 不限。 */
const TURN_LIMITS = [300, 500, 800, 1500, 3000, 0]
const DEFAULT_TURN_LIMIT = 800
/** 语音通话：停顿多久算说完（毫秒）。 */
const CALL_SILENCES = [800, 1000, 1200, 1500, 2000, 3000]
const DEFAULT_CALL_SILENCE = 1200
/** 朗读语速（百炼 speech_rate，变速不变调）。一段朗读开始后就改不了，新语速从下一段起生效。 */
const SPEECH_RATES = [1, 1.25, 1.5, 2]
const DEFAULT_SPEECH_RATE = 1

/** 普通话音色：id、名字、简介、性别。 */
const MANDARIN = [
  ['Cherry', '芊悦', '阳光积极、亲切自然小姐姐', '女'],
  ['Serena', '苏瑶', '温柔小姐姐', '女'],
  ['Ethan', '晨煦', '标准普通话，带部分北方口音。阳光、温暖、活力、朝气', '男'],
  ['Chelsie', '千雪', '二次元虚拟女友', '女'],
  ['Momo', '茉兔', '撒娇搞怪，逗你开心', '女'],
  ['Vivian', '十三', '拽拽的、可爱的小暴躁', '女'],
  ['Moon', '月白', '率性帅气的月白', '男'],
  ['Maia', '四月', '知性与温柔的碰撞', '女'],
  ['Kai', '凯', '耳朵的一场SPA', '男'],
  ['Nofish', '不吃鱼', '不会翘舌音的设计师', '男'],
  ['Bella', '萌宝', '喝酒不打醉拳的小萝莉', '女'],
  ['Jennifer', '詹妮弗', '品牌级、电影质感般美语女声', '女'],
  ['Ryan', '甜茶', '节奏拉满，戏感炸裂，真实与张力共舞', '男'],
  ['Katerina', '卡捷琳娜', '御姐音色，韵律回味十足', '女'],
  ['Aiden', '艾登', '精通厨艺的美语大男孩', '男'],
  ['Eldric Sage', '沧明子', '沉稳睿智的老者，沧桑如松却心明如镜', '男'],
  ['Mia', '乖小妹', '温顺如春水，乖巧如初雪', '女'],
  ['Mochi', '沙小弥', '聪明伶俐的小大人，童真未泯却早慧如禅', '男'],
  ['Bellona', '燕铮莺', '声音洪亮，吐字清晰，人物鲜活，听得人热血沸腾；金戈铁马入梦来，字正腔圆间尽显千面人声的江湖', '女'],
  ['Vincent', '田叔', '一口独特的沙哑烟嗓，一开口便道尽了千军万马与江湖豪情', '男'],
  ['Bunny', '萌小姬', '“萌属性”爆棚的小萝莉', '女'],
  ['Neil', '阿闻', '平直的基线语调，字正腔圆的咬字发音，这就是最专业的新闻主持人', '男'],
  ['Elias', '墨讲师', '既保持学科严谨性，又通过叙事技巧将复杂知识转化为可消化的认知模块', '女'],
  ['Arthur', '徐大爷', '被岁月和旱烟浸泡过的质朴嗓音，不疾不徐地摇开了满村的奇闻异事', '男'],
  ['Nini', '邻家妹妹', '糯米糍一样又软又黏的嗓音，那一声声拉长了的“哥哥”，甜得能把人的骨头都叫酥了', '女'],
  ['Seren', '小婉', '温和舒缓的声线，助你更快地进入睡眠，晚安，好梦', '女'],
  ['Pip', '顽屁小孩', '调皮捣蛋却充满童真的他来了，这是你记忆中的小新吗', '男'],
  ['Stella', '少女阿月', '平时是甜到发腻的迷糊少女音，但在喊出“代表月亮消灭你”时，瞬间充满不容置疑的爱与正义', '女'],
  ['Bodega', '博德加', '热情的西班牙大叔', '男'],
  ['Sonrisa', '索尼莎', '热情开朗的拉美大姐', '女'],
  ['Alek', '阿列克', '一开口，是战斗民族的冷，也是毛呢大衣下的暖', '男'],
  ['Dolce', '多尔切', '慵懒的意大利大叔', '男'],
  ['Sohee', '素熙', '温柔开朗，情绪丰富的韩国欧尼', '女'],
  ['Ono Anna', '小野杏', '鬼灵精怪的青梅竹马', '女'],
  ['Lenn', '莱恩', '理性是底色，叛逆藏在细节里——穿西装也听后朋克的德国青年', '男'],
  ['Emilien', '埃米尔安', '浪漫的法国大哥哥', '男'],
  ['Andre', '安德雷', '声音磁性，自然舒服、沉稳男生', '男'],
  ['Radio Gol', '拉迪奥·戈尔', '足球诗人Rádio Gol！今天我要用名字为你们解说足球', '男'],
]
/** 方言音色。 */
const DIALECT = [
  ['Jada', '上海-阿珍', '风风火火的沪上阿姐', '女'],
  ['Dylan', '北京-晓东', '北京胡同里长大的少年', '男'],
  ['Li', '南京-老李', '耐心的瑜伽老师', '男'],
  ['Marcus', '陕西-秦川', '面宽话短，心实声沉——老陕的味道', '男'],
  ['Roy', '闽南-阿杰', '诙谐直爽、市井活泼的台湾哥仔形象', '男'],
  ['Peter', '天津-李彼得', '天津相声，专业捧哏', '男'],
  ['Sunny', '四川-晴儿', '甜到你心里的川妹子', '女'],
  ['Eric', '四川-程川', '一个跳脱市井的四川成都男子', '男'],
  ['Rocky', '粤语-阿强', '幽默风趣的阿强，在线陪聊', '男'],
  ['Kiki', '粤语-阿清', '甜美的港妹闺蜜', '女'],
]

const voicesOf = (rows, group) => rows.map(([id, name, desc, gender]) => ({ id, name, desc, gender, group }))

/**
 * 能选的模型和音色。2026-11-05 在北京地域实测：只有 qwen3-tts-flash-realtime 能走这套实时协议，
 * 文档里的 48 个音色都能用；别的实时模型名一律被服务端用 1007 关掉连接（Model not exist），
 * CosyVoice、Sambert、Qwen-Audio-TTS 是另一套协议（/api-ws/v1/inference），这里不支持。
 */
export const CATALOG = [
  {
    id: 'qwen3-tts-flash-realtime',
    label: '千问3 实时语音合成',
    price: '每万字符 1 元，一个汉字算 2 个字符',
    voices: [...voicesOf(MANDARIN, '普通话'), ...voicesOf(DIALECT, '方言')],
  },
]

const modelOf = (id) => CATALOG.find((m) => m.id === id)

const ID_PATTERN = /^[A-Za-z0-9-]{8,64}$/
/** DSH 会话 id：字母、数字、短横线（有的带 session- 前缀）。 */
const SESSION_PATTERN = /^[A-Za-z0-9-]{8,100}$/
/** 自测录音的文件名：只许字母数字和 .-_，必须是 .wav，防止读到目录外。 */
const CLIP_PATTERN = /^[A-Za-z0-9._-]{1,64}\.wav$/
/** 自测配置文件：存在才启用「用录音代替麦克风」。 */
const CALL_TEST_NAME = 'call-test.json'
const CALL_TEST_DIR = 'call-test'

/** 开发自测时，pre-step 的判断逐行记在这里。 */
const CALL_DEBUG_LOG = 'call-debug.log'

/**
 * 开发自测：读 call-test.json。文件不存在就是没开自测。
 *   clips: ["a.wav", ...]  通话用这些录音代替麦克风（录音放在 ~/.config/dsh-voice/call-test/ 下）
 *   gapMs: 两段录音之间等多久
 *   debug: true            每次 pre-step 的判断记到 call-debug.log
 *   force: ["session-id"]  这些会话不经浏览器也当作在通话（只给自测用的一次性会话）
 * @param {string} dir
 */
export function readCallTest(dir) {
  let raw
  try {
    raw = JSON.parse(readFileSync(join(dir, CALL_TEST_NAME), 'utf8'))
  } catch {
    return { enabled: false, clips: [], gapMs: 1500, debug: false, force: [] }
  }
  const clips = Array.isArray(raw?.clips) ? raw.clips.filter((c) => typeof c === 'string' && CLIP_PATTERN.test(c)) : []
  const gapMs = typeof raw?.gapMs === 'number' && raw.gapMs >= 0 && raw.gapMs <= 60_000 ? raw.gapMs : 1500
  const debug = raw?.debug === true
  const force = Array.isArray(raw?.force) ? raw.force.filter((s) => typeof s === 'string' && SESSION_PATTERN.test(s)) : []
  return { enabled: clips.length > 0, clips, gapMs, debug, force }
}

/**
 * pre-step 每一步都要问一次开发开关：最多每 2 秒读一次文件。
 * @param {string} dir
 */
function cachedDevSwitch(dir) {
  let value = { debug: false, force: [] }
  let readAt = -Infinity
  return () => {
    const now = Date.now()
    if (now - readAt > 2000) {
      readAt = now
      const test = readCallTest(dir)
      value = { debug: test.debug, force: test.force }
    }
    return value
  }
}

/** @param {string} dir */
function debugWriter(dir) {
  return (/** @type {object} */ entry) => {
    appendFileSync(join(dir, CALL_DEBUG_LOG), `${JSON.stringify(entry)}\n`, { mode: 0o600 })
  }
}

/** @param {string} dir @param {string} name */
export function readTestClip(dir, name) {
  if (!CLIP_PATTERN.test(name)) return undefined
  if (!readCallTest(dir).enabled) return undefined
  try {
    return readFileSync(join(dir, CALL_TEST_DIR, name))
  } catch {
    return undefined
  }
}
const BODY_LIMIT = 64 * 1024
/** /turn 收一段最长 8 秒的 16 kHz PCM16（base64 约 341 KB）。 */
const TURN_BODY_LIMIT = 512 * 1024
/** 云端识别：一句最长 30 秒，16 kHz PCM16 约 1 MB，base64 后约 1.3 MB。 */
const ASR_BODY_LIMIT = 3 * 1024 * 1024
/** 一段朗读最多收这么多字，防止前端出错时无限追加。 */
const TEXT_LIMIT = 20000
/** 单次发给百炼的文字上限（分片发）。 */
const APPEND_CHUNK = 1000
/** 这么久没有新文字也没收到 finish，就当前端走了，自动 finish。 */
const IDLE_FINISH_MS = 60_000
/** 一段朗读最长存活时间。 */
const MAX_LIFETIME_MS = 15 * 60_000
/** 同时最多这么多段，超出就停掉最早的。 */
const MAX_UTTERANCES = 8
/** 浏览器还没来取音频时，最多先攒这么多字节。 */
const BUFFER_LIMIT = 20 * 1024 * 1024
/** 念完或出错但浏览器还没来取音频的，保留这么久。 */
const ENDED_GRACE_MS = 30_000

const FRAME_PCM = 1
const FRAME_ERROR = 2
const FRAME_END = 3

/** 把设置文件里的值收拾成能用的：不认识的值退回默认。 */
function normalizePrefs(raw) {
  const source = raw !== null && typeof raw === 'object' ? raw : {}
  const model = modelOf(source.model) ?? CATALOG[0]
  const voice = model.voices.some((v) => v.id === source.voice) ? source.voice : model.voices[0].id
  const turnLimit = TURN_LIMITS.includes(source.turnLimit) ? source.turnLimit : DEFAULT_TURN_LIMIT
  const host = typeof source.host === 'string' && HOST_PATTERN.test(source.host) ? source.host : DEFAULT_HOST
  const callSilenceMs = CALL_SILENCES.includes(source.callSilenceMs) ? source.callSilenceMs : DEFAULT_CALL_SILENCE
  const callBargeIn = source.callBargeIn === true
  const callSmartTurn = source.callSmartTurn === true
  const callKeepOnLock = source.callKeepOnLock === true
  const speakWhole = source.speakWhole === true
  const callSensitivity = CALL_SENSITIVITIES.includes(source.callSensitivity) ? source.callSensitivity : DEFAULT_CALL_SENSITIVITY
  // 只听人声：默认开，手动关掉才是 false
  const callVoiceModel = source.callVoiceModel !== false
  const callCloudAsr = source.callCloudAsr === true
  const speechRate = SPEECH_RATES.includes(source.speechRate) ? source.speechRate : DEFAULT_SPEECH_RATE
  const holdEnabled = source.holdEnabled !== false
  const replyEnabled = source.replyEnabled !== false
  return { host, model: model.id, voice, turnLimit, callSilenceMs, callBargeIn, callSmartTurn, callKeepOnLock, speakWhole, callSensitivity, callVoiceModel, callCloudAsr, speechRate, holdEnabled, replyEnabled }
}

/** 语音通话的收音灵敏度：低（环境吵时用）、中、高（说话轻时用）。门限数值在浏览器端 call/vad.ts。 */
const CALL_SENSITIVITIES = ['lowest', 'low', 'medium', 'high']
const DEFAULT_CALL_SENSITIVITY = 'medium'

/** 读一个 JSON 对象文件；没有、写坏了或不是对象都当空对象。 */
function readJsonFile(file) {
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'))
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

/**
 * 读配置：Key 文件必需；voice-reply.json 可选（音色、模型、每轮上限；host 只能手改）。
 * 没有 Key 时也带上当前设置，设置页照样能打开，只是提示去放 Key。
 * @param {string} [dir]
 */
export function readSettings(dir = CONFIG_DIR) {
  const prefs = normalizePrefs(readJsonFile(join(dir, SETTINGS_NAME)))
  const keyFile = join(dir, KEY_NAME)
  let key
  try {
    key = readFileSync(keyFile, 'utf8').trim()
  } catch {
    return { error: `没有找到百炼 API Key：${keyFile}`, ...prefs }
  }
  if (key === '') return { error: `百炼 API Key 文件是空的：${keyFile}`, ...prefs }
  return { key, ...prefs }
}

class BadSetting extends Error {}

/** 保存百炼 Key，不写入普通设置；原子替换并限制文件权限。 */
export function writeApiKey(dir, value) {
  if (typeof value !== 'string') throw new BadSetting('请输入百炼 API Key')
  const key = value.trim()
  if (key.length === 0 || key.length > 1024 || !/^[\x21-\x7e]+$/.test(key)) {
    throw new BadSetting('API Key 不能为空，也不能包含空格或换行')
  }
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  const file = join(dir, KEY_NAME)
  const temp = `${file}.${randomUUID()}.tmp`
  try {
    writeFileSync(temp, `${key}\n`, { mode: 0o600, flag: 'wx' })
    renameSync(temp, file)
  } catch (error) {
    rmSync(temp, { force: true })
    throw error
  }
}

/**
 * 改设置：只动 model / voice / turnLimit，文件里别的字段（比如手写的 host）原样留着。
 * 先写临时文件再改名，写到一半出错也不会留下半个文件。
 * @param {string} dir
 * @param {Record<string, unknown>} patch
 */
export function writeSettings(dir, patch) {
  const file = join(dir, SETTINGS_NAME)
  const next = { ...readJsonFile(file) }
  if ('model' in patch) {
    if (modelOf(patch.model) === undefined) throw new BadSetting('不认识这个模型')
    next.model = patch.model
  }
  if ('voice' in patch) {
    const model = modelOf(next.model) ?? CATALOG[0]
    if (typeof patch.voice !== 'string' || !model.voices.some((v) => v.id === patch.voice)) throw new BadSetting('这个模型没有这个音色')
    next.voice = patch.voice
  }
  if ('turnLimit' in patch) {
    if (!TURN_LIMITS.includes(patch.turnLimit)) throw new BadSetting('每轮最多念的字数不在可选范围里')
    next.turnLimit = patch.turnLimit
  }
  if ('callSilenceMs' in patch) {
    if (!CALL_SILENCES.includes(patch.callSilenceMs)) throw new BadSetting('停顿时长不在可选范围里')
    next.callSilenceMs = patch.callSilenceMs
  }
  if ('callBargeIn' in patch) {
    if (typeof patch.callBargeIn !== 'boolean') throw new BadSetting('「说话打断」只能开或关')
    next.callBargeIn = patch.callBargeIn
  }
  if ('callSmartTurn' in patch) {
    if (typeof patch.callSmartTurn !== 'boolean') throw new BadSetting('「听语气判断说完没有」只能开或关')
    next.callSmartTurn = patch.callSmartTurn
  }
  if ('callKeepOnLock' in patch) {
    if (typeof patch.callKeepOnLock !== 'boolean') throw new BadSetting('「锁屏后继续通话」只能开或关')
    next.callKeepOnLock = patch.callKeepOnLock
  }
  if ('speakWhole' in patch) {
    if (typeof patch.speakWhole !== 'boolean') throw new BadSetting('「整段写完再念」只能开或关')
    next.speakWhole = patch.speakWhole
  }
  if ('callCloudAsr' in patch) {
    if (typeof patch.callCloudAsr !== 'boolean') throw new BadSetting('「百炼识别」只能开或关')
    next.callCloudAsr = patch.callCloudAsr
  }
  if ('callVoiceModel' in patch) {
    if (typeof patch.callVoiceModel !== 'boolean') throw new BadSetting('「只听人声」只能开或关')
    next.callVoiceModel = patch.callVoiceModel
  }
  for (const field of ['holdEnabled', 'replyEnabled']) {
    if (field in patch) {
      if (typeof patch[field] !== 'boolean') throw new BadSetting('功能开关只能开或关')
      next[field] = patch[field]
    }
  }
  if ('speechRate' in patch) {
    if (!SPEECH_RATES.includes(patch.speechRate)) throw new BadSetting('语速不在可选范围里')
    next.speechRate = patch.speechRate
  }
  if ('callSensitivity' in patch) {
    if (!CALL_SENSITIVITIES.includes(patch.callSensitivity)) throw new BadSetting('收音灵敏度只能是很低、低、中、高')
    next.callSensitivity = patch.callSensitivity
  }
  const prefs = normalizePrefs(next)
  next.model = prefs.model
  next.voice = prefs.voice
  next.turnLimit = prefs.turnLimit
  next.callSilenceMs = prefs.callSilenceMs
  next.callBargeIn = prefs.callBargeIn
  next.callSmartTurn = prefs.callSmartTurn
  next.callKeepOnLock = prefs.callKeepOnLock
  next.speakWhole = prefs.speakWhole
  next.callSensitivity = prefs.callSensitivity
  next.callVoiceModel = prefs.callVoiceModel
  next.callCloudAsr = prefs.callCloudAsr
  next.speechRate = prefs.speechRate
  next.holdEnabled = prefs.holdEnabled
  next.replyEnabled = prefs.replyEnabled
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  const temp = `${file}.${process.pid}.${Date.now()}.tmp`
  try {
    writeFileSync(temp, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 })
    renameSync(temp, file)
  } catch (error) {
    rmSync(temp, { force: true })
    throw error
  }
  return prefs
}

/** 百炼的报错翻成能看懂的话。 */
export function describeError(raw) {
  const code = typeof raw?.code === 'string' ? raw.code : ''
  const message = typeof raw?.message === 'string' ? raw.message : ''
  if (code.includes('Unpurchased') || code.includes('Arrearage') || /eligible|arrear|balance/i.test(message)) {
    return '百炼拒绝调用：账户余额不足或没开通这个模型，请到百炼控制台充值或开通'
  }
  if (code.includes('InvalidApiKey') || /api.?key/i.test(message)) return '百炼 API Key 无效，请重新创建并保存'
  if (code.includes('Throttling') || /rate|limit/i.test(message)) return '百炼限流了，稍后再试'
  return `语音合成出错：${message || code || '未知错误'}`
}

function frame(type, payload) {
  const head = Buffer.alloc(5)
  head.writeUInt8(type, 0)
  head.writeUInt32BE(payload.length, 1)
  return Buffer.concat([head, payload])
}

/** 一段朗读：一条到百炼的 WebSocket，加一个（最多一个）在等音频的浏览器响应。 */
class Utterance {
  /** @param {string} id @param {(u: Utterance) => void} onGone */
  constructor(id, onGone) {
    this.id = id
    this.onGone = onGone
    this.createdAt = Date.now()
    /** @type {WebSocket | undefined} */
    this.ws = undefined
    this.ready = false
    /** @type {string[]} */
    this.pendingText = []
    this.finishRequested = false
    this.finishSent = false
    this.ended = false
    this.textLength = 0
    /** @type {Buffer[]} */
    this.buffered = []
    this.bufferedBytes = 0
    /** @type {import('node:http').ServerResponse | undefined} */
    this.res = undefined
    this.idleTimer = undefined
    this.lifeTimer = setTimeout(() => this.fail('朗读时间太长，已自动停止'), MAX_LIFETIME_MS)
    this.touch()
  }

  /** @param {{ key: string, host: string, model: string, voice: string, speechRate?: number }} settings */
  connect(settings) {
    const url = `wss://${settings.host}/api-ws/v1/realtime?model=${encodeURIComponent(settings.model)}`
    let ws
    try {
      ws = new WebSocket(url, { headers: { Authorization: `Bearer ${settings.key}` } })
    } catch (error) {
      this.fail(`连不上百炼：${error instanceof Error ? error.message : String(error)}`)
      return
    }
    ws.binaryType = 'arraybuffer'
    this.ws = ws
    const send = (event) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(event))
    }
    this.send = send
    ws.addEventListener('message', (message) => {
      if (this.ended) return
      let event
      try {
        const data = typeof message.data === 'string' ? message.data : Buffer.from(message.data).toString('utf8')
        event = JSON.parse(data)
      } catch {
        return
      }
      if (event?.type === 'session.created') {
        send({ type: 'session.update', session: { mode: 'server_commit', voice: settings.voice, response_format: 'pcm', sample_rate: 24000, speech_rate: settings.speechRate ?? DEFAULT_SPEECH_RATE } })
      } else if (event?.type === 'session.updated') {
        this.ready = true
        this.flushText()
      } else if (event?.type === 'response.audio.delta' && typeof event.delta === 'string') {
        this.emit(frame(FRAME_PCM, Buffer.from(event.delta, 'base64')))
      } else if (event?.type === 'session.finished') {
        this.end()
      } else if (event?.type === 'error') {
        this.fail(describeError(event.error ?? event))
      } else if (event?.type === undefined && (event?.code !== undefined || event?.message !== undefined)) {
        // 鉴权、欠费这类错误没有 type 字段，紧接着连接就断
        this.fail(describeError(event))
      }
    })
    ws.addEventListener('close', (event) => {
      if (this.ended) return
      // 模型不可用这类错误不发 JSON：服务端直接用 1007 关连接，原因写在 reason 里
      const reason = typeof event?.reason === 'string' ? event.reason.trim() : ''
      this.fail(reason === '' ? '和百炼的连接断开了' : `和百炼的连接断开了：${reason}`)
    })
    ws.addEventListener('error', () => {
      if (!this.ended) this.fail('和百炼的连接出错了')
    })
  }

  touch() {
    clearTimeout(this.idleTimer)
    this.idleTimer = setTimeout(() => this.finish(), IDLE_FINISH_MS)
  }

  /** @param {string} text @returns {boolean} 是否收下 */
  append(text) {
    if (this.ended || this.finishRequested) return false
    if (this.textLength + text.length > TEXT_LIMIT) return false
    this.textLength += text.length
    for (let at = 0; at < text.length; at += APPEND_CHUNK) this.pendingText.push(text.slice(at, at + APPEND_CHUNK))
    this.touch()
    this.flushText()
    return true
  }

  finish() {
    if (this.ended) return
    this.finishRequested = true
    clearTimeout(this.idleTimer)
    this.flushText()
  }

  flushText() {
    if (!this.ready || this.ended) return
    for (const text of this.pendingText) this.send({ type: 'input_text_buffer.append', text })
    this.pendingText = []
    if (this.finishRequested && !this.finishSent) {
      this.finishSent = true
      this.send({ type: 'session.finish' })
    }
  }

  /** @param {Buffer} chunk */
  emit(chunk) {
    if (this.res !== undefined) {
      this.res.write(chunk)
      return
    }
    this.bufferedBytes += chunk.length
    if (this.bufferedBytes > BUFFER_LIMIT) {
      this.cancel()
      return
    }
    this.buffered.push(chunk)
  }

  /** @param {import('node:http').ServerResponse} res @returns {boolean} */
  attach(res) {
    if (this.res !== undefined) return false
    this.res = res
    res.writeHead(200, { 'content-type': 'application/octet-stream', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' })
    for (const chunk of this.buffered) res.write(chunk)
    this.buffered = []
    this.bufferedBytes = 0
    if (this.ended) res.end()
    return true
  }

  /** @param {string} message */
  fail(message) {
    if (this.ended) return
    this.emit(frame(FRAME_ERROR, Buffer.from(JSON.stringify({ message }), 'utf8')))
    this.end()
  }

  end() {
    if (this.ended) return
    this.emit(frame(FRAME_END, Buffer.alloc(0)))
    this.ended = true
    clearTimeout(this.idleTimer)
    clearTimeout(this.lifeTimer)
    try { this.ws?.close() } catch { /* 已经断了 */ }
    this.res?.end()
    this.onGone(this)
  }

  cancel() {
    if (this.ended) return
    this.cancelled = true
    this.ended = true
    clearTimeout(this.idleTimer)
    clearTimeout(this.lifeTimer)
    try { this.ws?.close() } catch { /* 已经断了 */ }
    this.res?.end()
    this.buffered = []
    this.onGone(this)
  }
}

class BodyError extends Error {
  /** @param {number} status @param {string} message */
  constructor(status, message) {
    super(message)
    this.status = status
  }
}

/** @param {import('node:http').IncomingMessage} req @param {number} [limit] @returns {Promise<any>} */
function readJson(req, limit = BODY_LIMIT) {
  return new Promise((resolve, reject) => {
    /** @type {Buffer[]} */
    const chunks = []
    let size = 0
    const onData = (/** @type {Buffer} */ chunk) => {
      size += chunk.length
      if (size > limit) {
        req.removeListener('data', onData)
        req.resume()
        reject(new BodyError(413, 'body too large'))
        return
      }
      chunks.push(chunk)
    }
    req.on('data', onData)
    req.on('end', () => {
      if (size > limit) return
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      } catch {
        reject(new BodyError(400, 'bad json'))
      }
    })
    req.on('error', () => reject(new BodyError(0, 'client aborted')))
  })
}

/** @param {import('node:http').ServerResponse} res @param {number} status @param {unknown} data */
function sendJson(res, status, data) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(JSON.stringify(data))
}

/**
 * 只收 application/json 的写请求：别的网站用表单或 text/plain 能不经预检直接发过来，
 * application/json 会触发预检，本接口不回 CORS 头，预检过不去。
 * @param {import('node:http').IncomingMessage} req
 */
function isJsonRequest(req) {
  const type = req.headers['content-type']
  return typeof type === 'string' && type.split(';')[0].trim().toLowerCase() === 'application/json'
}

/** 和官方 /api 用同一套登录校验；没有 connection 服务时一律拒绝。 */
function admitted(scope, ctx, req) {
  const connection = scope.get?.('connection') ?? ctx.get?.('connection')
  if (typeof connection?.admit !== 'function') return false
  return !('rejection' in connection.admit(req))
}

/**
 * 路由处理（单独导出，方便测试）。
 * @param {{ admit: (req: import('node:http').IncomingMessage) => boolean, settings?: () => ReturnType<typeof readSettings>, configDir?: string, calls?: CallRegistry, turn?: { predict(samples: Float32Array): Promise<number>, stop(): void } }} options
 */
export function createHandler(options) {
  const configDir = options.configDir ?? CONFIG_DIR
  const settingsOf = options.settings ?? (() => readSettings(configDir))
  const calls = options.calls ?? new CallRegistry()
  // 第一次有人问才启动工作线程
  const turn = options.turn ?? new SmartTurn()

  /** 设置页要的东西：现在的设置、能选的值、Key 有没有准备好（不含 Key 本身）。 */
  function settingsView() {
    const settings = settingsOf()
    const prefs = normalizePrefs(settings)
    return {
      ready: !('error' in settings),
      error: 'error' in settings ? String(settings.error) : null,
      settings: { model: prefs.model, voice: prefs.voice, turnLimit: prefs.turnLimit, callSilenceMs: prefs.callSilenceMs, callBargeIn: prefs.callBargeIn, callSmartTurn: prefs.callSmartTurn, callKeepOnLock: prefs.callKeepOnLock, speakWhole: prefs.speakWhole, callSensitivity: prefs.callSensitivity, callVoiceModel: prefs.callVoiceModel, callCloudAsr: prefs.callCloudAsr, speechRate: prefs.speechRate, holdEnabled: prefs.holdEnabled, replyEnabled: prefs.replyEnabled },
      vadVersion: VAD_VERSION,
      catalog: { models: CATALOG, turnLimits: TURN_LIMITS, callSilences: CALL_SILENCES, speechRates: SPEECH_RATES },
    }
  }

  /** GET 读设置，POST 改设置（只收 application/json，防跨站）。 */
  async function handleSettings(req, res) {
    if (req.method === 'GET') return sendJson(res, 200, settingsView())
    if (req.method !== 'POST') return sendJson(res, 405, { error: 'method not allowed' })
    if (!isJsonRequest(req)) return sendJson(res, 415, { error: 'expected application/json' })
    let body
    try {
      body = await readJson(req)
    } catch (error) {
      const status = error instanceof BodyError ? error.status : 400
      if (status === 0) return
      return sendJson(res, status, { error: error instanceof Error ? error.message : 'bad request' })
    }
    if (body === null || typeof body !== 'object' || Array.isArray(body)) return sendJson(res, 400, { error: 'bad settings' })
    try {
      writeSettings(configDir, body)
    } catch (error) {
      if (error instanceof BadSetting) return sendJson(res, 400, { error: error.message })
      return sendJson(res, 500, { error: `保存设置失败：${error instanceof Error ? error.message : String(error)}` })
    }
    return sendJson(res, 200, settingsView())
  }
  /** 写入 Key，不返回密钥内容；同设置接口一样要求登录和 JSON 请求。 */
  async function handleKey(req, res) {
    if (req.method !== 'POST') return sendJson(res, 405, { error: 'method not allowed' })
    if (!isJsonRequest(req)) return sendJson(res, 415, { error: 'expected application/json' })
    let body
    try {
      body = await readJson(req)
    } catch (error) {
      const status = error instanceof BodyError ? error.status : 400
      if (status === 0) return
      return sendJson(res, status, { error: '请求格式不正确' })
    }
    try {
      writeApiKey(configDir, body?.key)
    } catch (error) {
      if (error instanceof BadSetting) return sendJson(res, 400, { error: error.message })
      return sendJson(res, 500, { error: '保存 API Key 失败，请检查服务端配置目录的写入权限' })
    }
    return sendJson(res, 200, settingsView())
  }
  /** @type {Map<string, Utterance>} */
  const utterances = new Map()
  const gone = (/** @type {Utterance} */ u) => {
    // 百炼报错得很快时，浏览器可能还没来取音频；留一会儿，让它还能拿到错误帧
    if (u.res === undefined && !u.cancelled) {
      const timer = setTimeout(() => {
        if (utterances.get(u.id) === u) utterances.delete(u.id)
      }, ENDED_GRACE_MS)
      timer.unref?.()
      return
    }
    if (utterances.get(u.id) === u) utterances.delete(u.id)
  }

  /** @param {import('node:http').IncomingMessage} req @param {import('node:http').ServerResponse} res */
  async function handle(req, res) {
    if (!options.admit(req)) {
      res.writeHead(401)
      res.end('unauthorized')
      return
    }
    const url = new URL(req.url ?? '/', 'http://x')
    const action = url.pathname.slice(BASE_PATH.length)

    if (action === '/settings') return handleSettings(req, res)
    if (action === '/key') return handleKey(req, res)
    if (action.startsWith('/vad/')) return serveVadAsset(action.slice('/vad/'.length), req, res)

    if (action === '/audio') {
      if (req.method !== 'GET') return sendJson(res, 405, { error: 'method not allowed' })
      const id = url.searchParams.get('id') ?? ''
      const u = utterances.get(id)
      if (u === undefined) return sendJson(res, 404, { error: 'unknown utterance' })
      if (!u.attach(res)) return sendJson(res, 409, { error: 'audio already attached' })
      res.on('close', () => {
        if (!u.ended) u.cancel()
      })
      return
    }

    if (action === '/status') {
      if (req.method !== 'GET') return sendJson(res, 405, { error: 'method not allowed' })
      const settings = settingsOf()
      return sendJson(res, 200, 'error' in settings ? { ready: false, error: settings.error } : { ready: true, voice: settings.voice, model: settings.model })
    }

    if (action === '/call/debug') {
      if (req.method !== 'GET') return sendJson(res, 405, { error: 'method not allowed' })
      return sendJson(res, 200, { calls: [...calls.calls.keys()], log: calls.log })
    }

    if (action === '/call/test') {
      // 开发自测用：~/.config/dsh-voice/call-test.json 存在时，通话用里面列的录音代替麦克风
      if (req.method !== 'GET') return sendJson(res, 405, { error: 'method not allowed' })
      const name = url.searchParams.get('clip')
      if (name === null) return sendJson(res, 200, readCallTest(configDir))
      const clip = readTestClip(configDir, name)
      if (clip === undefined) return sendJson(res, 404, { error: 'unknown clip' })
      res.writeHead(200, { 'content-type': 'audio/wav', 'cache-control': 'no-store' })
      res.end(clip)
      return
    }

    if (req.method !== 'POST' && action !== '/call') return sendJson(res, 405, { error: 'method not allowed' })

    if (action === '/call' && req.method === 'GET') {
      const sessionId = url.searchParams.get('sessionId') ?? ''
      if (!SESSION_PATTERN.test(sessionId)) return sendJson(res, 400, { error: 'bad sessionId' })
      return sendJson(res, 200, { active: calls.isActive(sessionId) })
    }

    if (action === '/asr') {
      // 通话识别走百炼（设置里打开「百炼识别」时）：浏览器发来 16 kHz WAV（base64），回识别出的文字
      if (!isJsonRequest(req)) return sendJson(res, 415, { error: 'expected application/json' })
      let asrBody
      try {
        asrBody = await readJson(req, ASR_BODY_LIMIT)
      } catch (error) {
        const status = error instanceof BodyError ? error.status : 400
        if (status === 0) return
        return sendJson(res, status, { error: error instanceof Error ? error.message : 'bad request' })
      }
      const audio = typeof asrBody?.audio === 'string' ? asrBody.audio : ''
      if (audio === '' || !/^[A-Za-z0-9+/]+=*$/.test(audio)) return sendJson(res, 400, { error: 'bad audio' })
      const settings = settingsOf()
      if ('error' in settings) return sendJson(res, 503, { error: String(settings.error) })
      const startedAt = Date.now()
      try {
        const text = await (options.cloudTranscribe ?? cloudTranscribe)({ key: settings.key, host: settings.host, wavBase64: audio })
        calls.trace({ asr: 'cloud', ms: Date.now() - startedAt, chars: text.length })
        return sendJson(res, 200, { text })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        calls.trace({ asrError: message, ms: Date.now() - startedAt })
        return sendJson(res, error instanceof AsrError ? 502 : 500, { error: message })
      }
    }

    if (action === '/turn') {
      // smart-turn：浏览器发来这一句到目前为止的声音（16 kHz PCM16，base64），回说完了的概率
      if (!isJsonRequest(req)) return sendJson(res, 415, { error: 'expected application/json' })
      let turnBody
      try {
        turnBody = await readJson(req, TURN_BODY_LIMIT)
      } catch (error) {
        const status = error instanceof BodyError ? error.status : 400
        if (status === 0) return
        return sendJson(res, status, { error: error instanceof Error ? error.message : 'bad request' })
      }
      const audio = typeof turnBody?.audio === 'string' ? turnBody.audio : ''
      if (audio === '') return sendJson(res, 400, { error: 'bad audio' })
      const samples = pcm16ToFloat(audio)
      if (samples.length < 1600) return sendJson(res, 400, { error: 'audio too short' })
      const startedAt = Date.now()
      try {
        const probability = await turn.predict(samples)
        calls.trace({ turn: Math.round(probability * 1000) / 1000, ms: Date.now() - startedAt, seconds: Math.round(samples.length / 1600) / 10 })
        return sendJson(res, 200, { probability })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        calls.trace({ turnError: message, ms: Date.now() - startedAt })
        return sendJson(res, 503, { error: `smart-turn 不可用：${message}` })
      }
    }

    if (req.method !== 'POST') return sendJson(res, 405, { error: 'method not allowed' })
    if (!isJsonRequest(req)) return sendJson(res, 415, { error: 'expected application/json' })
    let body
    try {
      body = await readJson(req)
    } catch (error) {
      const status = error instanceof BodyError ? error.status : 400
      if (status === 0) return
      return sendJson(res, status, { error: error instanceof Error ? error.message : 'bad request' })
    }

    if (action === '/call') {
      // 浏览器接通、挂断时告诉我们；通话中每隔一会儿再报一次 active: true
      const sessionId = typeof body?.sessionId === 'string' ? body.sessionId : ''
      if (!SESSION_PATTERN.test(sessionId)) return sendJson(res, 400, { error: 'bad sessionId' })
      if (typeof body.active !== 'boolean') return sendJson(res, 400, { error: 'bad active' })
      calls.set(sessionId, body.active)
      return sendJson(res, 200, { ok: true, active: body.active })
    }

    const id = typeof body?.id === 'string' ? body.id : ''
    if (!ID_PATTERN.test(id)) return sendJson(res, 400, { error: 'bad id' })

    if (action === '/open') {
      if (utterances.has(id)) return sendJson(res, 409, { error: 'utterance exists' })
      const settings = settingsOf()
      if ('error' in settings) return sendJson(res, 503, { error: settings.error })
      // 试听可以临时换模型、音色（不改存着的设置），但都得在可选范围里
      const model = modelOf(typeof body.model === 'string' ? body.model : settings.model) ?? CATALOG[0]
      if (typeof body.model === 'string' && model.id !== body.model) return sendJson(res, 400, { error: '不认识这个模型' })
      const voice = typeof body.voice === 'string'
        ? body.voice
        : (model.voices.some((v) => v.id === settings.voice) ? settings.voice : model.voices[0].id)
      if (!model.voices.some((v) => v.id === voice)) return sendJson(res, 400, { error: '这个模型没有这个音色' })
      // 浏览器带上它手里的语速：刚点了倍速按钮、设置还在保存时也按新语速念
      if ('speechRate' in body && !SPEECH_RATES.includes(body.speechRate)) return sendJson(res, 400, { error: '语速不在可选范围里' })
      const speechRate = 'speechRate' in body ? body.speechRate : normalizePrefs(settings).speechRate
      while (utterances.size >= MAX_UTTERANCES) {
        const oldest = utterances.values().next().value
        if (oldest === undefined) break
        oldest.cancel()
        utterances.delete(oldest.id)
      }
      const u = new Utterance(id, gone)
      utterances.set(id, u)
      u.connect({ key: settings.key, host: settings.host ?? DEFAULT_HOST, model: model.id, voice, speechRate })
      return sendJson(res, 200, { ok: true })
    }

    const u = utterances.get(id)
    if (action === '/append') {
      if (typeof body.text !== 'string' || body.text.length > TEXT_LIMIT) return sendJson(res, 400, { error: 'bad text' })
      if (u === undefined) return sendJson(res, 404, { error: 'unknown utterance' })
      return u.append(body.text) ? sendJson(res, 200, { ok: true }) : sendJson(res, 409, { error: 'utterance closed or full' })
    }
    if (action === '/finish') {
      u?.finish()
      return sendJson(res, 200, { ok: true })
    }
    if (action === '/cancel') {
      u?.cancel()
      return sendJson(res, 200, { ok: true })
    }
    return sendJson(res, 404, { error: 'not found' })
  }

  function disposeAll() {
    for (const u of [...utterances.values()]) u.cancel()
    utterances.clear()
    turn.stop()
  }

  return { handle, disposeAll, utterances }
}

/** @param {any} ctx */
export function apply(ctx) {
  // 通话登记表：路由和 agent/pre-step 共用一份
  const calls = new CallRegistry(() => Date.now(), cachedDevSwitch(CONFIG_DIR), debugWriter(CONFIG_DIR))
  ctx.on('agent/pre-step', createPreStep(calls))
  ctx.inject(['webServer'], (scope) => {
    const handler = createHandler({ admit: (req) => admitted(scope, ctx, req), calls })
    scope.effect(() => {
      const unregister = scope.webServer.register({ kind: 'prefix', path: BASE_PATH, handler: handler.handle })
      return () => {
        unregister()
        handler.disposeAll()
      }
    }, 'voice-reply: route')
  })
}
