import type { SourceFormat } from '@amritk/adapters/source-format'

import type { CliConfig } from './cli-config'

const SOURCE_FORMATS: readonly SourceFormat[] = ['json', 'typebox', 'zod', 'valibot', 'effect', 'asyncapi']

// Mutable shape used while building, returned as Partial<CliConfig>.
type MutableConfig = {
  schema?: string
  schemaDir?: string
  outDir?: string
  outFile?: string
  input?: SourceFormat
  export?: string
  typesOnly?: boolean
  validators?: boolean
  examples?: boolean
  build?: boolean
  force?: boolean
  logWarnings?: boolean
  strict?: boolean
  stripUnknown?: boolean
  caseInsensitive?: boolean
  readonly?: boolean
  helpers?: 'package' | 'embedded'
  typeSuffix?: string
  banner?: boolean | string
  importExt?: 'js' | 'ts'
  rootType?: string
  resolveRemote?: boolean
  allowedHosts?: string[]
  allowPrivateHosts?: boolean
  allowedRoots?: string[]
}

// Flags that take a value and accumulate across repeats instead of overwriting.
// They are handled apart from VALUE_KEYS because a second `--allowed-hosts` has
// to append rather than replace the first one.
const LIST_KEYS = new Set<keyof MutableConfig>(['allowedHosts', 'allowedRoots'])

// Boolean flags toggle on by presence and accept `--flag=false` to opt out.
const BOOLEAN_KEYS = new Set<keyof MutableConfig>([
  'typesOnly',
  'validators',
  'examples',
  'build',
  'force',
  'logWarnings',
  'strict',
  'stripUnknown',
  'caseInsensitive',
  'readonly',
  'resolveRemote',
  'allowPrivateHosts',
])
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
  'importExt',
  'rootType',
])

// Recognized flags that don't map into CliConfig because they're consumed
// earlier in the pipeline (e.g. `--config` is read by `extractConfigPath` to
// load the config file before flags are overlaid). They still take a value, so
// list them here to keep the unknown-flag guard from rejecting them.
const EXTERNAL_VALUE_KEYS = new Set<string>(['config'])

/** Normalizes a CLI flag name to its camelCase config key so both `--out-dir` and `--outDir` map to `outDir`. */
const toCamelCase = (key: string): string => key.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase())

/**
 * True when `--<flagName>` consumes the argument that follows it (`--banner`
 * takes an optional one, which still swallows the next non-flag token).
 *
 * Exported because whoever inspects raw argv before parsing — the version/help
 * detection in `cli.ts` — has to know that the `-v` in `--type-suffix -v` is a
 * *value*, not a request to print the version.
 */
export const flagTakesValue = (flagName: string): boolean => {
  const key = toCamelCase(flagName)
  return (
    VALUE_KEYS.has(key as keyof MutableConfig) ||
    LIST_KEYS.has(key as keyof MutableConfig) ||
    EXTERNAL_VALUE_KEYS.has(key) ||
    key === 'banner'
  )
}

const parseHelpersValue = (value: string): 'package' | 'embedded' | undefined => {
  if (value === 'package' || value === 'embedded') return value
  return undefined
}

const parseImportExtValue = (value: string): 'js' | 'ts' | undefined => {
  if (value === 'js' || value === 'ts') return value
  return undefined
}

const parseInputValue = (value: string): SourceFormat | undefined =>
  (SOURCE_FORMATS as readonly string[]).includes(value) ? (value as SourceFormat) : undefined

/**
 * Appends the comma-separated entries in `value` onto a list flag. Repeating the
 * flag accumulates, so `--allowed-hosts a.com --allowed-hosts b.com` and
 * `--allowed-hosts a.com,b.com` are equivalent. Blank entries are dropped.
 *
 * `--allowed-roots` shares this convention rather than inventing a second one.
 * The one thing it cannot express is a directory whose name contains a comma —
 * repeat the flag is not enough there, but a path like that is rare enough that
 * a second syntax is not worth the confusion.
 */
const appendListValue = (config: MutableConfig, key: 'allowedHosts' | 'allowedRoots', value: string): void => {
  const entries = value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
  if (entries.length === 0) return
  config[key] = [...(config[key] ?? []), ...entries]
}

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
    case 'rootType':
      config.rootType = value
      return true
    case 'input': {
      const parsed = parseInputValue(value)
      if (!parsed) {
        throw new Error(`Invalid --input value "${value}". Expected one of: ${SOURCE_FORMATS.join(', ')}.`)
      }
      config.input = parsed
      return true
    }
    case 'helpers': {
      const parsed = parseHelpersValue(value)
      if (!parsed) {
        throw new Error(`Invalid --helpers value "${value}". Expected one of: package, embedded.`)
      }
      config.helpers = parsed
      return true
    }
    case 'importExt': {
      const parsed = parseImportExtValue(value)
      if (!parsed) {
        throw new Error(`Invalid --import-ext value "${value}". Expected one of: js, ts.`)
      }
      config.importExt = parsed
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
    case 'validators':
      config.validators = value
      return true
    case 'examples':
      config.examples = value
      return true
    case 'build':
      config.build = value
      return true
    case 'force':
      config.force = value
      return true
    case 'logWarnings':
      config.logWarnings = value
      return true
    case 'strict':
      config.strict = value
      return true
    case 'stripUnknown':
      config.stripUnknown = value
      return true
    case 'caseInsensitive':
      config.caseInsensitive = value
      return true
    case 'readonly':
      config.readonly = value
      return true
    case 'resolveRemote':
      config.resolveRemote = value
      return true
    case 'allowPrivateHosts':
      config.allowPrivateHosts = value
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

    if (!arg) continue

    // A bare `--` ends the flags. Nothing after it is meaningful to the generate
    // command (it takes no positionals), but rejecting the terminator itself as an
    // unknown flag is worse than useless — shells and task runners insert it.
    if (arg === '--') break

    if (!arg.startsWith('--')) {
      // The generate command is flags-only, so a stray positional is a mistake
      // worth failing on: `mjst genrate --schema … --out-dir …` used to run a
      // perfectly normal generation and exit 0, hiding the typo'd subcommand.
      throw new Error(
        `Unexpected argument "${arg}". mjst takes flags only — did you mean a subcommand (\`mjst lint\`, \`mjst compile-api\`)?`,
      )
    }

    // Handle --flag=value syntax
    const equalsIndex = arg.indexOf('=')
    if (equalsIndex !== -1) {
      const key = toCamelCase(arg.slice(2, equalsIndex))
      const value = arg.slice(equalsIndex + 1)
      if (key === 'banner') {
        // --banner=false → false, --banner=true → true, --banner=<text> → custom string
        config.banner = value === 'false' ? false : value === 'true' ? true : value
      } else if (LIST_KEYS.has(key as keyof MutableConfig)) {
        appendListValue(config, key as 'allowedHosts' | 'allowedRoots', value)
      } else if (BOOLEAN_KEYS.has(key as keyof MutableConfig)) {
        assignBoolean(config, key, value !== 'false')
      } else if (VALUE_KEYS.has(key as keyof MutableConfig)) {
        assignValue(config, key, value)
      } else if (EXTERNAL_VALUE_KEYS.has(key)) {
        // `--config=` with nothing after it loaded no config and generated with
        // the defaults instead — the user asked for a config file, so say that we
        // did not get one.
        if (value === '') throw new Error(`Flag "--${arg.slice(2, equalsIndex)}" expects a value.`)
      } else {
        // An unrecognized flag is almost always a typo (e.g. `--strcit`). Silently
        // dropping it means the user gets non-strict output while believing they
        // asked for strict — fail loudly instead of guessing intent.
        throw new Error(`Unknown flag "--${arg.slice(2, equalsIndex)}".`)
      }
      continue
    }

    const key = toCamelCase(arg.slice(2))
    const flagName = arg.slice(2)

    // --banner: presence alone enables the default message; an immediately
    // following non-flag argument is treated as a custom message string.
    if (key === 'banner') {
      const nextArg = args[i + 1]
      if (nextArg && !nextArg.startsWith('--')) {
        config.banner = nextArg
        i++
      } else {
        config.banner = true
      }
      continue
    }

    // --allowed-hosts / --allowed-roots take a value (comma-separated) and
    // accumulate when repeated.
    if (LIST_KEYS.has(key as keyof MutableConfig)) {
      const value = args[i + 1]
      if (value === undefined || value.startsWith('--')) {
        throw new Error(`Flag "--${flagName}" expects a value.`)
      }
      appendListValue(config, key as 'allowedHosts' | 'allowedRoots', value)
      i++
      continue
    }

    // Boolean flag: presence alone enables it, no value needed
    if (BOOLEAN_KEYS.has(key as keyof MutableConfig)) {
      assignBoolean(config, key, true)
      continue
    }

    // Value flag: consume the next argument. It must be present and must not be
    // another flag — `--schema --out-dir dist` means `--schema` lost its value,
    // which would otherwise silently fall back to a default.
    if (VALUE_KEYS.has(key as keyof MutableConfig)) {
      const value = args[i + 1]
      if (value === undefined || value.startsWith('--')) {
        throw new Error(`Flag "--${flagName}" expects a value.`)
      }
      assignValue(config, key, value)
      i++
      continue
    }

    // A flag consumed elsewhere (e.g. `--config`) still swallows its value here,
    // and still has to have one: a bare `--config` used to be dropped silently, so
    // the run generated from CLI flags alone as if no config had been asked for.
    if (EXTERNAL_VALUE_KEYS.has(key)) {
      const value = args[i + 1]
      if (value === undefined || value.startsWith('--')) {
        throw new Error(`Flag "--${flagName}" expects a value.`)
      }
      i++
      continue
    }

    throw new Error(`Unknown flag "--${flagName}".`)
  }

  return config
}
