/**
 * 通话里几句不发给 agent、本地直接处理的话，以及判断「这是不是朗读的回声」。
 *
 * - 「停」「先停一下」「别做了」「取消」：让 agent 停下（agent 在跑时才算）。
 * - 「进度怎么样」「做到哪了」「还要多久」：本地念一句进度，不打断 agent。
 * - 回声：戴的耳机漏音、音量太大时，麦克风会录到朗读的声音。识别出的字大部分都在刚念过的话里，就当回声丢掉。
 *
 * 只认整句很短的话，免得把「帮我看看停车场的代码」这种当成命令。
 * 纯计算，Node 里能直接测。只用可擦除的 TypeScript 语法。
 */

export type Command = 'stop' | 'progress'

const PUNCT = /[\s，。、,.!?！？；;：:…~～"'“”‘’（）()【】[\]]/gu
const LEADING = /^(嗯+|好+|好的|那|那个|哎|诶|喂|行|你)+/u
const TRAILING = /(吧|啊|呀|了|哈|啦|嘛|哦|噢|呢|好吗|行吗|可以吗)+$/u

/** 去掉标点、开头的「嗯/好/那」、结尾的「吧/了/啊」。 */
export function normalizeCommand(text: string): string {
  let s = text.replace(PUNCT, '')
  // 开头、结尾的语气词可能叠好几层（「好那你」「了吧」）
  for (let i = 0; i < 3; i++) s = s.replace(LEADING, '').replace(TRAILING, '')
  return s
}

const STOP = new Set([
  '停', '停停', '停下', '停一下', '停下来', '停止', '打住',
  '先停', '先停下', '先停一下', '先停下来', '先别做', '先别干',
  '别做', '别干', '别弄', '不做', '不用做', '不要做', '不用干', '不要干', '不用弄',
  '取消', '中断', '算了停', '算了别做',
])

const PROGRESS = [
  /^(现在|目前)?的?(进度|进展)(怎么样|如何|咋样|到哪|到哪了|到哪一步)?$/u,
  /^(现在)?(做|干|弄|搞|跑)(到哪|到哪一步|得怎么样|完没|完了没|好没|好了没|完了吗|好了吗)$/u,
  /^(现在)?(怎么样|咋样|到哪|到哪一步|好了没|完了没|还要多久|还要多长时间|还要等多久)$/u,
  /^(你)?(还在(干|做|弄|忙)(什么|啥))$/u,
  /^(你)?在(干|做|弄|忙)(什么|啥)$/u,
]

/** 这句话是不是通话命令。不是返回 undefined（照常发给 agent）。 */
export function commandOf(text: string): Command | undefined {
  // 去语气词可能去过头（「好了没」的「好」不是语气词），原话也比一次
  const raw = text.replace(PUNCT, '')
  for (const s of [normalizeCommand(text), raw]) {
    if (s === '' || s.length > 12) continue
    if (STOP.has(s)) return 'stop'
    if (PROGRESS.some((re) => re.test(s))) return 'progress'
  }
  return undefined
}

function compact(text: string): string {
  return text.replace(PUNCT, '').toLowerCase()
}

/**
 * 识别出的话是不是朗读的回声：整句都在刚念过的话里，或者大部分「两字组合」都在。
 * 太短（不到 2 个字）的不判断（命令另外处理）。
 */
export function isEcho(heard: string, recentSpeech: string): boolean {
  const h = compact(heard)
  const r = compact(recentSpeech)
  if (h.length < 2 || r.length < 2) return false
  if (r.includes(h)) return true
  const pairs = new Set<string>()
  for (let i = 0; i + 1 < r.length; i++) pairs.add(r.slice(i, i + 2))
  let hit = 0
  let total = 0
  for (let i = 0; i + 1 < h.length; i++) {
    total++
    if (pairs.has(h.slice(i, i + 2))) hit++
  }
  return total > 0 && hit / total >= 0.6
}

// ---------- 进度 ----------

export interface Progress {
  /** 这一轮 agent 走了几步。 */
  steps: number
  /** 最近一次调用的工具名。 */
  lastTool: string
  /** 最近一段正文的最后一句。 */
  lastSaid: string
}

const TOOL_WORDS: [RegExp, string][] = [
  [/^(bash|terminal_|shell)/, '跑命令'],
  [/^read/, '看文件'],
  [/^(grep|glob)/, '搜代码'],
  [/^(edit|write)/, '改文件'],
  [/^web_/, '查资料'],
  [/^(subagent|spawn|workflow)/, '派子代理'],
  [/^computer_/, '操作电脑'],
  [/^(job_|wait_)/, '等后台任务'],
  [/^todo/, '整理待办'],
  [/^notes_/, '看笔记'],
]

function toolWords(name: string): string {
  for (const [re, words] of TOOL_WORDS) if (re.test(name)) return words
  return `用 ${name}`
}

function duration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000))
  const minutes = Math.floor(total / 60)
  const seconds = total % 60
  if (minutes === 0) return `${seconds} 秒`
  return seconds === 0 ? `${minutes} 分钟` : `${minutes} 分 ${seconds} 秒`
}

/** 念给用户听的一句进度。 */
export function progressText(progress: Progress | undefined, elapsedMs: number, running: boolean): string {
  if (!running) return '它这一轮已经做完了。'
  const parts = [`还在干活，已经 ${duration(elapsedMs)}`]
  if (progress !== undefined && progress.steps > 0) parts[0] += `，走了 ${progress.steps} 步`
  let text = `${parts[0]}。`
  if (progress !== undefined && progress.lastTool !== '') text += `刚才在${toolWords(progress.lastTool)}。`
  if (progress !== undefined && progress.lastSaid !== '') {
    const said = progress.lastSaid.length > 40 ? `${progress.lastSaid.slice(0, 40)}……` : progress.lastSaid
    text += `它最近说：${said}`
  }
  return text
}

interface ChatSnapshotLike {
  timeline?: { turnOrder?: readonly unknown[] }
  locations?: { getTurn?: (turn: unknown) => readonly unknown[] }
  nodes?: { get?: (key: unknown) => unknown }
}

interface StepNodeLike {
  kind?: string
  data?: { blocks?: readonly { kind?: string, text?: unknown, name?: unknown }[] }
}

/** 最后一句（按句末标点切），去掉 markdown 符号。 */
function lastSentence(text: string): string {
  const clean = text.replace(/[`*#>_|]/g, '').replace(/\s+/g, ' ').trim()
  const pieces = clean.split(/(?<=[。！？!?；;])/u).map((p) => p.trim()).filter((p) => p !== '')
  return pieces.at(-1) ?? ''
}

/**
 * useChat 选择器：最新一轮的步数、最近的工具、最近一句话。返回字符串（内容没变就不重渲染）。
 */
export function selectProgress(snapshot: unknown): string {
  try {
    const s = snapshot as ChatSnapshotLike
    const turn = s.timeline?.turnOrder?.at(-1)
    if (turn === undefined) return ''
    const progress: Progress = { steps: 0, lastTool: '', lastSaid: '' }
    for (const key of s.locations?.getTurn?.(turn) ?? []) {
      const node = s.nodes?.get?.(key) as StepNodeLike | undefined
      if (node?.kind !== 'assistant-step') continue
      progress.steps++
      for (const block of node.data?.blocks ?? []) {
        if (block.kind === 'tool-call' && typeof block.name === 'string' && block.name !== '') progress.lastTool = block.name
        if (block.kind === 'text' && typeof block.text === 'string') {
          const said = lastSentence(block.text)
          if (said !== '') progress.lastSaid = said
        }
      }
    }
    return JSON.stringify(progress)
  } catch {
    return ''
  }
}

export function parseProgress(signature: string): Progress | undefined {
  if (signature === '') return undefined
  try {
    return JSON.parse(signature) as Progress
  } catch {
    return undefined
  }
}
