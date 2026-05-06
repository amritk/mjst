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

/**
 * Renders the single authoritative config reference table.
 * This is the only place properties are documented — no separate detail blocks or
 * duplicate CLI flag tables. We use the first paragraph of each description so
 * the table stays readable without losing meaningful context.
 */
const renderConfigTable = (schema: ConfigSchema): string => {
  const required = new Set(schema.required ?? [])

  const header = [
    '| | Property | CLI Flag | Type | Required | Default | Description |',
    '|:---:|:---|:---|:---:|:---:|:---:|:---|',
  ]

  const rows = Object.entries(schema.properties).map(([name, prop]) => {
    const icon = prop['x-icon'] ?? '🔧'
    const cliFlag = prop['x-cli-flag'] ? `\`${prop['x-cli-flag']}\`` : '—'
    const isRequired = required.has(name)
    const requiredCell = isRequired ? '✅' : '—'
    const defaultCell = prop.default !== undefined ? formatValue(prop.default) : '—'
    // First paragraph gives enough context without making the table unwieldy
    const desc = prop.description?.split('\n\n')[0]?.replace(/\n/g, ' ') ?? ''
    return `| ${icon} | \`${name}\` | ${cliFlag} | \`${prop.type}\` | ${requiredCell} | ${defaultCell} | ${desc} |`
  })

  return [...header, ...rows].join('\n')
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

  const schemaRaw = await readFile(resolve(root, 'fixtures', 'config.schema.json'), 'utf-8')
  const schema = JSON.parse(schemaRaw) as ConfigSchema

  const table = renderConfigTable(schema)
  const readmePath = resolve(root, 'README.md')

  let content: string
  try {
    const existing = await readFile(readmePath, 'utf-8')
    const startIdx = existing.indexOf(START_MARKER)
    const endIdx = existing.indexOf(END_MARKER)
    if (startIdx !== -1 && endIdx !== -1) {
      content =
        existing.slice(0, startIdx + START_MARKER.length) +
        '\n' +
        table +
        '\n' +
        existing.slice(endIdx)
    } else {
      content = table
    }
  } catch {
    content = table
  }

  await writeFile(readmePath, content)
  console.log('README.md generated successfully.')
}

