/**
 * Splits a description into its first paragraph and everything after it,
 * without cutting a fenced code block in half.
 *
 * A blank line ends a paragraph — except inside a fence, where it is just a
 * blank line in the sample. Splitting on it regardless took the two halves of a
 * fence apart: one half was dropped, and when the other half was printed its
 * closing ``` opened a fence that swallowed the rest of the page.
 */
const splitParagraphs = (value: string): readonly string[] => {
  const lines = value.replace(/\r\n?/g, '\n').split('\n')
  const paragraphs: string[] = []
  let current: string[] = []
  let fence: string | undefined

  for (const line of lines) {
    const marker = /^\s{0,3}(`{3,}|~{3,})/.exec(line)?.[1]
    if (fence === undefined && marker !== undefined) fence = marker[0]
    else if (fence !== undefined && marker !== undefined && marker[0] === fence) fence = undefined
    if (fence === undefined && /^[ \t]*$/.test(line)) {
      if (current.length > 0) paragraphs.push(current.join('\n'))
      current = []
      continue
    }
    current.push(line)
  }
  if (current.length > 0) paragraphs.push(current.join('\n'))
  return paragraphs
}

/**
 * The first paragraph of a description. Table cells hold one line, so the rest
 * of a long description belongs on the property's own heading rather than
 * squeezed into a row.
 */
export const firstParagraph = (value: string): string => (splitParagraphs(value)[0] ?? '').trim()

/**
 * Everything after the first paragraph.
 *
 * A table row holds one line, so it carries {@link firstParagraph} and no more.
 * When the block below a row skips what the row already said, this is the part
 * it must still print — those paragraphs have appeared nowhere else.
 */
export const remainingParagraphs = (value: string): string => splitParagraphs(value).slice(1).join('\n\n').trim()
