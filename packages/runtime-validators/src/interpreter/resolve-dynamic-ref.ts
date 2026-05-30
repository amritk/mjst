import { resolveLocalRef } from '@/interpreter/resolve-local-ref'

/**
 * Resolves a JSON Schema 2020-12 `$dynamicRef` against the root document.
 *
 * The common (and, for us, only) shape is a plain-name fragment such as
 * `#meta`: it binds to the object in the document carrying the matching
 * `$dynamicAnchor` (`$dynamicAnchor: "meta"`). This is the pattern OpenAPI 3.1
 * uses so a media-type `schema` can late-bind to the root JSON Schema dialect.
 *
 * We resolve to the document-global `$dynamicAnchor` rather than implementing
 * the full dynamic-scope algorithm (walk the dynamic scope, bind to the
 * *outermost* matching anchor). For a single bundled document — what the
 * build-time generators already assume, and what `buildDynamicRefMap` in
 * `@amritk/helpers` does — there is exactly one anchor per name, so the two
 * agree. If we ever need true recursive-schema dynamic binding (e.g. the JSON
 * Schema meta-schema referencing itself through extension dialects), this is
 * where that scope tracking would go.
 *
 * A `$dynamicRef` with no matching `$dynamicAnchor`, or one written as a plain
 * JSON Pointer (`#/$defs/x`), falls back to {@link resolveLocalRef} so it still
 * behaves like a normal `$ref`. Returns `undefined` when nothing resolves, so
 * the caller can fail loudly rather than silently accept anything.
 */
export const resolveDynamicRef = (ref: string, root: unknown): unknown => {
  if (!ref.startsWith('#')) return undefined

  const fragment = ref.slice(1)
  // A plain-name fragment is a `$dynamicAnchor` lookup; a pointer (empty or
  // starting with "/") never names a dynamic anchor, so skip the search.
  if (fragment !== '' && !fragment.startsWith('/')) {
    const anchored = findDynamicAnchor(root, fragment, new Set())
    if (anchored !== undefined) return anchored
  }

  // Either a pointer form or a dynamic anchor that does not exist — defer to the
  // static resolver so `$dynamicRef` degrades gracefully to `$ref` semantics.
  return resolveLocalRef(ref, root)
}

/**
 * Depth-first search for the object carrying `$dynamicAnchor: name`. `seen`
 * guards against pathological cyclic inputs; schema trees are JSON-derived and
 * acyclic, and the caller memoizes the result so this runs at most once per ref.
 */
const findDynamicAnchor = (node: unknown, name: string, seen: Set<object>): unknown => {
  if (node === null || typeof node !== 'object' || seen.has(node)) return undefined
  seen.add(node)

  if (!Array.isArray(node) && (node as Record<string, unknown>)['$dynamicAnchor'] === name) return node

  for (const key in node) {
    const found = findDynamicAnchor((node as Record<string, unknown>)[key], name, seen)
    if (found !== undefined) return found
  }
  return undefined
}
