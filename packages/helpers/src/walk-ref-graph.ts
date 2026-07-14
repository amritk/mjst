import type { JSONSchema } from 'json-schema-typed/draft-2020-12'

import { buildDynamicRefMap } from './build-dynamic-ref-map'
import { extractRefs } from './extract-refs'
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
}

const rootCaches = new WeakMap<object, RootCache>()

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

const getRootCache = (rootSchema: JSONSchema): RootCache => {
  // Only object roots can key a WeakMap. A boolean root has no refs to walk and
  // the draft-07 upgrade is a no-op for it, so a throwaway cache is fine.
  if (typeof rootSchema !== 'object' || rootSchema === null) {
    const upgraded = rootSchema as unknown as Record<string, unknown>
    return { upgraded, dynamicRefMap: {}, resolveRefCache: new Map(), extractRefsCache: new WeakMap() }
  }

  const existing = rootCaches.get(rootSchema)
  if (existing) return existing

  const upgraded = upgradeDraft07Schema(rootSchema as Record<string, unknown>)
  const cache: RootCache = {
    upgraded,
    dynamicRefMap: buildDynamicRefMap(upgraded as JSONSchema),
    resolveRefCache: new Map(),
    extractRefsCache: new WeakMap(),
  }
  rootCaches.set(rootSchema, cache)
  return cache
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
 * code imports goes ungenerated. A ref that fails to resolve is reported via
 * `console.warn` and skipped, matching the generators' prior behavior.
 *
 * Resolution work is memoized per root document (see {@link RootCache}), so
 * running several generators over the same loaded schema does the expensive
 * walking once.
 *
 * @param rootSchema - The root JSON Schema to walk.
 * @param rootTypeName - The name for the root type (e.g. `'Document'`).
 * @param options - Naming options ({@link WalkRefGraphOptions}).
 * @param visit - Called once per output file with a fully prepared {@link RefNode}.
 */
export const walkRefGraph = (
  rootSchema: JSONSchema,
  rootTypeName: string,
  options: WalkRefGraphOptions,
  visit: (node: RefNode) => void,
): void => {
  const typeSuffix = options.typeSuffix ?? ''
  const cache = getRootCache(rootSchema)
  const { upgraded, dynamicRefMap } = cache

  const processedRefs = new Set<string>()
  const processedFilenames = new Set<string>()

  // Root node first — its filename reserves a slot so a later ref that maps to
  // the same name does not emit a duplicate file.
  const rootFilename = rootTypeName.toLowerCase()
  processedFilenames.add(rootFilename)

  // An alias root (a document that is just `$ref: '#/$defs/x'`) whose derived
  // filename equals its target's would reserve the filename for a wrapper that
  // re-exports the target — and the target, mapping to the same file, would
  // then never be generated, leaving a file that imports itself. Generate the
  // *target's* schema under the root's name instead, carrying the ref so
  // generators can exclude the self-import.
  let rootNodeSchema = upgraded as JSONSchema
  let rootNodeRef: string | undefined
  const aliasRef = getAliasRootRef(upgraded as JSONSchema)
  if (aliasRef && refToFilename(aliasRef) === rootFilename) {
    const resolved = cachedResolveRef(cache, aliasRef)
    if (resolved) {
      rootNodeSchema = resolved as JSONSchema
      rootNodeRef = aliasRef
    }
  }

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
  const queue: string[] = [...cachedExtractRefs(cache, upgraded as JSONSchema), ...Object.values(dynamicRefMap)]

  // Advance a read cursor instead of `queue.shift()`, whose O(n) element move
  // makes draining a large ref graph quadratic.
  for (let head = 0; head < queue.length; head++) {
    const ref = queue[head]
    if (!ref || processedRefs.has(ref)) continue
    processedRefs.add(ref)

    const resolved = cachedResolveRef(cache, ref)
    if (!resolved) {
      console.warn(`Warning: Could not resolve ref: ${ref}`)
      continue
    }

    const filename = refToFilename(ref)
    if (!processedFilenames.has(filename)) {
      processedFilenames.add(filename)
      visit({
        ref,
        typeName: refToName(ref, typeSuffix),
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
