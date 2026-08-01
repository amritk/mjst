import { hasType, isSchemaObject } from '@amritk/helpers/schema-guards'
import type { JSONSchema } from 'json-schema-typed/draft-2020-12'

/** The JSON types whose values are compared exactly by `Set` membership. */
const SCALAR_TYPES = new Set(['string', 'number', 'integer', 'boolean', 'null'])

/**
 * True when a schema provably describes a JSON scalar. Deliberately
 * conservative: a `$ref`, a boolean/absent schema, an `object`/`array` type, or a
 * missing `type` all fail this test, so anything we cannot prove scalar is
 * treated as possibly-structural.
 */
const schemaIsScalarOnly = (schema: unknown): boolean => {
  if (schema === undefined || !isSchemaObject(schema as JSONSchema) || !hasType(schema as JSONSchema)) return false
  const type = (schema as Record<string, unknown>)['type']
  const types = Array.isArray(type) ? type : [type]
  return types.length > 0 && types.every((t) => typeof t === 'string' && SCALAR_TYPES.has(t))
}

/**
 * True when an array's elements can only be JSON scalars, in which case
 * `uniqueItems` can be settled by a plain `Set` (SameValueZero is exact for
 * primitives). Tuple positions and the `items` tail must all be scalar.
 */
const arrayItemsAreScalarOnly = (schema: JSONSchema): boolean => {
  if (!isSchemaObject(schema)) return false
  const record = schema as Record<string, unknown>
  const prefix = record['prefixItems']
  if (Array.isArray(prefix)) {
    if (!prefix.every((position) => schemaIsScalarOnly(position))) return false
    // A closed tuple (`items: false` / `additionalItems: false`) has no tail;
    // otherwise the tail schema has to be scalar too.
    const tail = 'items' in record ? record['items'] : record['additionalItems']
    return tail === false ? true : schemaIsScalarOnly(tail)
  }
  if (Array.isArray(record['items'])) {
    // Draft-07 tuple spelling: the positions are `items`, the tail is `additionalItems`.
    if (!(record['items'] as unknown[]).every((position) => schemaIsScalarOnly(position))) return false
    return record['additionalItems'] === false ? true : schemaIsScalarOnly(record['additionalItems'])
  }
  return schemaIsScalarOnly(record['items'])
}

/**
 * A key-order-independent JSON projection of one element, used as the dedupe key
 * for a `uniqueItems` array whose items may be objects.
 *
 * `JSON.stringify(value)` alone is key-order *sensitive*, so `{ a: 1, b: 2 }` and
 * `{ b: 2, a: 1 }` produced different keys and a duplicate pair sailed through —
 * the strict parser accepted an array Ajv, the runtime interpreter, and
 * `generate-validators` all reject. The replacer sorts every object's keys before
 * serialization; `JSON.stringify` calls it for each nested value in turn, so the
 * canonicalization reaches all the way down without any recursion of our own.
 */
const CANONICAL_JSON =
  'JSON.stringify(_u, (_k, _v) => (_v !== null && typeof _v === "object" && !Array.isArray(_v)) ? ' +
  'Object.fromEntries(Object.keys(_v).sort().map((_sk) => [_sk, (_v as Record<string, unknown>)[_sk]])) : _v)'

/**
 * Builds the boolean expression that is TRUE when every element of `accessor` is
 * distinct — the `uniqueItems: true` contract.
 *
 * Scalar-only arrays take the cheap native `Set` (exact for primitives, and
 * allocation is a single pass). Anything that might hold an object or an array
 * falls back to the canonical-JSON projection above, because JSON Schema compares
 * items by *structural* equality and neither a plain `Set` (reference equality)
 * nor a raw `JSON.stringify` key (order sensitive) answers that question.
 *
 * @param accessor - Expression yielding the array; the caller must already have
 *   proven `Array.isArray`.
 * @param schema - The array schema, read for its item types.
 */
export const generateUniqueItemsCheck = (accessor: string, schema: JSONSchema): string =>
  arrayItemsAreScalarOnly(schema)
    ? `new Set(${accessor}).size === ${accessor}.length`
    : `new Set((${accessor} as unknown[]).map((_u) => ${CANONICAL_JSON})).size === ${accessor}.length`
