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

/** The outcome of a resolve pass: the dereferenced document plus any errors. */
export type ResolveResult = {
  /** The dereferenced document (all resolvable `$ref`s inlined). */
  resolved: unknown
  errors: ResolveError[]
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
}
