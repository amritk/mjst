import type { DocLayout, DocSort } from '@amritk/generate-markdown'

/** The flags and positional the `markdown` subcommand understands. */
export type MarkdownArgs = {
  /** Path to the JSON Schema to document (the sole positional). */
  schema?: string
  /** Directory the prose reference pages are written to (`--out-dir`). */
  outDir?: string
  /** Output path of the index page (`--file`). */
  file?: string
  /** Page title override (`--title`). */
  title?: string
  /** Fence language for derived examples (`--language`). */
  language?: string
  /** Default layout for nested properties (`--layout`). */
  layout?: DocLayout
  /** Property order (`--sort`). */
  sort?: DocSort
  /** Heading level of the page title (`--heading-level`). */
  headingLevel?: number
  /** True when `--table` was passed: render the HTML table instead of the pages. */
  table?: boolean
  /** Markdown file the table is spliced into (`--readme`). */
  readme?: string
  /** True when `--help`/`-h` was passed. */
  help?: boolean
}

const VALUE_KEYS = new Set(['outDir', 'file', 'title', 'language', 'layout', 'sort', 'headingLevel', 'readme'])

const BOOLEAN_KEYS = new Set(['table'])

const LAYOUTS = ['headings', 'table', 'none'] as const

const SORTS = ['schema', 'alphabetical'] as const

/** Normalizes a flag name so both `--out-dir` and `--outDir` map to the same key. */
const toCamelCase = (key: string): string => key.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase())

/**
 * The enum-valued flags are checked here rather than passed through, because
 * the renderer treats an unknown layout or sort as "not set" and falls back to
 * its default — so a typo would produce a full set of pages laid out the way the
 * user did not ask for, with nothing anywhere saying why.
 */
const parseChoice = <T extends string>(flag: string, value: string, choices: readonly T[]): T => {
  const match = choices.find((choice) => choice === value)
  if (match === undefined) {
    throw new Error(`Invalid --${flag} value "${value}". Expected one of: ${choices.join(', ')}.`)
  }
  return match
}

/** Heading levels run 1-6; anything else is not a heading any markdown renderer knows. */
const parseHeadingLevel = (value: string): number => {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 6) {
    throw new Error(`Invalid --heading-level value "${value}". Expected an integer from 1 to 6.`)
  }
  return parsed
}

const assignValue = (args: MarkdownArgs, key: string, value: string): void => {
  switch (key) {
    case 'outDir':
      args.outDir = value
      return
    case 'file':
      args.file = value
      return
    case 'title':
      args.title = value
      return
    case 'language':
      args.language = value
      return
    case 'layout':
      args.layout = parseChoice('layout', value, LAYOUTS)
      return
    case 'sort':
      args.sort = parseChoice('sort', value, SORTS)
      return
    case 'headingLevel':
      args.headingLevel = parseHeadingLevel(value)
      return
    case 'readme':
      args.readme = value
      return
    default:
      throw new Error(`Unknown flag "--${key}".`)
  }
}

/**
 * Parses the `markdown` argv into a typed args object. Mirrors the other
 * subcommand parsers: kebab-case and camelCase flag spellings, both
 * `--flag value` and `--flag=value`, and a loud error on unknown flags so a
 * typo cannot silently drop an option. Throws on usage errors; the caller turns
 * that into the exit-code-2 path.
 */
export const parseMarkdownArgs = (argv: readonly string[]): MarkdownArgs => {
  const args: MarkdownArgs = {}

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === undefined) continue

    if (arg === '--help' || arg === '-h') {
      args.help = true
      continue
    }

    if (!arg.startsWith('--')) {
      if (args.schema !== undefined) {
        throw new Error(`Unexpected argument "${arg}". markdown takes a single schema path.`)
      }
      args.schema = arg
      continue
    }

    // --flag=value syntax
    const equalsIndex = arg.indexOf('=')
    if (equalsIndex !== -1) {
      const name = arg.slice(2, equalsIndex)
      const key = toCamelCase(name)
      // Naming the flag beats "unknown flag" for the one spelling a user is
      // most likely to reach for on a switch: `--table=true`.
      if (BOOLEAN_KEYS.has(key)) throw new Error(`Flag "--${name}" is a switch and takes no value.`)
      if (!VALUE_KEYS.has(key)) throw new Error(`Unknown flag "--${name}".`)
      assignValue(args, key, arg.slice(equalsIndex + 1))
      continue
    }

    const flagName = arg.slice(2)
    const key = toCamelCase(flagName)

    if (BOOLEAN_KEYS.has(key)) {
      args.table = true
      continue
    }

    if (!VALUE_KEYS.has(key)) throw new Error(`Unknown flag "--${flagName}".`)

    // A value flag must consume a real value — `--out-dir --table` means
    // `--out-dir` lost its value, which should fail rather than write the pages
    // into a directory literally named "--table".
    const value = argv[i + 1]
    if (value === undefined || value.startsWith('--')) {
      throw new Error(`Flag "--${flagName}" expects a value.`)
    }
    assignValue(args, key, value)
    i++
  }

  return args
}
