/** The flags and positional the `compile-api` subcommand understands. */
export type CompileApiArgs = {
  /** Path to the module exporting the route contracts (the sole positional). */
  routesModule?: string
  /** Output file for the generated module (`--out`). */
  out?: string
  /** Import specifier override for the routes module (`--routes-import`). */
  routesImport?: string
  /** Path to a JSON file spread into the compile options (`--options`). */
  optionsFile?: string
  /** OpenAPI document path override (`--open-api-path`). */
  openApiPath?: string
  /** Request body size cap override (`--max-body-bytes`). */
  maxBodyBytes?: number
  /** True when `--help`/`-h` was passed. */
  help?: boolean
}

// Every flag takes a value; --help is the only boolean.
const VALUE_KEYS = new Set(['out', 'routesImport', 'options', 'openApiPath', 'maxBodyBytes'])

/** Normalizes a flag name so both `--routes-import` and `--routesImport` map to the same key. */
const toCamelCase = (key: string): string => key.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase())

/**
 * `Infinity` is a documented compileToModule value (it disables the cap), so
 * it is accepted alongside plain numbers; anything else non-numeric is a typo
 * the user should hear about rather than a silently ignored cap.
 */
const parseMaxBodyBytes = (value: string): number => {
  if (value.toLowerCase() === 'infinity') return Number.POSITIVE_INFINITY
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`Invalid --max-body-bytes value "${value}". Expected a non-negative number or Infinity.`)
  }
  return parsed
}

const assignValue = (args: CompileApiArgs, key: string, value: string): void => {
  switch (key) {
    case 'out':
      args.out = value
      return
    case 'routesImport':
      args.routesImport = value
      return
    case 'options':
      args.optionsFile = value
      return
    case 'openApiPath':
      args.openApiPath = value
      return
    case 'maxBodyBytes':
      args.maxBodyBytes = parseMaxBodyBytes(value)
      return
    default:
      throw new Error(`Unknown flag "--${key}".`)
  }
}

/**
 * Parses the `compile-api` argv into a typed args object. Mirrors the main
 * CLI parser's conventions: kebab-case and camelCase flag spellings, both
 * `--flag value` and `--flag=value`, and a loud error on unknown flags so a
 * typo cannot silently drop an option. Throws on usage errors; the caller
 * turns that into the exit-code-2 path.
 */
export const parseCompileApiArgs = (argv: readonly string[]): CompileApiArgs => {
  const args: CompileApiArgs = {}

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === undefined) continue

    if (arg === '--help' || arg === '-h') {
      args.help = true
      continue
    }

    if (!arg.startsWith('--')) {
      if (args.routesModule !== undefined) {
        throw new Error(`Unexpected argument "${arg}". compile-api takes a single routes module path.`)
      }
      args.routesModule = arg
      continue
    }

    // --flag=value syntax
    const equalsIndex = arg.indexOf('=')
    if (equalsIndex !== -1) {
      const key = toCamelCase(arg.slice(2, equalsIndex))
      if (!VALUE_KEYS.has(key)) throw new Error(`Unknown flag "--${arg.slice(2, equalsIndex)}".`)
      assignValue(args, key, arg.slice(equalsIndex + 1))
      continue
    }

    const flagName = arg.slice(2)
    const key = toCamelCase(flagName)
    if (!VALUE_KEYS.has(key)) throw new Error(`Unknown flag "--${flagName}".`)

    // A value flag must consume a real value — `--out --options x` means
    // `--out` lost its value, which should fail rather than compile to a
    // file literally named "--options".
    const value = argv[i + 1]
    if (value === undefined || value.startsWith('--')) {
      throw new Error(`Flag "--${flagName}" expects a value.`)
    }
    assignValue(args, key, value)
    i++
  }

  return args
}
