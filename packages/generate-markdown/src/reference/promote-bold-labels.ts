import { boldLabels } from '#helpers/bold-labels'
import type { RenderedHeading } from '#helpers/heading-text'
import { headingProse } from '#helpers/heading-text'
import { stepTitle } from '#helpers/step-title'
import { renderHeading } from '#reference/page-anchors'
import type { RenderContext } from '#types/render'

/**
 * The heading a label becomes. Its inline markdown stays, a heading being able
 * to carry it; the one trailing `.` or `:` that reads naturally on a bold line
 * and like a typo on a heading goes. Undefined for a label a reader would see
 * as no text at all (`**.**`), which would make an empty heading.
 */
const labelHeading = (lead: string): RenderedHeading | undefined => {
  const text = stepTitle(lead)
  if (text.length === 0) return undefined
  return { markdown: headingProse(lead.replace(/\\?[.:]$/, '')), text }
}

/**
 * Turns the bold-only paragraphs of a piece of prose into real headings at
 * `level`, when the schema asked for that — and returns the prose untouched
 * when it did not, so a schema without `x-mjst.markdown.headings.promoteBold`
 * renders byte for byte what it always has.
 *
 * An author labels the parts of a long description with bold paragraphs
 * because the same text becomes JSDoc and an editor's hover, where a `#`
 * heading renders badly and a hard-coded level is wrong wherever the
 * description ends up nested. Here the level is known, so the labels can join
 * the page's table of contents.
 *
 * The caller passes the level the text's own children render at — one deeper
 * than the heading that owns the prose. Every heading claims its anchor on the
 * way through, like every other heading on the page, so a label repeated
 * twice or named like a property is numbered rather than sharing an anchor.
 *
 * Runs before steps are rendered: a step's body is still a list item then,
 * and a bold paragraph inside it is left alone with the rest of the item.
 */
export const promoteBoldLabels = (markdown: string, level: number, context: RenderContext): string => {
  if (!context.headings.promoteBold) return markdown
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n')
  const labels = boldLabels(lines)
  if (labels.length === 0) return markdown

  const output: string[] = []
  let cursor = 0
  for (const label of labels) {
    output.push(...lines.slice(cursor, label.start))
    const heading = labelHeading(label.lead)
    if (heading === undefined) output.push(...lines.slice(label.start, label.end))
    else output.push(renderHeading(level, heading, context))
    cursor = label.end
  }
  output.push(...lines.slice(cursor))
  return output.join('\n')
}
