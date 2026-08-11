import { assignKey } from './assign-key'
import {
  buildResourceRegistry,
  entersSchemaMap,
  escapePointerSegment,
  isDataPosition,
  resolveUri,
} from './build-resource-registry'
import { assertSchemaDepth } from './max-schema-depth'
import { resolveRef } from './resolve-ref'
import { resolveScopedRef } from './resolve-scoped-ref'

/**
 * Rewrites every `$ref` and `$dynamicRef` in a document to a plain JSON Pointer
 * from the document root, applying the `$id` base URIs in scope on the way.
 *
 * This is the one place `$id` needs to be understood. Everything downstream —
 * the ref-graph walk, the filename and type-name derivation, the import graph
 * the generated code carries, the strict-mode subschema matcher — resolves refs
 * by string against the root document, so handing it a document whose refs are
 * already document-root pointers makes all of it correct at once, with no
 * base-URI awareness of its own.
 *
 * What that buys, concretely: `"list"`, `"http://example.com/b/d.json"`,
 * `"urn:uuid:…#/$defs/bar"`, `"/absref/foobar.json"`, and `"child1#my_anchor"`
 * all become nameable targets instead of refs the walker refuses; and a
 * `"#/$defs/t"` written inside an embedded resource stops silently selecting the
 * document root's `t`.
 *
 * A document that declares no `$id` is returned **by identity** — there is one
 * base URI in play, so its refs already mean what they say and nothing is
 * rewritten or allocated. The same goes for any subtree that comes back
 * unchanged, so the common document pays a single read-only walk.
 *
 * A ref the registry cannot place is left exactly as written. It may name
 * another document (a fetch this package does not do), and leaving it alone
 * keeps the existing behaviour — the walker refuses it, or a consumer drops it —
 * rather than inventing a target. {@link assertIdScopes} is what catches the
 * dangerous subset of those.
 */
export const normalizeRefScopes = (root: Record<string, unknown>): Record<string, unknown> => {
  const registry = buildResourceRegistry(root)
  if (registry === null) return root

  /** The document-root pointer `ref` names from `base`, or null to leave it alone. */
  const normalizedRef = (ref: string, base: string): string | null => {
    const target = resolveScopedRef(registry, ref, base)
    if (target === undefined) return null
    const rewritten = `#${target.pointer}`
    if (rewritten === ref) return null
    // Only rewrite onto a pointer that actually names a subschema. A resource
    // whose fragment leads nowhere is unresolvable per the spec, and pointing at
    // it would trade a ref the caller can still reason about for one that is
    // definitely broken.
    return resolveRef(rewritten, root) === undefined ? null : rewritten
  }

  /**
   * `$dynamicRef` keeps its late binding whenever the spec's bookending rule
   * says it has one: if static resolution lands on a `$dynamicAnchor` of the
   * same name, the reference stays written as the bare anchor name so
   * `buildDynamicRefMap` / `resolveDynamicRefs` bind it document-wide. Only when
   * there is no bookend — the name matches a plain `$anchor`, or the fragment is
   * a pointer — does 2020-12 say it behaves statically, and then it is rewritten
   * exactly like a `$ref`.
   */
  const normalizedDynamicRef = (ref: string, base: string): string | null => {
    const absolute = resolveUri(ref, base)
    if (absolute === undefined) return normalizedRef(ref, base)
    const hash = absolute.indexOf('#')
    const fragment = hash === -1 ? '' : absolute.slice(hash + 1)
    if (
      fragment !== '' &&
      !fragment.startsWith('/') &&
      registry.dynamicAnchors.has(`${absolute.slice(0, hash)}#${fragment}`)
    ) {
      return `#${fragment}` === ref ? null : `#${fragment}`
    }
    return normalizedRef(ref, base)
  }

  const rewrite = (node: unknown, pointer: string, enclosing: string, depth: number, inSchemaMap = false): unknown => {
    assertSchemaDepth(depth, 'normalizeRefScopes')
    if (node === null || typeof node !== 'object') return node

    if (Array.isArray(node)) {
      const mapped = node.map((item, index) => rewrite(item, `${pointer}/${index}`, enclosing, depth + 1, inSchemaMap))
      return mapped.some((item, index) => item !== node[index]) ? mapped : node
    }

    const record = node as Record<string, unknown>
    // The base was already worked out during the registry walk, so this pass
    // re-reads it rather than parsing the `$id` a second time.
    const base = registry.baseAt.get(pointer) ?? enclosing

    let changed = false
    const result: Record<string, unknown> = {}
    // Copy everything, then rewrite only the children the shared position
    // rule calls schemas. A key it skips holds instance data and keeps its
    // value verbatim; the
    // `$ref` rewrites only apply at a schema node, where those keys are
    // keywords rather than author-chosen names.
    for (const [key, value] of Object.entries(record)) assignKey(result, key, value)
    for (const key of Object.keys(record)) {
      if (isDataPosition(key, inSchemaMap)) continue
      const value = record[key]
      const next =
        !inSchemaMap && key === '$ref' && typeof value === 'string'
          ? (normalizedRef(value, base) ?? value)
          : !inSchemaMap && key === '$dynamicRef' && typeof value === 'string'
            ? (normalizedDynamicRef(value, base) ?? value)
            : rewrite(
                value,
                `${pointer}/${escapePointerSegment(key)}`,
                base,
                depth + 1,
                entersSchemaMap(key, inSchemaMap),
              )
      if (next !== value) changed = true
      assignKey(result, key, next)
    }
    return changed ? result : record
  }

  return rewrite(root, '', registry.rootBase, 0) as Record<string, unknown>
}
