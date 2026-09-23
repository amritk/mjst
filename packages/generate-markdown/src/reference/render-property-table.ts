import { formatInlineLiteral } from '#helpers/format-literal'
import { headingAnchor } from '#helpers/heading-anchor'
import { propertyHeading } from '#helpers/heading-text'
import { linkDestination } from '#helpers/link-destination'
import { readDescription, readDocMeta } from '#helpers/read-doc-meta'
import { referenceType } from '#helpers/reference-type'
import { relativeDocLink } from '#helpers/relative-doc-link'
import { tableCell, tableCode, tableFragment } from '#helpers/table-cell'
import type { DocMeta, DocTable, DocTableColumn } from '#types/doc'
import type { DocEntry, RenderContext } from '#types/render'

/**
 * Type labels that leave a reader no better off than a blank cell. `object` is
 * what every nested bag of options is, and an empty label is a shape the schema
 * never stated — a table of twenty rows saying `object` spends a column on one
 * word twenty times.
 *
 * Deliberately not "every row says the same thing": a table where every row is
 * `string` is worth the column, because "these are all strings" is a fact about
 * the options, and the next property added to it may well not be one.
 */
const UNINFORMATIVE_TYPES: ReadonlySet<string> = new Set(['', 'object'])

/**
 * Whether an `auto` column is worth its width, given whether any row fills it.
 * `always` and `never` are the schema overruling the judgement — the docs site
 * whose tables all have to line up, and the reference whose readers do not
 * think in types.
 */
const showColumn = (column: DocTableColumn, filled: boolean): boolean =>
  column === 'always' || (column === 'auto' && filled)

/**
 * The properties of a table in the order its rows appear: the order the caller
 * handed over, or the required ones first when the schema asked for that.
 *
 * A stable partition, so `sort` and `x-doc.order` still decide the order within
 * each group. Exported because the callers need the same order for the blocks
 * they render under the table: those follow their rows, and the anchors are
 * numbered in the order the headings print, so a block order that disagreed
 * with the rows would read out of sequence and number the repeats by the wrong
 * one.
 */
export const tableOrder = (entries: readonly DocEntry[], table: DocTable): readonly DocEntry[] =>
  table.requiredFirst
    ? [...entries.filter((entry) => entry.required), ...entries.filter((entry) => !entry.required)]
    : entries

/** How a table is rendered, beyond the properties themselves. */
export type PropertyTableOptions = {
  /**
   * Whether a property's own block — the part of it a row cannot hold — holds
   * more than its heading.
   *
   * Asked only about a property documented in a `table` section on another
   * page, which is the one case neither this table nor that page's registry can
   * answer: such a section gives a heading to exactly the properties whose
   * block has something in it. Everything on this page is answered by the
   * anchors its headings claimed, so most callers have nothing to pass.
   */
  readonly summarised?: (entry: DocEntry) => boolean
}

/**
 * The anchor of a property documented on another page, or an empty string when
 * it has no heading there to land on.
 *
 * Where it is documented decides whether there is one. In a section, the
 * section's layout does: a `table` section gives a heading to exactly the
 * properties that have something beyond their row, `none` renders nothing at
 * all, and `headings` gives every property one unless it asked not to have it.
 * On a page of its own it joins that page's property list, which is a heading
 * each with the same exception.
 *
 * The one thing it cannot know is how that page numbers a repeat of the same
 * name, its anchors being that page's to hand out: two `name` headings there
 * and this link lands on the first. A link to the wrong section of the right
 * page is the worst this gets, and only for a page that repeats a name — the
 * same-page links, where a repeat is common enough to have shown up in this
 * package's own fixtures, are numbered exactly.
 */
const anchorElsewhere = (
  entry: DocEntry,
  meta: DocMeta,
  context: RenderContext,
  summarised: (entry: DocEntry) => boolean,
): string => {
  const section = meta.section !== undefined ? context.sections.get(meta.section) : undefined
  const layout = section?.layout ?? 'headings'
  if (layout === 'none') return ''
  const headed = layout === 'table' ? summarised(entry) : meta.heading
  return headed ? headingAnchor(propertyHeading(entry.name, meta.title).text) : ''
}

/**
 * Where a property's row points, or undefined for a row that stays an inert
 * code span.
 *
 * A property documented on another page is named here and linked there, rather
 * than being duplicated into two places that drift apart. The page can be named
 * by the property or by the section it joins — a section carries its properties
 * to its own page, and a row that ignored that led nowhere.
 *
 * Either way the link carries the anchor of the property's own heading when it
 * has one, so a reader who wants the detail lands on it rather than at the top
 * of a page they then have to search. That includes the property documented
 * right below this table, which used to be the one case that was left inert.
 */
const rowDestination = (
  entry: DocEntry,
  meta: DocMeta,
  context: RenderContext,
  summarised: (entry: DocEntry) => boolean,
): string | undefined => {
  const pageId = meta.page ?? (meta.section !== undefined ? context.sections.get(meta.section)?.page : undefined)
  const file = pageId !== undefined ? context.pageFiles.get(pageId) : undefined
  const elsewhere = file !== undefined && file !== context.file
  // On this page the heading itself is the answer: it claimed its anchor as it
  // rendered — numbering included — and a property that never got one is not in
  // the registry at all. Nothing is guessed, so nothing can be guessed wrong.
  const anchor = elsewhere ? anchorElsewhere(entry, meta, context, summarised) : (context.anchors.anchorOf(entry) ?? '')
  // A heading of nothing but punctuation slugs to nothing, and `#` on its own
  // is a link to the top of the page dressed up as a link to the property.
  const fragment = anchor.length > 0 ? `#${linkDestination(anchor)}` : ''
  if (elsewhere) return `${linkDestination(relativeDocLink(context.file, file))}${fragment}`
  return fragment.length > 0 ? fragment : undefined
}

/**
 * Renders a set of properties as a markdown table — the compact layout for a
 * flat bag of options, where a heading each would be all ceremony and no
 * content.
 *
 * Every column has to earn its width, because the one that matters is
 * **Description** and a narrow viewport gives it what the others leave. By
 * default **Type** and **Default** are dropped when no row fills them with
 * anything the reader could act on, and requiredness is a marker in the
 * **Property** cell rather than a column: on a real page five rows in twenty
 * are required, which is a column of blanks carrying one bit.
 *
 * All of that is the default rather than the rule — a schema that wants its
 * types spelled out everywhere, or its required options listed first, says so
 * in the root `x-doc.table` and every table on every page follows it. See
 * {@link DocTable}.
 */
export const renderPropertyTable = (
  entries: readonly DocEntry[],
  context: RenderContext,
  options: PropertyTableOptions = {},
): string => {
  const style = context.table.required
  const marker = tableFragment(context.table.requiredMarker)
  const summarised = options.summarised ?? (() => false)
  const properties = tableOrder(entries, context.table).map((entry) => ({
    entry,
    meta: readDocMeta(entry.prop),
    type: referenceType(entry.prop, context.language),
  }))
  const hasDefault = (entry: DocEntry): boolean => entry.prop.default !== undefined && entry.prop.default !== null
  const showType = showColumn(
    context.table.type,
    properties.some(({ type }) => !UNINFORMATIVE_TYPES.has(type)),
  )
  const showDefault = showColumn(context.table.default, entries.some(hasDefault))
  // No column of blanks even under `column`: the style says where requiredness
  // goes, not that a table of entirely optional properties should say so.
  const showRequired = style === 'column' && entries.some((entry) => entry.required)

  const headers = [
    'Property',
    ...(showType ? ['Type'] : []),
    ...(showRequired ? ['Required'] : []),
    ...(showDefault ? ['Default'] : []),
    'Description',
  ]

  const row = ({ entry, meta, type }: (typeof properties)[number]): string => {
    const destination = rowDestination(entry, meta, context, summarised)
    const name = tableCode(entry.name)
    const label = destination === undefined ? name : `[${name}](${destination})`
    // Under `column` the column says it instead.
    const cells = [entry.required && style === 'marker' ? `${label}${marker}` : label]
    if (showType) cells.push(type.length > 0 ? tableCode(type) : '')
    if (showRequired) cells.push(entry.required ? '✅' : '')
    if (showDefault) {
      cells.push(hasDefault(entry) ? tableCode(formatInlineLiteral(entry.prop.default, context.language)) : '')
    }
    cells.push(tableCell(readDescription(entry.prop)))
    return `| ${cells.join(' | ')} |`
  }

  return [`| ${headers.join(' | ')} |`, `| ${headers.map(() => '---').join(' | ')} |`, ...properties.map(row)].join(
    '\n',
  )
}
