/**
 * Resolves a local JSON Schema reference against the root document. Two fragment
 * forms are supported:
 *
 * - **JSON Pointer** (`#/$defs/user`, `#/definitions/node`, `#`) — walked token
 *   by token, with `~1` → `/` and `~0` → `~` unescaping.
 * - **`$anchor` name** (`#node`) — a plain-name fragment, resolved by searching
 *   the document for an object whose `$anchor` equals that name.
 *
 * Only *local* refs are handled — pointers into the same document. A ref naming
 * another document by URI is answered a layer up, by `resolve-scoped-ref.ts`
 * against the registry, which is where a caller-supplied document (see
 * `ValidateOptions.schemas`) becomes reachable. Nothing at either layer fetches:
 * the interpreter resolves what it was given and fails loudly otherwise.
 *
 * `$id` base-URI scoping lives in `resolve-scoped-ref.ts` and runs *first* for
 * any document that declares an `$id`; this resolver is the document-global
 * fallback behind it, so a fragment that names nothing in its own resource can
 * still find an anchor declared elsewhere in the same document. Returns the
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

  return walkJsonPointer(root, pointer)
}

/**
 * Walks a JSON Pointer (`/$defs/user`, or `''` for the whole document) from
 * `start`, returning the value it names or `undefined` when it does not resolve.
 *
 * `visit` is called with each object node the walk passes *through* — including
 * `start` — which is how the `$id`-scoped resolver notices that a pointer
 * crossed into an embedded resource and picks up its base URI. Callers that do
 * not care about that omit it and pay nothing.
 */
export const walkJsonPointer = (start: unknown, pointer: string, visit?: (node: object) => void): unknown => {
  let current: unknown = start
  if (visit && current !== null && typeof current === 'object') visit(current)
  if (pointer === '') return current

  for (const rawPart of pointer.split('/').slice(1)) {
    // A `$ref` fragment is a URI, so each token is percent-decoded (RFC 6901 §6)
    // before the JSON Pointer `~1`/`~0` unescaping — otherwise `#/$defs/a%20b`
    // would look for the literal key `a%20b` instead of `a b` and fail to resolve.
    // A malformed sequence (a stray `%`) is treated as a literal token, not an error.
    let decoded = rawPart
    try {
      decoded = decodeURIComponent(rawPart)
    } catch {
      // Not valid percent-encoding — use the token verbatim.
    }
    // JSON Pointer escaping: ~1 → "/" and ~0 → "~".
    const part = decoded.replace(/~1/g, '/').replace(/~0/g, '~')

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
    if (visit && current !== null && typeof current === 'object') visit(current)
  }

  return current
}

/**
 * Keywords whose value is instance data, and keywords whose value is a map of
 * author-chosen names to schemas.
 *
 * Kept in step by hand with `@amritk/helpers`' `DATA_KEYWORDS`/`SCHEMA_MAPS`:
 * this package takes no `@amritk/*` dependency by design. The parity test in
 * that package reads these declarations, so a drift fails a test.
 */
const DATA_KEYWORDS = new Set(['enum', 'const', 'default', 'examples', 'example'])

const SCHEMA_MAPS = new Set([
  'properties',
  'patternProperties',
  '$defs',
  'definitions',
  'dependentSchemas',
  'dependencies',
])

/** Anchor keywords a plain `#name` fragment may bind to (see {@link resolveLocalRef}). */
const ANCHOR_KEYWORDS = ['$anchor', '$dynamicAnchor'] as const

/**
 * Depth-first search for the object whose value for any of `keywords` equals
 * `name` (e.g. `$anchor`/`$dynamicAnchor`, or `true` for `$recursiveAnchor`).
 * `seen` guards against pathological cyclic inputs; the schema tree itself is
 * JSON-derived and acyclic, and this runs at most once per ref (the caller
 * memoizes it). Shared by the static and dynamic resolvers so the traversal
 * exists in exactly one place.
 *
 * Iterative with an explicit stack rather than recursive, because the schema is
 * untrusted: a deeply nested document (20,000 levels of `{ "not": … }`) would
 * otherwise overflow the native stack with a `RangeError`, which is uncatchable
 * by the {@link isValidationLimitError} contract callers handle. Children are
 * pushed in reverse so popping visits them in key order — the same pre-order
 * traversal (and therefore the same "first anchor wins") the recursion had.
 */
export const findAnchor = (node: unknown, name: unknown, keywords: readonly string[], seen: Set<object>): unknown => {
  const stack: unknown[] = [node]
  // Whether each queued node is a name-to-schema map rather than a schema. Both
  // stacks pop together, before any early `continue`, since they index one
  // another.
  const inMaps: boolean[] = [false]

  while (stack.length > 0) {
    const current = stack.pop()
    const inMap = inMaps.pop() as boolean
    if (current === null || typeof current !== 'object' || seen.has(current)) continue
    seen.add(current)

    const record = current as Record<string, unknown>
    if (Array.isArray(current)) {
      // An element inherits its array's position.
      for (let i = current.length - 1; i >= 0; i--) {
        stack.push(current[i])
        inMaps.push(inMap)
      }
      continue
    }
    if (!inMap) {
      // `Object.hasOwn` first: schemas arrive at runtime, and a bare
      // `record[keyword]` answers from `Object.prototype`. With
      // `Object.prototype.$anchor = 'ghost'` set by any dependency, the first
      // node visited "declared" that anchor — so `$ref: '#ghost'`, which names
      // nothing, silently bound to the root schema instead of failing.
      for (const keyword of keywords) {
        if (Object.hasOwn(record, keyword) && record[keyword] === name) return current
      }
    }

    // An `$anchor` inside a `default`/`enum`/`const`/`example(s)` value is part
    // of a value the schema describes, not a declaration — so a `#name` ref
    // bound to it and validated against an accept-anything object. The keys of
    // a `properties`-style map are names, where the same words are not
    // keywords, so the walk stays inside those.
    const keys = Object.keys(record)
    for (let i = keys.length - 1; i >= 0; i--) {
      const key = keys[i] as string
      if (!inMap && DATA_KEYWORDS.has(key)) continue
      stack.push(record[key])
      inMaps.push(!inMap && SCHEMA_MAPS.has(key))
    }
  }

  return undefined
}
