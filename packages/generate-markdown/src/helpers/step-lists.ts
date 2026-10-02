import {
  dedent,
  interruptsParagraph,
  isBlank,
  itemMarker,
  type RawItem,
  startsBlock,
  topLevelBlocks,
} from '#helpers/markdown-blocks'

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

/**
 * `**Title.**` at the very start of an item, and the `.` or `:` an author puts
 * straight after the closing `**` instead of inside it. The lead-in has to be
 * followed by whitespace or the end of the line, so `**a**b` — one word, half
 * of it bold — is not mistaken for a title.
 */
const LEAD_IN = /^\*\*(?![\s*])(.*?\S)\*\*[.:]?(?=\s|$)/

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
export const stepLists = (lines: readonly string[]): readonly StepList[] =>
  topLevelBlocks(lines).flatMap((block): readonly StepList[] => {
    if (block.kind !== 'list' || block.items[0]?.marker.ordered !== true) return []
    const steps = block.items.map(stepItem)
    if (!steps.every((step) => step !== undefined)) return []
    return [{ start: block.start, end: block.end, items: steps }]
  })
