/**
 * 跟读：盯着当前对话最新一轮里主代理的每一步（assistant-step），边写边念。
 *
 * - 每一步对应一段朗读；步骤里的文字一边流出来一边交给 Speakify 清理，再发去合成。
 * - 设置里开了「整段写完再念」：等这一步写完（或开始调工具）再把整段交给合成，语调更连贯，开口晚一些。
 * - 中间回复（调工具之前说的话）也念。
 * - 打开开关、切换对话时，已经存在的步骤一律当作念过了，不会把旧回复重读一遍。
 * - 每一轮最多念的字数在「插件 → 语音朗读」里设置（默认 800 字，可以不限），超过就说一句「后面的内容请看屏幕」。
 * - 用户手动停止（点开关、按住说话）之后，这一轮剩下的都不念了，下一轮照常。
 */
import { stepReady, TurnBudget } from './pacing'
import { Speakify } from './speakify'
import { loadSettings, speakWhole, turnLimit } from './settings'
import { speaker, type Utterance } from './speaker'

/** 自动朗读的朗读段都用这个前缀（手动点回复下方喇叭是 message:，通话是另一套）。 */
export const AUTO_READ_TAG = 'turn:'

const OVER_BUDGET = '后面的内容请看屏幕。'

export interface StepView {
  key: string
  /** 这一步到目前为止所有文字块拼起来。 */
  text: string
  /** 最后一块不是文字了（开始调工具）：手里的半句可以先念出去。 */
  flush: boolean
  /** 这一步写完了。 */
  done: boolean
  /** 这一步被中断了（用户按了停止）。 */
  interrupted: boolean
}

export interface TurnView {
  turn: string
  steps: StepView[]
}

interface StepState {
  /** 开关打开前就有的步骤：不念。 */
  skip: boolean
  speakify: Speakify
  utterance: Utterance | undefined
  closed: boolean
}

export class Follower {
  private turn: string | undefined
  private steps = new Map<string, StepState>()
  private primed = false
  private budget = new TurnBudget()
  private noticeGiven = false
  private muted = false
  private stopsSeen = speaker.stops

  update(view: TurnView | null): void {
    if (view === null) return
    if (!this.primed) {
      // 第一次看到：现有的一律当作念过
      this.primed = true
      this.turn = view.turn
      for (const step of view.steps) this.steps.set(step.key, this.newState(true))
      this.stopsSeen = speaker.stops
      return
    }
    if (view.turn !== this.turn) {
      // 新的一轮：上一轮没念完的让它念完，状态清零
      this.finishAll()
      this.turn = view.turn
      this.steps.clear()
      this.budget.reset()
      this.noticeGiven = false
      this.muted = false
      this.stopsSeen = speaker.stops
      // 每轮开始重读一次设置：在别的设备上改了也能跟上
      void loadSettings(true)
    }
    if (speaker.stops !== this.stopsSeen) {
      // 被手动停了：这一轮剩下的都不念
      this.stopsSeen = speaker.stops
      this.muted = true
    }
    for (const step of view.steps) {
      let state = this.steps.get(step.key)
      if (state === undefined) {
        state = this.newState(this.muted)
        this.steps.set(step.key, state)
      }
      if (state.skip || state.closed) continue
      if (this.muted || step.interrupted) {
        this.close(state, false)
        continue
      }
      // 整段念：这一步还在写就先不交，写完（或开始调工具）再整段交出去
      if (!stepReady(speakWhole(), step)) continue
      const piece = state.speakify.push(step.text, step.done || step.flush)
      this.say(state, piece)
      if (step.done) this.close(state, true)
    }
  }

  /** 不再跟读（关开关、切对话、卸载）：在念的念完，不再追加。 */
  detach(): void {
    this.finishAll()
  }

  private newState(skip: boolean): StepState {
    return { skip, speakify: new Speakify(), utterance: undefined, closed: false }
  }

  private say(state: StepState, piece: string): void {
    if (piece === '') return
    // 按句截：整段念时一次交出很多字，也不会超过上限太多
    const { text, over } = this.budget.take(piece, turnLimit())
    if (text !== '') this.utter(state).append(text)
    if (over && !this.noticeGiven) {
      this.noticeGiven = true
      this.utter(state).append(OVER_BUDGET)
    }
  }

  private utter(state: StepState): Utterance {
    if (state.utterance === undefined) state.utterance = speaker.start(`${AUTO_READ_TAG}${this.turn ?? ''}`)
    return state.utterance
  }

  private close(state: StepState, finish: boolean): void {
    state.closed = true
    if (state.utterance === undefined) return
    if (finish) state.utterance.finish()
    else state.utterance.cancel()
  }

  private finishAll(): void {
    for (const state of this.steps.values()) if (!state.skip && !state.closed) this.close(state, true)
  }
}

interface ChatSnapshotLike {
  timeline?: { turnOrder?: readonly unknown[] }
  locations?: { getTurn?: (turn: unknown) => readonly unknown[] }
  nodes?: { get?: (key: unknown) => unknown }
}

interface AssistantNodeLike {
  kind?: string
  data?: {
    status?: string
    blocks?: readonly { kind?: string, text?: unknown }[]
  }
}

/**
 * useChat 选择器：把最新一轮的主代理步骤压成一个字符串。
 * 返回字符串是为了让 useChat 用 Object.is 比较时，内容没变就不重渲染。
 */
export function selectTurn(snapshot: unknown): string {
  try {
    const s = snapshot as ChatSnapshotLike
    const turn = s.timeline?.turnOrder?.at(-1)
    if (turn === undefined) return ''
    const keys = s.locations?.getTurn?.(turn) ?? []
    const steps: StepView[] = []
    for (const key of keys) {
      const node = s.nodes?.get?.(key) as AssistantNodeLike | undefined
      if (node?.kind !== 'assistant-step') continue
      const blocks = node.data?.blocks ?? []
      const status = node.data?.status
      const text = blocks
        .filter((block) => block.kind === 'text' && typeof block.text === 'string')
        .map((block) => block.text as string)
        .join('\n')
      const last = blocks.at(-1)
      steps.push({
        key: String(key),
        text,
        flush: last !== undefined && last.kind !== 'text',
        done: status === 'settled' || status === 'interrupted',
        interrupted: status === 'interrupted',
      })
    }
    return JSON.stringify({ turn: String(turn), steps } satisfies TurnView)
  } catch {
    return ''
  }
}

export function parseTurn(signature: string): TurnView | null {
  if (signature === '') return null
  try {
    return JSON.parse(signature) as TurnView
  } catch {
    return null
  }
}
