import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, resolve as resolvePath } from 'node:path'

import { assertPublicHost } from './assert-public-host'
import { childRole, type NodeRole } from './child-role'
import {
  bindsAtEvaluationTime,
  declaresAmbiguousAnchor,
  inliningKeepsScope,
  isScopeSensitive,
  type ScopeSensitiveNodes,
} from './dynamic-scope'
import { isContainedPath } from './is-contained-path'
import { isPrivateHost } from './is-private-host'
import { DEFAULT_MAX_DEPTH, depthLimitError } from './max-depth'
import { type ResolvedTarget, readReference, resolveFragment } from './reference'
import {
  baseOfNode,
  buildResourceRegistry,
  type ResourceRegistry,
  resolveRefInScope,
  type ScopedTarget,
  SYNTHETIC_BASE,
} from './resource-registry'
import { roleAtPath } from './role-at-path'
import { assignKey } from './safe-assign'
import type { JsonPath, OriginMap, ResolveError, ResolveOptions, ResolveResult } from './types'

// A ref currently mid-resolution is marked with this sentinel; revisiting it
// means a cycle, so the reference is kept (rewritten to a root-document ref,
// hoisting the target into `$defs` when it lives in another file) instead of
// recursing forever.
const CYCLE = Symbol('cycle')
// The inlined value, the in-document path it came from (for `origins`), and the
// `$id` base it was defined under (for the scope check in `resolveAt`).
type CacheValue = { value: unknown; pointer: JsonPath; base: string } | typeof CYCLE

/** See {@link ANNOTATION_ONLY_SIBLINGS} in resolve-refs.ts — same rule here. */
const ANNOTATION_ONLY_SIBLINGS = new Set(['summary', 'description'])

// --- Document location helpers ---------------------------------------------
//
// A "location" is the absolute identity of a document: either an absolute file
// path or an absolute http(s) URL. Refs are resolved relative to the location
// of the document they appear in, so a relative ref inside a remote document
// resolves to another remote URL, and one inside a local file to another path.
// A document's `$id` never changes which file/URL a ref loads from — it only
// scopes *in-document* resolution (see resource-registry.ts).

const isRemote = (location: string): boolean => /^https?:\/\//i.test(location)

/** Resolves the location of `ref` (its file/URL part) relative to `base`. */
const joinLocation = (base: string, ref: string): string => {
  if (isRemote(ref)) return ref
  if (isRemote(base)) return new URL(ref, base).href
  return resolvePath(dirname(base), ref)
}

/** Splits a `$ref` into its document part and its fragment (pointer or anchor name). */
const splitRef = (ref: string): { filePart: string; fragment: string } => {
  const hashIdx = ref.indexOf('#')
  return {
    filePart: hashIdx === -1 ? ref : ref.slice(0, hashIdx),
    fragment: hashIdx === -1 ? '' : ref.slice(hashIdx + 1),
  }
}

// --- Remote document cache -------------------------------------------------
//
// Fetched remote documents are cached in memory for the session. Local files are
// intentionally NOT cached across resolve passes — they can change on disk during
// a long-lived session (e.g. an editor/LSP), so each pass re-reads them. Remote
// documents are assumed stable; call `clearRemoteCache()` to drop them, or pass
// `cache: false` to bypass the session cache for a single call.
//
// Two properties this cache has to hold, both learned the hard way:
//
// 1. It is keyed by URL *and* by the credential/transport context the document
//    was fetched with (see `fetchScope`). Keyed by URL alone, a call carrying
//    tenant A's `Authorization` header would hand A's private document straight
//    to a later call that carried no credentials at all.
// 2. It is bounded. "Cached for the lifetime of the process" is fine for a CLI
//    run and a slow memory leak in a long-lived server, so entries expire and
//    the oldest are evicted past a cap.

/** A cached document plus the moment it stops being served. */
type CacheEntry = { value: unknown; expiresAt: number }

/** How long a fetched remote document stays servable from the session cache. */
const REMOTE_CACHE_TTL_MS = 10 * 60_000

/** Cap on cached documents; the least recently used are evicted past it. */
const REMOTE_CACHE_MAX_ENTRIES = 256

// Insertion order is the recency order: a hit re-inserts, so `keys().next()` is
// always the least recently used entry.
const remoteCache = new Map<string, CacheEntry>()

// In-flight remote loads, keyed exactly like the cache. Two resolve passes that
// start at the same time and reach the same URL *with the same credentials and
// transport* share a single fetch instead of racing two requests; whichever
// arrives first installs the promise, the rest await it. Sharing across
// differing credentials would leak the same way a URL-only cache key does — and
// would silently hand the second caller the first one's `fetch` and limits.
const inFlight = new Map<string, Promise<unknown>>()

// A NUL byte cannot appear in a URL, so a key splits unambiguously into
// `<scope>\0<location>` — which is what lets `clearRemoteCache(url)` find every
// scope a URL was fetched under.
const SCOPE_SEPARATOR = '\u0000'

/**
 * Drops cached remote documents. Pass a URL to drop just that document (across
 * every credential scope it was fetched under); pass nothing to drop them all.
 * Mainly useful in tests, or when a remote schema is known to have changed.
 */
export const clearRemoteCache = (location?: string): void => {
  if (location === undefined) {
    remoteCache.clear()
    return
  }
  const suffix = `${SCOPE_SEPARATOR}${location}`
  for (const key of remoteCache.keys()) {
    if (key.endsWith(suffix)) remoteCache.delete(key)
  }
}

/** Reads a live cache entry, refreshing its recency; `undefined` when absent or stale. */
const readRemoteCache = (key: string): CacheEntry | undefined => {
  const entry = remoteCache.get(key)
  if (entry === undefined) return undefined
  if (Date.now() >= entry.expiresAt) {
    remoteCache.delete(key)
    return undefined
  }
  remoteCache.delete(key)
  remoteCache.set(key, entry)
  return entry
}

/** Stores a fetched document, evicting the least recently used entries past the cap. */
const writeRemoteCache = (key: string, value: unknown): void => {
  remoteCache.delete(key)
  remoteCache.set(key, { value, expiresAt: Date.now() + REMOTE_CACHE_TTL_MS })
  while (remoteCache.size > REMOTE_CACHE_MAX_ENTRIES) {
    const oldest = remoteCache.keys().next()
    if (oldest.done) break
    remoteCache.delete(oldest.value)
  }
}

// Cap on redirect hops before we give up — generous enough for real services,
// low enough to stop a redirect loop from spinning forever.
const MAX_REDIRECTS = 5

/** Abort a remote fetch that has not responded within this many milliseconds. */
const FETCH_TIMEOUT_MS = 30_000

/** Refuse to buffer a remote document larger than this (bytes) to bound memory. */
const MAX_REMOTE_BYTES = 16 * 1024 * 1024

/**
 * Reads a response body, refusing to buffer more than `maxBytes`. A
 * `Content-Length` over the limit is rejected up front; a missing/lying header
 * is caught while streaming so a chunked response can't exhaust memory either.
 */
const readCapped = async (response: Response, maxBytes: number): Promise<string> => {
  const declared = Number(response.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new Error(`remote document exceeds ${maxBytes} bytes`)
  }

  const body = response.body
  if (!body) return response.text()

  const decoder = new TextDecoder()
  let text = ''
  let total = 0
  for await (const chunk of body as unknown as AsyncIterable<Uint8Array>) {
    total += chunk.byteLength
    if (total > maxBytes) throw new Error(`remote document exceeds ${maxBytes} bytes`)
    text += decoder.decode(chunk, { stream: true })
  }
  return text + decoder.decode()
}

/** The caller-supplied headers for `url`, if any. */
const headersFor = (url: string, options: ResolveOptions): Record<string, string> | undefined => {
  if (options.headers === undefined) return undefined
  return typeof options.headers === 'function' ? options.headers(url) : options.headers
}

// Stable per-process ids for caller-supplied callbacks, so two calls that pass
// *the same* function share a cache entry and two that pass different ones do
// not. A WeakMap keeps this from pinning the functions in memory.
const callableIds = new WeakMap<object, string>()
let nextCallableId = 0
const callableId = (fn: unknown): string => {
  if (typeof fn !== 'function') return 'default'
  let id = callableIds.get(fn)
  if (id === undefined) {
    id = `fn${++nextCallableId}`
    callableIds.set(fn, id)
  }
  return id
}

/**
 * A short digest of the request headers. Hashed rather than stored verbatim so
 * the cache key never holds a bearer token in plain text (keys are easy to end
 * up in a heap dump or a debug log), while still separating callers whose
 * credentials differ. Header names are lower-cased and sorted so the same
 * credentials fingerprint identically however the caller spelled them.
 */
const headersFingerprint = (headers: Record<string, string> | undefined): string => {
  if (headers === undefined) return 'none'
  const entries = Object.entries(headers)
    .map(([name, value]) => `${name.toLowerCase()}:${value}`)
    .sort()
  if (entries.length === 0) return 'none'
  return createHash('sha256').update(entries.join('\n')).digest('hex').slice(0, 32)
}

/**
 * Everything about *how* a document would be fetched, as a string. Two calls
 * share a cached (or in-flight) document only when these agree: the credentials
 * (so no cross-tenant leak), the `fetch` and `parse` callbacks (the cache stores
 * post-parse values, and a custom `fetch` may reach a different network), and
 * the limits (so a caller asking for a smaller `maxBytes` is not handed a
 * document fetched under a larger one).
 */
const fetchScope = (location: string, options: ResolveOptions): string =>
  [
    headersFingerprint(headersFor(location, options)),
    callableId(options.fetch),
    callableId(options.parse),
    String(options.timeoutMs ?? FETCH_TIMEOUT_MS),
    String(options.maxRedirects ?? MAX_REDIRECTS),
    String(options.maxBytes ?? MAX_REMOTE_BYTES),
    options.verifyDns === false ? 'nodns' : 'dns',
  ].join('|')

/** The session-cache / in-flight key for `location` under this call's options. */
const cacheKeyFor = (location: string, options: ResolveOptions): string =>
  `${fetchScope(location, options)}${SCOPE_SEPARATOR}${location}`

/**
 * Fetches and parses a remote document, following redirects manually so the
 * SSRF guard is re-applied to every hop. `fetch` follows redirects by default,
 * which would let an allow-listed public URL bounce to a private/loopback
 * address (e.g. the `169.254.169.254` metadata endpoint) — so we set
 * `redirect: 'manual'` and re-run {@link denialReason} on each `Location`.
 * Caller-supplied headers are only sent on hops that share the original URL's
 * origin, so a cross-origin redirect can't exfiltrate credentials.
 */
const fetchRemote = async (location: string, options: ResolveOptions, deadline: number): Promise<unknown> => {
  const maxRedirects = options.maxRedirects ?? MAX_REDIRECTS
  const timeoutMs = options.timeoutMs ?? FETCH_TIMEOUT_MS
  const maxBytes = options.maxBytes ?? MAX_REMOTE_BYTES
  const doFetch = options.fetch ?? fetch
  const origin = new URL(location).origin

  let current = location
  for (let hop = 0; hop <= maxRedirects; hop++) {
    const reason = denialReason(current, options)
    if (reason !== null) throw new Error(`refusing to follow redirect (${reason}): ${current}`)
    if (needsDnsVerification(options)) await assertPublicHost(new URL(current).hostname)

    const headers = new URL(current).origin === origin ? headersFor(location, options) : undefined
    const response = await doFetch(current, {
      redirect: 'manual',
      // Cap the wait for a response so a stalling host can't hang resolution
      // forever — and never past the whole resolve's deadline, so a chain of
      // slow hops cannot outlive the caller's total budget.
      signal: AbortSignal.timeout(Math.max(0, Math.min(timeoutMs, deadline - Date.now()))),
      ...(headers !== undefined ? { headers } : {}),
    })
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
    return parse(await readCapped(response, maxBytes), location)
  }
  throw new Error(`too many redirects (>${maxRedirects}): ${location}`)
}

/**
 * Whether `url`'s host is on the caller's allow-list. Matching is
 * case-insensitive (hostnames are, and `url.host` is already lower-cased, so a
 * `['EXAMPLE.com']` entry used to fail closed for no reason) and port-aware: an
 * entry without a port matches the host on any port, while an entry with one
 * must match the URL's port — counting the protocol default when the URL omits
 * it, so `example.com:443` matches `https://example.com/`.
 */
const isAllowedHost = (url: URL, allow: readonly string[]): boolean => {
  const hostname = url.hostname.toLowerCase()
  const port = url.port === '' ? (url.protocol === 'https:' ? '443' : '80') : url.port
  const withPort = `${hostname}:${port}`
  return allow.some((entry) => {
    const candidate = entry.trim().toLowerCase()
    return candidate === hostname || candidate === withPort
  })
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

  // Only http(s) may be fetched. Without this, a redirect to `file:///etc/passwd`
  // or a `data:` URL passes every host check below (their `hostname` is empty, so
  // `isPrivateHost('')` is false) and Bun's `fetch` would happily read the file.
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return `unsupported URL protocol "${url.protocol}" (only http and https are allowed)`
  }

  const allow = options.allowedHosts
  // An explicit allow-list entry is an intentional opt-in and bypasses the
  // private-host guard; otherwise refuse non-public targets by default.
  if (allow && allow.length > 0) {
    return isAllowedHost(url, allow) ? null : 'host is not in the allow-list'
  }
  if (!options.allowPrivateHosts && isPrivateHost(url.hostname)) {
    return 'host resolves to a private or loopback address (set allowPrivateHosts to permit)'
  }
  return null
}

/**
 * Whether this hop still needs the DNS-resolving half of the SSRF guard.
 * {@link denialReason} has already had its say by the time we ask; this only
 * covers what a URL cannot tell us — a public-looking name pointing at a private
 * address. Skipped when the caller opted out (`verifyDns: false`), when private
 * targets are permitted anyway, and when the host was explicitly allow-listed
 * (an allow-list entry is a deliberate "I know what this host is", and it is the
 * escape hatch for environments where names resolve at an egress proxy rather
 * than locally).
 */
const needsDnsVerification = (options: ResolveOptions): boolean => {
  if (options.verifyDns === false) return false
  if (options.allowPrivateHosts) return false
  if (options.allowedHosts && options.allowedHosts.length > 0) return false
  return true
}

/**
 * Loads a document into `docCache`, fetching/reading it if needed. Remote
 * documents are additionally cached for the session in `remoteCache` (unless
 * `cache: false`). On failure an error is recorded and the location is cached
 * as `{}` so that pointer lookups degrade gracefully instead of throwing.
 * Returns whether the document loaded successfully.
 */
const loadDoc = async (
  location: string,
  docCache: Map<string, unknown>,
  options: ResolveOptions,
  errors: ResolveError[],
  deadline: number,
): Promise<boolean> => {
  if (docCache.has(location)) return true

  if (isRemote(location)) {
    // Evaluate the policy before serving anything for a remote location —
    // including a cache hit. `remoteCache` is process-global and outlives a
    // single resolve call, so a URL fetched earlier under permissive options
    // must not be handed to a later call whose options (a disabled `remote`,
    // a stricter `allowedHosts`, no `allowPrivateHosts`) would refuse it.
    const reason = denialReason(location, options)
    if (reason !== null) {
      errors.push({ message: `Refusing to resolve remote $ref (${reason}): ${location}`, path: [] })
      docCache.set(location, {})
      return false
    }
    const useSessionCache = options.cache !== false
    // Both the session cache and the in-flight table are keyed by URL *and* by
    // the credentials/transport this call would fetch with, so a document
    // fetched with one tenant's token is invisible to a call carrying different
    // (or no) credentials — and nobody inherits somebody else's `fetch`.
    const key = cacheKeyFor(location, options)
    if (useSessionCache) {
      const entry = readRemoteCache(key)
      if (entry !== undefined) {
        docCache.set(location, entry.value)
        return true
      }
    }
    if (!useSessionCache) {
      // A cache-bypassing call must not serve (or poison) concurrent callers'
      // in-flight loads either — fetch independently.
      try {
        const doc = await fetchRemote(location, options, deadline)
        docCache.set(location, doc)
        return true
      } catch (err) {
        errors.push({ message: `Failed to fetch ${location}: ${String(err)}`, path: [] })
        docCache.set(location, {})
        return false
      }
    }
    // Coalesce concurrent loads of the same URL onto one in-flight request; the
    // owner (first caller) clears the slot once it settles. Only the owner's
    // deadline applies to the shared request — the others started at nearly the
    // same moment, so their budgets differ by microseconds.
    let pending = inFlight.get(key)
    const owner = pending === undefined
    if (pending === undefined) {
      pending = fetchRemote(location, options, deadline)
      inFlight.set(key, pending)
    }
    try {
      const doc = await pending
      writeRemoteCache(key, doc)
      docCache.set(location, doc)
      return true
    } catch (err) {
      errors.push({ message: `Failed to fetch ${location}: ${String(err)}`, path: [] })
      docCache.set(location, {})
      return false
    } finally {
      if (owner) inFlight.delete(key)
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

/** Escapes a JSON Pointer segment (RFC 6901): `~` → `~0`, `/` → `~1`. */
const escapeSegment = (segment: string): string => segment.replace(/~/g, '~0').replace(/\//g, '~1')

/** Renders a {@link JsonPath} as a `#/...` ref string. */
const pathToRef = (path: JsonPath): string =>
  path.length === 0 ? '#' : `#/${path.map((segment) => escapeSegment(String(segment))).join('/')}`

/** Derives a readable `$defs` key for a hoisted cycle target. */
const hoistName = (targetLocation: string, fragment: string, taken: Set<string>): string => {
  const fragmentTail = fragment.split('/').filter(Boolean).pop()
  const locationTail = targetLocation
    .split('/')
    .filter(Boolean)
    .pop()
    ?.replace(/\.[a-z0-9]+$/i, '')
  const raw = fragmentTail || locationTail || 'cycle'
  const sanitized = raw.replace(/[^A-Za-z0-9_.-]/g, '-') || 'cycle'
  let name = sanitized
  for (let n = 2; taken.has(name); n++) name = `${sanitized}-${n}`
  taken.add(name)
  return name
}

/** Documents (root included) a single resolve may load before it stops. */
const MAX_DOCUMENTS = 500

/** Milliseconds the whole resolve may spend loading documents. */
const TOTAL_TIMEOUT_MS = 60_000

/**
 * Resolves `$ref`s in a document on disk (or at a URL), including cross-file
 * and remote refs. Remote documents are fetched on the fly and cached in memory
 * for the session; `options` governs whether/which remote hosts are allowed,
 * how they are fetched (`headers`, `fetch`, `timeoutMs`, `maxRedirects`,
 * `maxBytes`), which local directories may be read (`localRefs`,
 * `allowedRoots`), the limits on the resolve as a whole (`maxDocuments`,
 * `totalTimeoutMs`, `maxDepth`), and whether the session cache is used
 * (`cache`).
 *
 * Only references in *schema* positions are followed: a `$ref`-shaped object
 * inside `enum`, `const`, `default` or `examples` is instance data, so it is
 * kept verbatim and the document it names is never loaded (see `child-role.ts`).
 *
 * As in {@link resolveRefs}, a reference the resolver cannot answer without
 * changing what the document accepts is *kept* rather than guessed at, and
 * resolves within the output: a cycle (rewritten to a root-relative `$ref`, its
 * target hoisted into `$defs` when it came from another file), and — for a
 * resolve that stayed inside a single document — a `$dynamicRef` whose anchor
 * name is declared more than once. Neither is reported on `errors`; nothing
 * failed.
 */
export const resolveRefsFromFile = async (filename: string, options: ResolveOptions = {}): Promise<ResolveResult> => {
  const rootLocation = isRemote(filename) ? filename : resolvePath(filename)
  const errors: ResolveError[] = []
  const docCache = new Map<string, unknown>()
  const maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH
  const maxDocuments = options.maxDocuments ?? MAX_DOCUMENTS
  const deadline = Date.now() + (options.totalTimeoutMs ?? TOTAL_TIMEOUT_MS)

  // Where a local `$ref` is allowed to land. The default confines it to the
  // folder holding the root document — the same default-deny stance the remote
  // path takes, and the reason `{"$ref": "../../etc/passwd"}` (or an absolute
  // path) no longer reads whatever the process can read. A remote root has no
  // local neighborhood at all, so nothing on disk is reachable from it unless
  // the caller names a root explicitly.
  const localRoots = (options.allowedRoots ?? (isRemote(rootLocation) ? [] : [dirname(rootLocation)])).map((root) =>
    resolvePath(root),
  )

  /** Returns why a local document may not be read, or `null` if it is allowed. */
  const localDenialReason = (location: string): string | null => {
    if (options.localRefs === false) return 'local $ref resolution is disabled'
    if (localRoots.length === 0) {
      return 'no local directory is allowed for this document (set allowedRoots to permit one)'
    }
    if (localRoots.some((root) => isContainedPath(root, location))) return null
    return `it resolves outside the allowed roots [${localRoots.join(', ')}] (set allowedRoots to permit it)`
  }

  // The root document is what the caller explicitly named, so it is never
  // subject to the confinement it defines.
  if (!(await loadDoc(rootLocation, docCache, options, errors, deadline))) {
    return { resolved: {}, errors }
  }

  // Per-document `$id` registries, built lazily. A document's registry scopes
  // anchor lookups and lets URI refs match embedded resources without fetching.
  const registries = new Map<string, ResourceRegistry>()
  const registryFor = (location: string): ResourceRegistry => {
    let registry = registries.get(location)
    if (registry === undefined) {
      registry = buildResourceRegistry(docCache.get(location), isRemote(location) ? location : SYNTHETIC_BASE, maxDepth)
      registries.set(location, registry)
    }
    return registry
  }

  // The depth limit is reported once per resolve, however many branches trip it.
  let depthLimitReported = false
  const reportDepthLimit = (): void => {
    if (depthLimitReported) return
    depthLimitReported = true
    errors.push(depthLimitError(maxDepth))
  }

  /**
   * Collects the document parts of refs under `node` that are NOT `$id`-internal.
   * Stops at `maxDepth` like the resolve pass does — a subtree we refuse to
   * resolve does not need its documents fetched either. Value positions are
   * skipped for the same reason the resolve pass skips them: a `$ref` inside an
   * `enum` member is data, and fetching the document it names would turn a
   * literal into a network request.
   */
  const collectRefTargets = (
    node: unknown,
    location: string,
    base: string,
    out: Set<string>,
    depth: number,
    role: NodeRole,
  ): void => {
    if (node === null || typeof node !== 'object' || role === 'value') return
    if (depth > maxDepth) {
      reportDepthLimit()
      return
    }
    if (Array.isArray(node)) {
      node.forEach((item, index) => {
        collectRefTargets(item, location, base, out, depth + 1, childRole(role, index))
      })
      return
    }
    const obj = node as Record<string, unknown>
    const registry = registryFor(location)
    const isSchema = role !== 'schemaMap'
    const nodeBase = isSchema && typeof obj['$id'] === 'string' ? baseOfNode(registry, obj, base) : base
    const reference = isSchema ? readReference(obj) : undefined
    if (reference && reference.keyword !== '$recursiveRef') {
      const scoped = resolveRefInScope(registry, reference.keyword, reference.value, nodeBase)
      if (scoped === 'external') {
        const { filePart } = splitRef(reference.value)
        if (filePart !== '') out.add(filePart)
      }
    }
    // Recurse into every key — including a reference node's siblings, which apply
    // alongside the referenced schema (2020-12) and may carry their own refs.
    for (const key of Object.keys(obj)) {
      if (reference && key === reference.keyword) continue
      collectRefTargets(obj[key], location, nodeBase, out, depth + 1, childRole(role, key))
    }
  }

  /**
   * Walks every reachable document starting from the root, loading each one so
   * the synchronous resolve pass can look them up. This is the only async part
   * of resolution: remote documents are fetched here (in dependency order) and
   * cached for the session.
   *
   * Two budgets bound the walk, because each loaded document can name more
   * documents of its own: `maxDocuments` caps how many are loaded at all, and
   * the deadline caps the wall-clock time they may take together. Without them a
   * document listing hundreds of distinct URLs turns this resolver into an
   * egress amplifier (and a scanner) pointed wherever the attacker likes, and
   * every one of those requests is allowed to burn the full per-hop timeout.
   * When either budget runs out we stop loading and report it; refs into the
   * documents we never loaded degrade exactly like any unresolvable ref.
   */
  const prefetch = async (): Promise<void> => {
    const seen = new Set<string>([rootLocation])
    const queue: string[] = [rootLocation]
    let loaded = 1
    while (queue.length > 0) {
      const location = queue.shift() as string
      const out = new Set<string>()
      collectRefTargets(docCache.get(location), location, registryFor(location).rootBase, out, 0, 'schema')
      for (const filePart of out) {
        const target = joinLocation(location, filePart)
        if (seen.has(target)) continue
        seen.add(target)
        if (loaded >= maxDocuments) {
          errors.push({
            message: `Refusing to load more than ${maxDocuments} documents; the rest of the $ref graph was left unresolved (raise maxDocuments to allow more)`,
            path: [],
          })
          return
        }
        if (Date.now() >= deadline) {
          errors.push({
            message: `Resolve deadline of ${options.totalTimeoutMs ?? TOTAL_TIMEOUT_MS}ms elapsed; the rest of the $ref graph was left unresolved (raise totalTimeoutMs to allow more)`,
            path: [],
          })
          return
        }
        if (!isRemote(target)) {
          const reason = localDenialReason(target)
          if (reason !== null) {
            errors.push({ message: `Refusing to read local $ref (${reason}): ${target}`, path: [] })
            docCache.set(target, {})
            continue
          }
        }
        loaded++
        await loadDoc(target, docCache, options, errors, deadline)
        queue.push(target)
      }
    }
  }

  await prefetch()

  const origins: OriginMap | undefined = options.trackOrigins ? new Map() : undefined
  const refCache = new Map<string, CacheValue>()
  // Output nodes that must not be relocated across an `$id` boundary — the kept
  // references and the `$dynamicAnchor`s they may bind to (see `dynamic-scope.ts`).
  const sensitive: ScopeSensitiveNodes = new WeakSet()
  /**
   * The `$dynamicAnchor` names whose binding this pass refuses to guess.
   *
   * Keeping a `$dynamicRef` only helps when the scaffolding it binds against
   * survives into the output, and that is guaranteed exactly when the resolve
   * stayed inside one document: the output is then that document with its refs
   * inlined, so `resolveRefs` semantics apply verbatim. Once several documents
   * are flattened into one, the anchors a `$dynamicRef` may reach are spread
   * across files that no longer exist on their own, and a kept keyword could
   * resolve to nothing — so a multi-document resolve keeps inlining the
   * lexically nearest anchor, as it always has.
   */
  const ambiguousDynamicAnchors =
    docCache.size === 1 ? registryFor(rootLocation).ambiguousDynamicAnchors : new Set<string>()
  // Cycle targets living in other documents are hoisted into the root's `$defs`
  // under these names once resolution completes (see the CYCLE branch).
  const hoists = new Map<string, string>()
  const hoistTaken = new Set<string>()

  /**
   * Single-pass resolver that inlines internal and external (`$ref` to other
   * file/URL) references. Every reachable document has already been loaded into
   * `docCache` by `prefetch`, so this stays synchronous. Refs are resolved once
   * (`refCache`); the CYCLE sentinel short-circuits re-entrant resolution.
   *
   * `baseLocation` is the location of the document `node` belongs to; `base` is
   * the current `$id` base URI within that document; `role` is where the node
   * sits in the vocabulary (see `child-role.ts`), which decides whether a `$ref`
   * key here is a reference at all.
   */
  const resolveAt = (node: unknown, baseLocation: string, base: string, depth: number, role: NodeRole): unknown => {
    if (node === null || typeof node !== 'object') return node
    // Instance data (`enum`, `const`, `default`, `examples`): a `$ref` key in
    // here belongs to the value, so the subtree is handed back untouched.
    if (role === 'value') return node
    if (depth > maxDepth) {
      // Past the limit we hand the subtree back untouched instead of unwinding
      // the stack with a RangeError. Nothing is lost — the branch simply keeps
      // its `$ref`s — and the failure is on `errors` where callers look.
      reportDepthLimit()
      return node
    }
    if (Array.isArray(node)) {
      const items = node.map((item, index) => resolveAt(item, baseLocation, base, depth + 1, childRole(role, index)))
      if (items.some((item) => isScopeSensitive(sensitive, item))) sensitive.add(items)
      return items
    }
    const obj = node as Record<string, unknown>
    const registry = registryFor(baseLocation)
    // A map of author-chosen names to schemas (`properties`, `$defs`, …) is not
    // itself a schema, so its keys are names — a property named `$ref` is a
    // property, not a reference.
    const isSchema = role !== 'schemaMap'
    const nodeBase = isSchema && typeof obj['$id'] === 'string' ? baseOfNode(registry, obj, base) : base
    const reference = isSchema ? readReference(obj) : undefined
    if (reference) {
      const { keyword, value } = reference

      // A `$dynamicRef` naming an anchor declared more than once has no single
      // target to inline — the dynamic scope picks one when the document is
      // evaluated — so the keyword is kept for the validator to answer, with its
      // siblings resolved around it.
      if (bindsAtEvaluationTime(keyword, value, ambiguousDynamicAnchors)) {
        const kept: Record<string, unknown> = {}
        for (const key of Object.keys(obj)) {
          assignKey(
            kept,
            key,
            key === keyword ? obj[key] : resolveAt(obj[key], baseLocation, nodeBase, depth + 1, childRole(role, key)),
          )
        }
        sensitive.add(kept)
        return kept
      }

      // Classify the ref: `$id`-internal (this document), or external (another
      // document, or a fragment resolved the legacy way against this one).
      // A resolved in-scope target, or undefined when the ref is external / an
      // anchor to look up in the target document below. Typed narrowly (never
      // `'external'`) so the later `scoped !== undefined` branches read as
      // `ScopedTarget`; the `'external'` case is handled here and never escapes.
      let scoped: ScopedTarget | undefined
      let targetLocation = baseLocation
      let fragment = ''
      if (keyword === '$recursiveRef') {
        fragment = value.startsWith('#') ? value.slice(1) : value
      } else {
        const inScope = resolveRefInScope(registry, keyword, value, nodeBase)
        if (inScope === 'external' || inScope === undefined) {
          const parts = splitRef(value)
          fragment = parts.fragment
          if (inScope === 'external' && parts.filePart !== '') {
            targetLocation = joinLocation(baseLocation, parts.filePart)
          }
        } else {
          scoped = inScope
        }
      }

      // Cache/cycle key includes the keyword (`$ref #x` and `$dynamicRef #x`
      // can bind to different targets) and, for scoped refs, the base URI (the
      // same anchor name can bind differently inside different resources).
      const cacheKey =
        scoped !== undefined
          ? `${keyword} ${baseLocation} ${nodeBase} ${value}`
          : `${keyword} ${targetLocation}#${fragment}`
      let resolved: unknown
      let pointer: JsonPath
      let targetBase = nodeBase
      const cached = refCache.get(cacheKey)
      if (cached === CYCLE) {
        // Mid-resolution revisit — a reference cycle. Keep a reference instead
        // of collapsing the branch to `{}`:
        // - target in the ROOT document → a root-relative ref (the target still
        //   exists in the resolved output);
        // - target in ANOTHER document → `#/$defs/<name>`, and the resolved
        //   target is attached there once resolution completes.
        let keptRef: string
        if (scoped !== undefined && baseLocation === rootLocation) {
          keptRef = pathToRef(scoped.pointer)
        } else if (scoped === undefined && targetLocation === rootLocation) {
          keptRef = `#${fragment}`
        } else {
          let name = hoists.get(cacheKey)
          if (name === undefined) {
            name = hoistName(targetLocation, fragment, hoistTaken)
            hoists.set(cacheKey, name)
          }
          keptRef = `#/$defs/${name}`
        }
        const kept: Record<string, unknown> = {}
        for (const key of Object.keys(obj)) {
          if (key === keyword) continue
          assignKey(kept, key, resolveAt(obj[key], baseLocation, nodeBase, depth + 1, childRole(role, key)))
        }
        // Always rewritten to a static `$ref`: the dynamic binding was already
        // decided when the cycle was entered.
        assignKey(kept, '$ref', keptRef)
        return kept
      }
      if (cached !== undefined) {
        resolved = cached.value
        pointer = cached.pointer
        targetBase = cached.base
      } else {
        refCache.set(cacheKey, CYCLE)
        let found: ResolvedTarget | undefined
        if (scoped !== undefined) {
          found = scoped
          targetBase = scoped.base
        } else {
          // `$anchor`/`$dynamicAnchor`/`$recursiveAnchor` resolve within the
          // target document — scoped by its own `$id`s where possible, falling
          // back to the document-global search. A fragment that resolves to
          // nothing inlines as `undefined` (kept as-is for parity).
          const targetRegistry = registryFor(targetLocation)
          const targetRoot = docCache.get(targetLocation) ?? {}
          if (keyword === '$recursiveRef') {
            found = resolveFragment(targetRoot, keyword, fragment)
            targetBase = targetRegistry.rootBase
          } else {
            const scopedFragment = resolveRefInScope(targetRegistry, keyword, `#${fragment}`, targetRegistry.rootBase)
            if (scopedFragment !== 'external' && scopedFragment !== undefined) {
              found = scopedFragment
              targetBase = scopedFragment.base
            } else {
              found = resolveFragment(targetRoot, keyword, fragment)
              targetBase = targetRegistry.rootBase
            }
          }
        }
        pointer = found?.pointer ?? []
        // The target is walked with the role it has where it is *defined*, so a
        // ref resolves the same way whoever points at it (see roleAtPath).
        resolved = resolveAt(found?.value, targetLocation, targetBase, depth + 1, roleAtPath(pointer))
        refCache.set(cacheKey, { value: resolved, pointer, base: targetBase })
        // Stamp the inlined node with where it was defined so a consumer can map a
        // resolved-tree node back to its source document/path. Only objects/arrays are
        // stamped (primitives can't key the map). First-write-wins: resolution recurses
        // to the deepest ref before returning, so the *definition* site stamps first;
        // an outer ref that merely points (transitively) at the same object must not
        // overwrite it with an intermediate location.
        if (origins && resolved !== null && typeof resolved === 'object' && !origins.has(resolved)) {
          origins.set(resolved, { location: targetLocation, pointer })
        }
      }

      // Inlining copies the target into *this* node's `$id` scope. A target that
      // carries a kept `$dynamicRef` (or a `$dynamicAnchor` one may bind to) only
      // means what it meant where it was defined, so when the copy would land
      // under a different base the reference is kept instead — same rule as the
      // in-memory resolver (see `dynamic-scope.ts`).
      if (isScopeSensitive(sensitive, resolved) && !inliningKeepsScope(resolved, nodeBase, targetBase)) {
        const kept: Record<string, unknown> = {}
        for (const key of Object.keys(obj)) {
          assignKey(
            kept,
            key,
            key === keyword ? obj[key] : resolveAt(obj[key], baseLocation, nodeBase, depth + 1, childRole(role, key)),
          )
        }
        sensitive.add(kept)
        return kept
      }

      const siblingKeys = Object.keys(obj).filter((key) => key !== keyword)
      if (siblingKeys.length === 0) return resolved
      const siblings: Record<string, unknown> = {}
      let siblingIsSensitive = false
      for (const key of siblingKeys) {
        const child = resolveAt(obj[key], baseLocation, nodeBase, depth + 1, childRole(role, key))
        assignKey(siblings, key, child)
        if (isScopeSensitive(sensitive, child)) siblingIsSensitive = true
      }
      // The reference node may itself be scaffolding: a schema can carry both a
      // `$dynamicAnchor` and a reference, and the anchor still has to stay in the
      // resource that registers it.
      const inlineIsSensitive =
        siblingIsSensitive ||
        isScopeSensitive(sensitive, resolved) ||
        declaresAmbiguousAnchor(obj, ambiguousDynamicAnchors)

      // Annotation-only siblings (OpenAPI Reference Objects): inline the target
      // with the annotations overriding — never wrap in `allOf`, which is not
      // valid where those references appear (Path Item, Response, Parameter).
      if (siblingKeys.every((key) => ANNOTATION_ONLY_SIBLINGS.has(key))) {
        if (resolved !== null && typeof resolved === 'object' && !Array.isArray(resolved)) {
          const overridden: Record<string, unknown> = {}
          for (const key of Object.keys(resolved)) {
            assignKey(overridden, key, (resolved as Record<string, unknown>)[key])
          }
          for (const key of Object.keys(siblings)) assignKey(overridden, key, siblings[key])
          if (origins && !origins.has(overridden)) origins.set(overridden, { location: targetLocation, pointer })
          if (inlineIsSensitive) sensitive.add(overridden)
          return overridden
        }
        // A non-object target (boolean schema, primitive) has no members to
        // override; the annotations have nowhere to live, so return the target.
        return resolved
      }

      // Keywords sibling to a reference apply alongside the referenced schema
      // (2020-12), so preserve them by combining both in an `allOf`.
      const existingAllOf = Array.isArray(siblings['allOf']) ? siblings['allOf'] : []
      const merged = { ...siblings, allOf: [...existingAllOf, resolved] }
      // Stamp the wrapper too, so origin lookups resolve for a ref-with-siblings node.
      if (origins && !origins.has(merged)) origins.set(merged, { location: targetLocation, pointer })
      if (inlineIsSensitive) sensitive.add(merged)
      return merged
    }
    const result: Record<string, unknown> = {}
    for (const key of Object.keys(obj)) {
      const child = resolveAt(obj[key], baseLocation, nodeBase, depth + 1, childRole(role, key))
      assignKey(result, key, child)
      if (isScopeSensitive(sensitive, child)) sensitive.add(result)
    }
    // A `$dynamicAnchor` a kept `$dynamicRef` might bind to is scaffolding: it
    // registers its name against the resource it sits in, so it has to stay there.
    if (isSchema && declaresAmbiguousAnchor(obj, ambiguousDynamicAnchors)) sensitive.add(result)
    return result
  }

  const rootRegistry = registryFor(rootLocation)
  // The document root is a schema; every other role follows from its keys.
  const resolved = resolveAt(docCache.get(rootLocation), rootLocation, rootRegistry.rootBase, 0, 'schema')

  // Attach cross-document cycle targets under `$defs` so every `#/$defs/<name>`
  // ref emitted by the CYCLE branch resolves within the output document.
  if (hoists.size > 0) {
    if (resolved !== null && typeof resolved === 'object' && !Array.isArray(resolved)) {
      const container = resolved as Record<string, unknown>
      const defs =
        container['$defs'] !== null && typeof container['$defs'] === 'object' && !Array.isArray(container['$defs'])
          ? (container['$defs'] as Record<string, unknown>)
          : {}
      for (const [cacheKey, name] of hoists) {
        const cached = refCache.get(cacheKey)
        assignKey(defs, name, cached !== undefined && cached !== CYCLE ? (cached.value ?? {}) : {})
      }
      assignKey(container, '$defs', defs)
    } else {
      errors.push({
        message: 'Cannot attach hoisted cycle definitions: the resolved root document is not an object',
        path: [],
      })
    }
  }

  return origins ? { resolved, errors, origins } : { resolved, errors }
}
