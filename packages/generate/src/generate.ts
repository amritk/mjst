import { buildSchema } from '@amritk/generate-parsers'
import { buildValidatorSchema } from '@amritk/generate-validators'
import { generateIndexBarrel } from '@amritk/helpers/generate-index-barrel'
import { identifierMentions } from '@amritk/helpers/identifier-mentions'
import { DEFAULT_UNKNOWN_KEYS, type UnknownKeysStrategy } from '@amritk/helpers/unknown-keys-strategy'
import type { JSONSchema } from 'json-schema-typed/draft-2020-12'

import { rehomeParserFile } from './rehome-parser-file'

/** A generated TypeScript file, as every mjst generator hands one back. */
export type GeneratedFile = {
  filename: string
  content: string
}

/**
 * One runtime entry point the generated output can carry. Each is a different
 * answer to "how much may this do to my document, and what do I get told".
 *
 * They compose rather than compete: asking for several emits several functions
 * over one shared type, and the ones that judge a value all judge it with the
 * same `validateX`, so no two can disagree about whether a document is valid.
 */
export type Mode =
  /** `X` — the TypeScript type, and nothing that runs. Always emitted. */
  | 'types'
  /**
   * `isX(input): input is X` — a type guard. Stops at the first thing wrong and
   * builds no error object, which on invalid input is dramatically cheaper than
   * any mode that reports: the check that fails is usually the first one tried.
   * Use it when the answer is a branch, not a message.
   */
  | 'guard'
  /**
   * `validateX(input): ValidationResult` — every error, each with a JSON Pointer,
   * the keyword that rejected the value and that keyword's own values. Use it
   * when a human or an API client has to be told what to fix.
   */
  | 'validate'
  /**
   * `coerceX(input): CoercionResult<X>` — move a scalar toward the declared type
   * where the schema leaves no choice, then validate. Substitutes nothing, so a
   * value it cannot coerce is rejected as written.
   */
  | 'coerce'
  /**
   * `repairX(input): RepairResult<X>` — coerce, validate, then repair each
   * rejected position to a value the schema supplies, reporting the validator's
   * own errors as the repairs. Tolerant, and never silently so.
   */
  | 'repair'
  /**
   * `parseX(input): X` — a total function. Repairs whatever it is given and
   * always returns a valid instance, reporting nothing. The fastest way to get a
   * usable value when you do not care what was wrong with the input.
   */
  | 'parse'
  /**
   * `parseX(input): X` that throws on the first violation instead of repairing.
   * Mutually exclusive with `'parse'` — they are the same function under two
   * contracts.
   */
  | 'parseStrict'

/** Every mode, for a caller who wants the lot. */
export const ALL_MODES: readonly Mode[] = ['types', 'guard', 'validate', 'coerce', 'repair', 'parse']

/** The modes served by the validator generator. */
const VALIDATOR_MODES: ReadonlySet<Mode> = new Set<Mode>(['guard', 'validate', 'coerce', 'repair'])

/** The modes served by the parser generator. */
const PARSER_MODES: ReadonlySet<Mode> = new Set<Mode>(['parse', 'parseStrict'])

/**
 * The suffix on the parser half's filename. The two generators emit a file named
 * for the same schema, so one of them has to move; the parser moves because the
 * validator file is the one that declares the type, and a reader opening
 * `user.ts` should find the type there.
 */
const PARSER_SUFFIX = '.parse'

export type GenerateOptions = {
  /**
   * Which entry points to emit. Defaults to `['types', 'guard', 'validate']` —
   * the modes that only ever read the document. Anything that rewrites a value
   * is opt-in, because a generator that quietly starts repairing documents is
   * not one you can trust by default.
   */
  readonly modes?: readonly Mode[]
  /** Suffix appended to every `$ref`-derived type name. The root name is untouched. */
  readonly typeSuffix?: string
  /** Documents already loaded, keyed by the absolute URI a `$ref` names them by. */
  readonly schemas?: Readonly<Record<string, unknown>>
  /** How a closed object's fast path proves it carries no undeclared key. */
  readonly unknownKeys?: UnknownKeysStrategy
  /** String `format`s the generated validators enforce. Unset leaves `format` an annotation. */
  readonly formats?: 'all' | readonly string[]
  /** Explain a failing `anyOf` / `oneOf` with the errors of the branch it plainly meant. */
  readonly branchErrors?: boolean
  /** Build each parsed result from the declared properties only, dropping undeclared keys. */
  readonly stripUnknown?: boolean
  /** Emit `readonly` type members. */
  readonly readonly?: boolean
  /** Normalize a mis-cased string onto an `enum` member it matches case-insensitively. */
  readonly caseInsensitive?: boolean
  /** Where the parser half gets its runtime helpers: the published package, or emitted sources. */
  readonly helpersMode?: 'package' | 'embedded'
  /** Prefix on emitted-helper import specifiers, when `helpersMode` is `'embedded'`. */
  readonly helpersImportPrefix?: string
  /** Schema extensions, keyed by definition name, passed through to the parser half. */
  readonly extensions?: Parameters<typeof buildSchema>[2]
}

/** Whether any requested mode needs that generator run at all. */
const wants = (modes: readonly Mode[], group: ReadonlySet<Mode>): boolean => modes.some((mode) => group.has(mode))

/**
 * Generates one coherent set of files for a schema, carrying whichever entry
 * points were asked for.
 *
 * This composes `@amritk/generate-validators` and `@amritk/generate-parsers`
 * rather than reimplementing either. That is deliberate: the two emit genuinely
 * different code for the value-producing modes — a parser fuses building the
 * output with checking it and is several times faster for it, while a validator
 * keeps the passes apart and can therefore report — and collapsing them into one
 * emitter would mean giving up one of those properties. Composing keeps both and
 * spends the cost on reconciling their output instead, which is bounded and
 * testable.
 *
 * What makes the reconciliation honest is that both generators derive the type
 * from the same `@amritk/helpers/generate-type-definition`, so the type is
 * emitted once and the parser half imports it. There is exactly one `X` in the
 * output, and every function in it is talking about the same type.
 */
export const generate = async (
  rootSchema: JSONSchema,
  rootTypeName: string,
  options: GenerateOptions = {},
): Promise<GeneratedFile[]> => {
  const modes = options.modes ?? ['types', 'guard', 'validate']
  if (modes.includes('parse') && modes.includes('parseStrict')) {
    throw new Error(
      "modes 'parse' and 'parseStrict' are the same function under two contracts — one repairs and always " +
        'returns a value, the other throws on the first violation. Ask for one.',
    )
  }

  const typeSuffix = options.typeSuffix ?? ''
  const unknownKeys = options.unknownKeys ?? DEFAULT_UNKNOWN_KEYS
  const files: GeneratedFile[] = []

  // The validator half owns the type, so it runs even for a types-only build and
  // even when only the parser modes were asked for.
  const validatorFiles = await buildValidatorSchema(
    rootSchema,
    rootTypeName,
    typeSuffix,
    options.schemas,
    unknownKeys,
    options.formats,
    modes.includes('coerce') || modes.includes('repair'),
    options.branchErrors === true,
    modes.includes('repair'),
  )

  for (const file of validatorFiles) {
    // The barrel is rebuilt at the end over the whole set, so the one the
    // validator generator wrote is dropped rather than merged.
    if (file.filename === 'index.ts') continue
    files.push(
      wants(modes, VALIDATOR_MODES) || file.filename === 'validation-result.ts'
        ? file
        : { ...file, content: stripRuntime(file.content) },
    )
  }

  if (wants(modes, PARSER_MODES)) {
    const parserFiles = await buildSchema(
      rootSchema,
      rootTypeName,
      options.extensions,
      false, // typesOnly — the type comes from the validator half
      false, // logWarnings
      modes.includes('parseStrict'),
      options.helpersMode ?? 'package',
      options.helpersImportPrefix ?? './',
      options.readonly === true,
      options.stripUnknown === true,
      typeSuffix,
      'js',
      options.caseInsensitive === true,
      options.schemas,
      unknownKeys,
    )

    for (const file of parserFiles) {
      if (file.filename === 'index.ts') continue
      // Helper modules declare no type, so `rehomeParserFile` hands them back
      // untouched and they keep their own filenames.
      if (file.filename.includes('/')) {
        files.push(file)
        continue
      }
      const moduleName = file.filename.replace(/\.ts$/, '')
      files.push({
        filename: `${moduleName}${PARSER_SUFFIX}.ts`,
        content: rehomeParserFile(file.content, moduleName, PARSER_SUFFIX),
      })
    }
  }

  files.push({ filename: 'index.ts', content: generateIndexBarrel(files) })
  return files
}

/**
 * Drops everything a validator file runs, keeping its type declarations and
 * exactly the imports those still need.
 *
 * A types-only build still goes through the validator generator, because that is
 * where the type is authored; what it must not do is ship a `validateX` nobody
 * asked for. Removing the runtime afterwards rather than asking the generator
 * for a types-only mode keeps the type identical to the one every other mode is
 * built against, which is the premise the whole package rests on.
 *
 * Pruning the imports is not tidiness. This repo — and anything inheriting its
 * flags — compiles with `noUnusedLocals`, so an import left behind for a
 * function that is no longer there fails the consumer's build; and a mixed
 * `import { type Inner, validateInner }` has to lose its value half and keep its
 * type half, because the surviving type still names `Inner`.
 */
const stripRuntime = (content: string): string => {
  const lines = content.split('\n')
  const kept: string[] = []
  const imports: string[] = []
  let depth = 0
  let dropping = false

  for (const line of lines) {
    if (line.startsWith('import ')) {
      imports.push(line)
      continue
    }
    // Runtime declarations go whether or not they are exported: the generator
    // hoists private helpers next to the functions that call them, and one left
    // behind with its caller gone is an unused local in the consumer's build.
    if (!dropping && /^(?:export )?(?:const|let|function) \w+/.test(line)) {
      dropping = true
      depth = 0
    }
    if (dropping) {
      for (const char of line) {
        if (char === '{' || char === '(' || char === '[') depth++
        else if (char === '}' || char === ')' || char === ']') depth--
      }
      if (depth <= 0) dropping = false
      continue
    }
    kept.push(line)
  }

  const body = kept
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  const mentions = identifierMentions(body)

  const pruned = imports.flatMap((statement) => {
    const match = /^import\s+(type\s+)?\{([^}]*)\}\s+from\s+('[^']+');?$/.exec(statement.trim())
    if (!match) return mentions(statement) ? [statement] : []

    const [, , clause = '', specifier = ''] = match
    const names = clause
      .split(',')
      .map((name) => name.trim().replace(/^type\s+/, ''))
      .filter((name) => name !== '' && mentions(name))

    // Whatever survives is only ever read by a type now, so the whole statement
    // becomes type-only regardless of how it arrived.
    return names.length > 0 ? [`import type { ${names.join(', ')} } from ${specifier};`] : []
  })

  return [...pruned, ...(pruned.length > 0 ? [''] : []), body].join('\n') + '\n'
}
