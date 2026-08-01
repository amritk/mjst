import type { JSONSchema } from 'json-schema-typed/draft-2020-12'

import { assertSchemaDepth } from './max-schema-depth'
import { isSchemaObject } from './schema-guards'

// Keywords whose values are data, not subschemas — an `$id` inside an example
// value is instance data and scopes nothing.
const NON_SCHEMA_KEYWORDS = new Set(['enum', 'const', 'default', 'examples'])

/** True when a subschema declares targets a fragment ref could legitimately mean. */
const declaresLocalTargets = (record: Record<string, unknown>): boolean =>
  typeof record['$defs'] === 'object' ||
  typeof record['definitions'] === 'object' ||
  typeof record['$anchor'] === 'string'

/**
 * Fails a document that relies on `$id` base-URI scoping, which this package
 * does not implement.
 *
 * In 2020-12 an `$id` on a subschema starts a new resource, and a `#/...` ref
 * inside it resolves against *that* resource — not the document root. Ref
 * resolution here always navigates from the root, so an embedded resource with
 * its own `$defs/t` and an inner `$ref: "#/$defs/t"` quietly picks up the
 * *outer* `$defs/t`: a different type, no warning, exit 0. A wrong type that
 * compiles is the worst outcome available, so the detectable shape of it is
 * rejected up front instead.
 *
 * The check is deliberately narrow. It only fires when a non-root `$id` scope
 * both contains a fragment ref and declares local targets of its own (`$defs`,
 * `definitions`, or an `$anchor`) — that is exactly the ambiguous case. A
 * decorative `$id` with nothing local to point at has only one possible reading,
 * so it stays silent and keeps working.
 *
 * TODO: replace this with real base-URI resolution — build an `$id` → resource
 * map during the upgrade pass and resolve fragments against the innermost
 * enclosing base URI — and delete the check.
 */
export const assertIdScopes = (rootSchema: JSONSchema): void => {
  if (!isSchemaObject(rootSchema)) return

  /**
   * `scopeId` is the nearest enclosing non-root `$id`, or null while still in
   * the root resource. `scopeOwnsTargets` says whether that scope declared ref
   * targets of its own. The root's `$id` is the document base, not a nested
   * scope, so `isRoot` keeps it from opening one.
   */
  const walk = (
    node: unknown,
    scopeId: string | null,
    scopeOwnsTargets: boolean,
    depth: number,
    isRoot: boolean,
  ): void => {
    assertSchemaDepth(depth, 'assertIdScopes')
    if (node === null || typeof node !== 'object') return
    if (Array.isArray(node)) {
      for (const item of node) walk(item, scopeId, scopeOwnsTargets, depth + 1, false)
      return
    }

    const record = node as Record<string, unknown>
    const id = record['$id']
    const startsScope = !isRoot && typeof id === 'string' && id !== ''
    const nextScopeId = startsScope ? id : scopeId
    const nextOwnsTargets = startsScope ? declaresLocalTargets(record) : scopeOwnsTargets

    const ref = record['$ref']
    if (nextScopeId !== null && nextOwnsTargets && typeof ref === 'string' && ref.startsWith('#') && ref !== '#') {
      throw new Error(
        `The subschema with $id "${nextScopeId}" declares its own definitions and contains the ref "${ref}". ` +
          '$id base-URI scoping is not supported: that ref would be resolved against the document root, ' +
          'silently selecting a different definition. Hoist the embedded resource into the root $defs ' +
          '(or drop the inner $id) so every fragment ref names one target.',
      )
    }

    for (const key of Object.keys(record)) {
      if (NON_SCHEMA_KEYWORDS.has(key)) continue
      walk(record[key], nextScopeId, nextOwnsTargets, depth + 1, false)
    }
  }

  walk(rootSchema, null, false, 0, true)
}
