import { collapseLineEndings } from '#helpers/escape-html'
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
    sectionPages: new Map(config.sections.map((section) => [section.id, section.page])),
  }
  const level = config.headingLevel
  const blocks: string[] = []
  // A title is schema text like any other. A line ending inside one ends the
  // heading and lets the rest of the title open a heading, a list or a fence of
  // its own — a fabricated section in the reader's table of contents.
  // Levels follow the headings that are actually emitted. A schema with no
  // title has no `#` for its properties to sit under, and starting them at `##`
  // left the file with no top-level heading at all.
  const titled = model.page.title !== undefined
  if (model.page.title !== undefined) blocks.push(heading(level, collapseLineEndings(model.page.title)))
  if (model.page.description !== undefined) blocks.push(model.page.description.trim())
  blocks.push(...renderExamples(model.page.examples, config.language))

  const entryLevel = titled ? level + 1 : level
  for (const entry of model.entries) blocks.push(...renderProperty(entry, entryLevel, context))

  for (const { section, entries } of model.sections) {
    if (section.title !== undefined) blocks.push(heading(entryLevel, collapseLineEndings(section.title)))
    if (section.description !== undefined) blocks.push(section.description.trim())
    blocks.push(...renderExamples(section.examples, config.language))
    const sectionEntryLevel = section.title !== undefined ? entryLevel + 1 : entryLevel
    for (const entry of entries) blocks.push(...renderProperty(entry, sectionEntryLevel, context))
  }

  return `${blocks.filter((block) => block.length > 0).join('\n\n')}\n`
}
