/**
 * Upgrades a JSON Schema draft-07 document to be compatible with the
 * draft 2020-12 conventions used by the build pipeline.
 *
 * Draft-07 schemas differ from 2020-12 in two ways that affect our pipeline:
 * - They use `definitions` instead of `$defs`
 * - Their `definitions` keys (and `$ref` values) may be full URIs
 *   (e.g. `http://asyncapi.com/definitions/3.1.0/channel.json`) rather than
 *   short names (e.g. `channel`)
 *
 * This function:
 * 1. Renames `definitions` → `$defs` at the root level only
 * 2. Hoists any nested `$defs` (originally `definitions` inside sub-schemas)
 *    up to the root `$defs` with a prefixed name, rewriting internal refs
 *    so they resolve correctly from the root
 * 3. Rewrites bare `$ref: "#"` self-references within each definition to
 *    point back to that definition's root-level `$defs` entry
 *
 * Only applied when the schema declares `$schema: http://json-schema.org/draft-07/schema`.
 */

import { refToFilename, toKebabCase } from './ref-to-filename'

/**
 * Returns true if the schema is a draft-07 document that needs upgrading.
 */
export const isDraft07Schema = (schema: Record<string, unknown>): boolean =>
  typeof schema['$schema'] === 'string' && schema['$schema'].includes('draft-07')

/**
 * Rewrites `$ref` values in a schema tree using an explicit string→string map.
 * Also rewrites bare `$ref: "#"` to the given `selfRef` path when provided.
 */
const rewriteRefs = (obj: unknown, refMap: ReadonlyMap<string, string>, selfRef?: string): unknown => {
  if (typeof obj !== 'object' || obj === null) return obj
  if (Array.isArray(obj)) return obj.map((item) => rewriteRefs(item, refMap, selfRef))

  const record = obj as Record<string, unknown>
  const result: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(record)) {
    if (key === '$ref' && typeof value === 'string') {
      if (refMap.has(value)) {
        result[key] = refMap.get(value)
      } else if (value === '#' && selfRef) {
        result[key] = selfRef
      } else {
        result[key] = value
      }
    } else {
      result[key] = rewriteRefs(value, refMap, selfRef)
    }
  }

  return result
}

/**
 * Hoists nested `$defs` from each root-level definition up to the root `$defs`.
 *
 * When a definition contains its own `$defs` (originally `definitions` in draft-07,
 * e.g. the json-schema meta-schema or avro schema), those nested defs are moved to
 * the root with a `parentName-childName` prefix. All internal `#/$defs/X` refs
 * within the parent and its nested defs are rewritten to `#/$defs/parentName-X`.
 * Bare `$ref: "#"` within nested defs is rewritten to `#/$defs/parentName`.
 */
const hoistNestedDefs = (defs: Record<string, unknown>): Record<string, unknown> => {
  const hoisted: Record<string, unknown> = {}

  for (const [parentName, parentSchema] of Object.entries(defs)) {
    if (typeof parentSchema !== 'object' || parentSchema === null) {
      hoisted[parentName] = parentSchema
      continue
    }

    const parentObj = parentSchema as Record<string, unknown>
    const nestedDefs = parentObj['$defs'] as Record<string, unknown> | undefined

    if (!nestedDefs || typeof nestedDefs !== 'object') {
      hoisted[parentName] = parentSchema
      continue
    }

    // Derive a short kebab-case prefix from the parent name (which may be a URI)
    const parentPrefix = parentName.startsWith('http://') || parentName.startsWith('https://')
      ? refToFilename(parentName)
      : parentName

    // Build a map from local ref → hoisted ref for every nested def
    const localToHoisted = new Map<string, string>()
    for (const localName of Object.keys(nestedDefs)) {
      const hoistedName = `${parentPrefix}-${toKebabCase(localName)}`
      localToHoisted.set(`#/$defs/${localName}`, `#/$defs/${hoistedName}`)
    }

    const selfRef = `#/$defs/${parentPrefix}`

    // Rewrite refs in the parent. Keep the nested $defs in place so that
    // URI-with-fragment refs (e.g. "http://foo.json#/$defs/queue") can still
    // navigate into the parent's nested defs after resolution.
    const rewrittenParent = rewriteRefs(parentObj, localToHoisted, selfRef) as Record<string, unknown>
    hoisted[parentName] = rewrittenParent

    // Hoist each nested def, rewriting its internal refs too
    for (const [localName, localSchema] of Object.entries(nestedDefs)) {
      const hoistedName = `${parentPrefix}-${toKebabCase(localName)}`
      hoisted[hoistedName] = rewriteRefs(localSchema, localToHoisted, selfRef)
    }
  }

  return hoisted
}

/**
 * Upgrades a draft-07 schema so it is compatible with the build pipeline.
 * If the schema is not draft-07, it is returned unchanged.
 *
 * @param schema - The raw JSON Schema (any draft)
 * @returns The schema with `definitions` renamed to `$defs` at the root,
 *          nested defs hoisted to the root, and internal refs rewritten
 */
export const upgradeDraft07Schema = (schema: Record<string, unknown>): Record<string, unknown> => {
  if (!isDraft07Schema(schema)) return schema

  // Rename root-level `definitions` to `$defs` (keep all other keys as-is)
  const { definitions, $schema: _, ...rest } = schema
  const rawDefs = (definitions ?? {}) as Record<string, unknown>

  // Recursively rename `definitions` → `$defs` inside each definition's body
  // so nested defs are accessible before hoisting
  const renamedDefs: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(rawDefs)) {
    renamedDefs[key] = renameNestedDefs(value)
  }

  // Hoist nested $defs up to root so the pipeline can resolve all refs flatly
  const hoistedDefs = hoistNestedDefs(renamedDefs)

  // Add short-name aliases for URI-keyed definitions so that internal refs
  // like `#/$defs/draft-07-schema` (produced by self-ref rewriting in hoistNestedDefs)
  // resolve correctly alongside the original URI key lookups.
  for (const key of Object.keys(hoistedDefs)) {
    if (key.startsWith('http://') || key.startsWith('https://')) {
      const shortName = refToFilename(key)
      if (shortName && !(shortName in hoistedDefs)) {
        hoistedDefs[shortName] = hoistedDefs[key]
      }
    }
  }

  return {
    ...rest,
    $defs: hoistedDefs,
  }
}

/**
 * Recursively renames `definitions` → `$defs` within a schema value and
 * rewrites `$ref: "#/definitions/X"` to `$ref: "#/$defs/X"` so that
 * `hoistNestedDefs` can map them to their hoisted root-level equivalents.
 * Does NOT hoist — hoisting is done separately at the root level.
 */
const renameNestedDefs = (obj: unknown): unknown => {
  if (typeof obj !== 'object' || obj === null) return obj
  if (Array.isArray(obj)) return obj.map(renameNestedDefs)

  const record = obj as Record<string, unknown>
  const result: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(record)) {
    if (key === '$ref' && typeof value === 'string' && value.startsWith('#/definitions/')) {
      result[key] = value.replace('#/definitions/', '#/$defs/')
    } else {
      const outKey = key === 'definitions' ? '$defs' : key
      result[outKey] = renameNestedDefs(value)
    }
  }

  return result
}
