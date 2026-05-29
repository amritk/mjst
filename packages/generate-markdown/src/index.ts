import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

/**
 * Describes the shape of a single property entry inside a JSON Schema object.
 * We include the x- extension fields we added so the generator can produce
 * richer output (CLI flag labels, icons) without hard-coding them here.
 */
type SchemaProperty = {
  readonly type: string
  readonly description?: string
  readonly $comment?: string
  readonly default?: unknown
  readonly examples?: readonly unknown[]
  readonly required?: readonly string[]
  readonly properties?: Readonly<Record<string, SchemaProperty>>
  readonly 'x-cli-flag'?: string
  readonly 'x-icon'?: string
}

/**
 * The top-level structure of our config.schema.json file.
 */
type ConfigSchema = {
  readonly title: string
  readonly $comment?: string
  readonly required?: readonly string[]
  readonly properties: Readonly<Record<string, SchemaProperty>>
  readonly examples?: readonly unknown[]
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
  if (value === undefined || value === null) return '—'
  if (typeof value === 'string') return `<code>"${escapeHtml(value)}"</code>`
  if (typeof value === 'boolean' || typeof value === 'number') return `<code>${value}</code>`
  return `<code>${escapeHtml(JSON.stringify(value))}</code>`
}

/**
 * The number of metadata columns in a property table. The description row spans
 * all of them so the prose can use the table's full width.
 */
const COLUMN_COUNT = 5

/**
 * Header row shared by the main table and every nested detail table. The
 * description has no header of its own — it lives in a full-width row under each
 * property's metadata.
 */
const TABLE_HEAD = [
  '<thead>',
  '<tr>',
  '<th>Property</th>',
  '<th>CLI Flag</th>',
  '<th>Type</th>',
  '<th align="center">Required</th>',
  '<th align="center">Default</th>',
  '</tr>',
  '</thead>',
].join('\n')

/**
 * Builds a stable anchor id for an object property's detail table from its
 * dotted path (e.g. `server.tls` → `config-server-tls`). Explicit ids keep the
 * in-table links working regardless of how the host renderer slugifies headings.
 */
const anchorId = (path: string): string => `config-${path.replace(/\./g, '-')}`

const isObjectWithProperties = (prop: SchemaProperty): boolean =>
  prop.type === 'object' && prop.properties !== undefined

/**
 * Renders a property as two table rows: a metadata row (name, flag, type,
 * required, default) and a full-width description row beneath it. The split lets
 * the description use the whole table width instead of being squeezed into one
 * narrow column. Object properties with nested fields link to their own detail
 * table rendered below the main table.
 */
const renderRow = (name: string, prop: SchemaProperty, required: ReadonlySet<string>, path: string): string => {
  const icon = prop['x-icon'] ?? '🔧'
  const code = `<code>${escapeHtml(name)}</code>`
  const nameCell = isObjectWithProperties(prop) ? `${icon} <a href="#${anchorId(path)}">${code}</a>` : `${icon} ${code}`
  const cliFlag = prop['x-cli-flag'] ? `<code>${escapeHtml(prop['x-cli-flag'])}</code>` : '—'
  const requiredCell = required.has(name) ? '✅' : '—'
  const defaultCell = prop.default !== undefined ? formatValue(prop.default) : '—'
  // First paragraph gives enough context without making the table unwieldy
  const desc = escapeHtml(prop.description?.split('\n\n')[0]?.replace(/\n/g, ' ') ?? '')
  return [
    '<tr>',
    `<td>${nameCell}</td>`,
    `<td>${cliFlag}</td>`,
    `<td><code>${escapeHtml(prop.type)}</code></td>`,
    `<td align="center">${requiredCell}</td>`,
    `<td align="center">${defaultCell}</td>`,
    '</tr>',
    '<tr>',
    `<td colspan="${COLUMN_COUNT}">${desc}</td>`,
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
): readonly string[] => {
  const rows = Object.entries(properties).map(([name, prop]) =>
    renderRow(name, prop, required, path ? `${path}.${name}` : name),
  )
  const table = ['<table>', TABLE_HEAD, '<tbody>', ...rows, '</tbody>', '</table>'].join('\n')
  const block = path ? `<a id="${anchorId(path)}"></a>\n#### \`${path}\`\n\n${table}` : table

  const nested = Object.entries(properties).flatMap(([name, prop]) => {
    const childProps = prop.properties
    if (prop.type !== 'object' || !childProps) return []
    const childPath = path ? `${path}.${name}` : name
    return renderTables(childProps, new Set(prop.required ?? []), childPath)
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
  return renderTables(schema.properties, required, '').join('\n\n')
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
 * replaced. Otherwise the whole file is overwritten with the table.
 */
export const generateMarkdown = async (): Promise<void> => {
  const root = process.cwd()

  const schemaRaw = await readFile(resolve(root, 'config.schema.json'), 'utf-8')
  const schema = JSON.parse(schemaRaw) as ConfigSchema

  const table = renderConfigTable(schema)
  const readmePath = resolve(root, 'README.md')

  let content: string
  try {
    const existing = await readFile(readmePath, 'utf-8')
    const startIdx = existing.indexOf(START_MARKER)
    const endIdx = existing.indexOf(END_MARKER)
    if (startIdx !== -1 && endIdx !== -1) {
      content = existing.slice(0, startIdx + START_MARKER.length) + '\n' + table + '\n' + existing.slice(endIdx)
    } else {
      content = table
    }
  } catch {
    content = table
  }

  await writeFile(readmePath, content)
  console.log('README.md generated successfully.')
}
