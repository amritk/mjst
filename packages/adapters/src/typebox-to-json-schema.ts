import { MJST_EXTENSION_KEY } from '@amritk/helpers/mjst-extension'
import type { JSONSchema } from 'json-schema-typed/draft-2020-12'

// The seven core JSON Schema 2020-12 types. Anything else in a `type` slot is a
// TypeBox extended type with no native JSON Schema equivalent.
const JSON_SCHEMA_TYPES = new Set(['string', 'number', 'integer', 'boolean', 'object', 'array', 'null'])

// Maps a TypeBox extended `type` string to the runtime class an `x-mjst`
// instanceOf hint should reference. Add entries here as more extended types
// gain generator support.
const EXTENDED_TYPE_TO_INSTANCE: Record<string, string> = {
  Date: 'Date',
}

// Maps a TypeBox extended `type` string to a non-JSON `x-mjst` primitive hint
// (e.g. Type.BigInt() emits `{ type: 'bigint' }`).
const EXTENDED_TYPE_TO_PRIMITIVE: Record<string, string> = {
  bigint: 'bigint',
}

/**
 * Recursively rewrites TypeBox extended types into an `x-mjst` instanceOf hint.
 *
 * TypeBox emits non-standard `type` strings for runtime classes (e.g.
 * `Type.Date()` produces `{ type: 'Date' }`). We drop the bogus `type` and
 * record the class under `x-mjst` so the generators can emit the right
 * TypeScript type and `instanceof` checks. Extended types we do not yet map are
 * left untouched with a warning, preserving a permissive best-effort fallback.
 */
const rewriteExtendedTypes = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(rewriteExtendedTypes)
  if (typeof value !== 'object' || value === null) return value

  const source = value as Record<string, unknown>
  const result: Record<string, unknown> = {}
  for (const [key, val] of Object.entries(source)) {
    result[key] = rewriteExtendedTypes(val)
  }

  const type = result['type']
  if (typeof type === 'string' && !JSON_SCHEMA_TYPES.has(type)) {
    const primitive = EXTENDED_TYPE_TO_PRIMITIVE[type]
    const instanceOf = EXTENDED_TYPE_TO_INSTANCE[type]
    if (primitive) {
      delete result['type']
      result[MJST_EXTENSION_KEY] = { primitive }
    } else if (instanceOf) {
      delete result['type']
      result[MJST_EXTENSION_KEY] = { instanceOf }
    } else {
      console.warn(`[mjst] TypeBox type '${type}' has no JSON Schema or x-mjst mapping; leaving it unchanged.`)
    }
  }

  return result
}

/**
 * TypeBox schemas are already JSON Schema objects at runtime, but they carry
 * non-enumerable symbol keys (`Kind`, `Optional`, ...) that TypeBox uses for its
 * own type machinery. A JSON round-trip drops those symbols (and any `undefined`
 * values), leaving a clean, plain JSON Schema. We then rewrite TypeBox's
 * extended types (Date, ...) into `x-mjst` hints the generators understand.
 *
 * We deliberately do not import TypeBox here: the conversion only touches the
 * plain-object shape, so TypeBox stays an optional peer dependency used solely
 * by the consumer's schema module, never by mjst itself.
 */
export const typeboxToJsonSchema = (source: unknown): JSONSchema => {
  if (typeof source !== 'object' || source === null) {
    const received = source === null ? 'null' : typeof source
    throw new Error(`TypeBox adapter expected a schema object but received ${received}.`)
  }

  // Boundary cast: JSON.parse yields `unknown`, and the round-tripped, rewritten
  // TypeBox schema is a valid JSON Schema by construction.
  const sanitized: unknown = JSON.parse(JSON.stringify(source))
  return rewriteExtendedTypes(sanitized) as JSONSchema
}
