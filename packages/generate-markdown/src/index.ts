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
 * Formats a JSON value for inline display inside a markdown sentence.
 * Strings get quoted so readers know they need quotes in their config.
 */
const formatValue = (value: unknown): string => {
  if (value === undefined || value === null) return '—'
  if (typeof value === 'string') return `\`"${value}"\``
  if (typeof value === 'boolean' || typeof value === 'number') return `\`${value}\``
  return `\`${JSON.stringify(value)}\``
}

/** Separator between the inline facts on a property's metadata line. */
const META_SEP = ' · '

/** Heading level used for top-level properties (renders as `###`). */
const ROOT_HEADING_LEVEL = 3

/**
 * Builds a stable anchor id for a property's section from its dotted path
 * (e.g. `server.tls` → `config-server-tls`). Explicit ids keep cross-links
 * working regardless of how the host renderer slugifies headings.
 */
const anchorId = (path: string): string => `config-${path.replace(/\./g, '-')}`

/**
 * Renders the compact "facts" line that sits under a property heading: the CLI
 * flag, type, a required marker, and the default value. Only the facts that
 * apply are shown, so the line stays short and reads well at any width — unlike
 * a fixed set of table columns that forces every value into the same grid.
 */
const renderMeta = (name: string, prop: SchemaProperty, required: ReadonlySet<string>): string => {
  const facts: string[] = []
  if (prop['x-cli-flag']) facts.push(`\`${prop['x-cli-flag']}\``)
  facts.push(`\`${prop.type}\``)
  if (required.has(name)) facts.push('**Required**')
  if (prop.default !== undefined) facts.push(`Default ${formatValue(prop.default)}`)
  return facts.join(META_SEP)
}

/**
 * Renders one property as a self-contained section: an anchored heading, a
 * compact metadata line, and the full description as flowing prose. Object
 * properties recurse, rendering each child as a deeper section keyed by its
 * dotted path so the hierarchy stays clear without nested tables.
 *
 * @param level - Heading level for this property (top-level properties use 3).
 */
const renderProperty = (
  name: string,
  prop: SchemaProperty,
  required: ReadonlySet<string>,
  path: string,
  level: number,
): readonly string[] => {
  const icon = prop['x-icon'] ?? '🔧'
  const heading = `<a id="${anchorId(path)}"></a>\n${'#'.repeat(level)} ${icon} \`${path}\``
  const meta = renderMeta(name, prop, required)
  const description = prop.description?.trim()

  const section = [heading, meta, ...(description ? [description] : [])].join('\n\n')

  if (prop.type !== 'object' || !prop.properties) return [section]

  const childRequired = new Set(prop.required ?? [])
  const children = Object.entries(prop.properties).flatMap(([childName, childProp]) =>
    renderProperty(childName, childProp, childRequired, `${path}.${childName}`, level + 1),
  )
  return [section, ...children]
}

/**
 * Renders the config reference as a stack of per-property sections. Each option
 * gets its own heading and a full-width description, so long text wraps as
 * normal prose instead of being squeezed into a narrow table column.
 */
const renderConfigReference = (schema: ConfigSchema): string => {
  const required = new Set(schema.required ?? [])
  return Object.entries(schema.properties)
    .flatMap(([name, prop]) => renderProperty(name, prop, required, name, ROOT_HEADING_LEVEL))
    .join('\n\n')
}

const START_MARKER = '<!-- config-table-start -->'
const END_MARKER = '<!-- config-table-end -->'

/**
 * Generates the configuration reference from the JSON Schema and writes it to
 * README.md. Every user-facing description comes from the schema so the two
 * stay in sync — update the schema, then run `bun run generate-readme`.
 *
 * If README.md already exists and contains <!-- config-table-start --> and
 * <!-- config-table-end --> markers, only the content between those markers is
 * replaced. Otherwise the whole file is overwritten with the reference.
 */
export const generateMarkdown = async (): Promise<void> => {
  const root = process.cwd()

  const schemaRaw = await readFile(resolve(root, 'config.schema.json'), 'utf-8')
  const schema = JSON.parse(schemaRaw) as ConfigSchema

  const reference = renderConfigReference(schema)
  const readmePath = resolve(root, 'README.md')

  let content: string
  try {
    const existing = await readFile(readmePath, 'utf-8')
    const startIdx = existing.indexOf(START_MARKER)
    const endIdx = existing.indexOf(END_MARKER)
    if (startIdx !== -1 && endIdx !== -1) {
      content = existing.slice(0, startIdx + START_MARKER.length) + '\n\n' + reference + '\n\n' + existing.slice(endIdx)
    } else {
      content = reference
    }
  } catch {
    content = reference
  }

  await writeFile(readmePath, content)
  console.log('README.md generated successfully.')
}
