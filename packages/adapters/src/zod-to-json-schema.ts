import { MJST_EXTENSION_KEY } from '@amritk/helpers/mjst-extension'
import type { JSONSchema } from 'json-schema-typed/draft-2020-12'

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

/**
 * Resolves Zod's `toJSONSchema` from a runtime import, tolerating both the
 * named export (`import { toJSONSchema }`) and the `z` namespace
 * (`z.toJSONSchema`). Throws a clear error when Zod is missing or too old,
 * since `toJSONSchema` only exists in Zod 4 and later.
 */
const loadToJsonSchema = async (): Promise<ToJsonSchema> => {
  let mod: Record<string, unknown>
  try {
    mod = (await import('zod')) as Record<string, unknown>
  } catch {
    throw new Error("The Zod adapter requires 'zod' (v4 or later) to be installed in your project.")
  }

  const named = mod['toJSONSchema']
  const namespace = (mod['z'] ?? mod['default'] ?? mod) as Record<string, unknown> | undefined
  const fromNamespace = namespace?.['toJSONSchema']
  const converter =
    typeof named === 'function' ? named : typeof fromNamespace === 'function' ? fromNamespace : undefined

  if (!converter) {
    throw new Error("Zod's 'toJSONSchema' was not found. The Zod adapter requires zod v4 or later.")
  }

  return converter as ToJsonSchema
}

/**
 * Converts a Zod schema into a Draft 2020-12 JSON Schema using Zod 4's native
 * `toJSONSchema`.
 *
 * Zod's `z.date()` has no JSON Schema representation and would otherwise throw.
 * We pass `unrepresentable: 'any'` so conversion never fails on it, then use the
 * `override` hook to rewrite date schemas into an `x-mjst` instanceOf hint — the
 * same extension TypeBox dates use — so generated types and runtime checks treat
 * them as `Date`.
 */
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

export const zodToJsonSchema = async (source: unknown): Promise<JSONSchema> => {
  if (typeof source !== 'object' || source === null) {
    const received = source === null ? 'null' : typeof source
    throw new Error(`Zod adapter expected a Zod schema but received ${received}.`)
  }

  const toJSONSchema = await loadToJsonSchema()

  // Zod types with no JSON Schema equivalent that we do *not* rescue into an
  // `x-mjst` hint. `unrepresentable: 'any'` turns these into `{}` (accepts
  // anything), which silently widens the generated type — so we surface them.
  const LOSSY_TYPES = new Set(['symbol', 'nan', 'void', 'undefined', 'never', 'map', 'set', 'promise', 'function'])
  const droppedTypes = new Set<string>()

  let json: Record<string, unknown>
  try {
    json = toJSONSchema(source, {
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

  if (droppedTypes.size > 0) {
    console.warn(
      `[mjst] Zod adapter: ${[...droppedTypes].sort().join(', ')} ${droppedTypes.size === 1 ? 'has' : 'have'} no JSON Schema representation and became "accept anything". The generated type will be wider than the Zod schema.`,
    )
  }

  // The dialect marker is noise for the generators, which already target 2020-12.
  delete json['$schema']

  // Zod under-constrains fixed tuples (bare `prefixItems`); restore their length.
  enforceTupleLength(json)

  return json as JSONSchema
}
