/**
 * 通话中输入框里已经有字时，识别出来的话接到草稿末尾（不自动发）。
 * 纯函数，Node 里能直接测。
 */

const LATIN_END = /[A-Za-z0-9]$/
const LATIN_START = /^[A-Za-z0-9]/

/** 把 text 接到 draft 后面：两边都是英文字母或数字时中间加一个空格，其余直接接上。 */
export function joinDraft(draft: string, text: string): string {
  const addition = text.trim()
  if (addition === '') return draft
  if (draft.trim() === '') return addition
  if (/\s$/.test(draft)) return draft + addition
  if (LATIN_END.test(draft) && LATIN_START.test(addition)) return `${draft} ${addition}`
  return draft + addition
}

/** 输入框里有没打完 / 没发的东西：有字或有附件。 */
export function isComposing(input: { draft: string, attachmentIds: readonly string[] } | undefined): boolean {
  if (input === undefined) return false
  return input.draft.trim() !== '' || input.attachmentIds.length > 0
}
