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

import { assignKey } from './assign-key'
import { entersSchemaMap, isDataPosition } from './build-resource-registry'
import { assertSchemaDepth } from './max-schema-depth'
import { readKey } from './read-key'
import { refToFilename, toKebabCase } from './ref-to-filename'

/**
 * Returns true if the schema is a draft-07 document that needs upgrading.
 */
export const isDraft07Schema = (schema: Record<string, unknown>): boolean => {
  // `readKey`: read straight off the object, an `Object.prototype.$schema` set
  // by any dependency would put *every* document through the draft-07 rewrite —
  // hoisting definitions and renaming refs in schemas that declare no draft.
  const declared = readKey(schema, '$schema')
  return typeof declared === 'string' && declared.includes('draft-07')
}

/**
 * Rewrites `$ref` values in a schema tree using an explicit string→string map.
 * Also rewrites bare `$ref: "#"` to the given `selfRef` path when provided.
 */
const rewriteRefs = (
  obj: unknown,
  refMap: ReadonlyMap<string, string>,
  selfRef?: string,
  depth = 0,
  inSchemaMap = false,
): unknown => {
  assertSchemaDepth(depth, 'upgradeDraft07Schema')
  if (typeof obj !== 'object' || obj === null) return obj
  if (Array.isArray(obj)) return obj.map((item) => rewriteRefs(item, refMap, selfRef, depth + 1, inSchemaMap))

  const record = obj as Record<string, unknown>
  const result: Record<string, unknown> = {}

  // Instance data is copied verbatim. Rewriting a `$ref` inside a `default`,
  // `enum` or `example(s)` changed the literal the author wrote — and for an
  // `enum` member that means an instance equal to a declared member is now
  // rejected, because the member itself moved.
  for (const [key, value] of Object.entries(record)) {
    if (isDataPosition(key, inSchemaMap)) {
      assignKey(result, key, value)
    } else if (!inSchemaMap && key === '$ref' && typeof value === 'string') {
      if (refMap.has(value)) {
        assignKey(result, key, refMap.get(value))
      } else if (value === '#' && selfRef) {
        assignKey(result, key, selfRef)
      } else {
        assignKey(result, key, value)
      }
    } else {
      assignKey(result, key, rewriteRefs(value, refMap, selfRef, depth + 1, entersSchemaMap(key, inSchemaMap)))
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
      assignKey(hoisted, parentName, parentSchema)
      continue
    }

    const parentObj = parentSchema as Record<string, unknown>
    const nestedDefs = readKey(parentObj, '$defs') as Record<string, unknown> | undefined

    if (!nestedDefs || typeof nestedDefs !== 'object') {
      assignKey(hoisted, parentName, parentSchema)
      continue
    }

    // Derive a short kebab-case prefix from the parent name (which may be a URI)
    const parentPrefix =
      parentName.startsWith('http://') || parentName.startsWith('https://') ? refToFilename(parentName) : parentName

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
    assignKey(hoisted, parentName, rewrittenParent)

    // Hoist each nested def, rewriting its internal refs too
    for (const [localName, localSchema] of Object.entries(nestedDefs)) {
      const hoistedName = `${parentPrefix}-${toKebabCase(localName)}`
      assignKey(hoisted, hoistedName, rewriteRefs(localSchema, localToHoisted, selfRef))
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
    // A definition may legitimately be named `__proto__`; a plain assignment
    // on that key sets the map's prototype and the definition disappears —
    // while the `$ref` to it is still rewritten, so the generators then fail
    // to resolve a definition the document declares right there.
    assignKey(renamedDefs, key, renameNestedDefs(value))
  }

  // Hoist nested $defs up to root so the pipeline can resolve all refs flatly
  const hoistedDefs = hoistNestedDefs(renamedDefs)

  // Add short-name aliases for URI-keyed definitions so that internal refs
  // like `#/$defs/draft-07-schema` (produced by self-ref rewriting in hoistNestedDefs)
  // resolve correctly alongside the original URI key lookups.
  for (const key of Object.keys(hoistedDefs)) {
    if (key.startsWith('http://') || key.startsWith('https://')) {
      const shortName = refToFilename(key)
      // `Object.hasOwn`, not `in`: a short name of `constructor` or
      // `toString` matches `Object.prototype` and the alias is silently
      // skipped, leaving the internal refs that expect it unresolvable.
      if (shortName && !Object.hasOwn(hoistedDefs, shortName)) {
        assignKey(hoistedDefs, shortName, hoistedDefs[key])
      }
    }
  }

  // The rest of the document has to learn the new name too. Its `$ref`s were
  // written against `#/definitions/...`, and that block no longer exists under
  // that name — so `{ "properties": { "a": { "$ref": "#/definitions/thing" } } }`
  // used to reach the generators unrewritten and stop the build with "Could not
  // resolve $ref". Only refs written *inside* `definitions` were being rewritten,
  // which is the same document and the same rename, so the split was an
  // oversight rather than a decision.
  return {
    ...(rewriteDefinitionsRefs(rest) as Record<string, unknown>),
    $defs: hoistedDefs,
  }
}

/**
 * Rewrites `$ref: "#/definitions/X"` to `$ref: "#/$defs/X"` throughout a schema
 * value, leaving every key untouched.
 *
 * Deliberately narrower than {@link renameNestedDefs}, which also renames the
 * `definitions` *key*. Outside the root `definitions` block there is nothing to
 * rename — a `definitions` sitting under `properties` is not hoisted and is not
 * addressable as `#/$defs/...` — so renaming it would only move the target of a
 * pointer that already worked.
 *
 * Three things it must not touch, each of which is a document it would otherwise
 * break rather than fix:
 *
 * - An embedded `$id` starts a new resource, and a `#/definitions/...` inside it
 *   addresses *that* resource's block — which is not renamed, since only the root
 *   document's `definitions` is hoisted. Rewriting there points the pointer at
 *   nothing, and `assertIdScopes` turns that into a hard failure for a document
 *   that generated fine before.
 * - `enum` / `const` / `default` / `examples` hold instance *data*. An object
 *   spelled `{"$ref": "…"}` there is a literal value, not a reference, and the
 *   rest of this package already skips these keys for exactly that reason.
 * - A key named `__proto__` assigned with `result[key] = …` runs the prototype
 *   setter instead of creating a property, silently dropping it from the output.
 *
 * Like `renameNestedDefs`, this rewrites the leading segment only: a pointer that
 * dives through a *nested* definitions block (`#/definitions/x/definitions/y`)
 * keeps its inner segment and still will not resolve. That gap is unchanged, and
 * the same in both places.
 */
const rewriteDefinitionsRefs = (obj: unknown, depth = 0, inSchemaMap = false): unknown => {
  assertSchemaDepth(depth, 'upgradeDraft07Schema')
  if (typeof obj !== 'object' || obj === null) return obj
  if (Array.isArray(obj)) return obj.map((item) => rewriteDefinitionsRefs(item, depth + 1, inSchemaMap))

  const record = obj as Record<string, unknown>
  const result: Record<string, unknown> = {}

  // Everything is copied through, then the shared position rule says which children are
  // schemas to descend into. Testing the data keywords by key name alone would
  // skip a property genuinely *named* `example` or `default` — leaving its
  // `#/definitions/...` unrewritten while the block it names is renamed to
  // `$defs`, so the ref dangles and the generators stop the build.
  for (const [key, value] of Object.entries(record)) assignKey(result, key, value)
  for (const key of Object.keys(record)) {
    if (isDataPosition(key, inSchemaMap)) continue
    const value = record[key]
    const rewritten =
      !inSchemaMap && key === '$ref' && typeof value === 'string' && value.startsWith('#/definitions/')
        ? value.replace('#/definitions/', '#/$defs/')
        : startsNewResource(value)
          ? value
          : rewriteDefinitionsRefs(value, depth + 1, entersSchemaMap(key, inSchemaMap))

    assignKey(result, key, rewritten)
  }

  return result
}

/** Whether a subschema declares its own `$id`, making it a separate resource. */
const startsNewResource = (value: unknown): boolean =>
  typeof value === 'object' &&
  value !== null &&
  !Array.isArray(value) &&
  typeof (value as Record<string, unknown>)['$id'] === 'string'

/**
 * Recursively renames `definitions` → `$defs` within a schema value and
 * rewrites `$ref: "#/definitions/X"` to `$ref: "#/$defs/X"` so that
 * `hoistNestedDefs` can map them to their hoisted root-level equivalents.
 * Does NOT hoist — hoisting is done separately at the root level.
 */
const renameNestedDefs = (obj: unknown, depth = 0, inSchemaMap = false): unknown => {
  assertSchemaDepth(depth, 'upgradeDraft07Schema')
  if (typeof obj !== 'object' || obj === null) return obj
  if (Array.isArray(obj)) return obj.map((item) => renameNestedDefs(item, depth + 1, inSchemaMap))

  const record = obj as Record<string, unknown>
  const result: Record<string, unknown> = {}

  // Copy first, then rewrite only the children the shared position rule calls schemas —
  // the same guard `rewriteDefinitionsRefs` carries. Without it this rewrote
  // `$ref`s inside `default`/`enum`/`example` values (changing the literal the
  // author wrote) and renamed a *property* genuinely called `definitions` to
  // `$defs`, so the declared property vanished from the emitted type and a
  // property the schema never had appeared beside it.
  for (const [key, value] of Object.entries(record)) assignKey(result, key, value)
  for (const key of Object.keys(record)) {
    if (isDataPosition(key, inSchemaMap)) continue
    const value = record[key]
    if (!inSchemaMap && key === '$ref' && typeof value === 'string' && value.startsWith('#/definitions/')) {
      assignKey(result, key, value.replace('#/definitions/', '#/$defs/'))
      continue
    }
    // Only a `definitions` *keyword* is renamed; inside a name map it is a name.
    const outKey = !inSchemaMap && key === 'definitions' ? '$defs' : key
    if (outKey !== key) delete result[key]
    assignKey(result, outKey, renameNestedDefs(value, depth + 1, entersSchemaMap(key, inSchemaMap)))
  }

  return result
}
