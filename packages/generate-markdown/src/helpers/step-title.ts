import { collapseLineEndings } from '#helpers/escape-html'

/** A link or an image, of which only the text a reader sees survives. */
const LINK = /!?\[([^\]]*)\]\([^)]*\)/g

/** A raw HTML tag, opening or closing. Only a tag: `a < b` is text. */
const TAG = /<\/?[A-Za-z][^<>]*>/g

/**
 * Marks where a piece of literal text was set aside. NUL cannot reach it from
 * the schema — CommonMark replaces one with U+FFFD, and so does
 * {@link stepTitle} before anything else — so no title can forge one.
 */
const SLOT = /\0(\d+)\0/g

/** The entities a title is most likely to carry, beyond the numeric ones. */
const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
}

/**
 * Decodes the entities CommonMark would, so `&amp;` reaches the attribute as
 * `&` and is escaped once rather than twice. A named entity outside the short
 * list above is left as written, and the attribute then shows it literally.
 */
const decodeEntities = (text: string): string =>
  text.replace(/&(?:#(\d{1,7})|#[xX]([0-9a-fA-F]{1,6})|([A-Za-z]+));/g, (entity, decimal, hex, name) => {
    if (name !== undefined) return NAMED_ENTITIES[name] ?? entity
    const point = decimal !== undefined ? Number(decimal) : Number.parseInt(hex, 16)
    return point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : '�'
  })

/**
 * Emphasis markers: a `*` run touching a word, every `~~`, and a run of `_`
 * that touches a word boundary. A `*` with space on both sides is text — `2 * 3`
 * — and so is an `_` inside a word (`snake_case`), which is exactly where
 * CommonMark refuses to read either as emphasis.
 */
const stripEmphasis = (text: string): string =>
  text
    .replace(/\*+/g, (run: string, offset: number, whole: string) => {
      const before = whole[offset - 1]
      const after = whole[offset + run.length]
      const spaced = (before === undefined || /\s/.test(before)) && (after === undefined || /\s/.test(after))
      return spaced ? run : ''
    })
    .replace(/~~/g, '')
    .replace(/(^|[^\p{L}\p{N}])_+/gu, '$1')
    .replace(/_+(?=[^\p{L}\p{N}]|$)/gu, '')

/**
 * Strips the inline markdown from a step's lead-in, leaving the words a reader
 * would see: the text of a code span (its backticks gone, its content kept as
 * written), the text of a link, and no emphasis markers or tags.
 *
 * Code spans and backslash escapes are set aside first and put back last, so
 * nothing in between touches them: `` `<your-key>` `` keeps its brackets,
 * `` `NPM_TOKEN` `` its underscore, and `\*` its asterisk. Stripping first and
 * finding the code spans afterwards took the `<your-key>` out of the middle of
 * a title as though it were a tag.
 */
const stripInlineMarkdown = (markdown: string): string => {
  const literals: string[] = []
  const slot = (text: string): string => `\0${literals.push(text) - 1}\0`
  let marked = ''
  let index = 0
  while (index < markdown.length) {
    const char = markdown[index] ?? ''
    if (char === '\\' && /[!-/:-@[-`{-~]/.test(markdown[index + 1] ?? '')) {
      marked += slot(markdown[index + 1] ?? '')
      index += 2
      continue
    }
    if (char === '`') {
      const run = /^`+/.exec(markdown.slice(index))?.[0] ?? '`'
      const close = markdown.indexOf(run, index + run.length)
      // A lone backtick run with no partner is literal text, as CommonMark has it.
      if (close !== -1 && markdown[close + run.length] !== '`') {
        const content = markdown.slice(index + run.length, close)
        marked += slot(/^ .* $/.test(content) && content.trim() !== '' ? content.slice(1, -1) : content)
        index = close + run.length
        continue
      }
      marked += run
      index += run.length
      continue
    }
    marked += char
    index += 1
  }
  const stripped = decodeEntities(stripEmphasis(marked.replace(LINK, '$1').replace(TAG, '')))
  return stripped.replace(SLOT, (_, position: string) => literals[Number(position)] ?? '')
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
  collapseLineEndings(stripInlineMarkdown(lead.replace(/\0/g, '�')))
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[.:]$/, '')
    .trim()
