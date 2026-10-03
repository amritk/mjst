import { topLevelBlocks } from '#helpers/markdown-blocks'

/** A paragraph that is nothing but one bold span, and the lines it spans. */
export type BoldLabel = {
  readonly start: number
  readonly end: number
  /** The text inside the bold span, exactly as written, line endings and all. */
  readonly lead: string
}

/**
 * A whole paragraph of one bold span — `**Text**` or `__Text__` — with at most
 * a `:` after it. The span has to open and close on non-whitespace, as
 * CommonMark's flanking rules have it, or it is not bold at all.
 */
const BOLD_ONLY = /^(\*\*|__)(?!\s)([\s\S]*?\S)\1:?$/

/**
 * The text of the one bold span a paragraph consists of, or undefined when it
 * is anything more. Two spans side by side (`**a** and **b**`) are not one,
 * and neither is a span whose closing run is escaped.
 */
const boldOnly = (paragraph: string): string | undefined => {
  const match = BOLD_ONLY.exec(paragraph)
  const delimiter = match?.[1]
  const lead = match?.[2]
  if (delimiter === undefined || lead === undefined) return undefined
  if (lead.includes(delimiter)) return undefined
  const escapes = /\\*$/.exec(lead)?.[0].length ?? 0
  return escapes % 2 === 0 ? lead : undefined
}

/**
 * Finds the paragraphs that label the prose after them: a top-level paragraph
 * that is a single bold span and nothing else, the way an author marks
 * **First release** and **Switch to trusted publishing** in a description
 * that cannot carry real headings.
 *
 * Only the top level. A bold span opening a longer paragraph is a lead-in, and
 * one inside a fence, a blockquote, a list item or raw HTML belongs to that
 * block — which is also what keeps a step's body out of it, a step being a
 * list item until it is rendered.
 */
export const boldLabels = (lines: readonly string[]): readonly BoldLabel[] =>
  topLevelBlocks(lines).flatMap((block): readonly BoldLabel[] => {
    if (block.kind !== 'paragraph') return []
    const paragraph = lines
      .slice(block.start, block.end)
      .map((line) => line.trim())
      .join('\n')
    const lead = boldOnly(paragraph)
    return lead === undefined ? [] : [{ start: block.start, end: block.end, lead }]
  })
