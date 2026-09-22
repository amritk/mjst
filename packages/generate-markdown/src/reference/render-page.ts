import { trimDescription } from '#helpers/first-paragraph'
import { proseHeading } from '#helpers/heading-text'
import { pageAnchors, renderHeading } from '#reference/page-anchors'
import { renderExamples } from '#reference/render-examples'
import { renderProperty, summarisedBlocks } from '#reference/render-property'
import { renderPropertyTable, tableOrder } from '#reference/render-property-table'
import type { DocConfig } from '#types/doc'
import type { PageModel, RenderContext } from '#types/render'

/**
 * Renders one page: its title and prose, the properties that belong to the page
 * itself, then each section with the properties assigned to it.
 *
 * Sections come after the page's own properties because a section is a grouping
 * a schema opts into — anything that never named one belongs to the page as a
 * whole, and reads best before the groupings start.
 *
 * A section lays its properties out the way it asks to: a heading each, one
 * table under its own heading, or nothing at all beyond its prose.
 */
export const renderPage = (model: PageModel, config: DocConfig, pageFiles: ReadonlyMap<string, string>): string => {
  const context: RenderContext = {
    language: config.language,
    layout: config.layout,
    sort: config.sort,
    table: config.table,
    file: model.page.file,
    page: model.page.id,
    pageFiles,
    sections: new Map(config.sections.map((section) => [section.id, section])),
    anchors: pageAnchors(),
  }
  const level = config.headingLevel
  const blocks: string[] = []
  // A title is schema text like any other. A line ending inside one ends the
  // heading and lets the rest of the title open a heading, a list or a fence of
  // its own — a fabricated section in the reader's table of contents.
  // Levels are fixed by the page's own structure, not by which headings the
  // schema happened to fill in. A page holds one top-level heading — its title
  // — and everything else sits below it. Promoting properties when the title is
  // missing gave a twelve-option schema twelve `#` headings, which is worse
  // than a page whose first heading is `##`: a docs site takes the single `#`
  // as the page title, and every linter counts more than one as an error. A
  // schema that wants that heading gives itself a `title`.
  if (model.page.title !== undefined) blocks.push(renderHeading(level, proseHeading(model.page.title), context))
  if (model.page.description !== undefined) blocks.push(trimDescription(model.page.description))
  blocks.push(...renderExamples(model.page.examples, config.language))

  for (const entry of model.entries) blocks.push(...renderProperty(entry, level + 1, context))

  for (const { section, entries } of model.sections) {
    if (section.title !== undefined) blocks.push(renderHeading(level + 1, proseHeading(section.title), context))
    if (section.description !== undefined) blocks.push(trimDescription(section.description))
    blocks.push(...renderExamples(section.examples, config.language))
    // A section's own layout, never `config.layout`: that one is the default for
    // a *property's* children, and letting it reach sections too would collapse
    // every grouping of a `layout: 'table'` schema into a table it never asked
    // for.
    const layout = section.layout ?? 'headings'
    // `none` is the section that documents itself: its prose and examples say
    // what the options are, so listing them again adds nothing.
    if (layout === 'none') continue
    if (layout === 'table' && entries.length > 0) {
      // Every property in the section still gets the block a row cannot hold —
      // its examples, its notes, the rest of its prose, its own children. The
      // `documentedElsewhere` test `renderProperty` uses for this is wrong here:
      // it treats any property naming a section as documented somewhere else,
      // and every property in this table names *this* one, so reusing it would
      // emit the table and silently drop all of it. A section carries its
      // properties to its own page, so the page they are documented on is the
      // page being rendered — there is nowhere else for them to be.
      //
      // Rendered before the table because the rows link into these blocks: a
      // block claims the anchor of the heading it opens with, and the table
      // reads the claims back. Rendering them the other way round would leave
      // every row pointing at nothing, and no second guess at which properties
      // have a heading can disagree with the headings themselves.
      //
      // In the table's own row order, which a split table reshuffles: the
      // blocks follow their rows down the page, and the anchors are numbered in
      // the order the headings print.
      const ordered = tableOrder(entries, context.table)
      const summaries = ordered.map((entry) => summarisedBlocks(entry, level + 2, context))
      blocks.push(renderPropertyTable(ordered, context))
      for (const summary of summaries) blocks.push(...summary)
      continue
    }
    for (const entry of entries) blocks.push(...renderProperty(entry, level + 2, context))
  }

  return `${blocks.filter((block) => block.length > 0).join('\n\n')}\n`
}
