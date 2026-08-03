import type { JSONSchema } from 'json-schema-typed/draft-2020-12'

import { buildDynamicRefMap } from './build-dynamic-ref-map'
import { assertSchemaDepth } from './max-schema-depth'

/**
 * Drops the registered documents nothing in the schema actually references.
 *
 * {@link graftExternalSchemas} embeds *every* document the caller registered,
 * because which ones are needed is not knowable until the base URIs have been
 * applied and the refs are pointers. That is the right order to do the work in,
 * but it leaves a document carrying companions it never mentions — and a
 * registry is meant to be something a caller can over-supply, pointing it at
 * everything they happen to have loaded.
 *
 * Left in place, those companions are not merely dead weight. The ref-graph walk
 * seeds its queue from every `$ref` in the document, so a stray reference inside
 * an unused companion — to a vocabulary document the caller did not register, say
 * — would stop generation for a schema that never asked for any of it. Their
 * `$dynamicAnchor`s would join the document-wide anchor map and be generated on
 * sight. One unreferenced document could fail, or bloat, every build.
 *
 * So reachability is computed here, once, and everything downstream sees an
 * ordinary document: registered companions that are used are indistinguishable
 * from definitions the author wrote, and the rest are gone.
 *
 * Pointers survive the prune untouched. A `$defs` entry is addressed by *name*,
 * so removing its siblings cannot renumber anything — which is what makes it safe
 * to run this after {@link normalizeRefScopes} has already rewritten every ref.
 */

/** The `$defs` prefix an in-document pointer to a registered document starts with. */
const DEFS_PREFIX = '#/$defs/'

/** Reverses RFC 6901's escapes, so a definition named `a/b` is matched by its real name. */
const unescapeSegment = (segment: string): string =>
  segment.indexOf('~') === -1 ? segment : segment.replace(/~1/g, '/').replace(/~0/g, '~')

/**
 * The registered document a pointer leads into, or `undefined` when it names
 * something the author wrote (or nothing at all).
 */
const externalTarget = (ref: string, external: ReadonlySet<string>): string | undefined => {
  if (!ref.startsWith(DEFS_PREFIX)) return undefined
  const rest = ref.slice(DEFS_PREFIX.length)
  const slash = rest.indexOf('/')
  const name = unescapeSegment(slash === -1 ? rest : rest.slice(0, slash))
  return external.has(name) ? name : undefined
}

/**
 * Every registered document reachable from one subtree in a single step.
 *
 * `$dynamicRef` counts as a reference for this purpose: a bare anchor name is
 * resolved through the document-wide map, so a document reached only by late
 * binding is kept rather than pruned out from under the ref that needs it.
 */
const referencedFrom = (
  node: unknown,
  external: ReadonlySet<string>,
  dynamicMap: Record<string, string>,
  into: Set<string>,
): void => {
  const walk = (value: unknown, depth: number): void => {
    assertSchemaDepth(depth, 'pruneExternalSchemas')
    if (value === null || typeof value !== 'object') return
    if (Array.isArray(value)) {
      for (const item of value) walk(item, depth + 1)
      return
    }

    const record = value as Record<string, unknown>
    const ref = record['$ref']
    if (typeof ref === 'string') {
      const name = externalTarget(ref, external)
      if (name !== undefined) into.add(name)
    }
    const dynamicRef = record['$dynamicRef']
    if (typeof dynamicRef === 'string') {
      // An anchor-form `$dynamicRef` binds through the map; a pointer-form one
      // already says where it goes.
      const target = dynamicRef.startsWith('#/') ? dynamicRef : dynamicMap[dynamicRef]
      const name = target === undefined ? undefined : externalTarget(target, external)
      if (name !== undefined) into.add(name)
    }

    for (const key in record) walk(record[key], depth + 1)
  }

  walk(node, 0)
}

/**
 * Returns `document` with every registered definition nothing reaches removed.
 *
 * Reachability starts from the document *without* its registered definitions —
 * so only what the author actually wrote seeds the search — and then follows
 * refs from each registered document that is reached, so a companion pulled in
 * by another companion is kept.
 *
 * The document is returned by identity when nothing needs dropping, which is the
 * case whenever a caller registers exactly what the schema uses.
 *
 * @param document - The grafted document, with every ref already a pointer.
 * @param external - The `$defs` names {@link graftExternalSchemas} added.
 * @returns The document, carrying only the registered definitions it uses.
 */
export const pruneExternalSchemas = (
  document: Record<string, unknown>,
  external: ReadonlySet<string>,
): Record<string, unknown> => {
  if (external.size === 0) return document
  const defs = document['$defs']
  if (typeof defs !== 'object' || defs === null || Array.isArray(defs)) return document
  const definitions = defs as Record<string, unknown>

  const dynamicMap = buildDynamicRefMap(document as JSONSchema)

  // The seed is the authored document: same root, same keywords, but with the
  // registered definitions taken out so they cannot vouch for themselves.
  const authored: Record<string, unknown> = {}
  for (const [name, definition] of Object.entries(definitions)) {
    if (!external.has(name)) authored[name] = definition
  }
  const seed: Record<string, unknown> = { ...document, $defs: authored }

  const reached = new Set<string>()
  referencedFrom(seed, external, dynamicMap, reached)

  const queue = [...reached]
  for (let head = 0; head < queue.length; head++) {
    const found = new Set<string>()
    referencedFrom(definitions[queue[head] as string], external, dynamicMap, found)
    for (const name of found) {
      if (reached.has(name)) continue
      reached.add(name)
      queue.push(name)
    }
  }

  if (reached.size === external.size) return document

  const kept: Record<string, unknown> = {}
  for (const [name, definition] of Object.entries(definitions)) {
    if (!external.has(name) || reached.has(name)) kept[name] = definition
  }
  return { ...document, $defs: kept }
}
