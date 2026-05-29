import type { SourceFormat } from '@amritk/adapters/source-format'

import type { CliConfig } from './cli-config'

const SOURCE_FORMATS: readonly SourceFormat[] = ['json', 'typebox', 'zod', 'valibot', 'effect']

// Mutable shape used while building, returned as Partial<CliConfig>.
type MutableConfig = {
  schema?: string
  schemaDir?: string
  outDir?: string
  outFile?: string
  input?: SourceFormat
  export?: string
  typesOnly?: boolean
  build?: boolean
  logWarnings?: boolean
  strict?: boolean
  readonly?: boolean
  helpers?: 'package' | 'embedded'
  typeSuffix?: string
  banner?: boolean
}

// Boolean flags toggle on by presence and accept `--flag=false` to opt out.
const BOOLEAN_KEYS = new Set<keyof MutableConfig>(['typesOnly', 'build', 'logWarnings', 'strict', 'readonly', 'banner'])
// Value flags consume the following argument (or `--flag=value`).
const VALUE_KEYS = new Set<keyof MutableConfig>([
  'schema',
  'schemaDir',
  'outDir',
  'outFile',
  'input',
  'export',
  'helpers',
  'typeSuffix',
])

/** Normalizes a CLI flag name to its camelCase config key so both `--out-dir` and `--outDir` map to `outDir`. */
const toCamelCase = (key: string): string => key.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase())

const parseHelpersValue = (value: string): 'package' | 'embedded' | undefined => {
  if (value === 'package' || value === 'embedded') return value
  return undefined
}

const parseInputValue = (value: string): SourceFormat | undefined =>
  (SOURCE_FORMATS as readonly string[]).includes(value) ? (value as SourceFormat) : undefined

/** Assigns a value-flag onto the config. Returns false for unknown keys. */
const assignValue = (config: MutableConfig, key: string, value: string): boolean => {
  switch (key) {
    case 'schema':
      config.schema = value
      return true
    case 'schemaDir':
      config.schemaDir = value
      return true
    case 'outDir':
      config.outDir = value
      return true
    case 'outFile':
      config.outFile = value
      return true
    case 'export':
      config.export = value
      return true
    case 'typeSuffix':
      config.typeSuffix = value
      return true
    case 'input': {
      const parsed = parseInputValue(value)
      if (parsed) config.input = parsed
      return true
    }
    case 'helpers': {
      const parsed = parseHelpersValue(value)
      if (parsed) config.helpers = parsed
      return true
    }
    default:
      return false
  }
}

/** Assigns a boolean flag onto the config. Returns false for unknown keys. */
const assignBoolean = (config: MutableConfig, key: string, value: boolean): boolean => {
  switch (key) {
    case 'typesOnly':
      config.typesOnly = value
      return true
    case 'build':
      config.build = value
      return true
    case 'logWarnings':
      config.logWarnings = value
      return true
    case 'strict':
      config.strict = value
      return true
    case 'readonly':
      config.readonly = value
      return true
    case 'banner':
      config.banner = value
      return true
    default:
      return false
  }
}

/**
 * Parses command-line arguments into a partial CLI config.
 * Every flag accepts both kebab-case and camelCase (e.g. `--out-dir` and `--outDir`)
 * and supports either `--flag value` or `--flag=value` syntax. Boolean flags toggle
 * on by presence and accept `--flag=false` to opt out. Only flags that were explicitly
 * provided are returned so they can be layered on top of config file values.
 */
export const parseCliArgs = (args: readonly string[]): Partial<CliConfig> => {
  const config: MutableConfig = {}

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]

    if (!arg || !arg.startsWith('--')) {
      continue
    }

    // Handle --flag=value syntax
    const equalsIndex = arg.indexOf('=')
    if (equalsIndex !== -1) {
      const key = toCamelCase(arg.slice(2, equalsIndex))
      const value = arg.slice(equalsIndex + 1)
      if (BOOLEAN_KEYS.has(key as keyof MutableConfig)) {
        assignBoolean(config, key, value !== 'false')
      } else {
        assignValue(config, key, value)
      }
      continue
    }

    const key = toCamelCase(arg.slice(2))

    // Boolean flag: presence alone enables it, no value needed
    if (BOOLEAN_KEYS.has(key as keyof MutableConfig)) {
      assignBoolean(config, key, true)
      continue
    }

    // Value flag: consume the next argument when it is not another flag
    if (VALUE_KEYS.has(key as keyof MutableConfig)) {
      const value = args[i + 1]
      if (value && !value.startsWith('--')) {
        assignValue(config, key, value)
        i++
      }
    }
  }

  return config
}
