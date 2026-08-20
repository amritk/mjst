/**
 * A path into a JSON document: object keys and array indices, in order.
 */
export type JsonPath = (string | number)[]

/** A single `$ref` resolution failure (a missing file, a bad URL, a refusal). */
export type ResolveError = {
  message: string
  /**
   * Where the reference that failed was written, as a path in the document you
   * asked to resolve — ending in the reference keyword, so it points at the
   * `$ref` line itself rather than at the schema around it. Anchor a diagnostic
   * on it and the reader lands on the reference they have to fix.
   *
   * Empty when there is nowhere to point: a failure that belongs to the resolve
   * as a whole (a depth or document budget), or a reference written in some
   * other document rather than in the one you named. A reference used in
   * several places is reported once, at the first.
   */
  path: JsonPath
}

/**
 * Where an inlined node came from: the absolute location (file path or URL, or
 * `''` for the single in-memory document) of the document it was defined in, and
 * the path to it within that document.
 */
export type Origin = {
  location: string
  pointer: JsonPath
}

/**
 * Per-node origin map produced when `trackOrigins` is set: maps each object/array
 * that was inlined in place of a `$ref` to where it was defined. A consumer can
 * then attribute a node in the resolved tree back to its source document and path
 * with a single lookup instead of re-deriving the `$ref` traversal. Keyed by node
 * identity, so it relies on the resolver sharing one object per repeated `$ref`
 * target (which it does).
 */
export type OriginMap = Map<object, Origin>

/** The outcome of a resolve pass: the dereferenced document plus any errors. */
export type ResolveResult = {
  /** The dereferenced document (all resolvable `$ref`s inlined). */
  resolved: unknown
  errors: ResolveError[]
  /**
   * Per-node origin map. Present only when `trackOrigins` was requested; each
   * entry maps an inlined object/array to the document and path it came from.
   */
  origins?: OriginMap
}

/** Controls how external `$ref`s to other documents are loaded. */
export type ResolveOptions = {
  /**
   * Whether http(s) `$ref`s may be fetched. Defaults to `true`.
   */
  remote?: boolean
  /**
   * Whether `$ref`s to other files on disk may be read. Defaults to `true`.
   * Pass `false` for a document from an untrusted source: the root document
   * you named is still read (it is what you asked for), but every cross-file
   * `$ref` out of it is refused. Internal `#/...` refs are unaffected.
   */
  localRefs?: boolean
  /**
   * Directories a local `$ref` must resolve inside. Defaults to
   * `[dirname(rootLocation)]` — the folder holding the document being resolved
   * — so a `$ref` cannot walk out of the document tree it belongs to
   * (`{"$ref": "../../../etc/passwd"}`, or an absolute `/etc/passwd`).
   *
   * Set it explicitly for the common split-spec layout where a document refers
   * to shared schemas in a sibling folder:
   *
   * ```ts
   * resolveRefsFromFile('./specs/v2/api.json', { allowedRoots: ['./specs'] })
   * ```
   *
   * Entries are resolved against the current working directory. Both the
   * lexical and the symlink-resolved path must land inside a root, so a symlink
   * planted in the tree cannot be used to escape it.
   */
  allowedRoots?: string[]
  /**
   * If non-empty, only these hosts (e.g. `api.example.com`) may be fetched for
   * remote `$ref`s. An empty/undefined list allows any host (subject to
   * `remote`). An explicit entry here always bypasses the private-host guard
   * (including the DNS check — see `verifyDns`).
   *
   * Matching is case-insensitive. An entry with **no port** (`example.com`)
   * matches the host on any port; an entry **with** a port
   * (`example.com:8443`) must match the URL's port exactly, where a URL that
   * omits the port counts as its protocol default (`443` for https, `80` for
   * http).
   */
  allowedHosts?: string[]
  /**
   * Allow remote `$ref`s to loopback, private, link-local, and other
   * non-public addresses. Defaults to `false`: such hosts are refused as a
   * best-effort SSRF guard (notably the `169.254.169.254` cloud-metadata
   * endpoint). An explicit `allowedHosts` entry always bypasses this guard.
   */
  allowPrivateHosts?: boolean
  /**
   * Resolve each remote host and refuse it when any address it resolves to is
   * non-public. Defaults to `true`, which is what stops a public-looking name
   * that points at a private address (`127.0.0.1.nip.io`) — the URL-only guard
   * cannot see those. Pass `false` where names are resolved somewhere else
   * (behind an egress proxy) and a local lookup would fail; allow-listed hosts
   * skip the check either way.
   *
   * This narrows DNS rebinding rather than closing it: the record can still
   * change between the check and the connection, which would take pinning the
   * socket to the verified address to prevent.
   */
  verifyDns?: boolean
  /**
   * Custom content parser. Receives the raw text of every loaded document and
   * its absolute location (file path or URL). Defaults to `JSON.parse`.
   *
   * Pass a YAML-aware function to support `.yaml`/`.yml` documents without
   * adding a dependency to this package:
   *
   * ```ts
   * import { parse as parseYaml } from 'yaml'
   *
   * resolveRefsFromFile(path, {
   *   parse: (content, location) =>
   *     /\.ya?ml$/i.test(location) ? parseYaml(content) : JSON.parse(content),
   * })
   * ```
   */
  parse?: (content: string, location: string) => unknown
  /**
   * Record a per-node origin map on the result (`origins`). For every object or
   * array inlined in place of a `$ref`, the map records the document and in-file
   * path it was defined at, so a consumer can attribute resolved-tree nodes back
   * to their source without re-walking the `$ref` chain. Defaults to `false`.
   */
  trackOrigins?: boolean
  /**
   * Extra HTTP headers sent with remote `$ref` requests (e.g. an `Authorization`
   * token for a private schema registry) — a static record, or a function
   * returning headers per URL so different hosts can carry different
   * credentials. To avoid leaking credentials, headers are only sent on redirect
   * hops whose origin matches the originally requested URL — the same policy
   * browsers apply to `Authorization` across cross-origin redirects.
   */
  headers?: Record<string, string> | ((url: string) => Record<string, string> | undefined)
  /**
   * Custom fetch implementation for remote documents (an instrumented client, a
   * proxy-aware one, a test stub). Called once per redirect hop with
   * `redirect: 'manual'` and a timeout signal. The SSRF guard still evaluates
   * every hop before this is called — a custom fetch widens *how* documents are
   * fetched, never *which* hosts may be. Defaults to the global `fetch`.
   */
  fetch?: (
    url: string,
    init: { redirect: 'manual'; signal: AbortSignal; headers?: Record<string, string> },
  ) => Promise<Response>
  /** Milliseconds before an unresponsive remote fetch is aborted. Defaults to `30_000`. */
  timeoutMs?: number
  /**
   * Milliseconds the whole resolve may take, across every document. Defaults to
   * `60_000`. `timeoutMs` bounds one hop; without an aggregate budget a document
   * with hundreds of `$ref`s could hold the process for hours by paying the
   * per-hop timeout over and over. Once it elapses, no further document is
   * loaded and the overrun is reported on `errors`.
   */
  totalTimeoutMs?: number
  /** Maximum redirect hops to follow per remote document. Defaults to `5`. */
  maxRedirects?: number
  /**
   * Maximum number of documents (root included) a single resolve may load.
   * Defaults to `500`. A hostile document listing hundreds of distinct URLs
   * otherwise turns this resolver into an egress amplifier — and each fetched
   * document can add more refs of its own. Once the cap is hit, loading stops
   * and the remaining refs degrade like any unresolvable ref.
   */
  maxDocuments?: number
  /** Maximum bytes buffered per remote document. Defaults to `16` MiB. */
  maxBytes?: number
  /**
   * How deep the resolver walks before leaving a subtree unresolved and
   * recording an error. Defaults to `512`. Guards the recursive walk against a
   * pathologically nested document, which would otherwise blow the call stack
   * with a `RangeError` — a thrown error this package promises never to throw.
   */
  maxDepth?: number
  /**
   * Whether fetched remote documents may be served from (and stored into) the
   * process-wide session cache. Pass `false` to bypass it for one call: every
   * remote document is re-fetched and nothing new is cached — useful when a
   * remote schema is known to have changed mid-session. Defaults to `true`.
   *
   * The cache is keyed by URL **and** by the credentials/transport it was
   * fetched with (`headers`, `fetch`, `parse`, and the limits), so a call
   * carrying one tenant's token can never serve its document to a call carrying
   * different (or no) credentials. It is bounded in both size and age; see
   * `clearRemoteCache`.
   */
  cache?: boolean
}
