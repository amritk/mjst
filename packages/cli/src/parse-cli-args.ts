import type { CliConfig } from './cli-config'

/**
 * Parses command-line arguments into a partial CLI config.
 * Supports --schema, --outDir, and --types-only flags with either `--flag value` or `--flag=value` syntax.
 * Only returns the flags that were explicitly provided so we can layer them on top of config file values.
 */
export const parseCliArgs = (args: readonly string[]): Partial<CliConfig> => {
  // Use a mutable local type for building, then return as Partial<CliConfig>
  const config: {
    schema?: string
    outDir?: string
    typesOnly?: boolean
    build?: boolean
    logWarnings?: boolean
    strict?: boolean
    helpers?: 'package' | 'embedded'
  } = {}

  const parseHelpersValue = (value: string): 'package' | 'embedded' | undefined => {
    if (value === 'package' || value === 'embedded') return value
    return undefined
  }

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]

    if (!arg) {
      continue
    }

    // Handle --flag=value syntax
    if (arg.startsWith('--') && arg.includes('=')) {
      const equalsIndex = arg.indexOf('=')
      const key = arg.slice(2, equalsIndex)
      const value = arg.slice(equalsIndex + 1)

      if (key === 'schema') {
        config.schema = value
      } else if (key === 'outDir') {
        config.outDir = value
      } else if (key === 'types-only') {
        // Accept --types-only=false to explicitly opt out, otherwise treat as true
        config.typesOnly = value !== 'false'
      } else if (key === 'build') {
        config.build = value !== 'false'
      } else if (key === 'log-warnings') {
        config.logWarnings = value !== 'false'
      } else if (key === 'strict') {
        config.strict = value !== 'false'
      } else if (key === 'helpers') {
        const parsed = parseHelpersValue(value)
        if (parsed) config.helpers = parsed
      }

      continue
    }

    // Handle --flag value syntax
    if (arg === '--schema') {
      const value = args[i + 1]

      if (value && !value.startsWith('--')) {
        config.schema = value
        i++
      }
    } else if (arg === '--outDir') {
      const value = args[i + 1]

      if (value && !value.startsWith('--')) {
        config.outDir = value
        i++
      }
    } else if (arg === '--types-only') {
      // Boolean flag: presence alone enables it, no value needed
      config.typesOnly = true
    } else if (arg === '--build') {
      config.build = true
    } else if (arg === '--log-warnings') {
      config.logWarnings = true
    } else if (arg === '--strict') {
      config.strict = true
    } else if (arg === '--helpers') {
      const value = args[i + 1]

      if (value && !value.startsWith('--')) {
        const parsed = parseHelpersValue(value)
        if (parsed) {
          config.helpers = parsed
          i++
        }
      }
    }
  }

  return config
}
