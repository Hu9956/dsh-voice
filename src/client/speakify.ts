/**
 * 把正在流式写出的 Markdown 回复，一段一段转成适合念出来的文字。
 *
 * - 整行写完，或者行内出现句末标点（。！？等）时就交出去，不用等整条回复写完。
 * - 代码块换成「代码见屏幕。」，表格换成「表格见屏幕。」，各只说一次。
 * - 链接只念文字，裸网址念「链接」，去掉标题、列表、加粗等符号。
 * - 行内代码：短的照念（比如 useEffect），路径只念文件名，长的念「代码」。
 * - 主代理出错重试、把这一步重写时，已经念过的句子不再念，从说法变了的那句接着念。
 *
 * 只用可擦除的 TypeScript 语法，Node 可以直接跑测试。
 */

/** 句末标点：念到这里可以先交出去。 */
// 英文句号要后面跟空白才算：流式时「1.」后面可能马上接「5」
const SENTENCE_END = /[。！？!?；;…]|\.(?=\s)/g

/** text[i] 是不是一句话的结尾。英文句号后面跟数字或小写字母的不算（1.5、a.b）。 */
function endsSentence(text: string, i: number): boolean {
  const ch = text[i]
  if (ch === undefined) return false
  if ('。！？!?；;…'.includes(ch)) return true
  if (ch !== '.') return false
  const next = text[i + 1]
  return next === undefined || !/[0-9a-z]/.test(next)
}

export class Speakify {
  /** 原文里已经处理过的长度。 */
  private consumed = 0
  /** 当前在不在 ``` 代码块里。 */
  private inFence = false
  /** 当前这个代码块有没有说过「代码见屏幕」。 */
  private fenceAnnounced = false
  /** 上一行是不是表格行（连续的表格只说一次）。 */
  private inTable = false
  /** 当前行前面一部分已经交出去了（只处理了行首符号一次）。 */
  private midLine = false
  /** 已经处理过的那段原文（用来发现原文被重写了）。 */
  private source = ''
  /** 这一遍交出的全部可念文字（包括重写后跳过没念的）。 */
  private said = ''
  /** 重写之前，听的人已经听到的内容。 */
  private heard = ''
  /** 重写后还在跳过已经念过的部分。 */
  private replaying = false

  /**
   * 喂入到目前为止的完整原文，返回新增的可念文字（可能是空串）。
   * @param raw 到目前为止的完整原文。通常只会变长；开头和之前不一样了（主代理出错重试、把这一步重写了），
   *   就从头再处理一遍，但已经念过的句子不再交出去。
   * @param final 原文不会再变了，把剩下的半行也交出去。
   */
  push(raw: string, final = false): string {
    if (!raw.startsWith(this.source)) this.rewrite()
    let out = ''
    while (this.consumed < raw.length) {
      const rest = raw.slice(this.consumed)
      const newline = rest.indexOf('\n')
      if (newline >= 0) {
        out += this.emit(this.piece(rest.slice(0, newline), true))
        this.consumed += newline + 1
        continue
      }
      if (final) {
        out += this.emit(this.piece(rest, true))
        this.consumed = raw.length
        break
      }
      const cut = this.sentenceCut(rest)
      if (cut <= 0) break
      out += this.emit(this.piece(rest.slice(0, cut), false))
      this.consumed += cut
    }
    this.source = raw.slice(0, this.consumed)
    return out
  }

  /** 从头处理一段新的原文（念过什么也一起忘掉）。 */
  reset(): void {
    this.restartParse()
    this.source = ''
    this.said = ''
    this.heard = ''
    this.replaying = false
  }

  private restartParse(): void {
    this.consumed = 0
    this.inFence = false
    this.fenceAnnounced = false
    this.inTable = false
    this.midLine = false
  }

  /** 原文被重写了：从头再处理一遍，先跳过听的人已经听过的部分。 */
  private rewrite(): void {
    // 上一遍已经追上、开始念新内容了，听到的就是上一遍的说法；还没追上，听到的仍是更早那一遍
    if (!this.replaying) this.heard = this.said
    this.replaying = this.heard !== ''
    this.said = ''
    this.source = ''
    this.restartParse()
  }

  /** 交出一段可念文字。重写之后，已经念过的部分不再交出，从说法变了的那句话开头接着念。 */
  private emit(text: string): string {
    if (text === '') return ''
    const start = this.said.length
    this.said += text
    if (!this.replaying) return text
    if (this.heard.startsWith(this.said)) return ''
    this.replaying = false
    let same = start
    const limit = Math.min(this.said.length, this.heard.length)
    while (same < limit && this.said[same] === this.heard[same]) same++
    // 听过的部分整个念到了、只是接着往下写：从接上的地方开始
    if (same >= this.heard.length) return this.said.slice(same)
    // 说法变了：退回这句话的开头整句重念，免得只念半句
    let from = same
    while (from > start && !endsSentence(this.said, from - 1)) from--
    return this.said.slice(from)
  }

  /** 半行里最后一个能安全断开的位置（句末标点之后），0 表示还不能断。 */
  private sentenceCut(partial: string): number {
    if (this.inFence) return 0
    if (!this.midLine) {
      const head = partial.trimStart()
      // 可能是代码块或表格的开头，等整行写完再说
      if (head.startsWith('`') || head.startsWith('|') || head === '' || head.startsWith('~')) return 0
    }
    let cut = 0
    SENTENCE_END.lastIndex = 0
    for (const match of partial.matchAll(SENTENCE_END)) {
      const end = (match.index ?? 0) + match[0].length
      const before = partial.slice(0, end)
      // 行内代码或链接还没闭合时不断
      if ((before.match(/`/g)?.length ?? 0) % 2 === 1) continue
      if ((before.match(/\[/g)?.length ?? 0) > (before.match(/\]/g)?.length ?? 0)) continue
      if ((before.match(/\(/g)?.length ?? 0) > (before.match(/\)/g)?.length ?? 0)) continue
      cut = end
    }
    return cut
  }

  /** 处理一段文字。lineEnd 为 true 表示这段之后就是换行（或全文结束）。 */
  private piece(text: string, lineEnd: boolean): string {
    let body: string | null
    if (this.midLine) {
      body = inline(text)
    } else {
      body = this.block(text)
    }
    this.midLine = !lineEnd
    if (body === null) return ''
    body = body.trim()
    if (body === '') return ''
    if (lineEnd && !/[。！？!?；;…，,：:、.]$/.test(body)) body += '。'
    return body
  }

  /** 行首的块级语法。返回 null 表示这一行不念。 */
  private block(line: string): string | null {
    const trimmed = line.trim()
    if (/^(```|~~~)/.test(trimmed)) {
      if (this.inFence) {
        this.inFence = false
        return null
      }
      this.inFence = true
      this.inTable = false
      if (this.fenceAnnounced) return null
      this.fenceAnnounced = true
      return '代码见屏幕。'
    }
    if (this.inFence) return null
    this.fenceAnnounced = false
    if (trimmed === '') {
      this.inTable = false
      return null
    }
    if (trimmed.startsWith('|')) {
      if (this.inTable) return null
      this.inTable = true
      return '表格见屏幕。'
    }
    this.inTable = false
    if (/^([-*_]\s*){3,}$/.test(trimmed)) return null
    let content = trimmed
      .replace(/^>+\s*/, '')
      .replace(/^#{1,6}\s+/, '')
      .replace(/^[-*+]\s+(\[[ xX]\]\s+)?/, '')
      .replace(/^\d+[.)]\s+/, '')
    content = inline(content)
    return content
  }
}

/** 行内语法：链接、网址、代码、强调、HTML。 */
export function inline(text: string): string {
  return text
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, (_m, alt: string) => alt.trim() === '' ? '图片' : alt)
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/<https?:\/\/[^>]+>/g, '链接')
    .replace(/https?:\/\/[^\s)）\]，。]+/g, '链接')
    .replace(/`([^`]+)`/g, (_m, code: string) => speakCode(code))
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/(^|[^\w*])\*([^*\s][^*]*)\*(?!\w)/g, '$1$2')
    .replace(/~~([^~]+)~~/g, '$1')
    .replace(/<\/?[a-zA-Z][^>]*>/g, '')
    .replace(/[*`]/g, '')
}

/** 行内代码念法：路径只念文件名，短标识照念，长的念「代码」。 */
export function speakCode(code: string): string {
  const value = code.trim()
  if (value === '') return ''
  if (/[/\\]/.test(value)) {
    const tail = value.split(/[/\\]/).filter(Boolean).at(-1) ?? ''
    return tail !== '' && tail.length <= 40 ? tail : '代码'
  }
  if (value.length <= 32 && !/[{};=<>]/.test(value)) return value
  return '代码'
}

/** 一次性把整段回复转成可念文字（喇叭按钮用）。 */
export function speakifyAll(raw: string): string {
  return new Speakify().push(raw, true)
}
