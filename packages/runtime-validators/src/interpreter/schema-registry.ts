/**
 * The in-document `$id` registry — JSON Schema 2020-12's base-URI machinery,
 * built once per validator and consulted whenever a `$ref` needs resolving.
 *
 * A subschema carrying `$id` is an *embedded resource*: its `$id` resolved
 * against the base in scope becomes the new base URI, every `$ref` written
 * inside it resolves against *that* base, and its `$anchor`s belong to it
 * rather than to the document. Without this a `$ref` written as a relative URI
 * (`"list"`), an absolute one (`"http://example.com/b/d.json"`), or a URN has
 * nothing to resolve against — even when the resource it names sits a few lines
 * further down the same document.
 *
 * The walk stays entirely in memory: a URI that matches no embedded resource is
 * simply not found, and the caller fails loudly. Fetching the document behind it
 * is `@amritk/resolve-refs`' job — this package does no I/O by design.
 *
 * {@link buildSchemaRegistry} returns `null` for a document that declares no
 * `$id` at all, which is the overwhelmingly common case. That `null` is the
 * interpreter's switch: it keeps the whole base-URI apparatus (and its per-node
 * cost) out of the hot path for schemas that never needed it.
 */

/** A document's embedded resources and anchors, keyed by resolved absolute URI. */
export type SchemaRegistry = {
  /** The document root's base URI — its own `$id` resolved, or {@link SYNTHETIC_BASE}. */
  readonly rootBase: string
  /** Absolute URI (fragment stripped) → the subschema that declared it. */
  readonly resources: Map<string, unknown>
  /** `${base}#${name}` → target, for `$anchor` and `$dynamicAnchor` alike. */
  readonly anchors: Map<string, unknown>
  /** `${base}#${name}` → target, for `$dynamicAnchor` only — what `$dynamicRef` binds to. */
  readonly dynamicAnchors: Map<string, unknown>
  /**
   * Every node that declares an `$id` → the absolute base URI it establishes.
   * The interpreter uses this to notice, as it walks, that it has crossed into
   * another resource. Only `$id`-bearing nodes are recorded, so this stays tiny.
   */
  readonly baseOf: WeakMap<object, string>
}

/**
 * The base a document with no `$id` of its own resolves against. It uses the
 * reserved `.invalid` TLD so it can never collide with a real `$id`, and nothing
 * ever fetches it — the interpreter only compares URI strings.
 */
export const SYNTHETIC_BASE = 'https://runtime-validators.invalid/schema'

/**
 * Keywords whose value is arbitrary *data* rather than a subschema. An `$id` or
 * `$anchor` sitting inside an `enum` member is part of an instance the schema
 * describes, not a declaration, so the walk stops at these.
 */
const DATA_KEYWORDS = new Set(['enum', 'const', 'default', 'examples'])

/** `new URL(ref, base).href`, or `undefined` when the pair does not parse. */
export const resolveUri = (ref: string, base: string): string | undefined => {
  try {
    return new URL(ref, base).href
  } catch {
    return undefined
  }
}

/** Strips the `#fragment` from an absolute URI. */
export const withoutFragment = (uri: string): string => {
  const hash = uri.indexOf('#')
  return hash === -1 ? uri : uri.slice(0, hash)
}

/**
 * The base URI a subschema establishes through its `$id`, or the enclosing base
 * when it declares none. A draft-07-style `$id: "#name"` resolves to a bare
 * fragment and therefore establishes nothing, which the empty-string check
 * catches.
 */
const baseAfterId = (node: Record<string, unknown>, enclosing: string): string => {
  const id = node['$id']
  if (typeof id !== 'string' || id === '') return enclosing
  const resolved = resolveUri(id, enclosing)
  if (resolved === undefined) return enclosing
  const bare = withoutFragment(resolved)
  return bare === '' ? enclosing : bare
}

/**
 * Walks `root` once, registering every embedded resource and every anchor under
 * the base URI it is scoped to. First declaration wins on a duplicate URI or
 * anchor name, matching document order.
 *
 * Returns `null` when the document declares no `$id` anywhere — there is then
 * exactly one base URI in play, so the plain document-local resolver already
 * gives the spec's answer and the interpreter can skip all of this.
 *
 * Iterative with an explicit stack rather than recursive, for the same reason
 * the pattern screen is: the schema is untrusted, and a 20,000-level nested
 * document would otherwise overflow the native stack with a `RangeError` that
 * `isValidationLimitError` does not recognize.
 */
export const buildSchemaRegistry = (root: unknown): SchemaRegistry | null => {
  if (root === null || typeof root !== 'object') return null

  const resources = new Map<string, unknown>()
  const anchors = new Map<string, unknown>()
  const dynamicAnchors = new Map<string, unknown>()
  const baseOf = new WeakMap<object, string>()
  let sawId = false

  // `seen` guards a shared or cyclic object graph. A schema parsed from JSON is
  // a tree, but this is a plain function over an arbitrary in-memory value.
  const seen = new Set<object>()
  // Parallel stacks (node + the base in scope for it) rather than one stack of
  // `{ node, base }` pairs, so the walk allocates nothing per node.
  const nodes: object[] = [root]
  const bases: string[] = [SYNTHETIC_BASE]

  while (nodes.length > 0) {
    const node = nodes.pop() as object
    const enclosing = bases.pop() as string
    if (seen.has(node)) continue
    seen.add(node)

    // Children go on in reverse so popping visits them in document order, which
    // is what makes "first declaration wins" below mean what it says.
    if (Array.isArray(node)) {
      for (let i = node.length - 1; i >= 0; i--) {
        const item = node[i]
        if (item !== null && typeof item === 'object') {
          nodes.push(item)
          bases.push(enclosing)
        }
      }
      continue
    }

    const record = node as Record<string, unknown>
    const base = baseAfterId(record, enclosing)
    if (base !== enclosing) {
      sawId = true
      baseOf.set(node, base)
      if (!resources.has(base)) resources.set(base, node)
    }

    const anchor = record['$anchor']
    if (typeof anchor === 'string') {
      const key = `${base}#${anchor}`
      if (!anchors.has(key)) anchors.set(key, node)
    }
    const dynamicAnchor = record['$dynamicAnchor']
    if (typeof dynamicAnchor === 'string') {
      const key = `${base}#${dynamicAnchor}`
      // Per 2020-12 a `$dynamicAnchor` also creates an ordinary anchor, so a
      // plain `$ref` to the same name resolves to it too.
      if (!dynamicAnchors.has(key)) dynamicAnchors.set(key, node)
      if (!anchors.has(key)) anchors.set(key, node)
    }

    const keys = Object.keys(record)
    for (let i = keys.length - 1; i >= 0; i--) {
      const key = keys[i] as string
      if (DATA_KEYWORDS.has(key)) continue
      const child = record[key]
      if (child === null || typeof child !== 'object') continue
      nodes.push(child)
      bases.push(base)
    }
  }

  if (!sawId) return null

  const rootBase = baseOf.get(root) ?? SYNTHETIC_BASE
  // The root answers to its own `$id` and to the synthetic base, so both
  // spellings of a self-reference land on it.
  if (!resources.has(rootBase)) resources.set(rootBase, root)
  if (!resources.has(SYNTHETIC_BASE)) resources.set(SYNTHETIC_BASE, root)

  return { rootBase, resources, anchors, dynamicAnchors, baseOf }
}
