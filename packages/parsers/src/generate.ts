import { buildSchema } from '@amritk/generate-parsers'
import { buildValidatorSchema } from '@amritk/generate-validators'
import { generateIndexBarrel } from '@amritk/helpers/generate-index-barrel'
import { DEFAULT_UNKNOWN_KEYS, type UnknownKeysStrategy } from '@amritk/helpers/unknown-keys-strategy'
import type { JSONSchema } from 'json-schema-typed/draft-2020-12'

import { rehomeParserFile } from './rehome-parser-file'

/** The extension emitted on relative import specifiers. */
export type ImportExtension = 'js' | 'ts'

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
   * `checkX(input): ValidationResult` — the same result `validateX` returns, with
   * the one error that stopped it. Use it when a failure has to be reported but
   * only the first thing wrong matters: it costs a single error object and walks
   * no further, where `validateX` keeps going to collect the rest.
   */
  | 'check'
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
export const ALL_MODES: readonly Mode[] = ['types', 'guard', 'validate', 'check', 'coerce', 'repair', 'parse']

/** The modes served by the validator generator. */
const VALIDATOR_MODES: ReadonlySet<Mode> = new Set<Mode>(['guard', 'validate', 'check', 'coerce', 'repair'])

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
  /**
   * Extension on every emitted relative import specifier. `'js'` (the default) is
   * the standard NodeNext form a compiled consumer needs; `'ts'` emits the literal
   * on-disk paths, so the output runs directly under Node's type stripping with no
   * build step.
   *
   * It reaches both halves, which is not a detail: they share one directory here,
   * and a set where the parser files say `.ts` and the validator files say `.js`
   * is one that resolves under neither runtime.
   */
  readonly importExt?: ImportExtension
  /**
   * Print warnings the parser generator raises about the schema — a keyword it
   * cannot enforce, a construct it had to widen. Off by default because this is a
   * library call, and a library that writes to stdout is a nuisance in anything
   * that embeds it.
   */
  readonly logWarnings?: boolean
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
  const importExt: ImportExtension = options.importExt ?? 'js'
  const needsValidator = wants(modes, VALIDATOR_MODES)
  const needsParser = wants(modes, PARSER_MODES)
  const files: GeneratedFile[] = []

  const parserFiles = async (): Promise<GeneratedFile[]> =>
    buildSchema(
      rootSchema,
      rootTypeName,
      options.extensions,
      !needsParser, // typesOnly — when the parser is only here to author the type
      options.logWarnings === true,
      modes.includes('parseStrict'),
      options.helpersMode ?? 'package',
      options.helpersImportPrefix ?? './',
      options.readonly === true,
      options.stripUnknown === true,
      typeSuffix,
      importExt,
      options.caseInsensitive === true,
      options.schemas,
      unknownKeys,
    )

  // Whoever is going to be in the output anyway authors the type, and nobody else
  // is run for it. Asking the validator generator for a parse-only build meant
  // shipping its 17 KiB runtime contract with nothing to import it, and paying
  // for a second codegen to produce a type the parser had already written — the
  // two are identical, so there is nothing to choose between them but cost.
  if (!needsValidator) {
    for (const file of await parserFiles()) {
      if (file.filename !== 'index.ts') files.push(file)
    }
    files.push({ filename: 'index.ts', content: generateIndexBarrel(files, { importExt }) })
    return files
  }

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
    importExt,
    modes.includes('check'),
  )

  for (const file of validatorFiles) {
    // The barrel is rebuilt at the end over the whole set, so the one the
    // validator generator wrote is dropped rather than merged.
    if (file.filename !== 'index.ts') files.push(file)
  }

  if (needsParser) {
    for (const file of await parserFiles()) {
      if (file.filename === 'index.ts') continue
      // Helper modules declare no type, so they keep the one name they were
      // emitted under and nothing about them needs rehoming.
      if (file.filename.includes('/')) {
        files.push(file)
        continue
      }
      const moduleName = file.filename.replace(/\.ts$/, '')
      files.push({
        filename: `${moduleName}${PARSER_SUFFIX}.ts`,
        content: rehomeParserFile(file.content, moduleName, PARSER_SUFFIX, importExt),
      })
    }
  }

  files.push({ filename: 'index.ts', content: generateIndexBarrel(files, { importExt }) })
  return files
}
