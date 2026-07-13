import type { JSONSchema } from 'json-schema-typed/draft-2020-12'

import { buildDynamicRefMap } from './build-dynamic-ref-map'

/**
 * Collects a `#/...` ref for every subschema in the document that carries a
 * `$dynamicAnchor` — anywhere in the tree, not just direct `$defs` entries.
 *
 * These definitions are reachable only through `$dynamicRef`, which the ref
 * walker does not follow directly (a `$dynamicRef` is rewritten to a concrete
 * `$ref` by `resolveDynamicRefs` *after* the schema is extracted, so plain
 * `extractRefs` never sees it). Seeding them explicitly guarantees a file is
 * generated for each dynamic-anchor target — without this, a generator would
 * emit code that imports a type whose file was never produced.
 *
 * Delegates to {@link buildDynamicRefMap} so the set of seeded refs and the
 * `$dynamicRef` rewrite targets can never disagree.
 *
 * @example
 * ```ts
 * // $defs.schema has $dynamicAnchor: "meta"
 * extractDynamicAnchorDefs(rootSchema) // ['#/$defs/schema']
 * ```
 */
export const extractDynamicAnchorDefs = (schema: JSONSchema): string[] => Object.values(buildDynamicRefMap(schema))
