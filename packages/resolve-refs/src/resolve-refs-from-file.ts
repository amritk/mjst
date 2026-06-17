import { readFileSync } from 'node:fs'
import { dirname, resolve as resolvePath } from 'node:path'

import { getByPointer, pointerToPath } from './get-by-pointer'
import { isPrivateHost } from './is-private-host'
import type { OriginMap, ResolveError, ResolveOptions, ResolveResult } from './types'

// A ref currently mid-resolution is marked with this sentinel; revisiting it
// means a cycle, so we return `{}` instead of recursing forever.
const CYCLE = Symbol('cycle')
type CacheValue = unknown | typeof CYCLE

// --- Document location helpers ---------------------------------------------
//
// A "location" is the absolute identity of a document: either an absolute file
// path or an absolute http(s) URL. Refs are resolved relative to the location
// of the document they appear in, so a relative ref inside a remote document
// resolves to another remote URL, and one inside a local file to another path.

const isRemote = (location: string): boolean => /^https?:\/\//i.test(location)

/** Resolves the location of `ref` (its file/URL part) relative to `base`. */
const joinLocation = (base: string, ref: string): string => {
  if (isRemote(ref)) return ref
  if (isRemote(base)) return new URL(ref, base).href
  return resolvePath(dirname(base), ref)
}

/** Splits a `$ref` into its document part and JSON-pointer part. */
const splitRef = (ref: string): { filePart: string; pointer: string } => {
  const hashIdx = ref.indexOf('#')
  return {
    filePart: hashIdx === -1 ? ref : ref.slice(0, hashIdx),
    pointer: hashIdx === -1 ? '' : ref.slice(hashIdx + 1),
  }
}

// --- Remote document cache -------------------------------------------------
//
// Fetched remote documents are cached in memory for the lifetime of the
// process ("the session"). Local files are intentionally NOT cached across
// resolve passes — they can change on disk during a long-lived session (e.g.
// an editor/LSP), so each pass re-reads them. Remote documents are assumed
// stable for the session; call `clearRemoteCache()` to drop them.

const remoteCache = new Map<string, unknown>()

// In-flight remote loads, keyed by location. Two resolve passes that start at
// the same time and reach the same URL share a single fetch instead of racing
// two requests; whichever arrives first installs the promise, the rest await it.
const inFlight = new Map<string, Promise<unknown>>()

/** Drops every cached remote document. Mainly useful for tests/long sessions. */
export const clearRemoteCache = (): void => {
  remoteCache.clear()
}

// Cap on redirect hops before we give up — generous enough for real services,
// low enough to stop a redirect loop from spinning forever.
const MAX_REDIRECTS = 5

/**
 * Fetches and parses a remote document, following redirects manually so the
 * SSRF guard is re-applied to every hop. `fetch` follows redirects by default,
 * which would let an allow-listed public URL bounce to a private/loopback
 * address (e.g. the `169.254.169.254` metadata endpoint) — so we set
 * `redirect: 'manual'` and re-run {@link denialReason} on each `Location`.
 */
const fetchRemote = async (location: string, options: ResolveOptions): Promise<unknown> => {
  let current = location
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const reason = denialReason(current, options)
    if (reason !== null) throw new Error(`refusing to follow redirect (${reason}): ${current}`)

    const response = await fetch(current, { redirect: 'manual' })
    if (response.status >= 300 && response.status < 400) {
      const next = response.headers.get('location')
      if (!next) throw new Error(`HTTP ${response.status} redirect with no Location header`)
      current = new URL(next, current).href
      continue
    }
    if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`)

    const parse = options.parse ?? ((c: string) => JSON.parse(c) as unknown)
    // Parse against the original request location so the caller's format sniffing
    // (e.g. `.yaml` vs `.json`) and any relative refs key off a stable identity.
    return parse(await response.text(), location)
  }
  throw new Error(`too many redirects (>${MAX_REDIRECTS}): ${location}`)
}

/** Returns why a remote location may not be fetched, or `null` if it is allowed. */
const denialReason = (location: string, options: ResolveOptions): string | null => {
  if (options.remote === false) return 'remote $ref resolution is disabled'

  let url: URL
  try {
    url = new URL(location)
  } catch {
    return 'the URL is invalid'
  }

  const allow = options.allowedHosts
  // An explicit allow-list entry is an intentional opt-in and bypasses the
  // private-host guard; otherwise refuse non-public targets by default.
  if (allow && allow.length > 0) {
    return allow.includes(url.host) ? null : 'host is not in the allow-list'
  }
  if (!options.allowPrivateHosts && isPrivateHost(url.hostname)) {
    return 'host resolves to a private or loopback address (set allowPrivateHosts to permit)'
  }
  return null
}

/**
 * Loads a document into `docCache`, fetching/reading it if needed. Remote
 * documents are additionally cached for the session in `remoteCache`. On
 * failure an error is recorded and the location is cached as `{}` so that
 * pointer lookups degrade gracefully instead of throwing. Returns whether the
 * document loaded successfully.
 */
const loadDoc = async (
  location: string,
  docCache: Map<string, unknown>,
  options: ResolveOptions,
  errors: ResolveError[],
): Promise<boolean> => {
  if (docCache.has(location)) return true

  if (isRemote(location)) {
    if (remoteCache.has(location)) {
      docCache.set(location, remoteCache.get(location))
      return true
    }
    const reason = denialReason(location, options)
    if (reason !== null) {
      errors.push({ message: `Refusing to resolve remote $ref (${reason}): ${location}`, path: [] })
      docCache.set(location, {})
      return false
    }
    // Coalesce concurrent loads of the same URL onto one in-flight request; the
    // owner (first caller) clears the slot once it settles.
    let pending = inFlight.get(location)
    const owner = pending === undefined
    if (pending === undefined) {
      pending = fetchRemote(location, options)
      inFlight.set(location, pending)
    }
    try {
      const doc = await pending
      remoteCache.set(location, doc)
      docCache.set(location, doc)
      return true
    } catch (err) {
      errors.push({ message: `Failed to fetch ${location}: ${String(err)}`, path: [] })
      docCache.set(location, {})
      return false
    } finally {
      if (owner) inFlight.delete(location)
    }
  }

  try {
    const parse = options.parse ?? ((c: string) => JSON.parse(c) as unknown)
    docCache.set(location, parse(readFileSync(location, 'utf8'), location))
    return true
  } catch (err) {
    errors.push({ message: String(err), path: [] })
    docCache.set(location, {})
    return false
  }
}

/** Collects the distinct document parts of every `$ref` directly under `node`. */
const collectRefTargets = (node: unknown, out: Set<string>): Set<string> => {
  if (node === null || typeof node !== 'object') return out
  if (Array.isArray(node)) {
    for (const item of node) collectRefTargets(item, out)
    return out
  }
  const obj = node as Record<string, unknown>
  if (typeof obj['$ref'] === 'string') {
    const { filePart } = splitRef(obj['$ref'])
    if (filePart !== '') out.add(filePart)
  }
  // Recurse into every key — including a `$ref` node's siblings, which apply
  // alongside the referenced schema (2020-12) and may carry their own refs.
  for (const key of Object.keys(obj)) {
    if (key === '$ref') continue
    collectRefTargets(obj[key], out)
  }
  return out
}

/**
 * Walks every reachable document starting from `rootLocation`, loading each one
 * so the synchronous resolve pass can look them up. This is the only async part
 * of resolution: remote documents are fetched here (in dependency order) and
 * cached for the session.
 */
const prefetch = async (
  rootLocation: string,
  docCache: Map<string, unknown>,
  options: ResolveOptions,
  errors: ResolveError[],
): Promise<void> => {
  const seen = new Set<string>([rootLocation])
  const queue: string[] = [rootLocation]
  while (queue.length > 0) {
    const location = queue.shift() as string
    for (const filePart of collectRefTargets(docCache.get(location), new Set())) {
      const target = joinLocation(location, filePart)
      if (seen.has(target)) continue
      seen.add(target)
      await loadDoc(target, docCache, options, errors)
      queue.push(target)
    }
  }
}

/**
 * Single-pass resolver that inlines internal and external (`$ref` to other
 * file/URL) references. Every reachable document has already been loaded into
 * `docCache` by `prefetch`, so this stays synchronous. Refs are resolved once
 * (`refCache`); the CYCLE sentinel short-circuits re-entrant resolution.
 *
 * `baseLocation` is the location of the document `node` belongs to, used to
 * resolve relative refs and `#/...` pointers within it.
 */
const resolveAt = (
  node: unknown,
  baseLocation: string,
  docCache: Map<string, unknown>,
  refCache: Map<string, CacheValue>,
  origins: OriginMap | undefined,
): unknown => {
  if (node === null || typeof node !== 'object') return node
  if (Array.isArray(node)) {
    return node.map((item) => resolveAt(item, baseLocation, docCache, refCache, origins))
  }
  const obj = node as Record<string, unknown>
  if (typeof obj['$ref'] === 'string') {
    const { filePart, pointer } = splitRef(obj['$ref'])
    const targetLocation = filePart === '' ? baseLocation : joinLocation(baseLocation, filePart)
    const targetRoot = docCache.get(targetLocation) ?? {}

    const cacheKey = `${targetLocation}#${pointer}`
    let resolved: unknown
    if (refCache.has(cacheKey)) {
      const cached = refCache.get(cacheKey)
      resolved = cached === CYCLE ? {} : cached
    } else {
      refCache.set(cacheKey, CYCLE)
      const target = pointer ? getByPointer(targetRoot, pointer) : targetRoot
      resolved = resolveAt(target, targetLocation, docCache, refCache, origins)
      refCache.set(cacheKey, resolved)
      // Stamp the inlined node with where it was defined so a consumer can map a
      // resolved-tree node back to its source document/path. Only objects/arrays are
      // stamped (primitives can't key the map). First-write-wins: resolution recurses
      // to the deepest `$ref` before returning, so the *definition* site stamps first;
      // an outer ref that merely points (transitively) at the same object must not
      // overwrite it with an intermediate location.
      if (origins && resolved !== null && typeof resolved === 'object' && !origins.has(resolved)) {
        origins.set(resolved, { location: targetLocation, pointer: pointerToPath(pointer) })
      }
    }

    // Keywords sibling to `$ref` apply alongside the referenced schema (2020-12),
    // so preserve them by combining both in an `allOf` rather than dropping them.
    const siblingKeys = Object.keys(obj).filter((key) => key !== '$ref')
    if (siblingKeys.length === 0) return resolved
    const siblings: Record<string, unknown> = {}
    for (const key of siblingKeys) siblings[key] = resolveAt(obj[key], baseLocation, docCache, refCache, origins)
    const existingAllOf = Array.isArray(siblings['allOf']) ? siblings['allOf'] : []
    const merged = { ...siblings, allOf: [...existingAllOf, resolved] }
    // Stamp the wrapper too, so origin lookups resolve for a `$ref`-with-siblings node.
    if (origins && !origins.has(merged))
      origins.set(merged, { location: targetLocation, pointer: pointerToPath(pointer) })
    return merged
  }
  const result: Record<string, unknown> = {}
  for (const key of Object.keys(obj)) {
    result[key] = resolveAt(obj[key], baseLocation, docCache, refCache, origins)
  }
  return result
}

/**
 * Resolves `$ref`s in a document on disk (or at a URL), including cross-file
 * and remote refs. Remote documents are fetched on the fly and cached in memory
 * for the session; `options` governs whether/which remote hosts are allowed.
 */
export const resolveRefsFromFile = async (filename: string, options: ResolveOptions = {}): Promise<ResolveResult> => {
  const rootLocation = isRemote(filename) ? filename : resolvePath(filename)
  const errors: ResolveError[] = []
  const docCache = new Map<string, unknown>()

  if (!(await loadDoc(rootLocation, docCache, options, errors))) {
    return { resolved: {}, errors }
  }
  await prefetch(rootLocation, docCache, options, errors)
  const origins: OriginMap | undefined = options.trackOrigins ? new Map() : undefined
  const resolved = resolveAt(docCache.get(rootLocation), rootLocation, docCache, new Map(), origins)
  return origins ? { resolved, errors, origins } : { resolved, errors }
}
