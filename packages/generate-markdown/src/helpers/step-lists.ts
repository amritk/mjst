import { fenceMarker } from '#helpers/fence-marker'
import { type HtmlBlockEnd, htmlBlockStart } from '#helpers/html-block'

/** One item of a list that qualifies as steps: its bold lead-in, and the rest. */
export type StepItem = {
  /** The text inside the bold lead-in, exactly as written. */
  readonly lead: string
  /** Everything after the lead-in, de-indented to column 0 and trimmed of blank lines. */
  readonly body: string
}

/**
 * A top-level ordered list whose every item opens with a bold lead-in, and the
 * lines it spans: `start` is its first line, `end` the line after its last.
 */
export type StepList = {
  readonly start: number
  readonly end: number
  readonly items: readonly StepItem[]
}

/** A list item's first line, as far as the parts a sibling has to agree on. */
type ItemMarker = {
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
 * A list item gathered from the source, before anyone asks whether it has a
 * lead-in. `openFence` is the run of a fence the item ended inside, if any.
 */
type RawItem = {
  readonly marker: ItemMarker
  readonly lines: readonly string[]
  readonly openFence: string | undefined
}

const ORDERED_MARKER = /^( {0,3})(\d{1,9})([.)])/
const BULLET_MARKER = /^( {0,3})([-+*])/
const THEMATIC_BREAK = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/
const ATX_HEADING = /^ {0,3}#{1,6}(?:[ \t]|$)/

/**
 * `**Title.**` at the very start of an item, and the `.` or `:` an author puts
 * straight after the closing `**` instead of inside it. The lead-in has to be
 * followed by whitespace or the end of the line, so `**a**b` — one word, half
 * of it bold — is not mistaken for a title.
 */
const LEAD_IN = /^\*\*(?![\s*])(.*?\S)\*\*[.:]?(?=\s|$)/

/**
 * True when the line closes the block `open` started: a run of the same
 * character at least as long, with nothing but whitespace after it.
 */
const closesFence = (line: string, open: string): boolean => {
  const run = /^ {0,3}(`{3,}|~{3,})[ \t]*$/.exec(line)?.[1]
  return run !== undefined && run[0] === open[0] && run.length >= open.length
}

const isBlank = (line: string): boolean => /^[ \t]*$/.test(line)

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
const dedent = (line: string, columns: number): string => {
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
const itemMarker = (line: string): ItemMarker | undefined => {
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
const startsBlock = (line: string): boolean =>
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
const interruptsParagraph = (line: string): boolean => {
  const marker = itemMarker(line)
  if (marker !== undefined) return marker.content.length > 0 && (!marker.ordered || marker.one)
  return (
    THEMATIC_BREAK.test(line) ||
    fenceMarker(line) !== undefined ||
    ATX_HEADING.test(line) ||
    /^ {0,3}>/.test(line) ||
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

/**
 * Keeps the text after a lead-in the paragraph text it was. On the lead-in's
 * line it could only continue the paragraph the bold text opened; as the first
 * line of a body it would open a block of its own — and a fence opened there
 * never closes, so it swallowed the step's closing tags and the rest of the
 * page. A backslash before the character that starts the block leaves the
 * text as the reader saw it.
 */
const asParagraphText = (line: string): string => {
  const ordered = /^(\d{1,9})([.)])/.exec(line)
  if (ordered !== null && itemMarker(line) !== undefined) return `${ordered[1]}\\${line.slice(ordered[1]?.length)}`
  return startsBlock(line) && !line.startsWith('<') ? `\\${line}` : line
}

/**
 * The item's lead-in and body, or undefined when it does not open with one.
 * The body is the rest of the first line followed by every later line
 * de-indented out of the item, so a nested list or a fence inside it comes out
 * at column 0, ready to be markdown of its own.
 */
const stepItem = ({ marker, lines, openFence }: RawItem): StepItem | undefined => {
  const lead = LEAD_IN.exec(marker.content)
  if (lead === null) return undefined
  const [, ...later] = lines.map((line) => dedent(line, marker.contentColumn))
  const sameLine = marker.content.slice(lead[0].length).replace(/^[ \t]+/, '')
  // The body's first line is paragraph text when it continues the lead-in's
  // paragraph: the rest of the lead-in's own line, or — when that is empty —
  // the next line, unless that line opens a block of its own.
  const next = later[0]
  const continues = sameLine.length === 0 && next !== undefined && !isBlank(next) && !interruptsParagraph(next)
  const rest = [
    ...(sameLine.length > 0 ? [asParagraphText(sameLine)] : []),
    ...(continues ? [asParagraphText(next.replace(/^[ \t]+/, '')), ...later.slice(1)] : later),
  ].map((line) => (isBlank(line) ? '' : line))
  const first = rest.findIndex((line) => line.length > 0)
  const last = rest.findLastIndex((line) => line.length > 0)
  // CommonMark closes a fence left open at the end of the item. Out of the
  // item nothing would, and it would run on through the closing tags.
  const closing = openFence === undefined ? [] : [openFence]
  return { lead: lead[1] ?? '', body: first === -1 ? '' : [...rest.slice(first, last + 1), ...closing].join('\n') }
}

/**
 * Finds the lists in a description that can be rendered as steps: top-level
 * ordered lists whose every item opens with a bold lead-in.
 *
 * All or nothing, per list. One item without a lead-in keeps the whole list a
 * list, because an author who wrote it that way wrote a list — and a list
 * converted halfway reads as two components that happen to touch.
 *
 * Only the top level: a list nested in another list's item, in a blockquote or
 * in a fence is part of that block, and every list and fence at the top level
 * is read to its end so nothing inside one is mistaken for the start of another.
 * An ordered list starting at anything but 1 cannot interrupt a paragraph in
 * CommonMark, so `…in\n2. **Two.** x` is prose and stays prose.
 */
export const stepLists = (lines: readonly string[]): readonly StepList[] => {
  const found: StepList[] = []
  let fence: string | undefined
  let html: HtmlBlockEnd | undefined
  let paragraph = false
  let index = 0

  while (index < lines.length) {
    const line = lines[index] ?? ''
    if (fence !== undefined) {
      if (closesFence(line, fence)) fence = undefined
      index += 1
      continue
    }
    if (html !== undefined) {
      if (html === 'blank' ? isBlank(line) : html(line)) html = undefined
      index += 1
      continue
    }
    // Raw HTML runs to its own end, and a list inside it is text the author
    // kept out of markdown — converting one put tags inside a comment and
    // left their closing halves outside it.
    const block = htmlBlockStart(line, paragraph)
    if (block !== undefined) {
      html = block === 'blank' || !block(line) ? block : undefined
      paragraph = false
      index += 1
      continue
    }
    const opened = fenceMarker(line)
    if (opened !== undefined) {
      fence = opened
      paragraph = false
      index += 1
      continue
    }
    const marker = itemMarker(line)
    if (marker !== undefined && (!marker.ordered || marker.one || !paragraph)) {
      const { items, end } = readList(lines, index)
      const steps = marker.ordered ? items.map(stepItem) : []
      if (steps.length > 0 && steps.every((step) => step !== undefined)) {
        found.push({ start: index, end, items: steps.filter((step) => step !== undefined) })
      }
      paragraph = false
      index = end
      continue
    }
    // What an ordered list may not interrupt is a paragraph, so the lines
    // that are something else — a heading, a break, an indented code block
    // (four columns in, with no paragraph open to continue) — do not count.
    const indentedCode: boolean = indentOf(line) >= 4 && !paragraph
    paragraph = !isBlank(line) && !indentedCode && !ATX_HEADING.test(line) && !THEMATIC_BREAK.test(line)
    index += 1
  }
  return found
}
