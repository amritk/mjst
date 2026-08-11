import { assertSchemaDepth } from './max-schema-depth'
import { readKey } from './read-key'

/**
 * The `$id` base-URI machinery JSON Schema 2020-12 defines, read off a document
 * once and expressed entirely in JSON Pointers.
 *
 * A subschema carrying `$id` is an *embedded resource*: its `$id` resolved
 * against the base in scope becomes a new base URI, every `$ref` written inside
 * it resolves against *that* base, and its `$anchor`s belong to it rather than
 * to the document. Without this a `$ref` written as a relative URI (`"list"`),
 * an absolute one (`"http://example.com/b/d.json"`), a URN, or an absolute path
 * (`"/absref/foobar.json"`) has nothing to resolve against — even when the
 * resource it names sits a few lines further down the same document. Worse, a
 * plain `#/$defs/t` written *inside* a resource used to be read against the
 * document root, so it quietly selected a different definition than its author
 * wrote.
 *
 * Everything is keyed by JSON Pointer rather than by object identity on purpose:
 * pointers are the currency the rest of this package already deals in
 * (`resolveRef`, `refToName`, `refToFilename`, the generated import graph), so a
 * consumer can turn a registry hit straight into a `$ref` string, a filename, or
 * a type name without holding on to the document.
 *
 * The walk stays entirely in memory. A URI that matches no embedded resource is
 * simply not found — fetching the document behind it is `@amritk/resolve-refs`'
 * job.
 */

/** A document's embedded resources and anchors, all located by JSON Pointer. */
export type ResourceRegistry = {
  /** The document root's base URI — its own `$id` resolved, or {@link SYNTHETIC_BASE}. */
  readonly rootBase: string
  /** Absolute URI (fragment stripped) → the pointer of the subschema that declared it. */
  readonly resources: ReadonlyMap<string, string>
  /** `${base}#${name}` → pointer, for `$anchor` and `$dynamicAnchor` alike. */
  readonly anchors: ReadonlyMap<string, string>
  /** `${base}#${name}` → pointer, for `$dynamicAnchor` only — what `$dynamicRef` binds to. */
  readonly dynamicAnchors: ReadonlyMap<string, string>
  /**
   * Pointer of every `$id`-bearing node → the absolute base URI it establishes.
   * A second walk over the same document can rebuild the base in scope from this
   * without re-parsing a single URL. Only `$id`-bearing nodes are recorded, so it
   * stays tiny.
   */
  readonly baseAt: ReadonlyMap<string, string>
}

/**
 * The base a document with no `$id` of its own resolves against. It uses the
 * reserved `.invalid` TLD so it can never collide with a real `$id`, and nothing
 * ever fetches it — only URI strings are ever compared.
 */
export const SYNTHETIC_BASE = 'https://helpers.mjst.invalid/schema'

/**
 * Keywords whose value is arbitrary *data* rather than a subschema. An `$id` or
 * `$anchor` sitting inside an `enum` member is part of an instance the schema
 * describes, not a declaration, so every walk over the `$id` graph stops at
 * these.
 */
export const DATA_KEYWORDS = new Set([
  'enum',
  'const',
  'default',
  'examples',
  // OpenAPI 3.0's singular spelling. `foldNullable` runs specifically on 3.0
  // documents, and the adapters take TypeBox/OpenAPI-derived input, so an
  // `example` value was being walked as though it were a schema.
  'example',
])

/**
 * Keywords whose value is a map of author-chosen names to schemas.
 *
 * The distinction {@link DATA_KEYWORDS} needs to be useful: at a schema node
 * those four are keywords, but inside one of these maps the keys are *names*,
 * so a property genuinely called `default` or `examples` carries no keyword
 * meaning. A walker that skips by key name alone skips that property's whole
 * subtree, which is how a real tuple went unnormalized and a `nullable`
 * property went unfolded.
 */
export const SCHEMA_MAPS = new Set([
  'properties',
  'patternProperties',
  '$defs',
  'definitions',
  'dependentSchemas',
  // Draft-07's `dependencies`: its keys are trigger property names too.
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

/**
 * Escapes one object key for use as a JSON Pointer reference token.
 *
 * `~`/`/` are RFC 6901's own escapes. `%` is escaped on top of those because the
 * pointer we build here is handed back as a `$ref` — a URI fragment — and
 * `resolveRef` percent-decodes each token before matching it, so a definition
 * literally named `a%2Fb` would otherwise be looked up as `a/b`.
 */
export const escapePointerSegment = (segment: string): string =>
  segment.indexOf('~') === -1 && segment.indexOf('/') === -1 && segment.indexOf('%') === -1
    ? segment
    : segment.replace(/~/g, '~0').replace(/\//g, '~1').replace(/%/g, '%25')

/**
 * Whether `key` holds instance data rather than a schema, at a node whose own
 * position is `inSchemaMap`.
 *
 * A schema walk has two kinds of object. At a **schema node** the keys are
 * keywords, so {@link DATA_KEYWORDS} mark subtrees holding values the schema
 * describes, which must not be read as schemas. Inside a {@link SCHEMA_MAPS}
 * entry the keys are author-chosen **names**, where those same words carry no
 * keyword meaning — a definition or property genuinely called `default` is
 * ordinary.
 *
 * Every walker here used to test the key name alone, which conflated the two:
 * a `$defs.default` had its whole subtree skipped, so an `$anchor` inside it
 * never registered and the `$ref` naming it failed to resolve. Threading one
 * boolean through the recursion is what tells them apart, and asking these two
 * functions is what keeps the walkers agreeing about it.
 *
 * Two predicates rather than a generator over `{key, value, inSchemaMap}`
 * objects: these are the inner loop of ten whole-document walkers, several of
 * which document that they allocate nothing per node.
 *
 * Arrays are the caller's to handle, and the rule there is that **an element
 * inherits its array's position**, the same one `resolve-refs`' `childRole`
 * applies.
 *
 * @example
 * ```typescript
 * const walk = (node: unknown, inSchemaMap: boolean): void => {
 *   if (Array.isArray(node)) {
 *     for (const item of node) walk(item, inSchemaMap)
 *     return
 *   }
 *   if (!isObject(node)) return
 *   for (const key of Object.keys(node)) {
 *     if (isDataPosition(key, inSchemaMap)) continue
 *     walk(node[key], entersSchemaMap(key, inSchemaMap))
 *   }
 * }
 * ```
 */
export const isDataPosition = (key: string, inSchemaMap: boolean): boolean => !inSchemaMap && DATA_KEYWORDS.has(key)

/** Whether the child at `key` is a map of author-chosen names. See {@link isDataPosition}. */
export const entersSchemaMap = (key: string, inSchemaMap: boolean): boolean => !inSchemaMap && SCHEMA_MAPS.has(key)

/**
 * The base URI a subschema establishes through its `$id`, or the enclosing base
 * when it declares none. A draft-07-style `$id: "#name"` resolves to a bare
 * fragment and therefore establishes nothing, which the empty-string check
 * catches.
 */
export const baseAfterId = (node: Record<string, unknown>, enclosing: string): string => {
  const id = node['$id']
  if (typeof id !== 'string' || id === '') return enclosing
  const resolved = resolveUri(id, enclosing)
  if (resolved === undefined) return enclosing
  const hash = resolved.indexOf('#')
  const bare = hash === -1 ? resolved : resolved.slice(0, hash)
  return bare === '' ? enclosing : bare
}

/**
 * Registries are memoized per document, because several passes want the same
 * one — the `$id`-scope screen, the ref rewrite, and any caller that keeps
 * resolving as it walks — and each build is a full walk of the document.
 * Schemas are treated as immutable here, and the `WeakMap` drops the entry once
 * the caller releases the document.
 */
const registries = new WeakMap<object, ResourceRegistry | null>()

/**
 * Walks a document once, registering every embedded resource and every anchor
 * under the base URI it is scoped to. First declaration wins on a duplicate URI
 * or anchor name, which is document order.
 *
 * Returns `null` when the document declares no `$id` anywhere — there is then
 * exactly one base URI in play, so plain document-local pointer resolution
 * already gives the spec's answer and every caller can skip the whole apparatus
 * (and its per-node cost) on what is overwhelmingly the common document.
 *
 * @param root - The document to read. Anything that is not an object registers
 *   nothing.
 */
export const buildResourceRegistry = (root: unknown): ResourceRegistry | null => {
  if (root === null || typeof root !== 'object') return null
  const memoized = registries.get(root)
  if (memoized !== undefined || registries.has(root)) return memoized ?? null

  const resources = new Map<string, string>()
  const anchors = new Map<string, string>()
  const dynamicAnchors = new Map<string, string>()
  const baseAt = new Map<string, string>()
  let sawId = false

  const walk = (node: unknown, pointer: string, enclosing: string, depth: number, inSchemaMap: boolean): void => {
    assertSchemaDepth(depth, 'buildResourceRegistry')
    if (node === null || typeof node !== 'object') return
    if (Array.isArray(node)) {
      for (let index = 0; index < node.length; index++)
        walk(node[index], `${pointer}/${index}`, enclosing, depth + 1, inSchemaMap)
      return
    }

    const record = node as Record<string, unknown>
    const base = baseAfterId(record, enclosing)
    if (base !== enclosing) {
      sawId = true
      baseAt.set(pointer, base)
      if (!resources.has(base)) resources.set(base, pointer)
    }

    const anchor = readKey(record, '$anchor')
    if (typeof anchor === 'string' && !anchors.has(`${base}#${anchor}`)) anchors.set(`${base}#${anchor}`, pointer)

    const dynamicAnchor = readKey(record, '$dynamicAnchor')
    if (typeof dynamicAnchor === 'string') {
      const key = `${base}#${dynamicAnchor}`
      if (!dynamicAnchors.has(key)) dynamicAnchors.set(key, pointer)
      // Per 2020-12 a `$dynamicAnchor` also creates an ordinary anchor, so a
      // plain `$ref` to the same name resolves to it too.
      if (!anchors.has(key)) anchors.set(key, pointer)
    }

    for (const key of Object.keys(record)) {
      if (isDataPosition(key, inSchemaMap)) continue
      walk(record[key], `${pointer}/${escapePointerSegment(key)}`, base, depth + 1, entersSchemaMap(key, inSchemaMap))
    }
  }

  walk(root, '', SYNTHETIC_BASE, 0, false)
  if (!sawId) {
    registries.set(root, null)
    return null
  }

  const rootBase = baseAt.get('') ?? SYNTHETIC_BASE
  // The root answers to its own `$id` and to the synthetic base, so both
  // spellings of a self-reference land on it.
  if (!resources.has(rootBase)) resources.set(rootBase, '')
  if (!resources.has(SYNTHETIC_BASE)) resources.set(SYNTHETIC_BASE, '')

  const registry: ResourceRegistry = { rootBase, resources, anchors, dynamicAnchors, baseAt }
  registries.set(root, registry)
  return registry
}
