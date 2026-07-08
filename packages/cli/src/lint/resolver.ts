import { readFileSync } from 'node:fs'
import { resolve as resolvePath } from 'node:path'
import {
  createDocument,
  type Document,
  type IOriginMap,
  type ISourceDocument,
  type ISourceSet,
  type JsonPath,
  type LintResolver,
  resolveSourceOriginFromMap,
} from '@amritk/lint'
import { type OriginMap, resolveRefs, resolveRefsFromFile } from '@amritk/resolve-refs'
import { parse as parseYaml } from '@amritk/yaml'

/** How `mjst lint` dereferences `$ref` (and `$dynamicRef`/`$recursiveRef`). */
export type ResolverOptions = {
  /**
   * Fetch http(s) `$ref`s. Defaults to `false`: a lint run should not make
   * network calls unless asked. A non-empty `allowedHosts` implies `remote`.
   */
  remote?: boolean
  /** If set, only these hosts may be fetched (and each bypasses the private-host guard). */
  allowedHosts?: string[]
  /** Permit remote refs to private/loopback/link-local hosts (off by default as an SSRF guard). */
  allowPrivateHosts?: boolean
}

const isRemote = (location: string): boolean => /^https?:\/\//i.test(location)

/**
 * Parses a referenced document by extension: YAML for `.yaml`/`.yml`, JSON for
 * `.json`, and for anything else (extensionless, remote) tries JSON first, then
 * YAML. YAML is a JSON superset, so this accepts every document the linter does.
 */
const parseDoc = (content: string, location: string): unknown => {
  if (/\.ya?ml$/i.test(location)) return parseYaml(content)
  if (/\.json$/i.test(location)) return JSON.parse(content)
  try {
    return JSON.parse(content)
  } catch {
    return parseYaml(content)
  }
}

/** The reference keywords whose value may point at another document (a non-`#` target). */
const REF_KEYWORDS = ['$ref', '$dynamicRef', '$recursiveRef'] as const

/**
 * Whether `data` contains a reference into another document (a `$ref` value that
 * is not a same-document `#...` fragment). Internal-only documents resolve fully
 * in memory, so we avoid the disk round-trip unless an external target exists.
 */
const hasExternalRefs = (data: unknown): boolean => {
  if (data === null || typeof data !== 'object') return false
  if (Array.isArray(data)) return data.some(hasExternalRefs)
  const obj = data as Record<string, unknown>
  for (const keyword of REF_KEYWORDS) {
    const value = obj[keyword]
    if (typeof value === 'string' && !value.startsWith('#')) return true
  }
  return Object.values(obj).some(hasExternalRefs)
}

/** Whether the file at `absolute` reads back byte-for-byte as `input` (the document we linted). */
const readsBackAs = (absolute: string, input: string): boolean => {
  try {
    return readFileSync(absolute, 'utf8') === input
  } catch {
    return false
  }
}

/**
 * Builds the {@link ISourceSet} the runner uses to map a finding on a resolved
 * (dereferenced) node back to the file it came from. Origins from the resolver
 * attribute each inlined node to its source document + path; `get` lazily parses
 * each source file (with a position map) so findings on cross-file nodes report
 * that file's own `line:column`. The root document is already parsed by the
 * linter, so it is reused directly. Remote documents are not re-fetched here, so
 * a finding inlined from a URL falls back to the root document's position.
 */
const buildSourceSet = (
  rootDocument: Document,
  resolved: unknown,
  origins: OriginMap | undefined,
  rootLocation: string,
): ISourceSet => {
  const documents = new Map<string, ISourceDocument | undefined>([[rootLocation, rootDocument]])
  const originMap: IOriginMap = origins ?? new Map()

  const load = (location: string): ISourceDocument | undefined => {
    if (documents.has(location)) return documents.get(location)
    let document: ISourceDocument | undefined
    if (location !== '' && !isRemote(location)) {
      try {
        document = createDocument(readFileSync(location, 'utf8'), { source: location })
      } catch {
        document = undefined
      }
    }
    documents.set(location, document)
    return document
  }

  return {
    get: load,
    origin: (path: JsonPath) => resolveSourceOriginFromMap(resolved, originMap, rootLocation, path),
  }
}

/**
 * Builds a {@link LintResolver} backed by `@amritk/resolve-refs`, dereferencing
 * `$ref`, `$dynamicRef`/`$dynamicAnchor`, and `$recursiveRef`/`$recursiveAnchor`
 * so rules with `resolved: true` (the ruleset default) see through references.
 *
 * Internal-only documents resolve in memory. A document with cross-file/remote
 * refs is resolved from disk **only when its source file reads back exactly as
 * the linted input** — so a piped document (`--stdin-filepath`) never resolves
 * against a different on-disk file — with remote fetching gated by `options`.
 */
export const createLintResolver = (options: ResolverOptions = {}): LintResolver => {
  const fromFileOptions = {
    remote: options.remote ?? false,
    ...(options.allowedHosts ? { allowedHosts: options.allowedHosts } : {}),
    ...(options.allowPrivateHosts ? { allowPrivateHosts: options.allowPrivateHosts } : {}),
    parse: parseDoc,
    trackOrigins: true as const,
  }

  return async (document, { input }) => {
    const { source } = document
    if (source && hasExternalRefs(document.data)) {
      const absolute = resolvePath(source)
      if (readsBackAs(absolute, input)) {
        const { resolved, origins } = await resolveRefsFromFile(absolute, fromFileOptions)
        return { resolved, sources: buildSourceSet(document, resolved, origins, absolute) }
      }
    }
    const { resolved, origins } = resolveRefs(document.data, { trackOrigins: true })
    return { resolved, sources: buildSourceSet(document, resolved, origins, '') }
  }
}
