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
 * Formats a JSON value for inline display inside a markdown table or sentence.
 * Strings get quoted so readers know they need quotes in their config.
 */
const formatValue = (value: unknown): string => {
  if (value === undefined || value === null) return '—'
  if (typeof value === 'string') return `\`"${value}"\``
  if (typeof value === 'boolean' || typeof value === 'number') return `\`${value}\``
  return `\`${JSON.stringify(value)}\``
}

const TABLE_HEADER = [
  '| | Property | CLI Flag | Type | Required | Default | Description |',
  '|:---:|:---|:---|:---:|:---:|:---:|:---|',
]

/**
 * Builds a stable anchor id for an object property's detail table from its
 * dotted path (e.g. `server.tls` → `config-server-tls`). Explicit ids keep the
 * in-table links working regardless of how the host renderer slugifies headings.
 */
const anchorId = (path: string): string => `config-${path.replace(/\./g, '-')}`

const isObjectWithProperties = (prop: SchemaProperty): boolean =>
  prop.type === 'object' && prop.properties !== undefined

/**
 * Renders a single table row. Object properties with nested fields link to
 * their own detail table rendered below the main table.
 */
const renderRow = (name: string, prop: SchemaProperty, required: ReadonlySet<string>, path: string): string => {
  const icon = prop['x-icon'] ?? '🔧'
  const cliFlag = prop['x-cli-flag'] ? `\`${prop['x-cli-flag']}\`` : '—'
  const requiredCell = required.has(name) ? '✅' : '—'
  const defaultCell = prop.default !== undefined ? formatValue(prop.default) : '—'
  // First paragraph gives enough context without making the table unwieldy
  const desc = prop.description?.split('\n\n')[0]?.replace(/\n/g, ' ') ?? ''
  const nameCell = isObjectWithProperties(prop) ? `[\`${name}\`](#${anchorId(path)})` : `\`${name}\``
  return `| ${icon} | ${nameCell} | ${cliFlag} | \`${prop.type}\` | ${requiredCell} | ${defaultCell} | ${desc} |`
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
  const table = [...TABLE_HEADER, ...rows].join('\n')
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
