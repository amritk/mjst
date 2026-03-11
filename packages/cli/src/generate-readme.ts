/**
 * Describes a single CLI option as it appears in config.mjst.json.
 * We keep documentation metadata here rather than in CliConfig so we do not
 * pollute the runtime config type with README-generation concerns.
 */
type CliOptionDefinition = {
  readonly flag: string
  readonly configKey?: string
  readonly type: 'string' | 'boolean'
  readonly required: boolean
  readonly description: string
}

/**
 * The shape of config.mjst.json. Drives all README content so that the
 * documentation stays in sync with the actual CLI options.
 */
export type CliConfigDefinition = {
  readonly name: string
  readonly description: string
  readonly usage: string
  readonly options: readonly CliOptionDefinition[]
}

/**
 * Generates README.md markdown from a CLI config definition.
 * Covers the tool description, usage line, options table, and config file example.
 */
export const generateReadme = (def: CliConfigDefinition): string => {
  const lines: string[] = []

  lines.push(`# ${def.name}`)
  lines.push('')
  lines.push(def.description)
  lines.push('')
  lines.push('## Usage')
  lines.push('')
  lines.push('```sh')
  lines.push(def.usage)
  lines.push('```')
  lines.push('')
  lines.push('## Options')
  lines.push('')
  lines.push('| Flag | Type | Required | Description |')
  lines.push('| ---- | ---- | -------- | ----------- |')

  for (const option of def.options) {
    const required = option.required ? 'Yes' : 'No'
    lines.push(`| \`${option.flag}\` | \`${option.type}\` | ${required} | ${option.description} |`)
  }

  lines.push('')
  lines.push('## Config File')
  lines.push('')
  lines.push(
    'You can use a JSON config file instead of (or alongside) CLI flags. CLI flags always take precedence over config file values.',
  )
  lines.push('')
  lines.push('```json')
  lines.push('{')
  lines.push('  "schema": "path/to/schema.json",')
  lines.push('  "outDir": "generated"')
  lines.push('}')
  lines.push('```')
  lines.push('')
  lines.push('```sh')
  lines.push('mjst --config config.json')
  lines.push('```')
  lines.push('')

  return lines.join('\n')
}
