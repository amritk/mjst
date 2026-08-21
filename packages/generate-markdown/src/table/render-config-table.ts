import { codeSpan } from '#helpers/code-span'
import { displayType } from '#helpers/display-type'
import { collapseLineEndings, escapeHtml } from '#helpers/escape-html'
import { formatList, formatValue } from '#helpers/format-value'
import {
  asArray,
  asProperties,
  asSchema,
  asText,
  isObject,
  isObjectWithProperties,
  stringExtension,
} from '#helpers/guards'
import type { ConfigSchema, SchemaProperty } from '#types/schema'

/**
 * Which optional columns to render. A column is only shown when at least one
 * property somewhere in the schema would put content in it, so a table never
 * carries a column that is empty for every row. The set is computed once for the
 * whole schema and shared by the main table and every nested table so all tables
 * keep the same shape (and the detail row's `colspan` stays correct).
 */
type Columns = {
  readonly cliFlag: boolean
  readonly type: boolean
  readonly required: boolean
  readonly default: boolean
}

/**
 * Builds the content of the full-width row beneath a property's metadata. It
 * always leads with the first paragraph of the description and then appends the
 * allowed values (`enum`) and sample values (`examples`) when the schema
 * provides them, so readers see the constraints the metadata columns can't hold.
 */
const renderDetailCell = (prop: SchemaProperty): string => {
  // First paragraph gives enough context without making the table unwieldy
  const desc = escapeHtml(
    asText(prop.description)
      // Normalise first, then split. Spelling the alternation inline —
      // `(?:\r\n|\r|\n)[ \t]*(?:\r\n|\r|\n)` — lets the engine backtrack the
      // first group to a bare `\r` and hand the `\n` to the second, so a single
      // CRLF matched and everything after the first line break was dropped.
      .replace(/\r\n?/g, '\n')
      .split(/\n[ \t]*\n/)[0] ?? '',
  )
  const lines = [desc]
  if (asArray(prop.enum).length > 0) lines.push(`<strong>Allowed:</strong> ${formatList(prop.enum)}`)
  if (asArray(prop.examples).length > 0) lines.push(`<strong>Examples:</strong> ${formatList(prop.examples)}`)
  return lines.filter((line) => line.length > 0).join('<br>')
}

/**
 * True when any property in the tree (including nested object properties)
 * satisfies the predicate. Used to decide whether an optional column has any
 * content to show across the whole schema.
 */
const anyProperty = (properties: unknown, predicate: (prop: SchemaProperty) => boolean): boolean =>
  Object.values(asProperties(properties)).some((entry) => {
    const prop = asSchema(entry)
    return predicate(prop) || anyProperty(prop.properties, predicate)
  })

/**
 * True when the schema (or any nested object) marks at least one *rendered*
 * property as required. Required-ness lives on the parent's `required` array
 * rather than on the property itself, so this walks the `required`/`properties`
 * pairs directly.
 *
 * A name is only counted when `properties` declares it, because that is what
 * `renderRow` ticks. Taking any non-empty `required` array gave a schema whose
 * list names a property it does not declare — a typo, or a name left behind by
 * an edit — a Required column that stayed blank on every row, precisely the
 * empty column this scan exists to suppress.
 */
const anyRequired = (input: unknown): boolean => {
  const { properties, required } = asSchema(input)
  if (!isObject(properties)) return false
  const names = new Set(asArray(required))
  if (Object.keys(properties).some((name) => names.has(name))) return true
  return Object.values(properties).some(anyRequired)
}

/**
 * Decides which optional columns to render by scanning the whole schema once.
 * A column is included only when something would fill it, so empty columns
 * (e.g. CLI flags or defaults the schema never uses) disappear entirely.
 */
const resolveColumns = (schema: ConfigSchema): Columns => ({
  // Truthiness, matching what `renderRow` will actually put in the cell: keying
  // off `!== undefined` gave `"x-cli-flag": ""` a column that stayed blank on
  // every row — precisely the empty column this scan exists to suppress.
  cliFlag: anyProperty(schema.properties, (prop) => stringExtension(prop['x-cli-flag']) !== undefined),
  type: anyProperty(schema.properties, (prop) => displayType(prop).length > 0),
  required: anyRequired(schema),
  default: anyProperty(schema.properties, (prop) => prop.default !== undefined && prop.default !== null),
})

/** The number of rendered columns, used for the full-width detail row's colspan. */
const columnCount = (columns: Columns): number =>
  1 + Number(columns.cliFlag) + Number(columns.type) + Number(columns.required) + Number(columns.default)

/**
 * Header row shared by the main table and every nested detail table. The
 * description has no header of its own — it lives in a full-width row under each
 * property's metadata. Only the columns selected in {@link Columns} are emitted.
 */
const renderTableHead = (columns: Columns): string => {
  const headers = ['<th>Property</th>']
  if (columns.cliFlag) headers.push('<th>CLI Flag</th>')
  if (columns.type) headers.push('<th>Type</th>')
  if (columns.required) headers.push('<th align="center">Required</th>')
  if (columns.default) headers.push('<th align="center">Default</th>')
  return ['<thead>', '<tr>', ...headers, '</tr>', '</thead>'].join('\n')
}

/**
 * Builds an anchor id for an object property's detail table from its dotted path
 * (e.g. `server.tls` → `config-server-tls`). Explicit ids keep the in-table links
 * working regardless of how the host renderer slugifies headings.
 *
 * Every character outside `[A-Za-z0-9_-]` collapses to `-`, so the id is always
 * safe to drop into an unquoted-by-accident HTML attribute: a property named
 * `a"b` used to emit `id="config-a"b"`, terminating the attribute early.
 * Collapsing is lossy, which is why {@link buildAnchorIds} — not this function —
 * is what callers use; it resolves the collisions the collapse creates.
 */
const anchorId = (path: string): string => `config-${path.replace(/[^A-Za-z0-9_-]/g, '-')}`

/**
 * Identifies a node by its path *segments* rather than the dotted path they
 * render as. The dotted form is ambiguous — a root property literally named
 * `a.b` and `b` nested under `a` both display as `a.b` — so using it as a key
 * made the two nodes share one entry.
 */
const anchorKey = (segments: readonly string[]): string => JSON.stringify(segments)

/** Every node that will get its own detail table, in render order. */
const objectPaths = (properties: unknown, segments: readonly string[]): (readonly string[])[] =>
  Object.entries(asProperties(properties)).flatMap(([name, entry]) => {
    const prop = asSchema(entry)
    if (!isObjectWithProperties(prop)) return []
    const child = [...segments, name]
    return [child, ...objectPaths(prop.properties, child)]
  })

/**
 * Assigns each detail table a unique anchor id up front, so a row's link and the
 * table it points at agree without either having to see the other.
 *
 * {@link anchorId} is not injective — both nodes above collapse to
 * `config-a-b`, as does a property named `a"b` — and duplicate ids meant one of
 * the colliding tables was simply unreachable, every link landing on whichever
 * came first. Collisions get a `-2`, `-3`, … suffix in render order.
 */
const buildAnchorIds = (properties: unknown): ReadonlyMap<string, string> => {
  const used = new Set<string>()
  const ids = new Map<string, string>()
  for (const segments of objectPaths(properties, [])) {
    const base = anchorId(segments.join('.'))
    let id = base
    for (let suffix = 2; used.has(id); suffix++) id = `${base}-${suffix}`
    used.add(id)
    ids.set(anchorKey(segments), id)
  }
  return ids
}

/**
 * Renders a property as two table rows: a metadata row (name, optional flag,
 * type, required, default) and a full-width detail row beneath it carrying the
 * description plus any allowed values (`enum`) and sample values (`examples`).
 * Icons and CLI flags are shown only when the property declares them — there is
 * no placeholder, and columns the schema never uses are omitted entirely. Object
 * properties with nested fields link to their own detail table rendered below.
 */
const renderRow = (
  name: string,
  prop: SchemaProperty,
  required: ReadonlySet<string>,
  segments: readonly string[],
  columns: Columns,
  anchors: ReadonlyMap<string, string>,
): string => {
  const code = `<code>${escapeHtml(name)}</code>`
  const anchor = anchors.get(anchorKey(segments))
  const label = isObjectWithProperties(prop) && anchor ? `<a href="#${anchor}">${code}</a>` : code
  // `x-icon` is schema-controlled text like every other field, so it must be
  // escaped before interpolation — otherwise an icon value containing HTML
  // (`<`, `&`) injects raw markup into the table.
  const icon = stringExtension(prop['x-icon'])
  const nameCell = icon ? `${escapeHtml(icon)} ${label}` : label

  const cliFlag = stringExtension(prop['x-cli-flag'])
  const cells = [`<td>${nameCell}</td>`]
  if (columns.cliFlag) cells.push(`<td>${cliFlag ? `<code>${escapeHtml(cliFlag)}</code>` : ''}</td>`)
  if (columns.type) {
    const type = displayType(prop)
    cells.push(`<td>${type ? `<code>${escapeHtml(type)}</code>` : ''}</td>`)
  }
  if (columns.required) cells.push(`<td align="center">${required.has(name) ? '✅' : ''}</td>`)
  if (columns.default) cells.push(`<td align="center">${prop.default != null ? formatValue(prop.default) : ''}</td>`)

  return [
    '<tr>',
    ...cells,
    '</tr>',
    '<tr>',
    `<td colspan="${columnCount(columns)}">${renderDetailCell(prop)}</td>`,
    '</tr>',
  ].join('\n')
}

/**
 * Renders the table for one object's properties followed by a detail table for
 * each nested object property (recursively). The root call passes an empty path
 * and omits a heading; nested calls add an anchored heading so parent rows can
 * link straight to the relevant table.
 */
const renderTables = (
  properties: unknown,
  required: ReadonlySet<string>,
  segments: readonly string[],
  columns: Columns,
  anchors: ReadonlyMap<string, string>,
): readonly string[] => {
  const entries = Object.entries(asProperties(properties))
  const rows = entries.map(([name, prop]) =>
    renderRow(name, asSchema(prop), required, [...segments, name], columns, anchors),
  )
  const table = ['<table>', renderTableHead(columns), '<tbody>', ...rows, '</tbody>', '</table>'].join('\n')
  const path = segments.join('.')
  // The heading is the one place a property name reaches the output outside a
  // `<td>`, and it is markdown rather than HTML — so it is contained by
  // `codeSpan` (whose content is literal) plus `collapseLineEndings`, not by
  // `escapeHtml`, which would display `&lt;` where the name says `<`. What a
  // code span cannot contain — a splice marker — the guard in `generateMarkdown`
  // catches instead, by refusing to write.
  const block = segments.length
    ? `<a id="${anchors.get(anchorKey(segments)) ?? anchorId(path)}"></a>\n#### ${codeSpan(collapseLineEndings(path))}\n\n${table}`
    : table

  const nested = entries.flatMap(([name, entry]) => {
    const prop = asSchema(entry)
    if (!isObjectWithProperties(prop)) return []
    return renderTables(prop.properties, new Set(asArray(prop.required)), [...segments, name], columns, anchors)
  })

  return [block, ...nested]
}

/**
 * Renders the config reference: a main properties table plus a linked detail
 * table for every nested object property. Descriptions use the first paragraph
 * from the schema so each table stays readable without losing context.
 */
export const renderConfigTable = (input: ConfigSchema): string => {
  // A schema file holding `null` parses fine and reached `schema.required`.
  const schema = (isObject(input) ? input : {}) as ConfigSchema
  const required = new Set(asArray(schema.required))
  const columns = resolveColumns(schema)
  const anchors = buildAnchorIds(schema.properties)
  return renderTables(schema.properties, required, [], columns, anchors).join('\n\n')
}
