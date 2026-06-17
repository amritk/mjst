import { MJST_EXTENSION_KEY } from '@amritk/helpers/mjst-extension'
import type { JSONSchema } from 'json-schema-typed/draft-2020-12'

// Minimal structural view of `effect`'s `JSONSchema.make`, loaded at runtime so
// `effect` stays an optional peer dependency.
type Make = (schema: unknown) => Record<string, unknown>

/** A read-only view of the slice of an Effect AST node we inspect. */
type EffectAst = {
  readonly _tag?: string
  readonly annotations?: Record<string | symbol, unknown>
}

/**
 * Resolves `effect`'s `JSONSchema.make` from a runtime import, throwing a clear
 * error when it is missing.
 */
const loadMake = async (): Promise<Make> => {
  let mod: Record<string, unknown>
  try {
    mod = (await import('effect')) as Record<string, unknown>
  } catch {
    throw new Error("The Effect adapter requires 'effect' to be installed in your project.")
  }

  const jsonSchema = mod['JSONSchema'] as Record<string, unknown> | undefined
  const make = jsonSchema?.['make']

  if (typeof make !== 'function') {
    throw new Error("Effect's 'JSONSchema.make' was not found. The Effect adapter requires effect v3 or later.")
  }

  return make as Make
}

// The annotation key Effect stamps an identifier under (e.g. `"DateFromSelf"`).
const IDENTIFIER_ANNOTATION = Symbol.for('effect/annotation/Identifier')

/** Reads `node.ast`, the AST that backs every Effect `Schema`. */
const astOf = (source: unknown): EffectAst | undefined => {
  const ast = (source as { ast?: unknown })?.ast
  return ast && typeof ast === 'object' ? (ast as EffectAst) : undefined
}

/**
 * Effect models `bigint` and a runtime `Date` as types with no JSON Schema
 * representation, so `JSONSchema.make` throws on `Schema.BigIntFromSelf` /
 * `Schema.DateFromSelf`. To stay consistent with the Zod, Valibot, and TypeBox
 * adapters — which map those to the shared `x-mjst` hint — we rescue them here:
 * `bigint` (`BigIntKeyword`) → `primitive: 'bigint'`, and the `DateFromSelf`
 * declaration → `instanceOf: 'Date'`. (`Schema.Date` / `Schema.BigInt` decode
 * from a string and already convert to a `string` schema, so they are untouched.)
 */
const rescueXMjst = (ast: EffectAst): JSONSchema | undefined => {
  if (ast._tag === 'BigIntKeyword') return { [MJST_EXTENSION_KEY]: { primitive: 'bigint' } } as JSONSchema
  if (ast._tag === 'Declaration' && ast.annotations?.[IDENTIFIER_ANNOTATION] === 'DateFromSelf') {
    return { [MJST_EXTENSION_KEY]: { instanceOf: 'Date' } } as JSONSchema
  }
  return undefined
}

/**
 * Converts an Effect `Schema` into a JSON Schema via `JSONSchema.make`.
 *
 * Effect models values as a decode/encode pair, so `JSONSchema.make` describes
 * the *encoded* (wire) representation. For example `Schema.Date` decodes from a
 * string, so it converts to a string schema rather than a runtime `Date`. We
 * pass that representation straight through — it accurately reflects what Effect
 * expects on the wire — only stripping the dialect marker. A top-level
 * `BigIntFromSelf` / `DateFromSelf` is rescued into an `x-mjst` hint.
 */
export const effectToJsonSchema = async (source: unknown): Promise<JSONSchema> => {
  // Effect `Schema` values are callable, so they report as `function`, not `object`.
  if ((typeof source !== 'object' && typeof source !== 'function') || source === null) {
    const received = source === null ? 'null' : typeof source
    throw new Error(`Effect adapter expected an Effect Schema but received ${received}.`)
  }

  const ast = astOf(source)
  if (ast) {
    const rescued = rescueXMjst(ast)
    if (rescued) return rescued
  }

  const make = await loadMake()

  let json: Record<string, unknown>
  try {
    json = make(source)
  } catch (error) {
    // `make` throws on an unrepresentable type with no `jsonSchema` annotation —
    // most often a nested `BigIntFromSelf` / `DateFromSelf`. Point the user at the
    // fix rather than surfacing Effect's opaque "Missing annotation" message.
    throw new Error(
      `Effect adapter failed to convert the schema. A nested bigint or runtime Date (BigIntFromSelf / DateFromSelf) ` +
        `has no JSON Schema representation — use the string-encoded Schema.BigInt / Schema.Date, or add a ` +
        `\`jsonSchema\` annotation to that field.\n${String(error)}`,
    )
  }

  delete json['$schema']

  return json as JSONSchema
}
