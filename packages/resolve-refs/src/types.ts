/**
 * A path into a JSON document: object keys and array indices, in order. Errors
 * report the location of the offending `$ref` with one of these.
 */
export type JsonPath = (string | number)[]

/** A single `$ref` resolution failure (a missing file, a bad URL, a refusal). */
export type ResolveError = {
  message: string
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
   * If non-empty, only these hosts (e.g. `api.example.com`) may be fetched for
   * remote `$ref`s. An empty/undefined list allows any host (subject to
   * `remote`). An explicit entry here always bypasses the private-host guard.
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
  /** Maximum redirect hops to follow per remote document. Defaults to `5`. */
  maxRedirects?: number
  /** Maximum bytes buffered per remote document. Defaults to `16` MiB. */
  maxBytes?: number
  /**
   * Whether fetched remote documents may be served from (and stored into) the
   * process-wide session cache. Pass `false` to bypass it for one call: every
   * remote document is re-fetched and nothing new is cached — useful when a
   * remote schema is known to have changed mid-session. Defaults to `true`.
   */
  cache?: boolean
}
