import type { JSONSchema } from 'json-schema-typed/draft-2020-12'

import { assertIdScopes } from './assert-id-scopes'
import { assignKey } from './assign-key'
import { buildDynamicRefMap } from './build-dynamic-ref-map'
import { entersSchemaMap, isDataPosition } from './build-resource-registry'
import { extractRefs } from './extract-refs'
import { graftExternalSchemas } from './graft-external-schemas'
import { normalizeRefScopes } from './normalize-ref-scopes'
import { pruneExternalSchemas } from './prune-external-schemas'
import { refToFilename } from './ref-to-filename'
import { refToName } from './ref-to-name'
import { resolveDynamicRefs } from './resolve-dynamic-refs'
import { resolveRef } from './resolve-ref'
import { upgradeDraft07Schema } from './upgrade-draft07-schema'

/**
 * One node of the `$ref` graph, handed to the `visit` callback. Everything a
 * generator needs to emit a single output file is pre-computed here so the
 * traversal, naming, and `$dynamicRef` rewriting live in one place instead of
 * being copy-pasted into every generator.
 */
export type RefNode = {
  /**
   * The `$ref` string this node was reached through, or `undefined` for the
   * root schema. Exception: an alias root (a bare `$ref` document) whose
   * derived filename collides with its target's carries the target's ref, so
   * generators can exclude self-imports from the merged file.
   */
  ref: string | undefined
  /** PascalCase type name — the root type name verbatim, or `refToName(ref, typeSuffix)`. */
  typeName: string
  /** kebab-case filename without extension — the lowercased root type name, or `refToFilename(ref)`. */
  filename: string
  /** The subschema to generate, with any `$dynamicRef` already rewritten to `$ref`. */
  schema: JSONSchema
  /** The upgraded root document, for callers that resolve imports against it. */
  rootSchema: Record<string, unknown>
  /** True for the root schema node, which is always visited first. */
  isRoot: boolean
}

/** Options controlling how `$ref`-derived names are produced. */
export type WalkRefGraphOptions = {
  /**
   * Suffix appended to every `$ref`-derived type name (e.g. `'Object'` →
   * `ContactObject`). The root type name is used verbatim and is not affected.
   * Defaults to `''`.
   */
  readonly typeSuffix?: string
  /**
   * Other schema documents you have **already loaded**, keyed by the absolute
   * URI a `$ref` names them by. Supplying them makes those URIs resolvable, so
   * the schema being generated can reference a document that is not itself.
   *
   * Nothing here fetches: the walker cannot be told a URL, only a document, so
   * generation stays a pure function of its inputs. Loading is yours to do (or
   * `@amritk/resolve-refs`'), and however you do it the result comes back
   * through here. A `$ref` to a URI nobody registered is still refused.
   *
   * Each registered document is a schema resource like any other — its `$id`,
   * `$anchor`s, `$dynamicAnchor`s and nested embedded resources all become
   * resolvable, and a `$ref` from one registered document into another resolves
   * too. A document with no `$id` resolves its relative `$ref`s against the URI
   * you registered it under, and one whose `$id` disagrees answers to both. See
   * {@link graftExternalSchemas}.
   *
   * Only the documents actually reached get files, so registering more than the
   * schema uses costs nothing in the output. Treat the map and the documents in
   * it as immutable once passed: walks are memoized per `(schema, schemas)` by
   * identity, so hand over a *new* object when the set of documents changes.
   */
  readonly schemas?: Readonly<Record<string, unknown>>
}

/**
 * The reusable, schema-scoped work the walker memoizes. Keyed by the *original*
 * root schema object so repeated walks of the same document — the parsers,
 * validators, and examples generators all running over one loaded schema —
 * pay for the draft-07 upgrade, the dynamic-ref map, and each `resolveRef` /
 * `extractRefs` exactly once. JSON Schema inputs are treated as immutable here;
 * the `WeakMap` drops the entry once the caller releases the schema.
 */
type RootCache = {
  upgraded: Record<string, unknown>
  dynamicRefMap: Record<string, string>
  resolveRefCache: Map<string, Record<string, unknown> | undefined>
  extractRefsCache: WeakMap<object, Set<string>>
  /**
   * Root-anchored variants of this cache, keyed by root filename. A document
   * whose *root* carries a `$dynamicAnchor` needs an extra `$defs` alias so the
   * anchor has a nameable target (see {@link rootAnchoredCache}), and that alias
   * depends on the caller's root type name — which the document-keyed cache
   * cannot know. Rare enough that the extra map costs nothing in practice.
   */
  rootAnchored: Map<string, RootCache>
}

const rootCaches = new WeakMap<object, RootCache>()

/**
 * Caches for walks that carry a registry, keyed by the schema *and* by the
 * registry object. A grafted document is a different document — different
 * resources, different pointers — so it cannot share the plain per-root entry,
 * and two registries over one root are two distinct walks. Identity is the key
 * because the registry is documented as immutable once passed, which is the same
 * contract `@amritk/runtime-validators` puts on `ValidateOptions.schemas`.
 */
const registryCaches = new WeakMap<object, WeakMap<object, RootCache>>()

/** `buildDynamicRefMap` uses this pointer for an anchor declared on the root itself. */
const ROOT_POINTER = '#'

/**
 * Who claimed a generated filename or type name. `label` names the claimant in
 * a collision message; `resolved` is the subschema it resolved to, which is
 * what tells a genuine clash apart from two spellings of one definition.
 */
type NameOwner = {
  readonly label: string
  readonly resolved: unknown
}

/**
 * True when two refs name what is, for generation purposes, one definition —
 * so sharing a filename is correct rather than a collision.
 *
 * Identity covers the common case: `upgradeDraft07Schema` aliases every
 * URI-keyed definition to a short name by assigning the *same* object, and a
 * document may spell one target several ways. The serialized comparison is the
 * fallback for hand-authored documents that duplicate a definition under both
 * spellings, where the two objects are equal but distinct. It only runs after a
 * name clash, so the cost never touches the common path.
 */
const sameDefinition = (a: unknown, b: unknown): boolean => a === b || JSON.stringify(a) === JSON.stringify(b)

/**
 * Keywords that give a schema a shape of its own. A root carrying any of these
 * next to its `$ref` is a real composition, not a pure alias, and keeps the
 * default root handling.
 */
const SHAPE_KEYWORDS = [
  'properties',
  'type',
  'oneOf',
  'anyOf',
  'allOf',
  'patternProperties',
  'additionalProperties',
  'enum',
  'const',
  'items',
  'prefixItems',
  'required',
  'if',
  'then',
  'else',
  'not',
] as const

/** The `$ref` of a pure-alias root document (only `$ref` + metadata keys), or null. */
const getAliasRootRef = (schema: JSONSchema): string | null => {
  if (typeof schema !== 'object' || schema === null) return null
  const record = schema as Record<string, unknown>
  if (typeof record['$ref'] !== 'string') return null
  return SHAPE_KEYWORDS.some((key) => key in record) ? null : record['$ref']
}

/** The keys whose value is a map of named definitions — the things a `$ref` can name. */
const DEFINITION_MAP_KEYS = ['$defs', 'definitions'] as const

/**
 * The object form of a boolean subschema: `true` admits every value and `false`
 * admits none, which is exactly what `{}` and `{ not: {} }` say.
 *
 * The rewrite is confined to definition maps because that is the only place the
 * two spellings are interchangeable for us. A `$defs` entry is a *named* schema —
 * the ref graph gives it a file, a type, and a parser, all of which need an
 * object to read keywords off, so `$defs: { bool: true }` used to resolve to
 * nothing and stop generation. Elsewhere a boolean is not merely a terse schema:
 * `additionalProperties: true` and `additionalProperties: {}` mean the same thing
 * to a validator but generate different *types*, so those are left alone.
 */
const expandBooleanDefinitions = (value: unknown, inSchemaMap = false): unknown => {
  if (typeof value !== 'object' || value === null) return value
  if (Array.isArray(value)) {
    const mapped = value.map((item) => expandBooleanDefinitions(item, inSchemaMap))
    return mapped.some((item, index) => item !== value[index]) ? mapped : value
  }

  const record = value as Record<string, unknown>
  let changed = false
  const result: Record<string, unknown> = {}
  // `isDataPosition` decides which keys are keywords. Classifying by name
  // alone expanded a `$defs` sitting inside a `default`/`enum` value — turning
  // the author's literal `true` into `{}` — and treated a property genuinely
  // named `$defs` as a definition map, which the doc above says must not
  // happen because `true` and `{}` generate different TypeScript.
  for (const [key, sub] of Object.entries(record)) assignKey(result, key, sub)
  for (const key of Object.keys(record)) {
    if (isDataPosition(key, inSchemaMap)) continue
    const next =
      !inSchemaMap && (DEFINITION_MAP_KEYS as readonly string[]).includes(key)
        ? expandDefinitionMap(record[key])
        : expandBooleanDefinitions(record[key], entersSchemaMap(key, inSchemaMap))
    if (next !== record[key]) changed = true
    assignKey(result, key, next)
  }
  return changed ? result : value
}

/** Replaces each boolean entry of one `$defs`/`definitions` map with its object equivalent. */
const expandDefinitionMap = (definitions: unknown): unknown => {
  if (typeof definitions !== 'object' || definitions === null || Array.isArray(definitions)) return definitions
  const record = definitions as Record<string, unknown>
  let changed = false
  const result: Record<string, unknown> = {}
  for (const [name, definition] of Object.entries(record)) {
    const next = definition === true ? {} : definition === false ? { not: {} } : expandBooleanDefinitions(definition)
    if (next !== definition) changed = true
    assignKey(result, name, next)
  }
  return changed ? result : definitions
}

const getRootCache = (rootSchema: JSONSchema, schemas: Readonly<Record<string, unknown>> | undefined): RootCache => {
  // Only object roots can key a WeakMap. A boolean root has no refs to walk and
  // the draft-07 upgrade is a no-op for it, so a throwaway cache is fine — and
  // with no refs there is nothing a registry could resolve either.
  if (typeof rootSchema !== 'object' || rootSchema === null) {
    const upgraded = rootSchema as unknown as Record<string, unknown>
    return {
      upgraded,
      dynamicRefMap: {},
      resolveRefCache: new Map(),
      extractRefsCache: new WeakMap(),
      rootAnchored: new Map(),
    }
  }

  const registry = schemas !== undefined && Object.keys(schemas).length > 0 ? schemas : undefined
  const cached = registry === undefined ? rootCaches.get(rootSchema) : registryCaches.get(rootSchema)?.get(registry)
  if (cached) return cached

  // Grafting happens before the upgrade so a registered draft-07 document is
  // upgraded with everything else, and before the `$id` pass so its resources
  // are in the registry that pass reads.
  const grafted =
    registry === undefined ? undefined : graftExternalSchemas(rootSchema as Record<string, unknown>, registry)
  const combined = grafted?.document ?? (rootSchema as Record<string, unknown>)
  const expanded = expandBooleanDefinitions(upgradeDraft07Schema(combined)) as Record<string, unknown>
  assertIdScopes(expanded as JSONSchema)
  // Applying `$id` as a base URI *once*, here, is what lets everything
  // downstream — ref resolution, naming, the emitted import graph — keep
  // treating a `$ref` as a plain document-root pointer.
  const normalized = normalizeRefScopes(expanded)
  // A caller may register more than the schema uses. Dropping the rest here, once
  // the refs are pointers and reachability is finally knowable, is what keeps an
  // unused companion from seeding the queue below or contributing an anchor —
  // everything after this point sees an ordinary single document.
  const upgraded = grafted === undefined ? normalized : pruneExternalSchemas(normalized, grafted.names)
  const cache: RootCache = {
    upgraded,
    dynamicRefMap: buildDynamicRefMap(upgraded as JSONSchema),
    resolveRefCache: new Map(),
    extractRefsCache: new WeakMap(),
    rootAnchored: new Map(),
  }
  if (registry === undefined) rootCaches.set(rootSchema, cache)
  else {
    const byRegistry = registryCaches.get(rootSchema) ?? new WeakMap<object, RootCache>()
    byRegistry.set(registry, cache)
    registryCaches.set(rootSchema, byRegistry)
  }
  return cache
}

/** True when the document points at its own root — `$ref: "#"` (or `"#/"`) anywhere inside it. */
const referencesRoot = (value: unknown): boolean => {
  if (typeof value !== 'object' || value === null) return false
  if (Array.isArray(value)) return value.some(referencesRoot)
  const record = value as Record<string, unknown>
  if (record['$ref'] === ROOT_POINTER || record['$ref'] === '#/') return true
  for (const key in record) if (referencesRoot(record[key])) return true
  return false
}

/** A structural deep copy, for the subtrees `rewriteRootRefs` must not rewrite. */
const copyValue = (value: unknown): unknown => {
  if (typeof value !== 'object' || value === null) return value
  if (Array.isArray(value)) return value.map(copyValue)
  const out: Record<string, unknown> = {}
  for (const [key, sub] of Object.entries(value as Record<string, unknown>)) assignKey(out, key, copyValue(sub))
  return out
}

/** Rewrites every root-pointer `$ref` to the root's `$defs` alias, deep-copying as it goes. */
const rewriteRootRefs = (value: unknown, rootSelfRef: string, inSchemaMap = false): unknown => {
  if (typeof value !== 'object' || value === null) return value
  if (Array.isArray(value)) return value.map((item) => rewriteRootRefs(item, rootSelfRef, inSchemaMap))
  const out: Record<string, unknown> = {}
  const record = value as Record<string, unknown>
  // Instance data is copied, not rewritten: a `default: { "$ref": "#" }` is a
  // documented config value that happens to be ref-shaped, and rewriting its
  // literal hands consumers a pointer the author never wrote. Copied rather
  // than aliased, because this function's contract is a fresh tree — placing
  // the caller's own object here would let a later stage mutating a `default`
  // write through to the input document and to every other emitted node.
  //
  // Only those keys. Copying every child first and then overwriting the schema
  // ones made the walk deep-copy each subtree once per level above it — O(nodes
  // x depth) allocations, all but the last thrown away.
  const rewritten = new Set<string>()
  for (const key of Object.keys(record)) {
    if (isDataPosition(key, inSchemaMap)) continue
    rewritten.add(key)
  }
  for (const [key, sub] of Object.entries(record)) {
    if (!rewritten.has(key)) assignKey(out, key, copyValue(sub))
  }
  for (const key of Object.keys(record)) {
    if (isDataPosition(key, inSchemaMap)) continue
    assignKey(
      out,
      key,
      !inSchemaMap && key === '$ref' && (record[key] === ROOT_POINTER || record[key] === '#/')
        ? rootSelfRef
        : rewriteRootRefs(record[key], rootSelfRef, entersSchemaMap(key, inSchemaMap)),
    )
  }
  return out
}

/**
 * A view of the cache in which the document root has a nameable target.
 *
 * Two shapes need one: a `$dynamicAnchor` declared on the root (which
 * `buildDynamicRefMap` points at the pointer `#`), and a plain `$ref: "#"` — the
 * ordinary spelling of a recursive tree. Nothing downstream can name a file for
 * that pointer: `refToFilename('#')` is not a module and `refToName('#')` is not
 * an identifier, so a recursive document used to emit an import of a
 * `ref-<hash>.ts` that was never generated — output that does not compile at
 * all. So the root's own body is aliased into `$defs` under the root's filename
 * and every root-pointer ref is rewritten to it. Every consumer then resolves
 * through the ordinary `#/$defs/<name>` path and lands on the type the root file
 * already exports — which is exactly what the recursive idiom means. The alias
 * holds the root *without* its `$defs`, so the document stays acyclic and still
 * survives the structured clone in `resolveDynamicRefs`.
 */
const rootAnchoredCache = (base: RootCache, rootFilename: string, rootSelfRef: string): RootCache => {
  const cached = base.rootAnchored.get(rootFilename)
  if (cached) return cached

  const rewritten = referencesRoot(base.upgraded)
    ? (rewriteRootRefs(base.upgraded, rootSelfRef) as Record<string, unknown>)
    : base.upgraded
  const { $defs, ...rootBody } = rewritten
  const defs = (typeof $defs === 'object' && $defs !== null ? $defs : {}) as Record<string, unknown>
  if (Object.hasOwn(defs, rootFilename)) {
    throw new Error(
      `The root schema declares a $dynamicAnchor, so its own definition is aliased as "${rootSelfRef}" — ` +
        `but "${rootFilename}" is already a definition in $defs. Rename one so each gets its own file.`,
    )
  }

  const derived: RootCache = {
    upgraded: { ...rewritten, $defs: { ...defs, [rootFilename]: rootBody } },
    dynamicRefMap: Object.fromEntries(
      Object.entries(base.dynamicRefMap).map(([anchor, pointer]) => [
        anchor,
        pointer === ROOT_POINTER ? rootSelfRef : pointer,
      ]),
    ),
    resolveRefCache: new Map(),
    extractRefsCache: new WeakMap(),
    rootAnchored: new Map(),
  }
  base.rootAnchored.set(rootFilename, derived)
  return derived
}

/**
 * Every `$dynamicRef` in the document written as a JSON Pointer rather than an
 * anchor name.
 *
 * Such a ref names no `$dynamicAnchor`, so 2020-12 says it behaves statically and
 * {@link resolveDynamicRefs} duly degrades it to a plain `$ref` — but nothing
 * queued the target, so a definition reached only that way went ungenerated and
 * the file that referenced it imported a module the walk never emitted. The
 * anchor form needs none of this: it is seeded from the `$dynamicAnchor` map.
 */
const dynamicPointerRefs = (value: unknown, into: Set<string> = new Set()): Set<string> => {
  if (typeof value !== 'object' || value === null) return into
  if (Array.isArray(value)) {
    for (const item of value) dynamicPointerRefs(item, into)
    return into
  }
  const record = value as Record<string, unknown>
  const ref = record['$dynamicRef']
  if (typeof ref === 'string' && ref.startsWith('#/')) into.add(ref)
  for (const key in record) dynamicPointerRefs(record[key], into)
  return into
}

/** Memoized `resolveRef` keyed by ref string within a single root document. */
const cachedResolveRef = (cache: RootCache, ref: string): Record<string, unknown> | undefined => {
  if (cache.resolveRefCache.has(ref)) return cache.resolveRefCache.get(ref)
  const resolved = resolveRef(ref, cache.upgraded)
  cache.resolveRefCache.set(ref, resolved)
  return resolved
}

/** Memoized `extractRefs` keyed by the (stable) resolved subschema identity. */
const cachedExtractRefs = (cache: RootCache, schema: JSONSchema): Set<string> => {
  if (typeof schema !== 'object' || schema === null) return extractRefs(schema)
  const existing = cache.extractRefsCache.get(schema)
  if (existing) return existing
  const refs = extractRefs(schema)
  cache.extractRefsCache.set(schema, refs)
  return refs
}

/**
 * Walks a JSON Schema and its entire `$ref` / `$dynamicRef` graph, invoking
 * `visit` once per distinct output file: first the root, then every reachable
 * definition (breadth-first). This is the single, shared traversal the parser,
 * validator, and example generators were each re-implementing.
 *
 * For every node the walker has already upgraded draft-07 inputs, resolved the
 * ref, rewritten `$dynamicRef` to `$ref`, and derived the type/file names — so
 * callers only have to turn `node.schema` into file content. Definitions
 * reachable only via `$dynamicAnchor` are seeded too, so nothing the generated
 * code imports goes ungenerated.
 *
 * The walker throws rather than degrading whenever it cannot produce output that
 * would actually work: an unresolvable `$ref`, a `$dynamicRef` with no anchor to
 * bind to, or two definitions that reduce to one filename or one type name. Each
 * of those used to warn (or say nothing) and carry on, which meant `mjst` exited
 * 0 having written TypeScript that either does not compile or — worse — compiles
 * to the wrong type.
 *
 * A `$ref` whose target is another document resolves when that document is
 * handed over through {@link WalkRefGraphOptions.schemas} — the walker folds the
 * registered documents into the one it is walking, so cross-document refs become
 * ordinary pointers and get files and type names by the same rules as everything
 * else. Nothing is ever fetched; a URI nobody registered is still refused.
 *
 * Resolution work is memoized per root document (see {@link RootCache}), so
 * running several generators over the same loaded schema does the expensive
 * walking once.
 *
 * @param rootSchema - The root JSON Schema to walk.
 * @param rootTypeName - The name for the root type (e.g. `'Document'`).
 * @param options - Naming and registry options ({@link WalkRefGraphOptions}).
 * @param visit - Called once per output file with a fully prepared {@link RefNode}.
 */
export const walkRefGraph = (
  rootSchema: JSONSchema,
  rootTypeName: string,
  options: WalkRefGraphOptions,
  visit: (node: RefNode) => void,
): void => {
  const typeSuffix = options.typeSuffix ?? ''
  const baseCache = getRootCache(rootSchema, options.schemas)
  const rootFilename = rootTypeName.toLowerCase()

  // A `$dynamicAnchor` on the document root needs the root aliased into `$defs`
  // before anything can name it. The alias is reachable as `#/$defs/<root
  // filename>`, so the name every consumer derives from it has to come back as
  // the root type name — otherwise the root file would export `Tree` while the
  // recursive property was typed `TreeObject`, and nothing would say so.
  const rootSelfRef = `#/$defs/${rootFilename}`
  const rootIsAnchored = Object.values(baseCache.dynamicRefMap).includes(ROOT_POINTER)
  // A plain `$ref: "#"` needs the same alias for the same reason (see
  // rootAnchoredCache) — without it the recursive property was typed and parsed
  // through a module nothing ever emitted.
  const rootIsSelfReferenced = referencesRoot(baseCache.upgraded)
  const needsRootAlias = rootIsAnchored || rootIsSelfReferenced
  if (needsRootAlias && refToName(rootSelfRef, typeSuffix) !== rootTypeName) {
    throw new Error(
      `The root schema is referenced by ${rootIsAnchored ? 'a $dynamicAnchor' : 'a $ref to "#"'}, which is ` +
        `generated as the root's own file — but the root type name "${rootTypeName}" does not survive the round ` +
        `trip through ref naming (refs to it would be named "${refToName(rootSelfRef, typeSuffix)}"). Use a ` +
        'single-word root type name with no type suffix, or move the recursion onto a $defs entry.',
    )
  }

  const cache = needsRootAlias ? rootAnchoredCache(baseCache, rootFilename, rootSelfRef) : baseCache
  const { upgraded, dynamicRefMap } = cache

  const processedRefs = new Set<string>()
  /** Which ref claimed each generated name, so a collision can name both sides. */
  const filenameOwners = new Map<string, NameOwner>()
  const typeNameOwners = new Map<string, NameOwner>()

  // An alias root (a document that is just `$ref: '#/$defs/x'`) whose derived
  // filename equals its target's would reserve the filename for a wrapper that
  // re-exports the target — and the target, mapping to the same file, would
  // then never be generated, leaving a file that imports itself. Generate the
  // *target's* schema under the root's name instead, carrying the ref so
  // generators can exclude the self-import.
  let rootNodeSchema = upgraded as JSONSchema
  let rootNodeRef: string | undefined
  let rootTarget: unknown = upgraded
  const aliasRef = getAliasRootRef(upgraded as JSONSchema)
  if (aliasRef && refToFilename(aliasRef) === rootFilename) {
    const resolved = cachedResolveRef(cache, aliasRef)
    if (resolved) {
      rootNodeSchema = resolved as JSONSchema
      rootNodeRef = aliasRef
      // The root node *is* this definition now, so the ref must not come round
      // again as a separate file — and the root owns the target for collision
      // purposes, so another spelling of the same definition still merges.
      rootTarget = resolved
      processedRefs.add(aliasRef)
    }
  }

  // The root's `$defs` alias is the root's own file, so it must never be walked
  // as a separate definition — and the root node carries it as its `ref` so the
  // generators leave the (self-)import out.
  if (needsRootAlias) {
    processedRefs.add(rootSelfRef)
    rootNodeRef ??= rootSelfRef
  }

  // The root's names reserve a slot so a later ref that maps to either one is
  // reported instead of silently overwriting it.
  const rootOwner: NameOwner = { label: `the root type ${rootTypeName}`, resolved: rootTarget }
  filenameOwners.set(rootFilename, rootOwner)
  typeNameOwners.set(rootTypeName, rootOwner)

  visit({
    ref: rootNodeRef,
    typeName: rootTypeName,
    filename: rootFilename,
    schema: resolveDynamicRefs(rootNodeSchema, dynamicRefMap),
    rootSchema: upgraded,
    isRoot: true,
  })

  // Seed dynamic-anchor targets from the memoized map instead of calling
  // extractDynamicAnchorDefs (which would re-walk the whole document — the map
  // already holds exactly those refs as its values).
  // A pointer-form `$dynamicRef` is only seeded when it actually resolves: an
  // unresolvable one is dropped by every downstream consumer (no import is
  // emitted for it), so queueing it would turn a permissive parser into a build
  // error for a ref the document never defined.
  const queue: string[] = [
    ...cachedExtractRefs(cache, upgraded as JSONSchema),
    ...Object.values(dynamicRefMap),
    ...[...dynamicPointerRefs(upgraded)].filter((ref) => cachedResolveRef(cache, ref) !== undefined),
  ]

  // Advance a read cursor instead of `queue.shift()`, whose O(n) element move
  // makes draining a large ref graph quadratic.
  for (let head = 0; head < queue.length; head++) {
    const ref = queue[head]
    if (!ref || processedRefs.has(ref)) continue
    processedRefs.add(ref)

    const resolved = cachedResolveRef(cache, ref)
    if (!resolved) {
      // Warning-and-skip used to leave the generators emitting the type name and
      // the parser/validator call for a file that was never produced, so the
      // output only failed later — at `tsc`, or at runtime with a
      // `ReferenceError`, and `mjst` itself still exited 0. `escapeRegexPattern`
      // already sets the precedent: a schema the generator cannot honour stops
      // the build rather than producing code that cannot work.
      throw new Error(
        `Could not resolve $ref "${ref}". Nothing in the document defines it, so the generated output would ` +
          'reference a type and a function that are never emitted. Fix the ref, or drop it from the schema.',
      )
    }

    // Two definitions that reduce to one name used to collapse silently, and a
    // silently wrong type is the worst outcome available — so a real collision
    // now stops the build. Renaming has to be the caller's call: the name is
    // what every emitted import is keyed on.
    //
    // Filenames collide on case and separators (`Pet`/`pet`); the first one
    // generated won and the second was dropped, so every reference to it got
    // the other one's shape. Type names collide more widely still, because
    // `refToName` folds separators away (`foo-bar`, `foo.bar`, and `fooBar` all
    // become `FooBar`) — and that half was worse, since both files *were*
    // emitted and the importer ended up with two `import { FooBar }` lines that
    // do not parse.
    const filename = refToFilename(ref)
    const typeName = refToName(ref, typeSuffix)
    const fileOwner = filenameOwners.get(filename)

    if (fileOwner) {
      // Same target under two spellings is not a collision: `upgradeDraft07Schema`
      // deliberately aliases every URI-keyed definition to a short name, so both
      // refs point at the identical object and one file serves both.
      if (!sameDefinition(fileOwner.resolved, resolved)) {
        throw new Error(
          `"${ref}" and ${fileOwner.label} both generate the file "${filename}.ts", so only one of them can be ` +
            'emitted and every reference to the other would resolve to the wrong type. Rename one definition.',
        )
      }
    } else {
      const typeOwner = typeNameOwners.get(typeName)
      if (typeOwner) {
        throw new Error(
          `"${ref}" and ${typeOwner.label} both generate the type name "${typeName}" from different files, so the ` +
            'generated output would import that name twice and fail to parse. Rename one definition.',
        )
      }

      const owner: NameOwner = { label: `"${ref}"`, resolved }
      filenameOwners.set(filename, owner)
      typeNameOwners.set(typeName, owner)
      visit({
        ref,
        typeName,
        filename,
        schema: resolveDynamicRefs(resolved as JSONSchema, dynamicRefMap),
        rootSchema: upgraded,
        isRoot: false,
      })
    }

    // Always queue nested refs from the resolved schema, even when its file was
    // a duplicate: two ref strings can share a filename yet reach different
    // sub-definitions (e.g. a URI key and its short-name alias).
    for (const nested of cachedExtractRefs(cache, resolved as JSONSchema)) {
      if (!processedRefs.has(nested)) queue.push(nested)
    }
  }
}
