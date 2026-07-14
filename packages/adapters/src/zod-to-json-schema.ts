import { MJST_EXTENSION_KEY } from '@amritk/helpers/mjst-extension'
import type { JSONSchema } from 'json-schema-typed/draft-2020-12'

import type { AdapterOptions } from './adapter'
import { reportLossyConstructs } from './report-lossy-constructs'

// Zod 4's `toJSONSchema` does the heavy lifting. We only describe the slice of
// its surface we touch so the adapter does not need a hard dependency on Zod's
// types — `zod` stays an optional peer dependency loaded at runtime.
type ToJsonSchema = (schema: unknown, options?: ZodToJsonSchemaOptions) => Record<string, unknown>

type OverrideContext = {
  readonly zodSchema?: { readonly _zod?: { readonly def?: { readonly type?: string } } }
  readonly jsonSchema: Record<string, unknown>
}

type ZodToJsonSchemaOptions = {
  readonly unrepresentable?: 'any' | 'throw'
  readonly override?: (ctx: OverrideContext) => void
}

// Minimal structural view of the `zod-to-json-schema` package (the Zod 3
// fallback). Its `override` callback receives a Zod 3 type def whose `typeName`
// is a `ZodFirstPartyTypeKind` string (e.g. `'ZodDate'`); returning a schema
// replaces the node, and returning the module's `ignoreOverride` symbol falls
// through to the default parsing.
type FallbackDef = { readonly typeName?: string }

type FallbackOptions = {
  readonly definitionPath?: string
  readonly override?: (def: FallbackDef) => Record<string, unknown> | symbol
}

type FallbackConvert = (schema: unknown, options?: FallbackOptions) => Record<string, unknown>

type FallbackConverter = {
  readonly convert: FallbackConvert
  readonly ignoreOverride: symbol
}

// Zod types that have no JSON Schema equivalent and become "accept anything"
// (`{}`) — the same widening the Zod 4 path performs with `unrepresentable:
// 'any'`. Reported through a warning so the loss is never silent. The Zod 4
// path keys these by Zod's lowercase type name; the fallback keys them by Zod
// 3's `ZodFirstPartyTypeKind`, mapped here to the same friendly labels.
const LOSSY_TYPES = new Set(['symbol', 'nan', 'void', 'undefined', 'never', 'map', 'set', 'promise', 'function'])
const LOSSY_TYPENAMES: Record<string, string> = {
  ZodSymbol: 'symbol',
  ZodNaN: 'nan',
  ZodVoid: 'void',
  ZodUndefined: 'undefined',
  ZodNever: 'never',
  ZodMap: 'map',
  ZodSet: 'set',
  ZodPromise: 'promise',
  ZodFunction: 'function',
}

/**
 * Resolves Zod's `toJSONSchema` from a runtime import, tolerating both the
 * named export (`import { toJSONSchema }`) and the `z` namespace
 * (`z.toJSONSchema`). Returns `null` when Zod is missing or too old (Zod 3 has
 * no `toJSONSchema`) so the caller can fall back to `zod-to-json-schema`.
 */
const loadToJsonSchema = async (): Promise<ToJsonSchema | null> => {
  let mod: Record<string, unknown>
  try {
    mod = (await import('zod')) as Record<string, unknown>
  } catch {
    return null
  }

  const named = mod['toJSONSchema']
  const namespace = (mod['z'] ?? mod['default'] ?? mod) as Record<string, unknown> | undefined
  const fromNamespace = namespace?.['toJSONSchema']
  const converter =
    typeof named === 'function' ? named : typeof fromNamespace === 'function' ? fromNamespace : undefined

  return converter ? (converter as ToJsonSchema) : null
}

/**
 * Resolves the `zod-to-json-schema` package — the Zod 3 fallback used when the
 * installed Zod lacks the native `toJSONSchema`. Returns `null` when the
 * package is absent or does not expose the expected shape.
 */
const loadFallbackConverter = async (): Promise<FallbackConverter | null> => {
  let mod: Record<string, unknown>
  try {
    mod = (await import('zod-to-json-schema')) as Record<string, unknown>
  } catch {
    return null
  }

  const named = mod['zodToJsonSchema']
  const fromDefault = mod['default']
  const convert = typeof named === 'function' ? named : typeof fromDefault === 'function' ? fromDefault : undefined
  const ignoreOverride = mod['ignoreOverride']

  if (typeof convert !== 'function' || typeof ignoreOverride !== 'symbol') return null

  return { convert: convert as FallbackConvert, ignoreOverride }
}

/**
 * Runs the Zod 4 native `toJSONSchema`, mapping `z.date()`/`z.bigint()` into the
 * shared `x-mjst` hints and recording lossy (unrepresentable) types.
 *
 * Zod's `z.date()` has no JSON Schema representation and would otherwise throw.
 * We pass `unrepresentable: 'any'` so conversion never fails on it, then use the
 * `override` hook to rewrite date schemas into an `x-mjst` instanceOf hint — the
 * same extension TypeBox dates use — so generated types and runtime checks treat
 * them as `Date`.
 */
const convertWithZod4 = (
  source: unknown,
  toJSONSchema: ToJsonSchema,
  droppedTypes: Set<string>,
): Record<string, unknown> => {
  try {
    return toJSONSchema(source, {
      unrepresentable: 'any',
      override: (ctx) => {
        const type = ctx.zodSchema?._zod?.def?.type
        if (type === 'date') {
          for (const key of Object.keys(ctx.jsonSchema)) delete ctx.jsonSchema[key]
          ctx.jsonSchema[MJST_EXTENSION_KEY] = { instanceOf: 'Date' }
        } else if (type === 'bigint') {
          for (const key of Object.keys(ctx.jsonSchema)) delete ctx.jsonSchema[key]
          ctx.jsonSchema[MJST_EXTENSION_KEY] = { primitive: 'bigint' }
        } else if (type && LOSSY_TYPES.has(type)) {
          droppedTypes.add(type)
        }
      },
    })
  } catch (error) {
    throw new Error(`Zod adapter failed to convert the schema. Is it a valid Zod schema?\n${String(error)}`)
  }
}

/**
 * Runs the `zod-to-json-schema` fallback for Zod 3, reaching the same outcome as
 * {@link convertWithZod4}: `z.date()`/`z.bigint()` become the shared `x-mjst`
 * hints and lossy types are recorded for the warning. Zod 3's date/bigint would
 * otherwise degrade to a string/integer schema, so the `override` hook rewrites
 * them, and lossy leaf types (which the fallback silently drops) are turned into
 * an open `{}` schema so the field survives — matching the Zod 4 widening.
 *
 * Emits refs under `$defs` (via `definitionPath`) to match the Zod 4 path; the
 * shared finalize step normalises the fallback's draft-07 tuple form afterwards.
 */
const convertWithFallback = (
  source: unknown,
  fallback: FallbackConverter,
  droppedTypes: Set<string>,
): Record<string, unknown> => {
  try {
    return fallback.convert(source, {
      definitionPath: '$defs',
      override: (def) => {
        const typeName = def?.typeName
        if (typeName === 'ZodDate') return { [MJST_EXTENSION_KEY]: { instanceOf: 'Date' } }
        if (typeName === 'ZodBigInt') return { [MJST_EXTENSION_KEY]: { primitive: 'bigint' } }
        const friendly = typeName ? LOSSY_TYPENAMES[typeName] : undefined
        if (friendly) {
          droppedTypes.add(friendly)
          return {}
        }
        return fallback.ignoreOverride
      },
    })
  } catch (error) {
    throw new Error(`Zod adapter failed to convert the schema. Is it a valid Zod schema?\n${String(error)}`)
  }
}

/**
 * `zod-to-json-schema` (the Zod 3 fallback) emits tuples in draft-07 form —
 * `items` as an array plus `additionalItems` for the rest element. Rewrite those
 * nodes into 2020-12 form (`prefixItems`, with `additionalItems` becoming
 * `items`) so the rest of the pipeline — and {@link enforceTupleLength} below —
 * sees the same shape the Zod 4 path produces. No-op on Zod 4 output, which
 * already uses `prefixItems`.
 */
const normalizeDraftTuples = (node: unknown): void => {
  if (node === null || typeof node !== 'object') return
  if (Array.isArray(node)) {
    for (const item of node) normalizeDraftTuples(item)
    return
  }
  const obj = node as Record<string, unknown>
  if (Array.isArray(obj['items'])) {
    obj['prefixItems'] = obj['items']
    if ('additionalItems' in obj) {
      // A rest element (`.rest(...)`) — its schema (or `false`) becomes `items`.
      obj['items'] = obj['additionalItems']
      delete obj['additionalItems']
    } else {
      // No rest element: drop `items` so `enforceTupleLength` forbids extras.
      delete obj['items']
    }
  }
  for (const value of Object.values(obj)) normalizeDraftTuples(value)
}

/**
 * Zod 4's `toJSONSchema` emits a fixed tuple as a bare `prefixItems` array with
 * no length bound, so the result accepts a too-short array (positions past the
 * end are simply unconstrained) and a too-long one (nothing forbids extra
 * items). A Zod tuple requires exactly its fixed elements, so we restore that:
 * `minItems` forces the fixed elements to be present, and — when the tuple has
 * no `.rest(...)` (no `items`) — `items: false` forbids extras. Applied to every
 * `prefixItems` node in the tree. Existing tighter bounds are never loosened.
 */
const enforceTupleLength = (node: unknown): void => {
  if (node === null || typeof node !== 'object') return
  if (Array.isArray(node)) {
    for (const item of node) enforceTupleLength(item)
    return
  }
  const obj = node as Record<string, unknown>
  if (Array.isArray(obj['prefixItems'])) {
    const fixed = obj['prefixItems'].length
    const min = typeof obj['minItems'] === 'number' ? obj['minItems'] : 0
    if (min < fixed) obj['minItems'] = fixed
    // No `items` keyword means no rest element: the array may not exceed the
    // fixed tuple, so forbid additional items.
    if (!('items' in obj)) obj['items'] = false
  }
  for (const value of Object.values(obj)) enforceTupleLength(value)
}

// Keys a branch may carry and still be treated as a plain "closed object" that
// is safe to merge. Anything else (patternProperties, a nested allOf, $ref, a
// conditional, …) makes the merge unsafe, so we leave such an allOf alone.
const CLOSED_OBJECT_KEYS = new Set(['type', 'properties', 'required', 'additionalProperties'])

const isClosedObject = (node: unknown): node is Record<string, unknown> => {
  if (node === null || typeof node !== 'object' || Array.isArray(node)) return false
  const obj = node as Record<string, unknown>
  if (obj['type'] !== 'object' || obj['additionalProperties'] !== false) return false
  return Object.keys(obj).every((key) => CLOSED_OBJECT_KEYS.has(key))
}

/**
 * Zod emits an intersection of objects as an `allOf` where every branch carries
 * `additionalProperties: false`. That is unsatisfiable — each branch rejects the
 * keys the others contribute — even though the Zod intersection accepts the
 * combined object. When every `allOf` branch is a closed object we merge them
 * into one: properties are unioned (a key in several branches becomes an `allOf`
 * of its schemas), `required` is unioned, and `additionalProperties: false` is
 * kept over the combined key set. `allOf`s with a non-object branch (e.g. two
 * refined strings) are left untouched — those already combine correctly.
 */
const mergeClosedObjectAllOf = (node: unknown): unknown => {
  if (node === null || typeof node !== 'object') return node
  if (Array.isArray(node)) return node.map(mergeClosedObjectAllOf)

  const obj = node as Record<string, unknown>
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(obj)) out[key] = mergeClosedObjectAllOf(value)

  const allOf = out['allOf']
  if (Array.isArray(allOf) && allOf.length > 1 && allOf.every(isClosedObject)) {
    const properties: Record<string, unknown[]> = {}
    const required = new Set<string>()
    for (const branch of allOf as Record<string, unknown>[]) {
      const props = (branch['properties'] ?? {}) as Record<string, unknown>
      for (const [prop, schema] of Object.entries(props)) {
        const bucket = properties[prop]
        if (bucket) bucket.push(schema)
        else properties[prop] = [schema]
      }
      for (const r of (branch['required'] ?? []) as string[]) required.add(r)
    }
    const mergedProps: Record<string, unknown> = {}
    for (const [prop, schemas] of Object.entries(properties)) {
      mergedProps[prop] = schemas.length === 1 ? schemas[0] : { allOf: schemas }
    }
    delete out['allOf']
    out['type'] = 'object'
    out['properties'] = mergedProps
    if (required.size > 0) out['required'] = [...required]
    out['additionalProperties'] = false
  }
  return out
}

/**
 * Shared post-processing applied to both the Zod 4 and Zod 3 conversion output:
 * report widened lossy types (a batched warning, or a throw in strict mode),
 * drop the dialect marker, normalise draft-07 tuples, restore tuple length
 * bounds, and collapse unsatisfiable object intersections.
 */
const finalize = (
  json: Record<string, unknown>,
  droppedTypes: Set<string>,
  strict: boolean | undefined,
): JSONSchema => {
  // Surface every widened type in one batched, branded notice (or throw in
  // strict mode) so the loss is not silent — the same treatment the Valibot
  // adapter gives its own unrepresentable constructs.
  reportLossyConstructs('Zod', droppedTypes, strict)

  // The dialect marker is noise for the generators, which already target 2020-12.
  delete json['$schema']

  // The Zod 3 fallback emits draft-07 tuples; rewrite them to 2020-12 form.
  normalizeDraftTuples(json)

  // Zod under-constrains fixed tuples (bare `prefixItems`); restore their length.
  enforceTupleLength(json)

  // Collapse an unsatisfiable `allOf` of closed objects (object intersections).
  return mergeClosedObjectAllOf(json) as JSONSchema
}

/**
 * Converts a Zod schema into a Draft 2020-12 JSON Schema.
 *
 * Prefers Zod 4's native `toJSONSchema`. When the installed Zod lacks it (Zod 3),
 * falls back to the optional `zod-to-json-schema` package, routing through the
 * same `x-mjst` date/bigint mapping and lossy-type reporting. If neither path is
 * available, throws a clear error explaining what to install.
 */
export const zodToJsonSchema = async (source: unknown, options?: AdapterOptions): Promise<JSONSchema> => {
  if (typeof source !== 'object' || source === null) {
    const received = source === null ? 'null' : typeof source
    throw new Error(`Zod adapter expected a Zod schema but received ${received}.`)
  }

  const droppedTypes = new Set<string>()

  const toJSONSchema = await loadToJsonSchema()
  if (toJSONSchema) {
    return finalize(convertWithZod4(source, toJSONSchema, droppedTypes), droppedTypes, options?.strict)
  }

  const fallback = await loadFallbackConverter()
  if (fallback) {
    return finalize(convertWithFallback(source, fallback, droppedTypes), droppedTypes, options?.strict)
  }

  throw new Error(
    "The Zod adapter requires either 'zod' v4+ (for its native toJSONSchema) or the 'zod-to-json-schema' " +
      'package (a fallback for Zod 3). Neither was found — install one in your project.',
  )
}
