import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

/**
 * Describes the shape of a single property entry inside a JSON Schema object.
 * We include the x- extension fields we added so the generator can produce
 * richer output (CLI flag labels, icons) without hard-coding them here, plus the
 * reference (`$ref`) and composition (`enum`/`const`/`anyOf`/…) keywords that
 * real-world schemas lean on. `type` is optional because a property can describe
 * itself purely through those keywords; {@link displayType} fills the gap.
 */
type SchemaProperty = {
  readonly type?: string | readonly string[]
  readonly $ref?: string
  readonly description?: string
  readonly $comment?: string
  readonly default?: unknown
  readonly enum?: readonly unknown[]
  readonly const?: unknown
  readonly examples?: readonly unknown[]
  readonly required?: readonly string[]
  readonly properties?: Readonly<Record<string, SchemaProperty>>
  readonly items?: SchemaProperty | readonly SchemaProperty[]
  readonly anyOf?: readonly SchemaProperty[]
  readonly oneOf?: readonly SchemaProperty[]
  readonly allOf?: readonly SchemaProperty[]
  readonly 'x-cli-flag'?: string
  readonly 'x-icon'?: string
}

/**
 * The top-level structure of our config.schema.json file. `$defs` holds the
 * reusable definitions that `$ref`s point at; they are inlined before rendering.
 */
type ConfigSchema = {
  readonly title: string
  readonly $comment?: string
  readonly required?: readonly string[]
  readonly properties: Readonly<Record<string, SchemaProperty>>
  readonly $defs?: Readonly<Record<string, SchemaProperty>>
  readonly examples?: readonly unknown[]
}

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

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * Follows a JSON pointer (the fragment after `#/`, e.g. `$defs/server`) from the
 * document root. Segments are unescaped per RFC 6901 (`~1` → `/`, `~0` → `~`).
 * Returns `undefined` when the pointer can't be resolved so a broken `$ref`
 * degrades gracefully instead of throwing.
 */
const resolvePointer = (root: Record<string, unknown>, ref: string): unknown => {
  if (!ref.startsWith('#/')) return undefined
  const segments = ref
    .slice(2)
    .split('/')
    .map((segment) => segment.replace(/~1/g, '/').replace(/~0/g, '~'))
  let current: unknown = root
  for (const segment of segments) {
    if (!isObject(current)) return undefined
    current = current[segment]
  }
  return current
}

/**
 * Inlines every `$ref` in the schema by resolving it against the document root
 * (typically into `$defs`) and recursing into the result. Sibling keywords on a
 * `$ref` node — most commonly `description` — win over the referenced target, as
 * JSON Schema 2020-12 allows. A `seen` set of pointers along the current branch
 * breaks recursive definitions: the second time a ref is encountered it collapses
 * to a bare object stub so generation always terminates.
 */
const dereference = (node: unknown, root: Record<string, unknown>, seen: ReadonlySet<string>): unknown => {
  if (Array.isArray(node)) return node.map((item) => dereference(item, root, seen))
  if (!isObject(node)) return node

  const { $ref: ref, ...siblings } = node
  if (typeof ref === 'string') {
    if (seen.has(ref)) {
      // Recursive reference: stop here, keeping any description from the ref site.
      return { type: 'object', ...(dereference(siblings, root, seen) as object) }
    }
    const target = dereference(resolvePointer(root, ref), root, new Set(seen).add(ref))
    return { ...(isObject(target) ? target : {}), ...(dereference(siblings, root, seen) as object) }
  }

  const resolved: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(node)) resolved[key] = dereference(value, root, seen)
  return resolved
}

/** Maps a JSON value to the JSON Schema type name that best describes it. */
const jsonTypeOf = (value: unknown): string => {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  return typeof value
}

/** Joins type names into a `a | b` union, dropping blanks and duplicates. */
const unionOf = (parts: readonly string[]): string => [...new Set(parts.filter((part) => part.length > 0))].join(' | ')

/**
 * Derives the type label to show for a property. Prefers the declared `type`
 * (string or `["string","null"]` union) and otherwise infers one from the
 * composition keywords real schemas use instead — `enum`, `const`, and
 * `anyOf`/`oneOf`/`allOf` — falling back to `object`/`array` when the shape is
 * implied by `properties`/`items`. Returns an empty string when nothing applies.
 */
const displayType = (prop: SchemaProperty): string => {
  if (typeof prop.type === 'string') return prop.type
  if (Array.isArray(prop.type)) return unionOf(prop.type.filter((entry): entry is string => typeof entry === 'string'))
  if (prop.enum && prop.enum.length > 0) return unionOf(prop.enum.map(jsonTypeOf))
  if (prop.const !== undefined) return jsonTypeOf(prop.const)
  for (const variants of [prop.anyOf, prop.oneOf, prop.allOf]) {
    if (variants && variants.length > 0) {
      const union = unionOf(variants.map(displayType).filter((type) => type !== 'null'))
      if (union.length > 0) return union
    }
  }
  if (prop.properties) return 'object'
  if (prop.items !== undefined) return 'array'
  return ''
}

/**
 * Escapes the HTML-significant characters so schema text (and CLI flags such as
 * `--schema <path>`) renders literally inside the HTML table cells.
 */
const escapeHtml = (value: string): string => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/**
 * Formats a JSON value for inline display inside an HTML table cell. Strings get
 * quoted so readers know they need quotes in their config.
 */
const formatValue = (value: unknown): string => {
  if (value === undefined || value === null) return ''
  if (typeof value === 'string') return `<code>"${escapeHtml(value)}"</code>`
  if (typeof value === 'boolean' || typeof value === 'number') return `<code>${value}</code>`
  return `<code>${escapeHtml(JSON.stringify(value))}</code>`
}

/**
 * Renders a comma-separated list of JSON values (used for `enum` and
 * `examples`), reusing {@link formatValue} so each entry is quoted and escaped
 * the same way a default is.
 */
const formatList = (values: readonly unknown[]): string => values.map(formatValue).join(', ')

/**
 * Builds the content of the full-width row beneath a property's metadata. It
 * always leads with the first paragraph of the description and then appends the
 * allowed values (`enum`) and sample values (`examples`) when the schema
 * provides them, so readers see the constraints the metadata columns can't hold.
 */
const renderDetailCell = (prop: SchemaProperty): string => {
  // First paragraph gives enough context without making the table unwieldy
  const desc = escapeHtml(prop.description?.split('\n\n')[0]?.replace(/\n/g, ' ') ?? '')
  const lines = [desc]
  if (prop.enum && prop.enum.length > 0) lines.push(`<strong>Allowed:</strong> ${formatList(prop.enum)}`)
  if (prop.examples && prop.examples.length > 0) lines.push(`<strong>Examples:</strong> ${formatList(prop.examples)}`)
  return lines.filter((line) => line.length > 0).join('<br>')
}

/**
 * True when any property in the tree (including nested object properties)
 * satisfies the predicate. Used to decide whether an optional column has any
 * content to show across the whole schema.
 */
const anyProperty = (
  properties: Readonly<Record<string, SchemaProperty>>,
  predicate: (prop: SchemaProperty) => boolean,
): boolean =>
  Object.values(properties).some(
    (prop) => predicate(prop) || (prop.properties ? anyProperty(prop.properties, predicate) : false),
  )

/**
 * True when the schema (or any nested object) marks at least one property as
 * required. Required-ness lives on the parent's `required` array rather than on
 * the property itself, so this walks the `required`/`properties` pairs directly.
 */
const anyRequired = (node: {
  readonly required?: readonly string[]
  readonly properties?: Readonly<Record<string, SchemaProperty>>
}): boolean => {
  if (node.required && node.required.length > 0) return true
  return node.properties ? Object.values(node.properties).some(anyRequired) : false
}

/**
 * Decides which optional columns to render by scanning the whole schema once.
 * A column is included only when something would fill it, so empty columns
 * (e.g. CLI flags or defaults the schema never uses) disappear entirely.
 */
const resolveColumns = (schema: ConfigSchema): Columns => ({
  cliFlag: anyProperty(schema.properties, (prop) => prop['x-cli-flag'] !== undefined),
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
 * Builds a stable anchor id for an object property's detail table from its
 * dotted path (e.g. `server.tls` → `config-server-tls`). Explicit ids keep the
 * in-table links working regardless of how the host renderer slugifies headings.
 */
const anchorId = (path: string): string => `config-${path.replace(/\./g, '-')}`

const isObjectWithProperties = (prop: SchemaProperty): boolean =>
  prop.properties !== undefined && Object.keys(prop.properties).length > 0

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
  path: string,
  columns: Columns,
): string => {
  const code = `<code>${escapeHtml(name)}</code>`
  const label = isObjectWithProperties(prop) ? `<a href="#${anchorId(path)}">${code}</a>` : code
  // `x-icon` is schema-controlled text like every other field, so it must be
  // escaped before interpolation — otherwise an icon value containing HTML
  // (`<`, `&`) injects raw markup into the table.
  const nameCell = prop['x-icon'] ? `${escapeHtml(prop['x-icon'])} ${label}` : label

  const cells = [`<td>${nameCell}</td>`]
  if (columns.cliFlag)
    cells.push(`<td>${prop['x-cli-flag'] ? `<code>${escapeHtml(prop['x-cli-flag'])}</code>` : ''}</td>`)
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
  properties: Readonly<Record<string, SchemaProperty>>,
  required: ReadonlySet<string>,
  path: string,
  columns: Columns,
): readonly string[] => {
  const rows = Object.entries(properties).map(([name, prop]) =>
    renderRow(name, prop, required, path ? `${path}.${name}` : name, columns),
  )
  const table = ['<table>', renderTableHead(columns), '<tbody>', ...rows, '</tbody>', '</table>'].join('\n')
  const block = path ? `<a id="${anchorId(path)}"></a>\n#### \`${path}\`\n\n${table}` : table

  const nested = Object.entries(properties).flatMap(([name, prop]) => {
    if (!isObjectWithProperties(prop) || !prop.properties) return []
    const childPath = path ? `${path}.${name}` : name
    return renderTables(prop.properties, new Set(prop.required ?? []), childPath, columns)
  })

  return [block, ...nested]
}

/**
 * Renders the config reference: a main properties table plus a linked detail
 * table for every nested object property. Descriptions use the first paragraph
 * from the schema so each table stays readable without losing context.
 */
const renderConfigTable = (schema: ConfigSchema): string => {
  const required = new Set(schema.required ?? [])
  const columns = resolveColumns(schema)
  return renderTables(schema.properties, required, '', columns).join('\n\n')
}

const START_MARKER = '<!-- config-table-start -->'
const END_MARKER = '<!-- config-table-end -->'

/**
 * Generates the properties table from the JSON Schema and writes it to README.md.
 * Every user-facing description comes from the schema so the two stay in sync —
 * update the schema, then run `bun run generate-readme`.
 *
 * If README.md already exists and contains <!-- config-table-start --> and
 * <!-- config-table-end --> markers, only the content between those markers is
 * replaced. If it exists but is missing one or both markers we refuse to write
 * rather than destroy hand-written content. When no README exists yet the table
 * is written on its own.
 */
export const generateMarkdown = async (): Promise<void> => {
  const root = process.cwd()

  const schemaRaw = await readFile(resolve(root, 'config.schema.json'), 'utf-8')
  const parsed = JSON.parse(schemaRaw) as Record<string, unknown>
  // Inline every $ref against the document's own $defs before rendering.
  const schema = dereference(parsed, parsed, new Set()) as ConfigSchema

  const table = renderConfigTable(schema)
  const readmePath = resolve(root, 'README.md')

  let existing: string | undefined
  try {
    existing = await readFile(readmePath, 'utf-8')
  } catch {
    // No README yet — safe to create one holding just the table.
    existing = undefined
  }

  let content: string
  if (existing === undefined) {
    content = table
  } else {
    const startIdx = existing.indexOf(START_MARKER)
    const endIdx = existing.indexOf(END_MARKER)
    // Both markers present: splice the table in and keep everything else. If a
    // marker is missing, overwriting would silently wipe the existing README, so
    // fail loudly and let the user add the markers where they want the table.
    if (startIdx === -1 || endIdx === -1) {
      throw new Error(
        `README.md exists but is missing the ${START_MARKER} / ${END_MARKER} markers. ` +
          'Add both markers where the config table should go, then re-run — refusing to overwrite the existing README.',
      )
    }
    content = existing.slice(0, startIdx + START_MARKER.length) + '\n' + table + '\n' + existing.slice(endIdx)
  }

  await writeFile(readmePath, content)
  console.log('README.md generated successfully.')
}
