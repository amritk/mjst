/**
 * Resolves a local JSON Schema `$ref` (a JSON Pointer fragment such as
 * `#/$defs/user` or `#/definitions/node`) against the root document.
 *
 * The runtime validator only resolves *local* refs — pointers into the same
 * document. Remote/URI refs are out of scope: a compiled validator is a single
 * self-contained function, and fetching external documents at compile time
 * would defeat that. Callers that need remote refs should bundle them into
 * `$defs` first (the same thing the build-time generators expect).
 *
 * Returns the resolved subschema, or `undefined` when the pointer does not
 * resolve so the compiler can fail loudly rather than silently accepting
 * anything.
 */
export const resolveLocalRef = (ref: string, root: unknown): unknown => {
  if (!ref.startsWith('#')) return undefined

  const pointer = ref.slice(1)
  // A bare "#" (or "#/") points at the whole document.
  if (pointer === '' || pointer === '/') return root

  const parts = pointer.split('/').slice(1)
  let current: unknown = root

  for (const rawPart of parts) {
    // JSON Pointer escaping: ~1 → "/" and ~0 → "~".
    const part = rawPart.replace(/~1/g, '/').replace(/~0/g, '~')

    if (current === null || typeof current !== 'object') return undefined
    const container = current as Record<string, unknown>
    if (!(part in container)) return undefined
    current = container[part]
  }

  return current
}
