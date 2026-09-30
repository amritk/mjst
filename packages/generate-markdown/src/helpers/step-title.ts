import { collapseLineEndings } from '#helpers/escape-html'

/** A link or an image, of which only the text a reader sees survives. */
const LINK = /!?\[([^\]]*)\]\([^)]*\)/g

/** A raw HTML tag, opening or closing. Only a tag: `a < b` is text. */
const TAG = /<\/?[A-Za-z][^<>]*>/g

/**
 * Emphasis markers: every `*` and `~~`, and a run of `_` that touches a word
 * boundary. An `_` inside a word is part of it — `snake_case` stays whole —
 * which is also where CommonMark refuses to read one as emphasis.
 */
const stripEmphasis = (text: string): string =>
  text
    .replace(/\*+|~~/g, '')
    .replace(/(^|[^\p{L}\p{N}])_+/gu, '$1')
    .replace(/_+(?=[^\p{L}\p{N}]|$)/gu, '')

/**
 * Strips the inline markdown from a step's lead-in, leaving the words a reader
 * would see: the text of a code span (its backticks gone, its content kept as
 * written), the text of a link, and no emphasis markers.
 *
 * A code span's content and a backslash-escaped character are taken as they
 * are rather than stripped, which is what makes `` `NPM_TOKEN` `` keep its
 * underscore and `\*` keep its asterisk.
 */
const stripInlineMarkdown = (markdown: string): string => {
  const source = markdown.replace(LINK, '$1').replace(TAG, '')
  let result = ''
  let plain = ''
  let index = 0
  while (index < source.length) {
    const char = source[index] ?? ''
    if (char === '\\' && /[!-/:-@[-`{-~]/.test(source[index + 1] ?? '')) {
      result += stripEmphasis(plain) + (source[index + 1] ?? '')
      plain = ''
      index += 2
      continue
    }
    if (char === '`') {
      const run = /^`+/.exec(source.slice(index))?.[0] ?? '`'
      const close = source.indexOf(run, index + run.length)
      // A lone backtick run with no partner is literal text, as CommonMark has it.
      if (close !== -1 && source[close + run.length] !== '`') {
        const content = source.slice(index + run.length, close)
        result +=
          stripEmphasis(plain) + (/^ .* $/.test(content) && content.trim() !== '' ? content.slice(1, -1) : content)
        plain = ''
        index = close + run.length
        continue
      }
      plain += run
      index += run.length
      continue
    }
    plain += char
    index += 1
  }
  return result + stripEmphasis(plain)
}

/**
 * The title a step's bold lead-in stands for: its inline markdown stripped, its
 * whitespace collapsed, and one trailing `.` or `:` dropped — the punctuation
 * that makes `**Create a token.**` read as a sentence in a list and would read
 * as a typo on a step's heading.
 *
 * Plain text, not yet escaped: where it lands decides what it needs.
 */
export const stepTitle = (lead: string): string =>
  collapseLineEndings(stripInlineMarkdown(lead)).replace(/\s+/g, ' ').trim().replace(/[.:]$/, '').trim()
