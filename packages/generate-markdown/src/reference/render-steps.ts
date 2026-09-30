import { escapeAttribute } from '#helpers/escape-html'
import { type StepItem, stepLists } from '#helpers/step-lists'
import { stepTitle } from '#helpers/step-title'
import type { DocSteps } from '#types/doc'
import type { PageAnchors, RenderContext } from '#types/render'

/**
 * What a step whose title slugs to nothing (`**🚀**`, `**…**`) is called in its
 * id. An empty `id=""` is worse than a dull one: a site that links to its steps
 * has nowhere to link.
 */
const FALLBACK_ID = 'step'

/**
 * Where the step tags sit inside the list's wrapper. Indented for the reader of
 * the markdown, and by no more than three columns, past which CommonMark reads
 * the tag as an indented code block instead of HTML.
 */
const STEP_INDENT = '  '

/**
 * Fills `{id}` and `{title}` in one pass, so a title that happens to contain
 * `{id}` is printed as written rather than filled a second time.
 */
const fill = (template: string, id: string, title: string): string =>
  template.replace(/\{(id|title)\}/g, (_, name: string) => (name === 'id' ? id : title))

/** The step markup for one list, with a blank line around every body so the site parses it as markdown. */
const stepsMarkup = (items: readonly StepItem[], steps: DocSteps, ids: PageAnchors): readonly string[] => {
  const lines: string[] = []
  if (steps.open.length > 0) lines.push(steps.open)
  for (const { lead, body } of items) {
    const title = stepTitle(lead)
    const slug = ids.claim(title)
    const id = slug.length > 0 ? slug : ids.claim(FALLBACK_ID)
    const attribute = escapeAttribute(title)
    lines.push(`${STEP_INDENT}${fill(steps.stepOpen, id, attribute)}`)
    // No blank lines for an empty body: they would only separate the two tags.
    if (body.length > 0) lines.push('', body, '')
    lines.push(`${STEP_INDENT}${fill(steps.stepClose, id, attribute)}`)
  }
  if (steps.close.length > 0) lines.push(steps.close)
  return lines
}

/**
 * Renders the lead-in ordered lists of a piece of prose as the docs site's step
 * component, when the schema asked for one — and returns the prose untouched
 * when it did not, so a schema without `x-mjst.markdown.steps` renders byte for
 * byte what it always has.
 *
 * Only prose that is rendered in full comes through here: descriptions under
 * a heading, page and section prose, notes and footers. A table cell keeps its
 * one-line summary, because a component spanning a dozen lines has no business
 * in a row.
 *
 * The markup is set off by a blank line on each side. An HTML block of this
 * kind cannot interrupt a paragraph, so without the line above it a list
 * written straight under its intro sentence would print its tags as text.
 */
export const renderSteps = (markdown: string, context: RenderContext): string => {
  const { steps } = context
  if (steps === undefined) return markdown
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n')
  const lists = stepLists(lines)
  if (lists.length === 0) return markdown

  const output: string[] = []
  let cursor = 0
  for (const list of lists) {
    output.push(...lines.slice(cursor, list.start))
    if (output.length > 0 && output.at(-1)?.trim() !== '') output.push('')
    output.push(...stepsMarkup(list.items, steps, context.stepIds))
    cursor = list.end
    if (cursor < lines.length && lines[cursor]?.trim() !== '') output.push('')
  }
  output.push(...lines.slice(cursor))
  return output.join('\n')
}
