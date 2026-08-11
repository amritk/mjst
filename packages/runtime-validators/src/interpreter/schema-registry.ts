/**
 * The `$id` registry — JSON Schema 2020-12's base-URI machinery, built once per
 * validator and consulted whenever a `$ref` needs resolving.
 *
 * A subschema carrying `$id` is an *embedded resource*: its `$id` resolved
 * against the base in scope becomes the new base URI, every `$ref` written
 * inside it resolves against *that* base, and its `$anchor`s belong to it
 * rather than to the document. Without this a `$ref` written as a relative URI
 * (`"list"`), an absolute one (`"http://example.com/b/d.json"`), or a URN has
 * nothing to resolve against — even when the resource it names sits a few lines
 * further down the same document.
 *
 * The registry also holds the documents a caller handed us through
 * `ValidateOptions.schemas`. Each one is a schema resource in its own right, so
 * it goes through exactly the same walk under its own retrieval URI: its `$id`,
 * its anchors and its embedded resources all register, and a `$ref` from one
 * registered document into another resolves like any other. That is what keeps
 * "we do no I/O" honest without also meaning "we cannot be told" — the walk
 * still never fetches anything, it only reads what it was given.
 *
 * A URI that matches no resource here is simply not found, and the caller fails
 * loudly. Fetching the document behind it is `@amritk/resolve-refs`' job.
 *
 * {@link buildSchemaRegistry} returns `null` for a document that declares no
 * `$id` and has no registered companions, which is the overwhelmingly common
 * case. That `null` is the interpreter's switch: it keeps the whole base-URI
 * apparatus (and its per-node cost) out of the hot path for schemas that never
 * needed it.
 */

/** Documents the caller has already loaded, keyed by the absolute URI a `$ref` names them by. */
export type SchemaDocuments = Readonly<Record<string, unknown>>

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
 *
 * Kept in step by hand with `@amritk/helpers`' `DATA_KEYWORDS`: this package
 * takes no `@amritk/*` dependency by design, so the set is restated rather than
 * imported. `example` is OpenAPI 3.0's singular spelling and belongs with
 * `examples`.
 */
const DATA_KEYWORDS = new Set(['enum', 'const', 'default', 'examples', 'example'])

/**
 * Keywords whose value is a map of author-chosen names to schemas.
 *
 * Inside one of these the keys are *names*, so {@link DATA_KEYWORDS} carry no
 * keyword meaning there — a property or definition genuinely called `example`
 * or `default` is ordinary, and skipping its subtree would leave an `$id` or
 * `$anchor` declared inside it unregistered, turning a `$ref` to it into a
 * hard "cannot resolve" throw. Restated here for the same reason as above.
 */
const SCHEMA_MAPS = new Set([
  'properties',
  'patternProperties',
  '$defs',
  'definitions',
  'dependentSchemas',
  'dependencies',
])

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
 * A schema keyword's value, treating an inherited name as absent.
 *
 * Schemas arrive at runtime, so a bare `node['$anchor']` answers from
 * `Object.prototype` when a dependency has polluted it — registering a phantom
 * anchor at the root, so a `$ref` naming nothing silently bound to the root
 * schema instead of failing to resolve. Spelled out rather than importing
 * `@amritk/helpers`' `readKey`: this package takes no `@amritk/*` dependency
 * by design.
 */
const own = (schema: Record<string, unknown>, keyword: string): unknown =>
  Object.hasOwn(schema, keyword) ? schema[keyword] : undefined

/**
 * The base URI a subschema establishes through its `$id`, or the enclosing base
 * when it declares none. A draft-07-style `$id: "#name"` resolves to a bare
 * fragment and therefore establishes nothing, which the empty-string check
 * catches.
 */
const baseAfterId = (node: Record<string, unknown>, enclosing: string): string => {
  const id = own(node, '$id')
  if (typeof id !== 'string' || id === '') return enclosing
  const resolved = resolveUri(id, enclosing)
  if (resolved === undefined) return enclosing
  const bare = withoutFragment(resolved)
  return bare === '' ? enclosing : bare
}

/**
 * The absolute form of a URI a caller registered a document under. Keys are
 * meant to be absolute already, so this only normalizes the spelling (`URL`
 * canonicalization, fragment dropped). A key `URL` cannot parse is kept
 * verbatim: string equality still matches it, so an unusual scheme resolves
 * rather than silently disappearing.
 */
const normalizeUri = (uri: string): string => {
  try {
    return withoutFragment(new URL(uri).href)
  } catch {
    return uri
  }
}

/** The tables a walk fills in, held together so one set can serve several documents. */
type RegistryTables = {
  readonly resources: Map<string, unknown>
  readonly anchors: Map<string, unknown>
  readonly dynamicAnchors: Map<string, unknown>
  readonly baseOf: WeakMap<object, string>
}

/**
 * Walks one schema resource, registering every embedded resource and every
 * anchor under the base URI it is scoped to. First declaration wins on a
 * duplicate URI or anchor name, matching document order.
 *
 * Returns whether the walk saw an `$id` — the fact that decides whether a
 * registry is needed at all for a lone document.
 *
 * Iterative with an explicit stack rather than recursive, for the same reason
 * the pattern screen is: the schema is untrusted, and a 20,000-level nested
 * document would otherwise overflow the native stack with a `RangeError` that
 * `isValidationLimitError` does not recognize.
 */
const walkResource = (root: object, rootBase: string, tables: RegistryTables): boolean => {
  const { resources, anchors, dynamicAnchors, baseOf } = tables
  let sawId = false

  // `seen` guards a shared or cyclic object graph. A schema parsed from JSON is
  // a tree, but this is a plain function over an arbitrary in-memory value. It is
  // per-document on purpose: the same object registered under two URIs should
  // register its anchors under both bases, not just the first.
  const seen = new Set<object>()
  // Parallel stacks (node + the base in scope for it) rather than one stack of
  // `{ node, base }` pairs, so the walk allocates nothing per node.
  const nodes: object[] = [root]
  const bases: string[] = [rootBase]
  // Whether each queued node is a name-to-schema map rather than a schema —
  // the distinction that keeps a definition named `example` from being read as
  // the keyword. See SCHEMA_MAPS.
  const inMaps: boolean[] = [false]

  while (nodes.length > 0) {
    const node = nodes.pop() as object
    const enclosing = bases.pop() as string
    const inMap = inMaps.pop() as boolean
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
          inMaps.push(inMap)
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

    const anchor = inMap ? undefined : own(record, '$anchor')
    if (typeof anchor === 'string') {
      const key = `${base}#${anchor}`
      if (!anchors.has(key)) anchors.set(key, node)
    }
    const dynamicAnchor = inMap ? undefined : own(record, '$dynamicAnchor')
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
      if (!inMap && DATA_KEYWORDS.has(key)) continue
      const child = record[key]
      if (child === null || typeof child !== 'object') continue
      nodes.push(child)
      bases.push(base)
      inMaps.push(!inMap && SCHEMA_MAPS.has(key))
    }
  }

  return sawId
}

/**
 * Builds the registry for `root` plus any documents the caller registered.
 *
 * Registered documents are walked under their retrieval URI, which is what makes
 * the suite's `retrieved nested refs resolve relative to their URI not $id` case
 * work: a document with no `$id` of its own still gives relative `$ref`s inside
 * it something to resolve against, and one whose `$id` disagrees with the URI it
 * was fetched from answers to both.
 *
 * Returns `null` when there is nothing to resolve against — no `$id` anywhere in
 * `root` and no registered documents — so the interpreter can skip the base-URI
 * apparatus entirely for the schemas that never needed it.
 */
export const buildSchemaRegistry = (root: unknown, documents?: SchemaDocuments): SchemaRegistry | null => {
  if (root === null || typeof root !== 'object') return null

  const tables: RegistryTables = {
    resources: new Map<string, unknown>(),
    anchors: new Map<string, unknown>(),
    dynamicAnchors: new Map<string, unknown>(),
    baseOf: new WeakMap<object, string>(),
  }

  // The document under validation goes first, so its declarations win a clash
  // with a registered one.
  const sawId = walkResource(root, SYNTHETIC_BASE, tables)

  let registered = false
  if (documents !== undefined) {
    for (const uri of Object.keys(documents)) {
      const document = documents[uri]
      if (document === null || typeof document !== 'object') continue
      registered = true
      const base = normalizeUri(uri)
      // The retrieval URI names the document even when its `$id` says otherwise,
      // which is the whole point of registering it under a URI.
      if (!tables.resources.has(base)) tables.resources.set(base, document)
      walkResource(document, base, tables)
    }
  }

  if (!sawId && !registered) return null

  const rootBase = tables.baseOf.get(root) ?? SYNTHETIC_BASE
  // The root answers to its own `$id` and to the synthetic base, so both
  // spellings of a self-reference land on it.
  if (!tables.resources.has(rootBase)) tables.resources.set(rootBase, root)
  if (!tables.resources.has(SYNTHETIC_BASE)) tables.resources.set(SYNTHETIC_BASE, root)

  return { rootBase, ...tables }
}
