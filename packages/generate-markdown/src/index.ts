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
 * x-example-titles lets each example have a human-readable heading in the docs.
 */
type ConfigSchema = {
  readonly title: string
  readonly description?: string
  readonly $comment?: string
  readonly required?: readonly string[]
  readonly properties: Readonly<Record<string, SchemaProperty>>
  readonly examples?: readonly unknown[]
  readonly 'x-example-titles'?: readonly string[]
}

/**
 * The fields from package.json we need to populate the README header and badges.
 * scripts lets us render the scripts table from real data rather than hard-coded text.
 * bin lets us derive the CLI binary name for usage examples.
 */
type PackageJson = {
  readonly name: string
  readonly description: string
  readonly version: string
  readonly license?: string
  readonly scripts?: Readonly<Record<string, string>>
  readonly bin?: Readonly<Record<string, string>>
}

/**
 * Options accepted by the shieldsBadge helper.
 * logoColor only applies when a logo is provided.
 */
type BadgeOptions = {
  readonly logo?: string
  readonly logoColor?: string
  readonly labelColor?: string
}

/**
 * Builds a shields.io badge URL and wraps it in a markdown image tag.
 * We use flat-square throughout for a consistent, modern look.
 */
const shieldsBadge = (label: string, message: string, color: string, options?: BadgeOptions): string => {
  const params = new URLSearchParams({ style: 'flat-square' })
  if (options?.logo) params.set('logo', options.logo)
  if (options?.logoColor) params.set('logoColor', options.logoColor)
  if (options?.labelColor) params.set('labelColor', options.labelColor)
  // shields.io uses - as a segment separator, so literal hyphens must be doubled
  // and underscores must be doubled too — then URL-encode spaces and special chars
  const esc = (s: string) => encodeURIComponent(s.replace(/-/g, '--').replace(/_/g, '__'))
  const slug = `${esc(label)}-${esc(message)}-${color}`
  return `![${label}](https://img.shields.io/badge/${slug}?${params.toString()})`
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
 * Detects which package manager the project uses by scanning the script commands.
 * We prefer bun > pnpm > yarn and fall back to npm if none match.
 */
const detectPackageManager = (scripts: Readonly<Record<string, string>> | undefined): string => {
  const allCommands = Object.values(scripts ?? {}).join(' ')
  if (/\bbun\b/.test(allCommands)) return 'bun'
  if (/\bpnpm\b/.test(allCommands)) return 'pnpm'
  if (/\byarn\b/.test(allCommands)) return 'yarn'
  return 'npm'
}

/**
 * Derives the CLI binary name from the package bin field.
 * Falls back to the package name when no bin entry is defined.
 */
const getCliName = (pkg: PackageJson): string => {
  const binKeys = pkg.bin ? Object.keys(pkg.bin) : []
  return binKeys[0] ?? pkg.name
}

/**
 * Builds a CLI usage example from required schema properties that have x-cli-flag.
 * For each required flag we use the first example value when available, otherwise
 * we keep the full x-cli-flag string (which already includes a placeholder like <path>).
 */
const buildCliExample = (schema: ConfigSchema, cliName: string): string => {
  const required = new Set(schema.required ?? [])
  const flags = Object.entries(schema.properties)
    .filter(([name, prop]) => required.has(name) && prop['x-cli-flag'])
    .map(([, prop]) => {
      // Split off the argument placeholder (e.g. "--schema <path>" → "--schema")
      // so we can append a real example value instead of the raw placeholder
      const flagName = prop['x-cli-flag']!.split(' ')[0]!
      const example = prop.examples?.[0]
      return example !== undefined ? `${flagName} ${example}` : prop['x-cli-flag']!
    })
  return [cliName, ...flags].join(' ')
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

/**
 * Renders copy-pasteable full-config examples with titled headings.
 * Titles come from x-example-titles in the schema so they stay in sync
 * with the examples array without any extra coordination needed here.
 */
const renderExamplesSection = (schema: ConfigSchema): string => {
  if (!schema.examples || schema.examples.length === 0) return ''

  const titles = schema['x-example-titles'] ?? []

  const blocks = schema.examples.map((example, i) => {
    const title = titles[i] ?? `Example ${i + 1}`
    return `**${title}**\n\`\`\`json\n${JSON.stringify(example, null, 2)}\n\`\`\``
  })

  return `## Config File Examples\n\n${blocks.join('\n\n')}`
}

/**
 * Renders the How It Works section by deriving one step per schema property.
 * We use the first sentence of each property description so the list stays concise.
 * Optional properties are clearly labelled so readers know what is mandatory.
 */
const renderHowItWorks = (schema: ConfigSchema): string => {
  const required = new Set(schema.required ?? [])

  const steps = Object.entries(schema.properties).map(([name, prop], i) => {
    // First sentence only — a period followed by a space is the sentence boundary
    const sentence = prop.description?.split('\n\n')[0]?.split('. ')[0] ?? name
    const flag = prop['x-cli-flag'] ? ` via \`${prop['x-cli-flag']}\`` : ''
    const optionalMarker = required.has(name) ? '' : ' _(optional)_'
    return `${i + 1}. **\`${name}\`**${optionalMarker}${flag} — ${sentence}`
  })

  return `## How It Works\n\n${steps.join('\n')}`
}

/**
 * Renders the scripts table directly from package.json scripts.
 * Showing the actual command is more useful than a hand-written description
 * because it never goes stale when commands change.
 */
const renderScriptsTable = (scripts: Readonly<Record<string, string>> | undefined, pm: string): string => {
  if (!scripts || Object.keys(scripts).length === 0) {
    return '## Scripts\n\n_No scripts defined._'
  }

  const header = ['| Script | Command |', '|:---|:---|']
  const rows = Object.entries(scripts).map(([name, command]) => `| \`${pm} run ${name}\` | \`${command}\` |`)
  return `## Scripts\n\n${[...header, ...rows].join('\n')}`
}

/**
 * Generates the README.md content by combining information from the JSON Schema
 * and package.json. Every user-facing description comes from the schema so the
 * two stay in sync — update the schema, then run `bun run generate-readme`.
 */
export const generateMarkdown = async (): Promise<void> => {
  const root = process.cwd()

  const [schemaRaw, pkgRaw] = await Promise.all([
    readFile(resolve(root, 'fixtures', 'config.schema.json'), 'utf-8'),
    readFile(resolve(root, 'package.json'), 'utf-8'),
  ])

  const schema = JSON.parse(schemaRaw) as ConfigSchema
  const pkg = JSON.parse(pkgRaw) as PackageJson

  const pm = detectPackageManager(pkg.scripts)
  const cliName = getCliName(pkg)
  const cliExample = buildCliExample(schema, cliName)

  // First paragraph of the schema description is the tool overview.
  // If no description is present we fall back to the schema title.
  const overviewText = schema.description ?? schema.title

  // Second paragraph onwards (if present) explains the config file approach.
  // If the description is a single paragraph we try $comment as a fallback.
  const descParagraphs = (schema.description ?? '').split('\n\n')
  const configFileExplanation = descParagraphs.length > 1 ? descParagraphs.slice(1).join('\n\n') : (schema.$comment ?? '')

  const badges = [
    shieldsBadge('status', 'pre-alpha', 'ef4444'),
    shieldsBadge('version', `v${pkg.version}`, '6366f1', { logo: 'npm', logoColor: 'white' }),
    shieldsBadge('license', pkg.license ?? 'MIT', '22c55e'),
    shieldsBadge('JSON Schema', '2020-12', 'f97316'),
    shieldsBadge('bun', 'required', 'FBF0DF', { logo: 'bun', logoColor: '000000' }),
  ].join('&nbsp; ')

  const readme = `<div align="center">

# ${pkg.name}

**${pkg.description}**

${badges}

</div>

---

## Overview

${overviewText}

---

## Installation

\`\`\`zsh
${pm} install
\`\`\`

---

## Usage

### CLI

\`\`\`bash
${cliExample}
\`\`\`

### Config File

${configFileExplanation}

\`\`\`bash
${cliName} --config ./${pkg.name}.config.json
\`\`\`

> [!NOTE]
> Validate your config against the bundled JSON Schema: [\`config.schema.json\`](./fixtures/config.schema.json)

---

## Configuration Reference

${renderConfigTable(schema)}

---

${renderExamplesSection(schema)}

---

${renderHowItWorks(schema)}

---

${renderScriptsTable(pkg.scripts, pm)}

---

<div align="center">

README generated from [\`config.schema.json\`](./fixtures/config.schema.json) &nbsp;·&nbsp; run \`${pm} run generate-readme\` to update

</div>
`

  await writeFile(resolve(root, 'README.md'), readme)
  console.log('README.md generated successfully.')
}