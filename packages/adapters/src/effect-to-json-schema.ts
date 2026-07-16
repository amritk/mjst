import { MJST_EXTENSION_KEY } from '@amritk/helpers/mjst-extension'
import type { JSONSchema } from 'json-schema-typed/draft-2020-12'

import { enforceTupleLength, normalizeDraftTuples } from './normalize-tuples'

// Minimal structural view of `effect`'s `JSONSchema.make`, loaded at runtime so
// `effect` stays an optional peer dependency. It accepts anything with an `ast`
// property, so we can call it on a bare AST node (`{ ast }`) to convert a
// nested subtree in isolation.
type Make = (schema: unknown) => Record<string, unknown>

/**
 * A read-only view of the slice of an Effect AST node we inspect while walking.
 *
 * We only model the container shapes we need to descend through to reach a
 * nested unrepresentable leaf (`bigint` / runtime `Date`): structs, arrays and
 * tuples, unions, and the wrapping nodes (`Refinement`, `Transformation`,
 * `Suspend`). Everything else is handed to `JSONSchema.make` wholesale.
 */
type EffectAst = {
  readonly _tag?: string
  readonly annotations?: Record<string | symbol, unknown>
  // `TypeLiteral` (a struct): `{ name: type }` fields.
  readonly propertySignatures?: ReadonlyArray<{
    readonly name: string
    readonly isOptional: boolean
    readonly type: EffectAst
  }>
  // `TupleType`: fixed `elements` followed by a variadic `rest` (e.g. `Schema.Array`).
  readonly elements?: ReadonlyArray<{ readonly isOptional: boolean; readonly type: EffectAst }>
  readonly rest?: ReadonlyArray<{ readonly type: EffectAst }>
  // `Union`: the member types.
  readonly types?: ReadonlyArray<EffectAst>
  // `Refinement` / `Transformation`: the encoded (wire) side we follow.
  readonly from?: EffectAst
  // `Suspend`: a thunk returning the deferred AST (used for recursive schemas).
  readonly f?: () => EffectAst
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

// A mutable JSON Schema object we build up and hoist `$defs` between while walking.
type SchemaObject = Record<string, unknown>

/**
 * Effect models `bigint` and a runtime `Date` as types with no JSON Schema
 * representation, so `JSONSchema.make` throws — for a top-level value *and* for
 * one buried inside a struct, array, or union. To stay consistent with the Zod,
 * Valibot, and TypeBox adapters — which map those to the shared `x-mjst` hint —
 * we rescue them wherever they appear: `bigint` (`BigIntKeyword`) →
 * `primitive: 'bigint'`, and the `DateFromSelf` declaration → `instanceOf: 'Date'`.
 *
 * `Schema.Date` / `Schema.BigInt` decode from a string and already convert to a
 * `string` schema, so they are untouched — the walk below hands any such
 * fully-representable subtree straight to `make` and keeps its output verbatim.
 */
const isDateFromSelf = (ast: EffectAst): boolean =>
  ast._tag === 'Declaration' && ast.annotations?.[IDENTIFIER_ANNOTATION] === 'DateFromSelf'

// `make` stamps every schema with a dialect marker and hoists referenced types
// into a sibling `$defs`. When we convert a nested subtree in isolation we strip
// the marker and lift its `$defs` into the shared root map so `$ref`s (which use
// absolute `#/$defs/...` paths) still resolve once everything is reassembled.
const hoistInto = (schema: SchemaObject, rootDefs: SchemaObject): SchemaObject => {
  delete schema['$schema']
  const defs = schema['$defs']
  if (defs && typeof defs === 'object') {
    Object.assign(rootDefs, defs)
    delete schema['$defs']
  }
  return schema
}

/**
 * Recursively converts an Effect AST into JSON Schema, rescuing nested
 * unrepresentable leaves into `x-mjst` hints along the way.
 *
 * The strategy is to lean on `make` as much as possible: any subtree it can
 * convert is representable, so we take its output verbatim. Only when `make`
 * throws do we descend structurally — reconstructing the container (struct,
 * array, union, ...) and recursing into its children — until we reach the
 * bigint / `Date` leaf that has no JSON Schema form and rescue it.
 */
const walk = (make: Make, ast: EffectAst, rootDefs: SchemaObject): SchemaObject => {
  // A subtree `make` accepts is fully representable, so use its output as-is.
  try {
    return hoistInto(make({ ast }), rootDefs)
  } catch {
    // `make` threw, so an unrepresentable node lives somewhere below. Fall through.
  }

  if (ast._tag === 'BigIntKeyword') return { [MJST_EXTENSION_KEY]: { primitive: 'bigint' } }
  if (isDateFromSelf(ast)) return { [MJST_EXTENSION_KEY]: { instanceOf: 'Date' } }

  switch (ast._tag) {
    case 'TypeLiteral': {
      const properties: SchemaObject = {}
      const required: string[] = []
      for (const ps of ast.propertySignatures ?? []) {
        properties[ps.name] = walk(make, ps.type, rootDefs)
        if (!ps.isOptional) required.push(ps.name)
      }
      return { type: 'object', required, properties, additionalProperties: false }
    }
    case 'TupleType': {
      const elements = ast.elements ?? []
      const rest = ast.rest ?? []
      const [firstRest] = rest
      // `Schema.Array(x)` is a tuple with no fixed elements and a single rest.
      if (elements.length === 0 && rest.length === 1 && firstRest) {
        return { type: 'array', items: walk(make, firstRest.type, rootDefs) }
      }
      return {
        type: 'array',
        minItems: elements.filter((e) => !e.isOptional).length,
        items: elements.map((e) => walk(make, e.type, rootDefs)),
        additionalItems: firstRest ? walk(make, firstRest.type, rootDefs) : false,
      }
    }
    case 'Union':
      return { anyOf: (ast.types ?? []).map((t) => walk(make, t, rootDefs)) }
    // `Refinement` and `Transformation` describe the encoded value via `from`;
    // `Suspend` defers to a thunk. Follow through to reach the wrapped subtree.
    case 'Refinement':
    case 'Transformation':
      if (ast.from) return walk(make, ast.from, rootDefs)
      break
    case 'Suspend':
      if (ast.f) return walk(make, ast.f(), rootDefs)
      break
  }

  // A genuinely unrepresentable type we do not know how to rescue (e.g. a raw
  // `symbol`). Point the user at the fix rather than Effect's opaque message.
  throw new Error(
    `Effect adapter failed to convert the schema. A ${ast._tag ?? 'nested'} type has no JSON Schema ` +
      `representation — replace it with a JSON-representable type, or add a \`jsonSchema\` annotation to that field.`,
  )
}

/**
 * Converts an Effect `Schema` into a JSON Schema via `JSONSchema.make`.
 *
 * Effect models values as a decode/encode pair, so `JSONSchema.make` describes
 * the *encoded* (wire) representation. For example `Schema.Date` decodes from a
 * string, so it converts to a string schema rather than a runtime `Date`. We
 * pass that representation straight through — it accurately reflects what Effect
 * expects on the wire — only stripping the dialect marker. A `BigIntFromSelf` /
 * `DateFromSelf` anywhere in the tree (top level or nested) is rescued into an
 * `x-mjst` hint instead of throwing.
 */
export const effectToJsonSchema = async (source: unknown): Promise<JSONSchema> => {
  // Effect `Schema` values are callable, so they report as `function`, not `object`.
  if ((typeof source !== 'object' && typeof source !== 'function') || source === null) {
    const received = source === null ? 'null' : typeof source
    throw new Error(`Effect adapter expected an Effect Schema but received ${received}.`)
  }

  const ast = astOf(source)
  if (!ast) {
    throw new Error('Effect adapter expected an Effect Schema but the value has no `ast` property.')
  }

  const make = await loadMake()

  const rootDefs: SchemaObject = {}
  const json = walk(make, ast, rootDefs)
  // Reattach the hoisted definitions once the whole tree is assembled.
  if (Object.keys(rootDefs).length > 0) json['$defs'] = rootDefs

  // `JSONSchema.make` (and the structural rescue path) emit fixed tuples in
  // draft-07 form (`items: [...]` + `additionalItems`), which the generators do
  // not recognize as a tuple — element types and length would go unvalidated.
  // Normalize to 2020-12 `prefixItems`, then restore the length bound.
  normalizeDraftTuples(json)
  enforceTupleLength(json)

  return json as JSONSchema
}
