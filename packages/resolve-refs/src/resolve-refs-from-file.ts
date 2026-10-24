import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, relative as relativePath, resolve as resolvePath, sep } from 'node:path'

import { assertPublicHost } from './assert-public-host'
import { childRole, type NodeRole } from './child-role'
import {
  bindsAtEvaluationTime,
  declaresAmbiguousAnchor,
  inliningKeepsScope,
  isScopeSensitive,
  type ScopeSensitiveNodes,
} from './dynamic-scope'
import { getByPointer } from './get-by-pointer'
import { isContainedPath } from './is-contained-path'
import { isPrivateHost } from './is-private-host'
import { DEFAULT_MAX_DEPTH, depthLimitError } from './max-depth'
import { refPathIndex } from './ref-path-index'
import {
  ANNOTATION_ONLY_SIBLINGS,
  type Reference,
  type RefKeyword,
  type ResolvedTarget,
  readReference,
  resolveFragment,
} from './reference'
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
import { splitRef } from './split-ref'
import type { JsonPath, OriginMap, ResolveError, ResolveOptions, ResolveResult } from './types'

// A ref currently mid-resolution is marked with this sentinel; revisiting it
// means a cycle, so the reference is kept (rewritten to a root-document ref,
// hoisting the target into `$defs` when it lives in another file) instead of
// recursing forever.
const CYCLE = Symbol('cycle')
// A ref whose target does not exist. Distinct from a resolved entry so a second
// ref to the same missing target builds its own kept node instead of being
// handed the first one — siblings and all.
const MISSING = Symbol('missing')
// The inlined value, the in-document path it came from (for `origins`), and the
// `$id` base it was defined under (for the scope check in `resolveAt`).
type CacheValue = { value: unknown; pointer: JsonPath; base: string } | typeof CYCLE | typeof MISSING

// --- Document location helpers ---------------------------------------------
//
// A "location" is the absolute identity of a document: either an absolute file
// path or an absolute http(s) URL. Refs are resolved relative to the location
// of the document they appear in, so a relative ref inside a remote document
// resolves to another remote URL, and one inside a local file to another path.
// A document's `$id` never changes which file/URL a ref loads from — it only
// scopes *in-document* resolution (see resource-registry.ts).

const isRemote = (location: string): boolean => /^https?:\/\//i.test(location)

/**
 * Resolves the location of `ref` (its file/URL part) relative to `base`, or
 * `undefined` when the pair does not name a location at all.
 *
 * The `undefined` is the whole point: resolving against a *remote* base goes
 * through the URL parser, and a ref like `//[bad` throws there. That used to
 * throw straight out of `resolveRefsFromFile` — a `TypeError` from a package
 * whose headline contract is that a bad ref is collected on `errors`, never
 * thrown — for any document that merely mentioned one.
 */
const joinLocation = (base: string, ref: string): string | undefined => {
  if (isRemote(ref)) return ref
  if (isRemote(base)) {
    try {
      return new URL(ref, base).href
    } catch {
      return undefined
    }
  }
  return resolvePath(dirname(base), ref)
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

/**
 * Parses a loaded document with the caller's parser, or `JSON.parse`.
 *
 * A leading byte-order mark is dropped first. A UTF-8 BOM is an encoding
 * marker rather than content, but by the time the bytes have been decoded into
 * a JS string it is a stray `U+FEFF` sitting in front of the `{` — and
 * `JSON.parse` rejects it outright. A schema written on Windows, or served by
 * something that prepends one, is exactly the document that carries one, and
 * the whole resolve failed on it with an `Unrecognized token` that named an
 * invisible character. YAML tolerates a leading BOM too, so dropping it is
 * right for a custom `parse` as well.
 */
const parseDocument = (content: string, location: string, options: ResolveOptions): unknown => {
  const text = content.charCodeAt(0) === 0xfeff ? content.slice(1) : content
  return options.parse === undefined ? (JSON.parse(text) as unknown) : options.parse(text, location)
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
 * post-parse values, and a custom `fetch` may reach a different network), the
 * limits (so a caller asking for a smaller `maxBytes` is not handed a document
 * fetched under a larger one), and the host guards.
 *
 * The guards belong here for the same reason the credentials do. `assertPublicHost`
 * runs at fetch time only, so a call made with `allowPrivateHosts` (or an
 * `allowedHosts` entry) warmed the cache for a URL a default-options call would
 * have refused — and the later call, hitting the cache, never reached the guard.
 * A public-*looking* name pointing at a private address (`127.0.0.1.nip.io`, an
 * internal VPC record) was served straight through.
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
    options.allowPrivateHosts === true ? 'private' : 'public',
    // Sorted so two callers spelling the same allowlist in a different order
    // still share a document.
    [...(options.allowedHosts ?? [])].sort().join(','),
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

    // Parse against the original request location so the caller's format sniffing
    // (e.g. `.yaml` vs `.json`) and any relative refs key off a stable identity.
    return parseDocument(await readCapped(response, maxBytes), location, options)
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
 *
 * `refPath` is where the reference that first named this document was written
 * in the root document, so a refusal or a missing file is reported *at the
 * `$ref`* rather than at the document start. It is empty when there is no such
 * place to point at — the root document itself, or a reference that lives in
 * some other document.
 */
const loadDoc = async (
  location: string,
  docCache: Map<string, unknown>,
  options: ResolveOptions,
  errors: ResolveError[],
  deadline: number,
  refPath: JsonPath,
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
      errors.push({ message: `Refusing to resolve remote $ref (${reason}): ${location}`, path: refPath })
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
        errors.push({ message: `Failed to fetch ${location}: ${String(err)}`, path: refPath })
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
      errors.push({ message: `Failed to fetch ${location}: ${String(err)}`, path: refPath })
      docCache.set(location, {})
      return false
    } finally {
      if (owner) inFlight.delete(key)
    }
  }

  try {
    docCache.set(location, parseDocument(readFileSync(location, 'utf8'), location, options))
    return true
  } catch (err) {
    errors.push({ message: String(err), path: refPath })
    docCache.set(location, {})
    return false
  }
}

/**
 * Escapes a JSON Pointer segment (RFC 6901): `~` → `~0`, `/` → `~1`, and `%` →
 * `%25`.
 *
 * The percent step is what makes this the inverse of `getByPointer`'s
 * `decodeSegment`, which percent-decodes before unescaping tildes: without it a
 * `$defs` key containing `%41` was emitted verbatim and read back as `A`, so a
 * kept cycle `$ref` resolved to nothing in the output document.
 */
const escapeSegment = (segment: string): string => segment.replace(/~/g, '~0').replace(/\//g, '~1').replace(/%/g, '%25')

/**
 * Deep-copies a parsed-JSON subtree. Used where a node would otherwise be handed
 * back by reference: those nodes belong to a document in the process-wide
 * session cache, and the resolved tree is the caller's to mutate.
 */
const detach = (node: unknown): unknown => {
  if (node === null || typeof node !== 'object') return node
  // Iterative, because the documents this guards against are exactly the deeply
  // nested ones — a recursive copy would need a depth bound, and bounding it by
  // `maxDepth` made the depth-limit call site a guaranteed no-op.
  //
  // `seen` is what a recursive version got from its depth bound: a custom
  // `parse` can return a cyclic document (a YAML recursive anchor does exactly
  // that), and without it the walk never terminates. It also keeps shared
  // subtrees shared, as they were in the source.
  const seen = new Map<object, unknown>()
  const out: { value: unknown } = { value: undefined }
  const stack: { src: unknown; set: (value: unknown) => void }[] = [
    {
      src: node,
      set: (value) => {
        out.value = value
      },
    },
  ]
  while (stack.length > 0) {
    const frame = stack.pop()
    if (frame === undefined) break
    const { src, set } = frame
    if (src === null || typeof src !== 'object') {
      set(src)
      continue
    }
    const already = seen.get(src)
    if (already !== undefined) {
      set(already)
      continue
    }
    if (Array.isArray(src)) {
      const copy: unknown[] = new Array(src.length)
      seen.set(src, copy)
      set(copy)
      // Pushed in reverse so the LIFO stack pops them in source order.
      for (let index = src.length - 1; index >= 0; index--) {
        const at = index
        stack.push({
          src: src[at],
          set: (value) => {
            copy[at] = value
          },
        })
      }
      continue
    }
    // A custom `parse` can put a class instance in value position — js-yaml
    // yields a `Date` for a YAML timestamp — and rebuilding one as a plain
    // object empties it: `default: 2020-01-01` serialized as `default: {}`,
    // silently, with the constraint gone.
    //
    // A `Date` copies cleanly. Anything else has no general clone, so it is
    // handed back by reference: it stays aliased to the session cache, which
    // is the lesser of the two harms — a caller would have to mutate the
    // instance in place to be bitten, where emptying it corrupts the value for
    // everyone, always. `JSON.parse` output, the default and the only shape
    // that aliasing can actually bite, has no instances and never gets here.
    //
    // Either way the result goes into `seen`, so an instance reached twice
    // still comes back as one object, as it was in the source.
    const prototype = Object.getPrototypeOf(src) as object | null
    if (prototype !== Object.prototype && prototype !== null) {
      const kept = src instanceof Date ? new Date(src.getTime()) : src
      seen.set(src, kept)
      set(kept)
      continue
    }
    const copy: Record<string, unknown> = {}
    seen.set(src, copy)
    set(copy)
    // Reverse for the same reason: popping in `Object.keys` order is what keeps
    // the copy's key order identical to the source's.
    const keys = Object.keys(src)
    for (let index = keys.length - 1; index >= 0; index--) {
      const key = keys[index] as string
      stack.push({
        src: (src as Record<string, unknown>)[key],
        set: (value) => assignKey(copy, key, value),
      })
    }
  }
  return out.value
}

/**
 * Re-expresses a ref that is being *kept* so it still names the same document
 * from the output's position. The ref was written relative to the document it
 * lives in; the output is read relative to the root, so a `./c.json` kept out
 * of `sub/b.json` silently comes to mean the root's own `c.json` — a different
 * file that may well exist and resolve cleanly, which is the worst shape a
 * wrong answer can take.
 *
 * A ref with no file part (`#/$defs/x`) already means the same thing in both
 * documents, and one written in the root document never moved; both are handed
 * back untouched.
 */
const rebaseKeptRef = (value: string, from: string, root: string): string => {
  if (from === root) return value
  const { uriPart: filePart, fragment } = splitRef(value)
  // A bare fragment names a place inside *its own* document. Once the node has
  // been lifted into the root output, `#/$defs/Thing` reads against the root's
  // `$defs` — a different definition, which may well exist and resolve cleanly.
  // The document is still identified, though, so pointing the ref back at it
  // keeps the reference meaning what it meant.
  if (filePart === '') return `${renderLocation(from, root)}${value}`
  // A ref carrying a scheme is absolute: it names the same thing from any
  // document, so there is nothing to rebase — and `joinLocation` would resolve
  // a non-http one like `urn:example:common` as a relative path, producing the
  // nonsense `./sub/urn:example:common`. Two-plus characters before the colon,
  // so a Windows drive letter is not mistaken for a scheme.
  if (/^[a-zA-Z][a-zA-Z0-9+.-]+:/.test(filePart)) return value
  const target = joinLocation(from, filePart)
  // A ref that names no location has nothing to rebase onto, so it is handed
  // back exactly as the author wrote it.
  if (target === undefined) return value
  const suffix = value.includes('#') ? `#${fragment}` : ''
  return `${renderLocation(target, root)}${suffix}`
}

/** How a document's location is written from the root document's position. */
const renderLocation = (target: string, root: string): string => {
  // A remote target is absolute already, and so is the only sane form when the
  // root is itself remote. A local pair becomes a path relative to the root's
  // directory, which keeps machine-specific absolute paths out of the output.
  if (isRemote(target) || isRemote(root)) return target
  const relative = relativePath(dirname(root), target).split(sep).join('/')
  return relative.startsWith('.') ? relative : `./${relative}`
}

/**
 * Rewrites every `$ref` in an already-detached subtree so it still names the
 * document it was written against once the subtree sits in the root output.
 * A no-op when the subtree came from the root document itself.
 *
 * Only for subtrees handed back wholesale — the depth limit — where no
 * per-node resolution ran to rebase them one at a time.
 */
const rebaseKeptRefs = (node: unknown, from: string, root: string, role: NodeRole): unknown => {
  if (from === root || node === null || typeof node !== 'object') return node
  // Role-aware, like the resolver itself: a `$ref` key inside `enum`, `const`,
  // `default` or `examples` belongs to an instance value that merely has a
  // property spelled that way, and rewriting it changes the literal the schema
  // declares. Inside a `properties`-style map the keys are names, so `$ref`
  // there is a property called `$ref`, not a reference either.
  // `detach` preserves cycles and shared subtrees on purpose (a YAML recursive
  // anchor is one), so this walk needs its own visited set: without it a cyclic
  // document loops forever — and a cyclic document always trips the depth limit,
  // which is the only way to get here — while a subtree reached from two parents
  // has its refs rebased twice, turning `./c.json` into `./sub/sub/c.json`.
  const seen = new Set<object>()
  const stack: { value: unknown; role: NodeRole }[] = [{ value: node, role }]
  while (stack.length > 0) {
    const current = stack.pop()
    if (current === undefined) break
    const { value: current_, role: currentRole } = current
    if (current_ === null || typeof current_ !== 'object') continue
    if (currentRole === 'value') continue
    if (seen.has(current_)) continue
    seen.add(current_)
    if (Array.isArray(current_)) {
      for (let index = 0; index < current_.length; index++) {
        stack.push({ value: current_[index], role: childRole(currentRole, index) })
      }
      continue
    }
    // `detach` hands a non-plain-prototype object back by reference (there is
    // no general clone for one), and that object may live in the process-wide
    // remote-document cache. Writing a rebased `$ref` into it would rewrite the
    // cached document for every later resolve in the process — which would then
    // rebase it a second time, against a different root. A class instance is
    // not a schema node anyway, so the walk stops at one.
    const prototype: unknown = Object.getPrototypeOf(current_)
    if (prototype !== Object.prototype && prototype !== null) continue
    const obj = current_ as Record<string, unknown>
    const isSchema = currentRole !== 'schemaMap'
    for (const [key, value] of Object.entries(obj)) {
      // `$ref` only: see `keepScopedReference` for why an anchor-form
      // `$dynamicRef` must not be qualified with a document.
      if (isSchema && key === '$ref' && typeof value === 'string') {
        assignKey(obj, key, rebaseKeptRef(value, from, root))
      } else {
        stack.push({ value, role: childRole(currentRole, key) })
      }
    }
  }
  return node
}

/** Renders a {@link JsonPath} as a `#/...` ref string. */
const pathToRef = (path: JsonPath): string =>
  path.length === 0 ? '#' : `#/${path.map((segment) => escapeSegment(String(segment))).join('/')}`

/** The members a document keeps its named definitions under, from its root. */
const DEFINITION_CONTAINERS: readonly (readonly string[])[] = [['$defs'], ['definitions'], ['components', 'schemas']]

/**
 * How many leading segments of `pointer` name the definition the target sits
 * *inside* (`$defs/Order` for `/$defs/Order/properties/lines/items`), or 0 when it
 * is a definition itself or sits in none.
 *
 * Bundling hoists that enclosing definition and points into it, rather than
 * lifting the inner node out on its own: the output then has the shape the same
 * schemas would have written in one file, and a generator names the node from its
 * path (`OrderLinesItems`) the way it would there, instead of from a bare `items`.
 */
const enclosingDefinitionLength = (pointer: JsonPath): number => {
  for (const container of DEFINITION_CONTAINERS) {
    const length = container.length + 1
    if (pointer.length > length && container.every((key, index) => pointer[index] === key)) return length
  }
  return 0
}

/** How a name is compared for collisions: as written, unless `keyOf` says otherwise. */
const asWritten = (name: string): string => name

/**
 * How bundling compares definition names: the way a code generator files them.
 * `refToFilename` in `@amritk/helpers` kebab-cases a name, so `Money` and `money`
 * (or `#/definitions/Money` and `#/$defs/Money`) become one file; comparing names
 * case- and punctuation-blind catches every such pair, at the cost of an
 * occasional suffix a generator would not have needed.
 */
const asFilename = (name: string): string => name.toLowerCase().replace(/[^a-z0-9]/g, '')

/** The members that hold nested definitions a generator emits a type for. */
const NAME_CONTAINERS = ['$defs', 'definitions'] as const

/** The members `refToFilename` (in `@amritk/helpers`) reads a nested name through. */
const POINTER_NAME_CONTAINERS = new Set(['$defs', 'definitions', 'properties'])

/**
 * The name a generator files the target of the internal pointer `pointer` under,
 * mirroring `refToFilename`'s `pointerNameParts`: the last segment, and each
 * earlier one a name container introduced (`/$defs/Order/properties/money` is
 * `Order-money`, `/components/schemas/User` is `User`).
 */
const generatedName = (pointer: string): string => {
  const segments = pointer.split('/').filter((segment) => segment !== '')
  const named = segments
    .map((segment, index) => ({
      segment,
      nested: index > 0 && POINTER_NAME_CONTAINERS.has(segments[index - 1] as string),
    }))
    .filter(({ segment }) => !POINTER_NAME_CONTAINERS.has(segment))
  return named
    .filter((part, index) => part.nested || index === named.length - 1)
    .map(({ segment }) => segment)
    .join('-')
}

/** Every internal pointer a `$ref` in `root` names, once each. Iterative; depth-capped and cycle-safe. */
const internalPointers = (root: unknown): Set<string> => {
  const pointers = new Set<string>()
  const seen = new WeakSet<object>()
  const stack: { value: unknown; depth: number }[] = [{ value: root, depth: 0 }]
  while (stack.length > 0) {
    const { value, depth } = stack.pop() as (typeof stack)[number]
    if (value === null || typeof value !== 'object' || seen.has(value) || depth > DEFAULT_MAX_DEPTH) continue
    seen.add(value)
    const ref = (value as { $ref?: unknown }).$ref
    if (typeof ref === 'string' && ref.startsWith('#/')) pointers.add(ref.slice(1))
    for (const member of Object.values(value)) stack.push({ value: member, depth: depth + 1 })
  }
  return pointers
}

/**
 * Every name a generator could file a definition in `map` under: each member,
 * and each definition nested in one through a name container, joined to its
 * parents' names the way `refToFilename` joins them (`#/$defs/user/$defs/meta` is
 * `user-meta`). Walked iteratively and at most
 * {@link DEFAULT_MAX_DEPTH} deep, each map once: a parsed document can be cyclic
 * (a YAML recursive anchor) or reach one map through several parents.
 */
const nestedDefinitionNames = (map: Record<string, unknown>): string[] => {
  const names: string[] = []
  const seen = new WeakSet<object>()
  const stack: { prefix: string; map: Record<string, unknown>; depth: number }[] = [{ prefix: '', map, depth: 0 }]
  while (stack.length > 0) {
    const { prefix: parent, map: current, depth } = stack.pop() as (typeof stack)[number]
    if (seen.has(current) || depth > DEFAULT_MAX_DEPTH) continue
    seen.add(current)
    for (const [key, value] of Object.entries(current)) {
      const name = parent === '' ? key : `${parent}-${key}`
      names.push(name)
      for (const nested of containedNameMaps(value)) stack.push({ prefix: name, map: nested, depth: depth + 1 })
    }
  }
  return names
}

/** The name containers (`$defs`, `definitions`) a schema holds. */
const containedNameMaps = (schema: unknown): Record<string, unknown>[] =>
  schema === null || typeof schema !== 'object' || Array.isArray(schema)
    ? []
    : NAME_CONTAINERS.map((container) => (schema as Record<string, unknown>)[container]).filter(
        (map): map is Record<string, unknown> => map !== null && typeof map === 'object' && !Array.isArray(map),
      )

/** Derives a readable `$defs` key for a hoisted cycle target. */
const hoistName = (
  targetLocation: string,
  fragment: string,
  taken: Set<string>,
  keyOf: (name: string) => string = asWritten,
): string => {
  const fragmentTail = fragment.split('/').filter(Boolean).pop()
  const locationTail = targetLocation
    .split('/')
    .filter(Boolean)
    .pop()
    ?.replace(/\.[a-z0-9]+$/i, '')
  const raw = fragmentTail || locationTail || 'cycle'
  const sanitized = raw.replace(/[^A-Za-z0-9_.-]/g, '-') || 'cycle'
  let name = sanitized
  for (let n = 2; taken.has(keyOf(name)); n++) name = `${sanitized}-${n}`
  taken.add(keyOf(name))
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
  // Locations that were refused or could not be read. They are cached as `{}`
  // like any other document, so `docCache` alone cannot tell them apart — and a
  // ref into one must not be reported a second time as an unresolvable fragment.
  const unloadable = new Set<string>()
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
  // subject to the confinement it defines. A caller that already parsed it
  // hands the value over instead, and the read and parse are skipped — for a
  // large spec that second parse was the single most expensive step of a run.
  if (options.rootDocument !== undefined) {
    docCache.set(rootLocation, options.rootDocument)
  } else if (!(await loadDoc(rootLocation, docCache, options, errors, deadline, []))) {
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

  // Where a reference was written in the root document, for the errors that
  // name one. Built on first use, so a clean resolve never walks for it — and
  // built once, so a document full of broken references stays linear.
  const refPathAt = refPathIndex(docCache.get(rootLocation), maxDepth)

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
    out: Map<string, Reference>,
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
        const { uriPart: filePart } = splitRef(reference.value)
        // First reference wins: it is the one a reader finds first, and it is
        // the one whose position a load failure is reported at.
        if (filePart !== '' && !out.has(filePart)) out.set(filePart, reference)
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
      const out = new Map<string, Reference>()
      collectRefTargets(docCache.get(location), location, registryFor(location).rootBase, out, 0, 'schema')
      for (const [filePart, reference] of out) {
        // Only a reference written in the root document has a position a
        // consumer can map back to a place in the document it handed us; one
        // inside a document we loaded on its behalf does not, so it reports
        // without a path exactly as it always has.
        const refPath = location === rootLocation ? refPathAt(reference.keyword, reference.value) : []
        const target = joinLocation(location, filePart)
        if (target === undefined) {
          errors.push({
            message: `Refusing to load $ref "${filePart}": it does not name a valid location`,
            path: refPath,
          })
          continue
        }
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
            errors.push({ message: `Refusing to read local $ref (${reason}): ${target}`, path: refPath })
            docCache.set(target, {})
            unloadable.add(target)
            continue
          }
        }
        loaded++
        if (!(await loadDoc(target, docCache, options, errors, deadline, refPath))) unloadable.add(target)
        queue.push(target)
      }
    }
  }

  await prefetch()

  // Everything below runs as a pass, so bundling can run it again. A document
  // embedded as a resource can turn out to hold a cycle through a target with no
  // URI, which nothing inside that resource can name; the next pass inlines that
  // document instead, as a resolve without `bundle` does. Errors and the depth
  // report from the pass that gave up are dropped with it.
  const errorsBeforeResolve = errors.length
  const depthReportedBeforeResolve = depthLimitReported
  const resolvePass = (inlineOnly: ReadonlySet<string>): { result: ResolveResult; unplaceable: Set<string> } => {
    // Embedded documents whose resource met a cycle it cannot name (see above).
    const unplaceable = new Set<string>()
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
    // Seeded with the root's own `$defs` keys. `hoistName` derives a name from the
    // ref's fragment or file basename, so `b.json` collided with a root definition
    // already called `b` — and the hoist then overwrote it, silently re-pointing
    // every kept `#/$defs/b` cycle ref at the wrong schema.
    const rootDoc = docCache.get(rootLocation)
    // Bundling also seeds the root's other definition maps, compared as a generator
    // files them (see `asFilename`): a hoisted `Money` beside a root `definitions/Money`
    // is one type file. Inlining keeps exact names, so its output is unchanged.
    const nameKey = options.bundle === true ? asFilename : asWritten
    const definitionNames = (root: unknown): string[] =>
      (options.bundle === true ? DEFINITION_CONTAINERS : [['$defs']]).flatMap((container) => {
        const map = getByPointer(root, `/${container.join('/')}`)
        if (map === null || typeof map !== 'object' || Array.isArray(map)) return []
        return options.bundle === true ? nestedDefinitionNames(map as Record<string, unknown>) : Object.keys(map)
      })
    // Bundling also claims what the root's own pointer refs are filed under, since a
    // generator emits a type for each (`#/$defs/Order/properties/lines` is `Order-lines`).
    const rootRefNames = (root: unknown): string[] =>
      options.bundle === true ? [...internalPointers(root)].map(generatedName) : []
    const rootNames = [...definitionNames(rootDoc), ...rootRefNames(rootDoc)]
    const hoistTaken = new Set<string>(rootNames.map(nameKey))
    // Every node carrying a `#/$defs/<name>` ref the CYCLE branch emitted, paired
    // with the hoist it names. The seeding above reads the *source* root, but the
    // hoists land in the *resolved* root's `$defs` — and under a pure-`$ref` root
    // (`{"$ref": "./b.json"}`) those are two different documents, so a name free
    // in one can already be taken in the other. The final check happens against
    // the object actually written to, which means a name can still change after
    // it has been emitted; these sites are how it gets rewritten instead of
    // stranding a ref that points at nothing.
    const hoistRefSites = new Map<Record<string, unknown>, string>()
    // The part of a bundled ref past its hoist's name, for a ref that points inside
    // a hoisted definition (see `enclosingDefinitionLength`); the rename keeps it.
    const hoistRefSuffixes = new Map<Record<string, unknown>, string>()

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
    /**
     * Builds a node that keeps its reference: the keyword is preserved and every
     * sibling resolves as usual. This is the one place that shape is built, for
     * every branch that needs it — a `$dynamicRef` that binds at evaluation time,
     * a scope-sensitive target that inlining would re-base, a ref whose target
     * could not be resolved. They used to be written out separately, and the
     * rebase added to one was missing from another for a round.
     *
     * A kept relative `$ref` has to be re-expressed against the root document, or
     * `./c.json` kept out of `sub/b.json` comes to name the root's own c.json.
     * `$ref` only: `$dynamicRef` and `$recursiveRef` carry an anchor name rather
     * than a location — `#meta` is the whole legal spelling — so qualifying one
     * with a document turns a soft kept reference into a value no consumer can
     * resolve (`@amritk/helpers` throws outright).
     */
    const keepScopedReference = (
      obj: Record<string, unknown>,
      keyword: string,
      baseLocation: string,
      nodeBase: string,
      depth: number,
      role: NodeRole,
    ): Record<string, unknown> => {
      const kept: Record<string, unknown> = {}
      for (const key of Object.keys(obj)) {
        const value = obj[key]
        assignKey(
          kept,
          key,
          key !== keyword
            ? resolveAt(value, baseLocation, nodeBase, depth + 1, childRole(role, key))
            : keyword === '$ref' && typeof value === 'string'
              ? rebaseKeptRef(value, baseLocation, rootLocation)
              : value,
        )
      }
      return kept
    }

    /**
     * Finds what a classified reference points at: the in-scope target when the
     * ref resolved against an `$id` in its own document, otherwise the fragment
     * looked up in the target document. `$anchor`/`$dynamicAnchor`/
     * `$recursiveAnchor` resolve within the target document — scoped by its own
     * `$id`s where possible, falling back to the document-global search. Returns
     * the base URI the target's own refs resolve against.
     */
    const lookupTarget = (
      scoped: ScopedTarget | undefined,
      keyword: RefKeyword,
      targetLocation: string,
      fragment: string,
    ): { found: ResolvedTarget | undefined; base: string } => {
      if (scoped !== undefined) return { found: scoped, base: scoped.base }
      const targetRegistry = registryFor(targetLocation)
      const targetRoot = docCache.get(targetLocation) ?? {}
      if (keyword === '$recursiveRef') {
        return { found: resolveFragment(targetRoot, keyword, fragment), base: targetRegistry.rootBase }
      }
      const scopedFragment = resolveRefInScope(targetRegistry, keyword, `#${fragment}`, targetRegistry.rootBase)
      if (scopedFragment !== 'external' && scopedFragment !== undefined) {
        return { found: scopedFragment, base: scopedFragment.base }
      }
      return { found: resolveFragment(targetRoot, keyword, fragment), base: targetRegistry.rootBase }
    }

    /**
     * The embedded resources the walk is placing output inside, innermost last, by
     * base URI: any node with an `$id` below the root, a hoisted document that keeps
     * its `$id`, and whatever is inlined into either. Empty while output lands in the
     * root's own resource, where a `#/...` ref reads from the output document's root;
     * inside one, `#` names that resource instead. Only `bundle` reads it: inlining
     * never writes a ref that depends on where it lands. Kept by {@link resolveAt}.
     */
    const placements: string[] = []

    // Absolute `$id`s already embedded by bundling, to the document each came from.
    // A second document claiming one keeps the inlining behavior — it carries the
    // same `$id` either way, so the input is ambiguous, and embedding it too would
    // only add a second resource every URI ref to that id could mean.
    const embeddedIds = new Map<string, string>()
    // Ids a second document claimed after the first was embedded. A ref by such an
    // id would name either resource, so a ref from the root's resource that named an
    // embedded document by URI is pointed at its hoist instead (see the attach).
    const contestedIds = new Set<string>()
    // Root-resource refs that name an embedded document by URI: the node, the hoist
    // it lives in, the document's id, and the pointer to the target inside it.
    const uriRefSites = new Map<Record<string, unknown>, { key: string; id: string; suffix: string }>()

    // What each bundling hoist holds: the document and the pointer hoisted. A
    // definition of a document that is also hoisted whole is already inside that
    // hoist, so it is pointed at there instead of attached a second time.
    const hoistTargets = new Map<string, { location: string; pointer: JsonPath }>()

    /** Whether a document's root declares an `$id` at all. */
    const declaresRootId = (location: string): boolean => {
      const root = docCache.get(location)
      return (
        root !== null &&
        typeof root === 'object' &&
        !Array.isArray(root) &&
        typeof (root as { $id?: unknown }).$id === 'string'
      )
    }

    /**
     * The absolute `$id` a document declares at its root, or `undefined`. Only a
     * literal absolute one: embedded under the root's `$defs`, a relative `$id`
     * would resolve against the output root's base instead of the location the
     * document was read from, and name a different resource.
     */
    const absoluteRootId = (location: string): string | undefined => {
      const root = docCache.get(location)
      if (root === null || typeof root !== 'object' || Array.isArray(root)) return undefined
      const id = (root as Record<string, unknown>)['$id']
      if (typeof id !== 'string' || !/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(id)) return undefined
      return registryFor(location).rootBase
    }

    /**
     * An absolute URI naming the node at `pointer` in `location`: the base of the
     * resource it sits in, plus the pointer from that resource's root. `undefined`
     * unless the output declares that base as an `$id`: the synthetic base a local
     * document without one resolves against names nothing, and a remote document's
     * URL names a document that is not in the output.
     */
    const uriFor = (location: string, base: string, pointer: JsonPath): string | undefined => {
      if (base.startsWith(SYNTHETIC_BASE)) return undefined
      const registry = registryFor(location)
      const declared = base === registry.rootBase ? absoluteRootId(location) === base : registry.resources.has(base)
      if (!declared) return undefined
      const resourcePointer = base === registry.rootBase ? [] : registry.resources.get(base)?.pointer
      if (resourcePointer === undefined || resourcePointer.some((segment, index) => pointer[index] !== segment)) {
        return undefined
      }
      const inner = pointer.slice(resourcePointer.length)
      return inner.length === 0 ? base : `${base}${pathToRef(inner)}`
    }

    /** The absolute URI of a cycle's target, for closing it from inside a resource. */
    const cycleTargetUri = (
      scoped: ScopedTarget | undefined,
      keyword: RefKeyword,
      targetLocation: string,
      fragment: string,
    ): string | undefined => {
      const { found, base } = lookupTarget(scoped, keyword, targetLocation, fragment)
      return found === undefined ? undefined : uriFor(targetLocation, base, found.pointer)
    }

    /**
     * Registers (once) and resolves (once) the hoist a bundled ref into another
     * document needs: the enclosing definition for a target inside one in a document
     * without an `$id`, the target itself otherwise in such a document, and the whole
     * document when it keeps its `$id`. Returns its key, name and hoisted pointer.
     */
    const hoistFor = (
      targetLocation: string,
      found: ResolvedTarget,
      targetBase: string,
      plain: boolean,
      depth: number,
    ): { key: string; name: string; pointer: JsonPath } => {
      // A document already hoisted whole holds every definition in it, so a ref into
      // one points inside that hoist instead of resolving the definition again.
      const wholeHoisted = plain && hoists.has(`$ref ${targetLocation}#`)
      const split = plain && !wholeHoisted ? enclosingDefinitionLength(found.pointer) : 0
      const pointer = plain && !wholeHoisted ? (split > 0 ? found.pointer.slice(0, split) : found.pointer) : []
      // Keyed by where the target is — its document and pointer — not by how the
      // ref spells it: `./common.json#/$defs/T` written in the root and `#/$defs/T`
      // written inside common.json are one definition, and keyed by spelling they
      // were hoisted twice, the second named after the file.
      const key = `$ref ${targetLocation}${pathToRef(pointer)}`
      const name = hoists.get(key) ?? hoistName(targetLocation, pathToRef(pointer).slice(1), hoistTaken, nameKey)
      hoists.set(key, name)
      hoistTargets.set(key, { location: targetLocation, pointer })
      // `CYCLE` while the target is being resolved further up this walk: its hoist is
      // registered above, so a ref back into it only has to name it.
      if (!refCache.has(key)) {
        refCache.set(key, CYCLE)
        const whole = pointer.length === found.pointer.length
        // Bundling copies a node's members over unchanged (only `$ref` values are
        // rewritten), so a pointer past the hoist still leads to the target in it.
        const value = whole ? found.value : getByPointer(docCache.get(targetLocation), pathToRef(pointer).slice(1))
        const base = whole ? targetBase : registryFor(targetLocation).rootBase
        const resolved = resolveAt(value, targetLocation, base, depth + 1, roleAtPath(pointer))
        refCache.set(key, { value: resolved, pointer, base })
        if (origins && resolved !== null && typeof resolved === 'object' && !origins.has(resolved)) {
          origins.set(resolved, { location: targetLocation, pointer })
        }
      }
      return { key, name, pointer }
    }

    /**
     * The `bundle` option's answer for a `$ref`: a node that keeps its reference,
     * pointing into the output instead of copying the target in, or `undefined` when
     * the ref has to be inlined after all.
     *
     * Where the target goes:
     * - in the root document, it stays where it is (the root is walked whole);
     * - in a document with no `$id`, it is hoisted into the root's `$defs` as a
     *   plain definition (the enclosing one, for a target inside a definition);
     * - in a document with an absolute root `$id`, the whole document is embedded
     *   under the root's `$defs` with that `$id` kept, so every `#...` pointer
     *   inside it still reads against it — how JSON Schema bundles a resource.
     *
     * What the ref says depends on where it lands. In the root's own resource a
     * `#/...` pointer reaches anything in the output. Inside an embedded resource
     * `#` names that resource, so a ref there is kept as written only when it lands
     * in the very resource it was written in and its target is there too; otherwise
     * it names its target by absolute URI when the target's resource has one, and is
     * inlined when it has none — there is no name that reads the same from there.
     */
    const bundleReference = (
      obj: Record<string, unknown>,
      value: string,
      scoped: ScopedTarget | undefined,
      targetLocation: string,
      fragment: string,
      cacheKey: string,
      refKey: string,
      baseLocation: string,
      nodeBase: string,
      depth: number,
      role: NodeRole,
    ): Record<string, unknown> | undefined => {
      const placedIn = placements.at(-1)
      const siteInRoot = placedIn === undefined && nodeBase === registryFor(baseLocation).rootBase
      const intoRoot = scoped !== undefined ? baseLocation === rootLocation : targetLocation === rootLocation
      // No `$id` anywhere: the registry records a base only where one changes, so a
      // document whose root `$id` is the URL it was read from records none.
      const plain = !intoRoot && registryFor(targetLocation).bases.size === 0 && !declaresRootId(targetLocation)
      const embeddedId = intoRoot || plain ? undefined : absoluteRootId(targetLocation)
      // A target in a document whose `$id`s cannot be carried over keeps the inlining
      // behavior; so does a plain target reached from inside a resource.
      if (!intoRoot && !plain) {
        if (embeddedId === undefined || inlineOnly.has(targetLocation)) return undefined
        const claimedBy = embeddedIds.get(embeddedId)
        if (registryFor(rootLocation).resources.has(embeddedId) || (claimedBy ?? targetLocation) !== targetLocation) {
          if (claimedBy !== undefined && claimedBy !== targetLocation) contestedIds.add(embeddedId)
          return undefined
        }
      }
      if (plain && !siteInRoot) return undefined
      if (refCache.get(cacheKey) === MISSING || refCache.get(refKey) === MISSING)
        return keepScopedReference(obj, '$ref', baseLocation, nodeBase, depth, role)

      const { found, base: targetBase } = lookupTarget(scoped, '$ref', targetLocation, fragment)
      // Same keep-and-report rules as inlining (see the long note there).
      const targetLoaded = docCache.has(targetLocation) && !unloadable.has(targetLocation)
      if (found === undefined || !targetLoaded) {
        if (targetLoaded) {
          errors.push({
            message: `Cannot resolve $ref "${value}"`,
            path: baseLocation === rootLocation ? refPathAt('$ref', value) : [],
          })
        }
        // A target is missing wherever it lands, so it is reported once (see `refKey`).
        refCache.set(cacheKey, MISSING)
        refCache.set(refKey, MISSING)
        return keepScopedReference(obj, '$ref', baseLocation, nodeBase, depth, role)
      }
      // The ref lands in the resource it was written in, and names something there,
      // so it means the same thing where it lands: that resource is carried over
      // whole with its `$id`. Content inlined into another resource is not.
      // Only a `#...` ref, or one resolved by `$id`, reads that way: a file part
      // resolves against the `$id` there, not against the file it was read from.
      const sameResource =
        placedIn !== undefined &&
        placedIn === nodeBase &&
        nodeBase === targetBase &&
        baseLocation === targetLocation &&
        (scoped !== undefined || splitRef(value).uriPart === '')
      // A target inside an embedded resource is named by its URI from anywhere: a
      // `#/...` pointer that runs from the root into a resource with its own `$id` is
      // one JSON Schema does not promise to resolve. Outside the root's resource a
      // `#` names that resource, so a target there is named by URI too. A target with
      // none is inlined, decided before anything is hoisted or claimed for it.
      const byUri = !sameResource && (!siteInRoot || embeddedId !== undefined)
      const uri = byUri ? uriFor(targetLocation, targetBase, found.pointer) : undefined
      if (byUri && uri === undefined) return undefined
      if (embeddedId !== undefined) embeddedIds.set(embeddedId, targetLocation)
      const hoist = intoRoot ? undefined : hoistFor(targetLocation, found, targetBase, plain, depth)
      const named = hoist !== undefined && plain && siteInRoot
      const suffix = named ? pathToRef(found.pointer.slice(hoist.pointer.length)).slice(1) : ''
      // Into the root, from its own resource: a ref resolved by `$id` or anchor, or
      // written as a `#` pointer, reads the same where it is, so it is kept as
      // written; one naming the root document by its file becomes a pointer.
      const target =
        uri ??
        (sameResource
          ? value
          : named
            ? `#/$defs/${hoist.name}${suffix}`
            : scoped !== undefined || value.startsWith('#')
              ? value
              : pathToRef(found.pointer))

      const kept: Record<string, unknown> = {}
      for (const key of Object.keys(obj)) {
        assignKey(
          kept,
          key,
          key === '$ref' ? target : resolveAt(obj[key], baseLocation, nodeBase, depth + 1, childRole(role, key)),
        )
      }
      // A ref naming its hoist by name is registered so the final rename (see the
      // hoist attach below) reaches it; one naming a URI or written as is is not.
      if (named) {
        hoistRefSites.set(kept, hoist.key)
        if (suffix !== '') hoistRefSuffixes.set(kept, suffix)
      }
      if (siteInRoot && hoist !== undefined && embeddedId !== undefined) {
        uriRefSites.set(kept, { key: hoist.key, id: embeddedId, suffix: pathToRef(found.pointer).slice(1) })
      }
      // Scaffolding for a dynamic reference stays where it binds, as on every other
      // path that builds a node (see `dynamic-scope.ts`).
      if (
        Object.values(kept).some((child) => isScopeSensitive(sensitive, child)) ||
        declaresAmbiguousAnchor(obj, ambiguousDynamicAnchors)
      ) {
        sensitive.add(kept)
      }
      return kept
    }

    /**
     * {@link resolveNode}, keeping track of {@link placements}: while bundling, a
     * schema with an `$id` anywhere but the output's root starts a resource of its
     * own, and everything under it — inlined targets included — lands in that
     * resource.
     */
    const resolveAt = (node: unknown, baseLocation: string, base: string, depth: number, role: NodeRole): unknown => {
      const entersResource =
        options.bundle === true &&
        role !== 'value' &&
        role !== 'schemaMap' &&
        node !== null &&
        typeof node === 'object' &&
        !Array.isArray(node) &&
        typeof (node as Record<string, unknown>)['$id'] === 'string' &&
        // Draft-07's `#Foo` names a location, not a resource, wherever it lands.
        splitRef((node as Record<string, unknown>)['$id'] as string).uriPart !== '' &&
        !(depth === 0 && baseLocation === rootLocation)
      // Nor does an `$id` naming the base the output is already in, so a `#` under
      // it still reads as before.
      const nodeBase = entersResource
        ? baseOfNode(registryFor(baseLocation), node as Record<string, unknown>, base)
        : base
      if (!entersResource || nodeBase === (placements.at(-1) ?? registryFor(rootLocation).rootBase)) {
        return resolveNode(node, baseLocation, base, depth, role)
      }
      placements.push(nodeBase)
      try {
        return resolveNode(node, baseLocation, base, depth, role)
      } finally {
        placements.pop()
      }
    }

    const resolveNode = (node: unknown, baseLocation: string, base: string, depth: number, role: NodeRole): unknown => {
      if (node === null || typeof node !== 'object') return node
      // Instance data (`enum`, `const`, `default`, `examples`): a `$ref` key in
      // here belongs to the value, so the subtree is handed back untouched.
      //
      // Copied, not aliased. Every other branch builds fresh objects, but these
      // two returned a subtree of the parsed document by reference — and for a
      // remote document that lives in the process-wide session cache, so a caller
      // mutating its own result (pushing onto a resolved `enum`) corrupted the
      // cached copy every later resolve in the process would be handed.
      if (role === 'value') return detach(node)
      if (depth > maxDepth) {
        // Past the limit we hand the subtree back instead of unwinding the stack
        // with a RangeError. Nothing is lost — the branch simply keeps its
        // `$ref`s — and the failure is on `errors` where callers look.
        //
        // Those kept refs still have to mean what they meant, though: the
        // subtree is being lifted into a root-based output, so a relative
        // `./c.json` written in `sub/b.json` would come to name the root's own
        // `c.json`. Same rebasing `keepScopedReference` does, for the same reason.
        reportDepthLimit()
        return rebaseKeptRefs(detach(node), baseLocation, rootLocation, role)
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
          const kept = keepScopedReference(obj, keyword, baseLocation, nodeBase, depth, role)
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
            if (inScope === 'external' && parts.uriPart !== '') {
              const target = joinLocation(baseLocation, parts.uriPart)
              // A ref that names no location names no document we could load, and
              // `prefetch` already recorded why. Keep it rather than resolving it
              // against the referencing document by accident.
              if (target === undefined) return keepScopedReference(obj, keyword, baseLocation, nodeBase, depth, role)
              targetLocation = target
            }
          } else {
            scoped = inScope
          }
        }

        // Cache/cycle key includes the keyword (`$ref #x` and `$dynamicRef #x`
        // can bind to different targets) and, for scoped refs, the base URI (the
        // same anchor name can bind differently inside different resources).
        //
        // While bundling, what a target resolves to also depends on where it lands:
        // its own bundled refs are `#/...` pointers in the root's resource, and URIs
        // or inlined copies inside an embedded one. One entry for both would hand a
        // copy made for one place to the other.
        const refKey =
          scoped !== undefined
            ? `${keyword} ${baseLocation} ${nodeBase} ${value}`
            : `${keyword} ${targetLocation}#${fragment}`
        const placedIn = options.bundle === true ? placements.at(-1) : undefined
        const cacheKey = placedIn === undefined ? refKey : `${refKey} (in ${placedIn})`
        if (options.bundle === true && keyword === '$ref') {
          const bundled = bundleReference(
            obj,
            value,
            scoped,
            targetLocation,
            fragment,
            cacheKey,
            refKey,
            baseLocation,
            nodeBase,
            depth,
            role,
          )
          if (bundled !== undefined) return bundled
        }
        let resolved: unknown
        let pointer: JsonPath
        let targetBase = nodeBase
        // Missing is missing wherever the target lands: reported once, by `refKey`.
        const cached = refCache.get(cacheKey) ?? (refCache.get(refKey) === MISSING ? MISSING : undefined)
        if (cached === CYCLE) {
          // Mid-resolution revisit — a reference cycle. Keep a reference instead
          // of collapsing the branch to `{}`:
          // - target in the ROOT document → a root-relative ref (the target still
          //   exists in the resolved output);
          // - target in ANOTHER document → `#/$defs/<name>`, and the resolved
          //   target is attached there once resolution completes.
          // While bundling inside an embedded resource, `#...` names that resource, so
          // the cycle is closed by the target's URI where it has one. Without one
          // it falls through to the pointer inlining has always written.
          const cycleUri =
            placedIn === undefined ? undefined : cycleTargetUri(scoped, keyword, targetLocation, fragment)
          // Every embedded document on the way here is marked: inlining only the
          // innermost lands the cycle in the next one out, which then meets it too.
          if (placedIn !== undefined && cycleUri === undefined) {
            for (const base of placements) {
              const embeddedAt = embeddedIds.get(base)
              if (embeddedAt !== undefined) unplaceable.add(embeddedAt)
            }
          }
          let keptRef: string
          let hoisted = false
          if (cycleUri !== undefined) {
            keptRef = cycleUri
          } else if (scoped !== undefined && baseLocation === rootLocation) {
            keptRef = pathToRef(scoped.pointer)
          } else if (scoped === undefined && targetLocation === rootLocation) {
            keptRef = `#${fragment}`
          } else {
            let name = hoists.get(cacheKey)
            if (name === undefined) {
              name = hoistName(targetLocation, fragment, hoistTaken, nameKey)
              hoists.set(cacheKey, name)
            }
            hoisted = true
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
          if (hoisted) hoistRefSites.set(kept, cacheKey)
          return kept
        }
        if (cached === MISSING) return keepScopedReference(obj, keyword, baseLocation, nodeBase, depth, role)
        if (cached !== undefined) {
          resolved = cached.value
          pointer = cached.pointer
          targetBase = cached.base
        } else {
          refCache.set(cacheKey, CYCLE)
          const lookup = lookupTarget(scoped, keyword, targetLocation, fragment)
          const found = lookup.found
          targetBase = lookup.base
          // A fragment that resolves to nothing *within a document that loaded* —
          // a typo'd pointer, an anchor that was renamed. This inlined literal
          // `undefined`, so the key vanished on serialization and a required
          // property silently lost every constraint it had, with nothing on
          // `errors` to say so. Match `resolveRefs`: record it and keep the node.
          //
          // The *keep* is unconditional; only the report is scoped. A refused or
          // unreadable document used to fall through to inlining `undefined`,
          // which serializes to nothing inside an object — the referencing node's
          // every constraint gone — and to `null` inside an array, so an
          // `allOf: [{ $ref: <refused> }]` became `allOf: [null]`, not a schema at
          // all. That is the same trade the budget case above already rejected.
          // A document that never loaded sits in `docCache` as a `{}` placeholder
          // (or is absent, when a budget stopped the prefetch reaching it), so a
          // *fragment-less* `$ref` into it does resolve — to an empty schema,
          // which accepts anything. For a host the SSRF guard refused, that
          // silently replaces a constraint with a hole, which is a worse answer
          // than the `undefined` this branch was written to stop inlining. The
          // node is kept for the same reason, whether or not it had a fragment.
          const targetLoaded = docCache.has(targetLocation) && !unloadable.has(targetLocation)
          if (found === undefined || !targetLoaded) {
            // Reported only when the target document is present and loaded fine.
            // One the prefetch never reached — because a `maxDocuments` /
            // `totalTimeoutMs` budget ran out — is absent from `docCache` and has
            // already recorded an error of its own.
            //
            // The node is kept either way. Gating the *keep* on this condition too
            // meant a budget-truncated resolve fell through to inlining
            // `undefined`, so the referencing node vanished on serialization —
            // trading a duplicate error for silent loss of every constraint on it.
            //
            // A refused or unreadable document is in `docCache` (as `{}`) but the
            // loader already said why, so it is excluded here rather than
            // reported twice under a vaguer message.
            if (targetLoaded) {
              errors.push({
                message: `Cannot resolve ${keyword} "${value}"`,
                // `refPathAt` indexes the *root* document only, so it can only
                // speak for a ref that lives there. Called unguarded it answered
                // for a ref in a sub-document by handing back the position of an
                // identical ref in the root — pointing a diagnostic at a line
                // that is not the offending one. The prefetch loop above already
                // guards this the same way; an empty path means "no position to
                // give", which is honest.
                path: baseLocation === rootLocation ? refPathAt(keyword, value) : [],
              })
            }
            refCache.set(cacheKey, MISSING)
            refCache.set(refKey, MISSING)
            return keepScopedReference(obj, keyword, baseLocation, nodeBase, depth, role)
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
          const kept = keepScopedReference(obj, keyword, baseLocation, nodeBase, depth, role)
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
            // This is the one path that *copies* a resolved node rather than
            // placing it. When the original was a CYCLE-kept node carrying a
            // provisional `#/$defs/<name>`, the copy inherits that string but not
            // its registration — so a later rename fixed the original and left
            // this one pointing at whatever else ended up under the old name.
            const hoistOf = hoistRefSites.get(resolved as Record<string, unknown>)
            if (hoistOf !== undefined) hoistRefSites.set(overridden, hoistOf)
            // A bundled ref into a definition carries the pointer past the hoist's
            // name; without it the rename would point the copy at the whole hoist.
            const suffixOf = hoistRefSuffixes.get(resolved as Record<string, unknown>)
            if (suffixOf !== undefined) hoistRefSuffixes.set(overridden, suffixOf)
            const uriSite = uriRefSites.get(resolved as Record<string, unknown>)
            if (uriSite !== undefined) uriRefSites.set(overridden, uriSite)
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
        // Settle the names against the `$defs` actually being written to. When
        // the resolved root is the source root this changes nothing; when it is
        // another document (a pure-`$ref` root resolves to whatever it points
        // at), it is the only thing standing between a hoist and overwriting a
        // definition that document already had — silently re-pointing every
        // `#/$defs/<name>` in the output at the wrong schema.
        //
        // A bundling hoist of a definition whose document is hoisted whole as well is
        // already inside that hoist (`$defs/common/$defs/Money`), so its refs point
        // there and it is not attached a second time beside it.
        const insideWhole = new Map<string, { whole: string; suffix: string }>()
        for (const [key, { location, pointer }] of hoistTargets) {
          const whole = `$ref ${location}#`
          if (pointer.length > 0 && hoists.has(whole))
            insideWhole.set(key, { whole, suffix: pathToRef(pointer).slice(1) })
        }
        // What the root's own definitions and refs are filed under, from the source
        // root: the hoists and refs rewritten into this container are not in it yet.
        const taken = new Set([...Object.keys(defs), ...definitionNames(container), ...rootNames].map(nameKey))
        // The paths into each hoist its refs use (`Order` pointed into at
        // `/properties/money`), each of which a generator files a type under.
        const usedSuffixes = new Map<string, Set<string>>()
        for (const [node, cacheKey] of hoistRefSites) {
          const redirect = insideWhole.get(cacheKey)
          const key = redirect?.whole ?? cacheKey
          const suffix = `${redirect?.suffix ?? ''}${hoistRefSuffixes.get(node) ?? ''}`
          if (suffix !== '') usedSuffixes.set(key, (usedSuffixes.get(key) ?? new Set()).add(suffix))
        }
        const finalNames = new Map<string, string>()
        for (const [cacheKey, name] of hoists) {
          if (insideWhole.has(cacheKey)) continue
          // A name claims the files of what is filed under it as well: the
          // definitions nested in it and the paths into it its refs use.
          const cached = refCache.get(cacheKey)
          const value = cached !== undefined && cached !== CYCLE && cached !== MISSING ? cached.value : undefined
          // Relative to the hoist, so trying `Order-2` after `Order` walks it once.
          const nested =
            options.bundle === true ? containedNameMaps(value).flatMap((map) => nestedDefinitionNames(map)) : []
          const claims = (candidate: string): string[] =>
            [
              candidate,
              ...(options.bundle === true
                ? [
                    ...nested.map((name) => `${candidate}-${name}`),
                    ...[...(usedSuffixes.get(cacheKey) ?? [])].map((suffix) =>
                      generatedName(`/$defs/${candidate}${suffix}`),
                    ),
                  ]
                : []),
            ].map(nameKey)
          let unique = name
          for (let n = 2; claims(unique).some((claim) => taken.has(claim)); n++) unique = `${name}-${n}`
          for (const claim of claims(unique)) taken.add(claim)
          finalNames.set(cacheKey, unique)
        }
        // A contested id names two resources, so refs from the root's resource to the
        // document embedded under it point at its hoist, which names exactly one.
        for (const [node, { key, id, suffix }] of uriRefSites) {
          if (contestedIds.has(id)) assignKey(node, '$ref', `#/$defs/${finalNames.get(key) as string}${suffix}`)
        }
        for (const [node, cacheKey] of hoistRefSites) {
          const redirect = insideWhole.get(cacheKey)
          // Every site names a hoist, and every hoist not inside a whole one was named above.
          const name = finalNames.get(redirect?.whole ?? cacheKey) as string
          assignKey(node, '$ref', `#/$defs/${name}${redirect?.suffix ?? ''}${hoistRefSuffixes.get(node) ?? ''}`)
        }
        for (const [cacheKey] of hoists) {
          if (insideWhole.has(cacheKey)) continue
          const cached = refCache.get(cacheKey)
          const attachable = cached !== undefined && cached !== CYCLE && cached !== MISSING
          // `finalNames` was built from this very map a few lines up, so every
          // key is present — no fallback to reason about.
          assignKey(defs, finalNames.get(cacheKey) as string, attachable ? (cached.value ?? {}) : {})
        }
        assignKey(container, '$defs', defs)
      } else {
        errors.push({
          message: 'Cannot attach hoisted cycle definitions: the resolved root document is not an object',
          path: [],
        })
      }
    }

    return { result: origins ? { resolved, errors, origins } : { resolved, errors }, unplaceable }
  }

  /** Runs passes until none meets a cycle it cannot name inside an embedded document. */
  const settle = (inlineOnly: ReadonlySet<string>): ResolveResult => {
    const { result, unplaceable } = resolvePass(inlineOnly)
    const more = [...unplaceable].filter((location) => !inlineOnly.has(location))
    if (more.length === 0) return result
    errors.length = errorsBeforeResolve
    depthLimitReported = depthReportedBeforeResolve
    return settle(new Set([...inlineOnly, ...more]))
  }
  return settle(new Set())
}
