/** A line that opens or closes a fenced block, with the run that delimits it. */
const fenceMarker = (line: string): string | undefined => /^ {0,3}(`{3,}|~{3,})/.exec(line)?.[1]

/** True when the line is indented enough to be an indented code block. */
const isIndentedCode = (line: string): boolean => /^(?: {4}|\t)/.test(line)

/**
 * Splits a description into paragraphs without cutting a code block in half.
 *
 * A blank line ends a paragraph — except inside a code block, where it is part
 * of the sample. Both kinds have to be recognised:
 *
 * - A fenced block runs until a line whose run is the same character and *at
 *   least as long* as the one that opened it. Tracking only the character let a
 *   ``` line close a ```` block, which is a real nesting people write.
 * - An indented block continues across a blank line whenever the next non-blank
 *   line is still indented.
 *
 * Splitting regardless took a block apart: one half was dropped, and printing
 * the other opened a fence that swallowed the rest of the page.
 */
const splitParagraphs = (value: string): readonly string[] => {
  const lines = value.replace(/\r\n?/g, '\n').split('\n')
  const paragraphs: string[] = []
  let current: string[] = []
  let fence: string | undefined

  for (const [index, line] of lines.entries()) {
    const marker = fenceMarker(line)
    if (fence === undefined && marker !== undefined) fence = marker
    else if (fence !== undefined && marker !== undefined && marker[0] === fence[0] && marker.length >= fence.length) {
      fence = undefined
    }

    if (fence === undefined && /^[ \t]*$/.test(line)) {
      const next = lines.slice(index + 1).find((entry) => !/^[ \t]*$/.test(entry))
      // The paragraph has to have *started* as an indented block. Asking
      // whether any line in it is indented also caught a lazy continuation —
      // an ordinary paragraph whose second line happens to be indented — and
      // glued the code block after it into the same paragraph.
      const inIndentedBlock = isIndentedCode(current[0] ?? '') && next !== undefined && isIndentedCode(next)
      if (!inIndentedBlock) {
        if (current.length > 0) paragraphs.push(current.join('\n'))
        current = []
        continue
      }
    }
    current.push(line)
  }
  if (current.length > 0) paragraphs.push(current.join('\n'))
  return paragraphs
}

/**
 * Trims the whitespace around a block, keeping the indentation that means
 * something: four spaces at the start of a line is what makes an indented code
 * block code, and stripping it turned a sample of HTML into live markup on the
 * page. One to three spaces mean nothing to markdown, so they go.
 */
const trimBlankLines = (value: string): string => {
  // No leading blank lines to strip: a paragraph never starts with one, because
  // a blank line is what ends the paragraph before it.
  const trimmed = value.replace(/\s+$/, '')
  return isIndentedCode(trimmed) ? trimmed : trimmed.replace(/^[ \t]+/, '')
}

/**
 * Trims a whole description for rendering.
 *
 * `String.prototype.trim` is the wrong tool: it takes the leading four spaces
 * off a description that opens with an indented code block, and a sample of
 * HTML then reaches the reader as live markup. Leading blank lines go, the
 * indentation of the first line stays when it is what makes that line code.
 */
export const trimDescription = (value: string): string => trimBlankLines(value.replace(/^(?:[ \t]*\n)+/, ''))

/** True when the whole paragraph is a code block, fenced or indented. */
const isCodeBlock = (paragraph: string): boolean =>
  fenceMarker(paragraph.split('\n')[0] ?? '') !== undefined || isIndentedCode(paragraph)

/**
 * Which paragraph a table row can hold — the first one that is not a code
 * block, because a row is one line and a code block is not one line.
 *
 * A description opening with a sample used to put that sample in the cell: the
 * indent that made it code was trimmed off on the way in, and `<div>` in a
 * schema's prose reached the reader as live markup rather than as the snippet
 * they were told to paste. Fenced blocks fared no better, arriving as
 * ``` ```js code ``` ``` on one line.
 */
const rowParagraph = (paragraphs: readonly string[]): number => paragraphs.findIndex((entry) => !isCodeBlock(entry))

/**
 * The first paragraph of a description a table row can hold. Table cells hold
 * one line, so the rest of a long description belongs on the property's own
 * heading rather than squeezed into a row.
 */
export const firstParagraph = (value: string): string => {
  const paragraphs = splitParagraphs(value)
  const index = rowParagraph(paragraphs)
  return index === -1 ? '' : trimBlankLines(paragraphs[index] ?? '').trim()
}

/**
 * Everything the row could not hold.
 *
 * A table row holds one line, so it carries {@link firstParagraph} and no more.
 * When the block below a row skips what the row already said, this is the part
 * it must still print — those paragraphs have appeared nowhere else, the
 * opening code sample included.
 */
export const remainingParagraphs = (value: string): string => {
  const paragraphs = splitParagraphs(value)
  const index = rowParagraph(paragraphs)
  return trimBlankLines(paragraphs.filter((_, position) => position !== index).join('\n\n'))
}
