import { getMjstInstanceOf, getMjstPrimitive } from '@amritk/helpers/mjst-extension'
import { readKey } from '@amritk/helpers/read-key'
import { resolveRef } from '@amritk/helpers/resolve-ref'
import { isSchemaObject } from '@amritk/helpers/schema-guards'
import type { JSONSchema } from 'json-schema-typed/draft-2020-12'

/**
 * Assertions the walk leaves to the validator's own test of the position, and
 * repairs by replacing the position — which is what the loop does with the
 * errors they produce, since each is reported at the position it judges.
 * Their subschemas (an `anyOf` branch, a `not`) are never descended into, so
 * whatever they contain is the validator's business alone.
 */
export const LEAF_KEYWORDS = new Set([
  'minLength',
  'maxLength',
  'pattern',
  'format',
  'minimum',
  'maximum',
  'exclusiveMinimum',
  'exclusiveMaximum',
  'multipleOf',
  'maxItems',
  'uniqueItems',
  'contains',
  'minContains',
  'maxContains',
  'minProperties',
  'maxProperties',
  'dependentRequired',
  'not',
  'anyOf',
  'oneOf',
])

/**
 * Keywords whose repair the walk cannot reproduce. Each one either changes what
 * a position *is* (`prefixItems`, `$dynamicRef`, `unevaluatedProperties`), or is
 * repaired somewhere other than the position that reports it: `minItems` pads
 * the array, and `propertyNames` reports a key no value can fix. A schema that
 * uses any of them keeps the validate-and-repair loop.
 */
const BLOCKING_KEYWORDS = new Set([
  'prefixItems',
  'additionalItems',
  'unevaluatedProperties',
  'unevaluatedItems',
  'dependentSchemas',
  'dependencies',
  'propertyNames',
  'minItems',
  '$dynamicRef',
  '$dynamicAnchor',
  '$recursiveRef',
  '$recursiveAnchor',
  'nullable',
])

/** The types the walk can test. */
const KNOWN_TYPES = new Set(['string', 'number', 'integer', 'boolean', 'null', 'array', 'object'])

/**
 * Why the single-pass repair walk cannot be emitted for `schema`, or `null` when
 * it can.
 *
 * Asked of every definition in the graph, because the walk crosses files the
 * same way validation does: one definition the walk cannot cover means none of
 * them get it, and `repairX` keeps the loop everywhere. The answer names the
 * keyword and where it is, for the error a schema that asked for something only
 * the walk does (`"x-repair": "ref"`) gets.
 */
export const repairWalkBlocker = (schema: JSONSchema, isRoot = true): string | null => blockerAt(schema, '#', isRoot)

const blockerAt = (schema: JSONSchema, at: string, isRoot: boolean): string | null => {
  if (typeof schema === 'boolean') return null
  if (!isSchemaObject(schema)) return `${at} is not a schema`
  const node = schema as Record<string, unknown>

  for (const key of Object.keys(node)) {
    if (BLOCKING_KEYWORDS.has(key)) return `${at}/${key}`
    // A runtime class or a non-JSON primitive replaces the type check the walk
    // makes. A brand, or what the docs generator reads, changes nothing it does.
    if (key === 'x-mjst' && (getMjstInstanceOf(schema) !== undefined || getMjstPrimitive(schema) !== undefined)) {
      return `${at}/x-mjst`
    }
    // A nested `$id` starts a new resolution scope, which the walk's `$ref`
    // calls know nothing about.
    if (key === '$id' && !isRoot) return `${at}/$id`
  }

  const type = readKey(node, 'type')
  if (type !== undefined) {
    const types = Array.isArray(type) ? type : [type]
    if (types.length === 0 || !types.every((entry) => typeof entry === 'string' && KNOWN_TYPES.has(entry))) {
      return `${at}/type`
    }
  }
  const items = readKey(node, 'items')
  if (Array.isArray(items)) return `${at}/items`

  for (const key of ['properties', 'patternProperties'] as const) {
    const map = readKey(node, key)
    if (map === undefined) continue
    if (typeof map !== 'object' || map === null || Array.isArray(map)) return `${at}/${key}`
    for (const [name, child] of Object.entries(map)) {
      const found = blockerAt(child as JSONSchema, `${at}/${key}/${name}`, false)
      if (found !== null) return found
    }
  }
  for (const key of ['additionalProperties', 'items', 'then', 'else'] as const) {
    const child = readKey(node, key)
    if (child === undefined) continue
    const found = blockerAt(child as JSONSchema, `${at}/${key}`, false)
    if (found !== null) return found
  }
  const allOf = readKey(node, 'allOf')
  if (allOf !== undefined) {
    if (!Array.isArray(allOf)) return `${at}/allOf`
    for (let i = 0; i < allOf.length; i++) {
      const found = blockerAt(allOf[i] as JSONSchema, `${at}/allOf/${i}`, false)
      if (found !== null) return found
    }
  }
  return null
}

/** Keywords whose values are instance data rather than schemas. */
const DATA_KEYWORDS = new Set(['default', 'const', 'enum', 'examples', 'example'])

/**
 * Whether any schema in `schema` opts into instance `$ref` following. Values
 * under `default`, `const`, `enum` and `examples` are documents, not schemas, so
 * the same words in an example opt nothing in.
 */
export const asksForRefs = (schema: unknown): boolean => {
  if (Array.isArray(schema)) return schema.some(asksForRefs)
  if (typeof schema !== 'object' || schema === null) return false
  const node = schema as Record<string, unknown>
  if (readKey(node, 'x-repair') === 'ref') return true
  for (const [key, value] of Object.entries(node)) {
    if (!DATA_KEYWORDS.has(key) && asksForRefs(value)) return true
  }
  return false
}

/**
 * Whether `schema` is — directly or through a chain of `$ref`s — a Reference
 * schema that opted into instance `$ref` following with `"x-repair": "ref"`.
 */
export const isReferenceSchema = (schema: JSONSchema, rootSchema: Record<string, unknown> | undefined): boolean => {
  let node: unknown = schema
  for (let hops = 0; hops < 32; hops++) {
    if (!isSchemaObject(node as JSONSchema)) return false
    const record = node as Record<string, unknown>
    if (readKey(record, 'x-repair') === 'ref') return true
    const ref = readKey(record, '$ref')
    if (typeof ref !== 'string' || rootSchema === undefined) return false
    node = resolveRef(ref, rootSchema)
  }
  return false
}

/** The keywords the walk checks through the validator's own test. */
export const leafKeywords = (node: Record<string, unknown>): Record<string, unknown> | null => {
  const leaf: Record<string, unknown> = {}
  let any = false
  for (const key of Object.keys(node)) {
    if (!LEAF_KEYWORDS.has(key)) continue
    leaf[key] = node[key]
    any = true
  }
  return any ? leaf : null
}
