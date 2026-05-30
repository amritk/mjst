import type { JSONSchema } from 'json-schema-typed/draft-2020-12'

/**
 * Collects `#/$defs/<key>` refs for every root definition that carries a
 * `$dynamicAnchor`.
 *
 * These definitions are reachable only through `$dynamicRef`, which the ref
 * walker does not follow directly (a `$dynamicRef` is rewritten to a concrete
 * `$ref` by `resolveDynamicRefs` *after* the schema is extracted, so plain
 * `extractRefs` never sees it). Seeding them explicitly guarantees a file is
 * generated for each dynamic-anchor target — without this, a generator would
 * emit code that imports a type whose file was never produced.
 *
 * @example
 * ```ts
 * // $defs.schema has $dynamicAnchor: "meta"
 * extractDynamicAnchorDefs(rootSchema) // ['#/$defs/schema']
 * ```
 */
export const extractDynamicAnchorDefs = (schema: JSONSchema): string[] => {
  const refs: string[] = []

  if (typeof schema !== 'object' || schema === null) return refs
  if (!('$defs' in schema) || typeof schema['$defs'] !== 'object' || schema['$defs'] === null) return refs

  for (const [key, value] of Object.entries(schema['$defs'])) {
    if (typeof value === 'object' && value !== null && '$dynamicAnchor' in value) {
      refs.push(`#/$defs/${key}`)
    }
  }

  return refs
}
