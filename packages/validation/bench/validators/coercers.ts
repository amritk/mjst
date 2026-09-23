import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import Ajv2020 from 'ajv/dist/2020.js'

import { generate } from '@amritk/validation'
import type { CoerceCase } from './coerce-cases.ts'

/** A generated file, as both packages hand it back. */
type GeneratedFile = { filename: string; content: string }

/**
 * A coercion entry point, normalised across the two contracts: hand it unknown
 * input, get back whatever that engine decided. The return type is deliberately
 * `unknown` — reading it is the caller's job precisely because the two engines
 * disagree about what "the answer" is, and flattening that away here would hide
 * the thing this benchmark exists to show.
 */
export type Coercer = (input: unknown) => unknown

/**
 * The two mjst code paths that turn unknown input into a typed value.
 *
 * They are not two implementations of one contract, which is the whole question
 * this benchmark is here to inform:
 *
 *   - `parser` is the parser engine in coercing (non-strict) mode. A
 *     total function: it repairs whatever it is given — coercing what it can and
 *     substituting the schema's defaults for what it cannot — and always returns
 *     a valid instance. Nothing is reported, because nothing failed.
 *   - `validator` is the validator engine in `coerce` mode. It moves
 *     scalars toward the declared type only where the schema leaves no choice,
 *     then runs the very same `validateX` and returns either the coerced value
 *     or the errors. Nothing is ever substituted, so a caller learns what was
 *     wrong with the document they actually sent.
 */
export const ENGINE_IDS = ['parser', 'validator', 'ajv'] as const
export type EngineId = (typeof ENGINE_IDS)[number]

export const ENGINE_LABELS: Record<EngineId, string> = {
  parser: 'parsers (parseX)',
  validator: 'validators --coerce (coerceX)',
  ajv: 'ajv coerceTypes (clone first)',
}

/**
 * A plain JSON deep copy — the cheapest clone that is correct for a parsed
 * document, and so the fairest one to charge Ajv. `structuredClone` would be the
 * obvious call and is several times slower.
 */
const cloneJson = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(cloneJson)
  if (typeof value !== 'object' || value === null) return value
  const out: Record<string, unknown> = {}
  for (const key of Object.keys(value)) out[key] = cloneJson((value as Record<string, unknown>)[key])
  return out
}

/**
 * Ajv compiled `{ allErrors: true, coerceTypes: true }` — the configuration
 * `coerceX` is built to replace — held to the same contract: the caller's input
 * is left alone and the answer comes back as `{ valid, value }`.
 *
 * Ajv coerces in place, so leaving the input alone means cloning it first, on
 * every call. That is not a handicap invented for the bench: a caller that keeps
 * the document it was given (a config it will diff, re-read, or report on) has
 * to do exactly this, and one that does not has handed its input to Ajv to
 * rewrite. `format` is left an annotation, as it is in mjst without `--formats`.
 */
const buildAjv = (coerceCase: CoerceCase): Coercer => {
  const validate = new Ajv2020({ allErrors: true, coerceTypes: true, strict: false, validateFormats: false }).compile(
    coerceCase.schema as object,
  )
  return (input) => {
    const value = cloneJson(input)
    return validate(value) ? { valid: true, value } : { valid: false, errors: validate.errors }
  }
}

/**
 * Rewrites the generated files' relative `./x.js` import specifiers to `./x.ts`.
 * The emitted source carries `.js` specifiers because that is what a compiled
 * consumer needs, and Bun resolves them back to the `.ts` files on disk. Node
 * does not: its type stripping resolves a specifier literally, so `./x.js` is a
 * missing file. Pointing the specifier at the file actually written lets both
 * runtimes import the same generated module with no transpile step.
 */
const toTsSpecifiers = (source: string): string => source.replace(/(from '\.[^']*)\.js'/g, "$1.ts'")

/**
 * Generates one engine's source for `coerceCase`. Exported so the orchestrator
 * can time the codegen and weigh the output without also loading it — the two
 * cold costs a consumer pays before any of the throughput below applies.
 *
 * Both go through the package's public `generate`, so the bench runs the same
 * way under either runtime: Bun resolves `@amritk/validation` to its sources
 * through the `development` condition, Node to the built `dist`. The parser is
 * asked for `parse` — its coercing mode, the only one that repairs rather than
 * throws — with its helpers emitted, so the temp dir it is written to is
 * self-contained.
 */
export const generateEngine = async (
  engine: Exclude<EngineId, 'ajv'>,
  coerceCase: CoerceCase,
): Promise<GeneratedFile[]> =>
  generate(
    coerceCase.schema,
    coerceCase.typeName,
    engine === 'parser'
      ? { modes: ['types', 'parse'], helpersMode: 'embedded' }
      : { modes: ['types', 'guard', 'validate', 'coerce'], unknownKeys: 'count-keys' },
  )

/**
 * Writes one engine's generated source to a temp dir and imports the entry point
 * out of it, so what gets timed is the code that actually ships rather than a
 * re-implementation of it.
 */
export const buildCoercer = async (engine: EngineId, coerceCase: CoerceCase): Promise<Coercer> => {
  if (engine === 'ajv') return buildAjv(coerceCase)
  const files = await generateEngine(engine, coerceCase)
  const dir = mkdtempSync(join(tmpdir(), `mjst-coerce-bench-${engine}-`))
  for (const file of files) {
    const path = join(dir, file.filename)
    await mkdir(dirname(path), { recursive: true })
    writeFileSync(path, toTsSpecifiers(file.content))
  }

  const mod = await import(pathToFileURL(join(dir, 'index.ts')).href)
  rmSync(dir, { recursive: true, force: true })

  const name = engine === 'parser' ? `parse${coerceCase.typeName}` : `coerce${coerceCase.typeName}`
  const fn = mod[name] as Coercer | undefined
  if (!fn) throw new Error(`${engine} generated no ${name}`)
  return fn
}

/**
 * The value an engine produced, or `null` when it refused the input.
 *
 * This is what makes the two contracts comparable without pretending they are
 * the same: a parser's return value is always the answer, while a coercing
 * validator's is the answer only when `valid` is true. Reducing both to "the
 * value, or nothing" lets the worker ask the one question that is fair to ask of
 * both — when they both accept, do they agree?
 */
export const acceptedValue = (engine: EngineId, result: unknown): unknown => {
  if (engine === 'parser') return result
  const outcome = result as { valid: boolean; value?: unknown }
  return outcome.valid ? outcome.value : null
}

/**
 * Splits an engine's output into what each schema costs and what the output
 * directory costs once.
 *
 * Reporting one total would badly misread the weight question. A validator's
 * `validation-result.ts` is 16 KiB of fixed runtime — the same 16 KiB whether the
 * project has one schema or fifty — and a parser's `_helpers/*` are fixed too
 * (and emitted at all only because this bench asks for `embedded`; the default
 * `package` mode imports them from `@amritk/helpers` and ships none). The number
 * that scales with a real project is the per-schema one, so it gets its own
 * column.
 */
export const weigh = (files: readonly GeneratedFile[]): { perSchema: number; shared: number } => {
  const isShared = (filename: string): boolean =>
    filename.startsWith('_helpers/') ||
    filename === 'validation-result.ts' ||
    filename === 'formats.ts' ||
    filename === 'index.ts'

  const bytes = (wanted: boolean): number =>
    files.filter((file) => isShared(file.filename) === wanted).reduce((total, file) => total + file.content.length, 0)

  return { perSchema: bytes(false), shared: bytes(true) }
}
