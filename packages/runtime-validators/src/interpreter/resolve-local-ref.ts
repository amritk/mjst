/**
 * Resolves a local JSON Schema reference against the root document. Two fragment
 * forms are supported:
 *
 * - **JSON Pointer** (`#/$defs/user`, `#/definitions/node`, `#`) — walked token
 *   by token, with `~1` → `/` and `~0` → `~` unescaping.
 * - **`$anchor` name** (`#node`) — a plain-name fragment, resolved by searching
 *   the document for an object whose `$anchor` equals that name.
 *
 * Only *local* refs are handled — pointers into the same document. Remote/URI
 * refs are out of scope: the interpreter is self-contained and never fetches
 * external documents. Callers that need remote refs should bundle them into
 * `$defs` first (the same thing the build-time generators expect).
 *
 * `$anchor` search is global within the document (we do not implement `$id`
 * base-URI scoping), which matches the common single-document case. Returns the
 * resolved subschema, or `undefined` when the reference does not resolve so the
 * caller can fail loudly rather than silently accepting anything.
 */
export const resolveLocalRef = (ref: string, root: unknown): unknown => {
  if (!ref.startsWith('#')) return undefined

  const pointer = ref.slice(1)
  // A bare "#" (or "#/") points at the whole document. Strict RFC 6901 would read
  // "#/" as the member with the empty-string key, but Ajv — our differential
  // oracle — treats it as root, and so do we.
  if (pointer === '' || pointer === '/') return root

  // A fragment that does not start with "/" is a plain anchor name, not a JSON
  // Pointer (which must be empty or begin with "/"). Per 2020-12 a `$dynamicAnchor`
  // also creates an ordinary anchor, so a plain `#x` ref resolves to either.
  if (!pointer.startsWith('/')) return findAnchor(root, pointer, ANCHOR_KEYWORDS, new Set())

  const parts = pointer.split('/').slice(1)
  let current: unknown = root

  for (const rawPart of parts) {
    // JSON Pointer escaping: ~1 → "/" and ~0 → "~".
    const part = rawPart.replace(/~1/g, '/').replace(/~0/g, '~')

    if (current === null || typeof current !== 'object') return undefined
    if (Array.isArray(current)) {
      // Into an array a token must be a non-negative index (RFC 6901). This also
      // stops `length`/`constructor` etc. from resolving to array internals.
      if (!/^(?:0|[1-9]\d*)$/.test(part)) return undefined
      const index = Number(part)
      if (index >= current.length) return undefined
      current = current[index]
    } else {
      // Own-property only: `in` would walk the prototype chain, so a mistyped
      // pointer like `#/$defs/toString` would resolve to `Object.prototype`'s
      // method and be silently treated as an accept-anything schema. `hasOwn`
      // makes an unresolvable ref fail loudly instead.
      const container = current as Record<string, unknown>
      if (!Object.hasOwn(container, part)) return undefined
      current = container[part]
    }
  }

  return current
}

/** Anchor keywords a plain `#name` fragment may bind to (see {@link resolveLocalRef}). */
const ANCHOR_KEYWORDS = ['$anchor', '$dynamicAnchor'] as const

/**
 * Depth-first search for the object whose value for any of `keywords` equals
 * `name` (e.g. `$anchor`/`$dynamicAnchor`). `seen` guards against pathological
 * cyclic inputs; the schema tree itself is JSON-derived and acyclic, and this
 * runs at most once per ref (the caller memoizes it). Shared by the static and
 * dynamic resolvers so the traversal exists in exactly one place.
 */
export const findAnchor = (node: unknown, name: string, keywords: readonly string[], seen: Set<object>): unknown => {
  if (node === null || typeof node !== 'object' || seen.has(node)) return undefined
  seen.add(node)

  if (!Array.isArray(node)) {
    const record = node as Record<string, unknown>
    for (const keyword of keywords) if (record[keyword] === name) return node
  }

  for (const key in node) {
    const found = findAnchor((node as Record<string, unknown>)[key], name, keywords, seen)
    if (found !== undefined) return found
  }
  return undefined
}
