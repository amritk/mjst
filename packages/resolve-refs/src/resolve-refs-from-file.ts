import { readFileSync } from 'node:fs'
import { dirname, resolve as resolvePath } from 'node:path'

import { isPrivateHost } from './is-private-host'
import { type ResolvedTarget, readReference, resolveFragment } from './reference'
import {
  baseOfNode,
  buildResourceRegistry,
  type ResourceRegistry,
  resolveRefInScope,
  type ScopedTarget,
  SYNTHETIC_BASE,
} from './resource-registry'
import { assignKey } from './safe-assign'
import type { JsonPath, OriginMap, ResolveError, ResolveOptions, ResolveResult } from './types'

// A ref currently mid-resolution is marked with this sentinel; revisiting it
// means a cycle, so the reference is kept (rewritten to a root-document ref,
// hoisting the target into `$defs` when it lives in another file) instead of
// recursing forever.
const CYCLE = Symbol('cycle')
// The inlined value plus the in-document path it came from (for `origins`).
type CacheValue = { value: unknown; pointer: JsonPath } | typeof CYCLE

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
// Fetched remote documents are cached in memory for the lifetime of the
// process ("the session"). Local files are intentionally NOT cached across
// resolve passes — they can change on disk during a long-lived session (e.g.
// an editor/LSP), so each pass re-reads them. Remote documents are assumed
// stable for the session; call `clearRemoteCache()` to drop them, or pass
// `cache: false` to bypass the session cache for a single call.

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

/**
 * Fetches and parses a remote document, following redirects manually so the
 * SSRF guard is re-applied to every hop. `fetch` follows redirects by default,
 * which would let an allow-listed public URL bounce to a private/loopback
 * address (e.g. the `169.254.169.254` metadata endpoint) — so we set
 * `redirect: 'manual'` and re-run {@link denialReason} on each `Location`.
 * Caller-supplied headers are only sent on hops that share the original URL's
 * origin, so a cross-origin redirect can't exfiltrate credentials.
 */
const fetchRemote = async (location: string, options: ResolveOptions): Promise<unknown> => {
  const maxRedirects = options.maxRedirects ?? MAX_REDIRECTS
  const timeoutMs = options.timeoutMs ?? FETCH_TIMEOUT_MS
  const maxBytes = options.maxBytes ?? MAX_REMOTE_BYTES
  const doFetch = options.fetch ?? fetch
  const origin = new URL(location).origin

  let current = location
  for (let hop = 0; hop <= maxRedirects; hop++) {
    const reason = denialReason(current, options)
    if (reason !== null) throw new Error(`refusing to follow redirect (${reason}): ${current}`)

    const headers = new URL(current).origin === origin ? headersFor(location, options) : undefined
    const response = await doFetch(current, {
      redirect: 'manual',
      // Cap the wait for a response so a stalling host can't hang resolution forever.
      signal: AbortSignal.timeout(timeoutMs),
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
    return allow.includes(url.host) ? null : 'host is not in the allow-list'
  }
  if (!options.allowPrivateHosts && isPrivateHost(url.hostname)) {
    return 'host resolves to a private or loopback address (set allowPrivateHosts to permit)'
  }
  return null
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
    if (useSessionCache && remoteCache.has(location)) {
      docCache.set(location, remoteCache.get(location))
      return true
    }
    if (!useSessionCache) {
      // A cache-bypassing call must not serve (or poison) concurrent callers'
      // in-flight loads either — fetch independently.
      try {
        const doc = await fetchRemote(location, options)
        docCache.set(location, doc)
        return true
      } catch (err) {
        errors.push({ message: `Failed to fetch ${location}: ${String(err)}`, path: [] })
        docCache.set(location, {})
        return false
      }
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

/**
 * Resolves `$ref`s in a document on disk (or at a URL), including cross-file
 * and remote refs. Remote documents are fetched on the fly and cached in memory
 * for the session; `options` governs whether/which remote hosts are allowed,
 * how they are fetched (`headers`, `fetch`, `timeoutMs`, `maxRedirects`,
 * `maxBytes`), and whether the session cache is used (`cache`).
 */
export const resolveRefsFromFile = async (filename: string, options: ResolveOptions = {}): Promise<ResolveResult> => {
  const rootLocation = isRemote(filename) ? filename : resolvePath(filename)
  const errors: ResolveError[] = []
  const docCache = new Map<string, unknown>()

  if (!(await loadDoc(rootLocation, docCache, options, errors))) {
    return { resolved: {}, errors }
  }

  // Per-document `$id` registries, built lazily. A document's registry scopes
  // anchor lookups and lets URI refs match embedded resources without fetching.
  const registries = new Map<string, ResourceRegistry>()
  const registryFor = (location: string): ResourceRegistry => {
    let registry = registries.get(location)
    if (registry === undefined) {
      registry = buildResourceRegistry(docCache.get(location), isRemote(location) ? location : SYNTHETIC_BASE)
      registries.set(location, registry)
    }
    return registry
  }

  /** Collects the document parts of refs under `node` that are NOT `$id`-internal. */
  const collectRefTargets = (node: unknown, location: string, base: string, out: Set<string>): void => {
    if (node === null || typeof node !== 'object') return
    if (Array.isArray(node)) {
      for (const item of node) collectRefTargets(item, location, base, out)
      return
    }
    const obj = node as Record<string, unknown>
    const registry = registryFor(location)
    const nodeBase = typeof obj['$id'] === 'string' ? baseOfNode(registry, obj, base) : base
    const reference = readReference(obj)
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
      collectRefTargets(obj[key], location, nodeBase, out)
    }
  }

  /**
   * Walks every reachable document starting from the root, loading each one so
   * the synchronous resolve pass can look them up. This is the only async part
   * of resolution: remote documents are fetched here (in dependency order) and
   * cached for the session.
   */
  const prefetch = async (): Promise<void> => {
    const seen = new Set<string>([rootLocation])
    const queue: string[] = [rootLocation]
    while (queue.length > 0) {
      const location = queue.shift() as string
      const out = new Set<string>()
      collectRefTargets(docCache.get(location), location, registryFor(location).rootBase, out)
      for (const filePart of out) {
        const target = joinLocation(location, filePart)
        if (seen.has(target)) continue
        seen.add(target)
        await loadDoc(target, docCache, options, errors)
        queue.push(target)
      }
    }
  }

  await prefetch()

  const origins: OriginMap | undefined = options.trackOrigins ? new Map() : undefined
  const refCache = new Map<string, CacheValue>()
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
   * the current `$id` base URI within that document.
   */
  const resolveAt = (node: unknown, baseLocation: string, base: string): unknown => {
    if (node === null || typeof node !== 'object') return node
    if (Array.isArray(node)) {
      return node.map((item) => resolveAt(item, baseLocation, base))
    }
    const obj = node as Record<string, unknown>
    const registry = registryFor(baseLocation)
    const nodeBase = typeof obj['$id'] === 'string' ? baseOfNode(registry, obj, base) : base
    const reference = readReference(obj)
    if (reference) {
      const { keyword, value } = reference

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
          assignKey(kept, key, resolveAt(obj[key], baseLocation, nodeBase))
        }
        // Always rewritten to a static `$ref`: the dynamic binding was already
        // decided when the cycle was entered.
        assignKey(kept, '$ref', keptRef)
        return kept
      }
      if (cached !== undefined) {
        resolved = cached.value
        pointer = cached.pointer
      } else {
        refCache.set(cacheKey, CYCLE)
        let found: ResolvedTarget | undefined
        let targetBase: string
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
        resolved = resolveAt(found?.value, targetLocation, targetBase)
        refCache.set(cacheKey, { value: resolved, pointer })
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

      const siblingKeys = Object.keys(obj).filter((key) => key !== keyword)
      if (siblingKeys.length === 0) return resolved
      const siblings: Record<string, unknown> = {}
      for (const key of siblingKeys) assignKey(siblings, key, resolveAt(obj[key], baseLocation, nodeBase))

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
      return merged
    }
    const result: Record<string, unknown> = {}
    for (const key of Object.keys(obj)) {
      assignKey(result, key, resolveAt(obj[key], baseLocation, nodeBase))
    }
    return result
  }

  const rootRegistry = registryFor(rootLocation)
  const resolved = resolveAt(docCache.get(rootLocation), rootLocation, rootRegistry.rootBase)

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
