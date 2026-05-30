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
 * Where an inlined node originally came from: the document it lived in and its
 * path within that document. Consumers (e.g. a linter) use this to report a
 * finding at the right file and line, rather than at the `$ref` site that pulled
 * the node in.
 */
export type NodeOrigin = {
  /** Absolute location (file path or URL) of the document this node came from. */
  location: string
  /** The path of this node within that document. */
  pointer: JsonPath
}

/** The outcome of a resolve pass: the dereferenced document plus any errors. */
export type ResolveResult = {
  /** The dereferenced document (all resolvable `$ref`s inlined). */
  resolved: unknown
  errors: ResolveError[]
  /**
   * Present only when `trackOrigins` is set. Maps each inlined object/array (by
   * identity) to where it came from. A node carries the origin of the innermost
   * `$ref` that produced it, so a chain `a.yaml#/x → b.yaml#/y` records the node
   * as originating in `b.yaml`. Resolution shares the identity of repeated `$ref`
   * targets, so a target reused in many places maps to its single origin.
   */
  origins?: WeakMap<object, NodeOrigin>
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
   * When true, the result includes an `origins` map recording where each inlined
   * node came from (document + path within it). Off by default to keep the common
   * case allocation-free; turn it on when you need to map inlined nodes back to
   * their original source location.
   */
  trackOrigins?: boolean
}
