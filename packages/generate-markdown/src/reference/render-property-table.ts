import { formatInlineLiteral } from '#helpers/format-literal'
import { linkDestination } from '#helpers/link-destination'
import { readDescription, readDocMeta } from '#helpers/read-doc-meta'
import { referenceType } from '#helpers/reference-type'
import { relativeDocLink } from '#helpers/relative-doc-link'
import { tableCell, tableCode } from '#helpers/table-cell'
import type { DocEntry, RenderContext } from '#types/render'

/**
 * Renders a set of properties as one markdown table — the compact layout for a
 * flat bag of options, where a heading each would be all ceremony and no
 * content.
 *
 * The **Required** and **Default** columns are dropped when no row fills them,
 * the same rule the HTML table renderer follows: a column of blanks tells the
 * reader nothing and costs them width.
 */
export const renderPropertyTable = (entries: readonly DocEntry[], context: RenderContext): string => {
  const showRequired = entries.some((entry) => entry.required)
  const showDefault = entries.some((entry) => entry.prop.default !== undefined && entry.prop.default !== null)

  const headers = ['Property', 'Type', ...(showRequired ? ['Required'] : []), ...(showDefault ? ['Default'] : [])]
  headers.push('Description')

  const rows = entries.map((entry) => {
    const meta = readDocMeta(entry.prop)
    // A property documented on another page is named here and linked there,
    // rather than being duplicated into two places that drift apart. The page
    // can be named by the property or by the section it joins — a section
    // carries its properties to its own page, and a row that ignored that led
    // nowhere.
    const pageId = meta.page ?? (meta.section !== undefined ? context.sectionPages.get(meta.section) : undefined)
    const page = pageId !== undefined ? context.pageFiles.get(pageId) : undefined
    const name = tableCode(entry.name)
    const label =
      page !== undefined && page !== context.file
        ? `[${name}](${linkDestination(relativeDocLink(context.file, page))})`
        : name
    const type = referenceType(entry.prop, context.language)
    const cells = [label, type.length > 0 ? tableCode(type) : '']
    if (showRequired) cells.push(entry.required ? '✅' : '')
    if (showDefault) {
      cells.push(
        entry.prop.default !== undefined && entry.prop.default !== null
          ? tableCode(formatInlineLiteral(entry.prop.default, context.language))
          : '',
      )
    }
    cells.push(tableCell(readDescription(entry.prop)))
    return `| ${cells.join(' | ')} |`
  })

  return [`| ${headers.join(' | ')} |`, `| ${headers.map(() => '---').join(' | ')} |`, ...rows].join('\n')
}
