/**
 * 跟读的节奏：什么时候把一步的文字交出去，一轮最多念多少字。
 *
 * 单独放一个文件、不 import 别的模块：Node 能直接跑测试。
 */

const ENDERS = '。！？!?；;…'
/** 句末标点后面紧跟的收尾符号（引号、括号），算在这句里。 */
const CLOSERS = '"\'”’）)」』】'

/** 把可念文字切成一句一句（保留标点）。英文句号后面跟数字或小写字母的不算句末（1.5、a.b）。 */
export function splitSentences(text: string): string[] {
  const out: string[] = []
  let start = 0
  let i = 0
  while (i < text.length) {
    const ch = text[i]!
    const next = text[i + 1]
    const ends = ENDERS.includes(ch) || (ch === '.' && (next === undefined || !/[0-9a-z]/.test(next)))
    if (!ends) {
      i++
      continue
    }
    let end = i + 1
    // 连着的标点（「？！」「……」）和收尾的引号、括号都算这句
    while (end < text.length && (ENDERS.includes(text[end]!) || text[end] === '.' || CLOSERS.includes(text[end]!))) end++
    out.push(text.slice(start, end))
    start = end
    i = end
  }
  if (start < text.length) out.push(text.slice(start))
  return out.filter((s) => s.trim() !== '')
}

/**
 * 这一步的文字现在能不能交出去。
 * 边写边念：随时都行。整段念：等这一步写完，或者开始调工具（工具前说的话先念）。
 */
export function stepReady(whole: boolean, step: { done: boolean, flush: boolean }): boolean {
  return !whole || step.done || step.flush
}

/** 一轮最多念多少字。超过上限的那句照样念完，再往后的不念。 */
export class TurnBudget {
  private spent = 0

  /**
   * 从一段可念文字里取出还能念的部分。
   * @param limit 上限，0 表示不限。
   * @returns text 能念的部分（可能是空串）；over 是不是已经念到上限、后面的被截掉了。
   */
  take(piece: string, limit: number): { text: string, over: boolean } {
    if (piece === '') return { text: '', over: false }
    if (limit <= 0) {
      this.spent += piece.length
      return { text: piece, over: false }
    }
    let text = ''
    for (const sentence of splitSentences(piece)) {
      if (this.spent >= limit) return { text, over: true }
      this.spent += sentence.length
      text += sentence
    }
    return { text, over: false }
  }

  reset(): void {
    this.spent = 0
  }
}
