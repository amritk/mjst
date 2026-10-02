import { fenceMarker } from '#helpers/fence-marker'
import { type HtmlBlockEnd, htmlBlockStart } from '#helpers/html-block'

/** A list item's first line, as far as the parts a sibling has to agree on. */
export type ItemMarker = {
  /** `.` or `)` for an ordered item, the bullet character for an unordered one. */
  readonly delimiter: string
  readonly ordered: boolean
  /** Whether the number is 1 — the only ordered item allowed to interrupt a paragraph. */
  readonly one: boolean
  /** The column the item's content starts at, which its continuation lines are indented to. */
  readonly contentColumn: number
  /** The first line's content, after the marker. */
  readonly content: string
}

/**
 * A list item gathered from the source, before anyone asks what is in it.
 * `openFence` is the run of a fence the item ended inside, if any.
 */
export type RawItem = {
  readonly marker: ItemMarker
  readonly lines: readonly string[]
  readonly openFence: string | undefined
}

/**
 * One block at the top level of a piece of markdown, and the lines it spans:
 * `start` is its first line, `end` the line after its last.
 *
 * Only the two kinds anything here rewrites are reported. Everything else — a
 * fence, raw HTML, a blockquote, a heading, a thematic break, an indented code
 * block — is read to its end and skipped, so nothing inside one is mistaken
 * for a block of its own.
 */
export type TopLevelBlock =
  | {
      readonly kind: 'list'
      readonly start: number
      readonly end: number
      readonly items: readonly RawItem[]
    }
  | {
      readonly kind: 'paragraph'
      readonly start: number
      readonly end: number
    }

const ORDERED_MARKER = /^( {0,3})(\d{1,9})([.)])/
const BULLET_MARKER = /^( {0,3})([-+*])/
const THEMATIC_BREAK = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/
const ATX_HEADING = /^ {0,3}#{1,6}(?:[ \t]|$)/
const BLOCKQUOTE = /^ {0,3}>/

/**
 * The line under a paragraph that turns it into a heading. Checked before a
 * thematic break, which `---` also is: under a paragraph it is the underline.
 */
const SETEXT_UNDERLINE = /^ {0,3}(?:=+|-+)[ \t]*$/

/**
 * True when the line closes the block `open` started: a run of the same
 * character at least as long, with nothing but whitespace after it.
 */
const closesFence = (line: string, open: string): boolean => {
  const run = /^ {0,3}(`{3,}|~{3,})[ \t]*$/.exec(line)?.[1]
  return run !== undefined && run[0] === open[0] && run.length >= open.length
}

export const isBlank = (line: string): boolean => /^[ \t]*$/.test(line)

/** The column a line's content starts at, a tab advancing to the next multiple of four as CommonMark has it. */
const indentOf = (line: string): number => {
  let column = 0
  for (const char of line) {
    if (char === ' ') column += 1
    else if (char === '\t') column += 4 - (column % 4)
    else break
  }
  return column
}

/**
 * Takes up to `columns` of indentation off a line. A tab that straddles the
 * cut leaves its far side behind as spaces, so a nested block keeps the depth
 * it had relative to the item.
 */
export const dedent = (line: string, columns: number): string => {
  let column = 0
  let index = 0
  while (index < line.length && column < columns) {
    const char = line[index]
    if (char === ' ') column += 1
    else if (char === '\t') column += 4 - (column % 4)
    else break
    index += 1
  }
  return ' '.repeat(Math.max(0, column - columns)) + line.slice(index)
}

/**
 * Reads a list item's first line. Undefined for a line that is not one — the
 * thematic break `* * *` included, which starts the way a bullet does.
 */
export const itemMarker = (line: string): ItemMarker | undefined => {
  if (THEMATIC_BREAK.test(line)) return undefined
  const ordered = ORDERED_MARKER.exec(line)
  const match = ordered ?? BULLET_MARKER.exec(line)
  if (match === null) return undefined
  const markerEnd = match[0].length
  const rest = line.slice(markerEnd)
  const gapText = /^[ \t]*/.exec(rest)?.[0] ?? ''
  // Measured in columns from where the marker ends, because a tab after it
  // reaches the next tab stop, not four columns on.
  const gapWidth = indentOf(' '.repeat(markerEnd) + gapText) - markerEnd
  const blank = isBlank(rest)
  // A marker needs whitespace after it, or nothing at all: `1.5` and `-x` are text.
  if (gapWidth === 0 && !blank) return undefined
  // Five columns or more is an indented code block inside the item, whose
  // content column is one past the marker; so is an item that starts empty.
  const wide = gapWidth > 4
  return {
    delimiter: ordered ? (match[3] ?? '.') : (match[2] ?? '-'),
    ordered: ordered !== null,
    one: ordered !== null && Number(match[2]) === 1,
    contentColumn: markerEnd + (wide || blank ? 1 : gapWidth),
    content: blank ? '' : wide ? ' '.repeat(gapWidth - 1) + rest.slice(gapText.length) : rest.slice(gapText.length),
  }
}

/**
 * True when a line begins a block of its own, so it cannot be the lazy
 * continuation of a paragraph above it: a list item, a heading, a blockquote,
 * a fence, a thematic break or raw HTML.
 */
export const startsBlock = (line: string): boolean =>
  itemMarker(line) !== undefined ||
  THEMATIC_BREAK.test(line) ||
  fenceMarker(line) !== undefined ||
  ATX_HEADING.test(line) ||
  /^ {0,3}[><]/.test(line)

/**
 * True when a line ends the paragraph above it rather than continuing it. Not
 * every block start does: an ordered item that does not start at 1, an empty
 * item, and an indented line all read as more of the paragraph.
 */
export const interruptsParagraph = (line: string): boolean => {
  const marker = itemMarker(line)
  if (marker !== undefined) return marker.content.length > 0 && (!marker.ordered || marker.one)
  return (
    THEMATIC_BREAK.test(line) ||
    fenceMarker(line) !== undefined ||
    ATX_HEADING.test(line) ||
    BLOCKQUOTE.test(line) ||
    htmlBlockStart(line, true) !== undefined
  )
}

/**
 * Reads one list from its first item to its last, the way CommonMark decides
 * where an item ends: a line indented to the item's content belongs to it, and
 * so does a blank line and an unindented line that lazily continues a
 * paragraph. A fence inside an item runs to its closing line or to the first
 * line that is not indented into the item, whichever comes first.
 *
 * The list ends at the first line that belongs to none of that, unless it is
 * the next item — a marker of the same kind, since `1.` and `1)` are two lists.
 * Trailing blank lines are left out of it, because they belong between the
 * list and whatever follows.
 */
const readList = (
  lines: readonly string[],
  start: number,
): { readonly items: readonly RawItem[]; readonly end: number } => {
  const items: RawItem[] = []
  const first = itemMarker(lines[start] ?? '')
  let marker = first
  let index = start
  let end = start

  while (marker !== undefined) {
    const itemStart = index
    const opened = fenceMarker(marker.content)
    let fence = opened
    let inParagraph = opened === undefined && !isBlank(marker.content)
    let afterBlank = false
    end = index + 1
    index += 1

    while (index < lines.length) {
      const line = lines[index] ?? ''
      if (isBlank(line)) {
        afterBlank = true
        inParagraph = false
        index += 1
        continue
      }
      const indented = indentOf(line) >= marker.contentColumn
      if (fence !== undefined) {
        // An unindented line ends the item and the fence with it; lazy
        // continuation is a paragraph's, never a code block's.
        if (!indented) break
        if (closesFence(dedent(line, marker.contentColumn), fence)) fence = undefined
      } else if (indented) {
        const content = dedent(line, marker.contentColumn)
        fence = fenceMarker(content)
        inParagraph = fence === undefined && !THEMATIC_BREAK.test(content) && !ATX_HEADING.test(content)
      } else if (!inParagraph || afterBlank || startsBlock(line)) {
        break
      }
      afterBlank = false
      end = index + 1
      index += 1
    }

    // Up to its last non-blank line: the blank lines after it sit between this
    // item and the next, or between the list and whatever follows it.
    items.push({ marker, lines: lines.slice(itemStart, end), openFence: fence })
    const next = itemMarker(lines[index] ?? '')
    marker =
      next !== undefined && next.ordered === first?.ordered && next.delimiter === first.delimiter ? next : undefined
  }
  return { items, end }
}

/** The line after the last one of the raw HTML block opening at `start`. */
const htmlEnd = (lines: readonly string[], start: number, ends: HtmlBlockEnd): number => {
  let index = start
  // The opening line can close its own block — a one-line `<!-- … -->`.
  if (ends !== 'blank' && ends(lines[index] ?? '')) return index + 1
  index += 1
  while (index < lines.length) {
    const line = lines[index] ?? ''
    index += 1
    if (ends === 'blank' ? isBlank(line) : ends(line)) break
  }
  return index
}

/**
 * Walks a piece of markdown one top-level block at a time, the way CommonMark
 * splits it, and reports the lists and paragraphs it finds there.
 *
 * Every block is read to its end before the next one starts, so a list in a
 * fence, a paragraph in a blockquote or a list item, and anything at all
 * inside raw HTML (`<!-- … -->`, `<pre>`, a `<div>` with no blank line after
 * it) is part of that block rather than a block of its own. A blockquote takes
 * the unmarked lines that lazily continue it, too: `> intro` with a line under
 * it is still one quote.
 *
 * A paragraph ends at a blank line or at a line that interrupts it — which an
 * ordered item only does when it starts at 1, so `…in\n2. **Two.** x` is one
 * paragraph. One whose last line is a setext underline is a heading, not a
 * paragraph, and is not reported.
 */
export const topLevelBlocks = (lines: readonly string[]): readonly TopLevelBlock[] => {
  const blocks: TopLevelBlock[] = []
  let index = 0

  while (index < lines.length) {
    const line = lines[index] ?? ''
    // An indented line here is code: no paragraph is open for it to continue,
    // the one before having been read to its end.
    if (isBlank(line) || indentOf(line) >= 4 || ATX_HEADING.test(line) || THEMATIC_BREAK.test(line)) {
      index += 1
      continue
    }
    const html = htmlBlockStart(line, false)
    if (html !== undefined) {
      index = htmlEnd(lines, index, html)
      continue
    }
    const fence = fenceMarker(line)
    if (fence !== undefined) {
      index += 1
      while (index < lines.length && !closesFence(lines[index] ?? '', fence)) index += 1
      index += 1
      continue
    }
    if (BLOCKQUOTE.test(line)) {
      index += 1
      while (index < lines.length) {
        const next = lines[index] ?? ''
        if (isBlank(next) || (!BLOCKQUOTE.test(next) && interruptsParagraph(next))) break
        index += 1
      }
      continue
    }
    if (itemMarker(line) !== undefined) {
      const { items, end } = readList(lines, index)
      blocks.push({ kind: 'list', start: index, end, items })
      index = end
      continue
    }

    const start = index
    let heading = false
    index += 1
    while (index < lines.length) {
      const next = lines[index] ?? ''
      if (isBlank(next)) break
      if (SETEXT_UNDERLINE.test(next)) {
        heading = true
        index += 1
        break
      }
      if (interruptsParagraph(next)) break
      index += 1
    }
    if (!heading) blocks.push({ kind: 'paragraph', start, end: index })
  }
  return blocks
}
