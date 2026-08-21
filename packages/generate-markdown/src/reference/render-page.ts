import { heading } from '#helpers/heading'
import { renderExamples } from '#reference/render-examples'
import { renderProperty } from '#reference/render-property'
import type { DocConfig } from '#types/doc'
import type { PageModel, RenderContext } from '#types/render'

/**
 * Renders one page: its title and prose, the properties that belong to the page
 * itself, then each section with the properties assigned to it.
 *
 * Sections come after the page's own properties because a section is a grouping
 * a schema opts into — anything that never named one belongs to the page as a
 * whole, and reads best before the groupings start.
 */
export const renderPage = (model: PageModel, config: DocConfig, pageFiles: ReadonlyMap<string, string>): string => {
  const context: RenderContext = {
    language: config.language,
    layout: config.layout,
    sort: config.sort,
    file: model.page.file,
    page: model.page.id,
    pageFiles,
  }
  const level = config.headingLevel
  const blocks: string[] = []
  if (model.page.title !== undefined) blocks.push(heading(level, model.page.title))
  if (model.page.description !== undefined) blocks.push(model.page.description.trim())
  blocks.push(...renderExamples(model.page.examples, config.language))

  for (const entry of model.entries) blocks.push(...renderProperty(entry, level + 1, context))

  for (const { section, entries } of model.sections) {
    if (section.title !== undefined) blocks.push(heading(level + 1, section.title))
    if (section.description !== undefined) blocks.push(section.description.trim())
    blocks.push(...renderExamples(section.examples, config.language))
    for (const entry of entries) blocks.push(...renderProperty(entry, level + 2, context))
  }

  return `${blocks.filter((block) => block.length > 0).join('\n\n')}\n`
}
