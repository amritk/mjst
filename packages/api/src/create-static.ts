import type { DotfilePolicy } from './resolve-static-path'
import { resolveStaticPath } from './resolve-static-path'
import { staticContentType } from './static-content-type'
import type { FetchOnRequest } from './to-fetch-handler'

/**
 * One file, as a {@link StaticReader} reports it.
 *
 * Everything but `body` is optional because not every source can cheaply
 * supply it — an object store knows its own metadata, a bundled asset map may
 * know nothing but the bytes — and the response degrades gracefully: no
 * `size`/`lastModified` simply means no `etag` and no conditional 304.
 */
export type StaticFile = {
  /** The bytes. A stream is passed through without buffering. */
  readonly body: ReadableStream<Uint8Array> | Uint8Array | string
  /** Byte length, used for `content-length` and the `etag`. */
  readonly size?: number
  /** Overrides the content type otherwise guessed from the extension. */
  readonly type?: string
  /** Last modification time in epoch milliseconds, used for the `etag`. */
  readonly lastModified?: number
}

/**
 * Reads one resolved path, or reports `undefined` when there is no such file.
 *
 * Injected rather than built in, because there is no filesystem call that
 * works everywhere this package runs: `Bun.file`, `node:fs`, an R2 bucket, and
 * a bundled asset manifest are four different things, and importing `node:fs`
 * to serve the first would break the Workers build for everyone.
 *
 * A missing file must come back as `undefined`, not as a thrown `ENOENT` — a
 * throw here is an error the pipeline reports as a 500, which is not what "not
 * found" means.
 *
 * ```typescript
 * // Bun
 * const read: StaticReader = async (path) => {
 *   const file = Bun.file(path)
 *   return (await file.exists()) ? { body: file.stream(), size: file.size, type: file.type } : undefined
 * }
 *
 * // Node
 * import { readFile, stat } from 'node:fs/promises'
 * const read: StaticReader = async (path) => {
 *   try {
 *     const info = await stat(path)
 *     if (!info.isFile()) return undefined
 *     return { body: await readFile(path), size: info.size, lastModified: info.mtimeMs }
 *   } catch {
 *     return undefined
 *   }
 * }
 * ```
 */
export type StaticReader = (path: string) => Promise<StaticFile | undefined> | StaticFile | undefined

/**
 * Options for {@link createStatic}.
 */
export type StaticOptions = {
  /** The document root, e.g. `'./public'`. */
  readonly root: string
  /** The URL prefix served from that root, e.g. `'/assets'`. */
  readonly prefix: string
  /** Reads one file. See {@link StaticReader}. */
  readonly read: StaticReader
  /** Whether to serve segments starting with `.`. Defaults to `'deny'`. */
  readonly dotfiles?: DotfilePolicy
  /** `cache-control` for served files. Defaults to `'public, max-age=3600'`. */
  readonly cacheControl?: string
  /** Extra headers stamped on every served file. */
  readonly headers?: Readonly<Record<string, string>>
}

/**
 * Serves files from a document root as an `onRequest` gate.
 *
 * ```typescript
 * const handler = toFetchHandler(api, {
 *   onRequest: [createStatic({ root: './public', prefix: '/assets', read })],
 *   onResponse: [createSecurityHeaders()],
 * })
 * ```
 *
 * A gate rather than a mount, for one reason worth stating: the configuration
 * then lives in exactly one place. A mount would need its prefix in the mount
 * key *and* in these options, and the day those two drift the failure is a
 * confusing 404 rather than an error.
 *
 * Anything this gate does not serve returns `undefined` and falls through to
 * routing untouched — a request outside the prefix, an unsafe method, a
 * missing file. That last one is deliberate: a request for a file that does
 * not exist gets the API's own 404 envelope, so a client sees one error shape
 * from one origin rather than two.
 *
 * The cost to an API that also uses this is one `startsWith` per request; a
 * request that does not match never reaches the reader, and never allocates a
 * promise, because the miss path returns synchronously.
 *
 * Path safety lives in `resolveStaticPath`, which rejects the encoded
 * traversals that survive client normalization. Two things this does *not* do:
 * it does not follow the `Range` header, so a media file served through it
 * cannot be seeked (put a CDN or the platform's own file serving in front of
 * video); and it cannot see a symlink inside the root pointing outside it,
 * which needs a `realpath` the reader seam does not expose.
 */
export const createStatic = (options: StaticOptions): FetchOnRequest => {
  const cacheControl = options.cacheControl ?? 'public, max-age=3600'
  const prefix = options.prefix.endsWith('/') ? options.prefix.slice(0, -1) : options.prefix

  return (request: Request): Response | undefined | Promise<Response | undefined> => {
    // A static root answers reads. Anything else is the API's business, and
    // returning 405 here would answer for paths this gate does not even own.
    if (request.method !== 'GET' && request.method !== 'HEAD') return undefined

    // Sliced by hand rather than via `new URL(...)`, matching the adapter: a
    // URL object parses and normalizes the whole URL, and this runs on every
    // request including the ones that fall straight through.
    const url = request.url
    const schemeEnd = url.indexOf('://')
    const pathStart = url.indexOf('/', schemeEnd === -1 ? 0 : schemeEnd + 3)
    if (pathStart === -1) return undefined
    const queryIndex = url.indexOf('?', pathStart)
    const pathname = queryIndex === -1 ? url.slice(pathStart) : url.slice(pathStart, queryIndex)

    const path = resolveStaticPath({
      pathname,
      prefix,
      root: options.root,
      ...(options.dotfiles === undefined ? {} : { dotfiles: options.dotfiles }),
    })
    if (path === undefined) return undefined

    return serve(path, request, options.read, cacheControl, options.headers)
  }
}

/** The async tail, kept out of the gate so a miss never allocates a promise. */
const serve = async (
  path: string,
  request: Request,
  read: StaticReader,
  cacheControl: string,
  extra: Readonly<Record<string, string>> | undefined,
): Promise<Response | undefined> => {
  const file = await read(path)
  if (file === undefined) return undefined

  const headers = new Headers(extra)
  headers.set('content-type', file.type ?? staticContentType(path))
  headers.set('cache-control', cacheControl)

  // An etag needs both halves to be meaningful: size alone collides on any
  // edit that preserves length, which is exactly what a one-character fix to a
  // config file or a rebuilt asset with a stable layout looks like.
  const etag =
    file.size === undefined || file.lastModified === undefined
      ? undefined
      : `"${file.size.toString(16)}-${Math.trunc(file.lastModified).toString(16)}"`
  if (etag !== undefined) headers.set('etag', etag)
  if (file.lastModified !== undefined) headers.set('last-modified', new Date(file.lastModified).toUTCString())

  if (etag !== undefined && matchesEtag(request.headers.get('if-none-match'), etag)) {
    // A 304 carries no body and no content-length, but must repeat the
    // validators so the cached entry's freshness is refreshed.
    return new Response(null, { status: 304, headers })
  }

  if (file.size !== undefined) headers.set('content-length', String(file.size))
  if (request.method === 'HEAD') {
    // The headers a GET would have produced, no body (RFC 9110). A stream
    // nothing will pump is cancelled rather than left dangling.
    if (file.body instanceof ReadableStream) void file.body.cancel().catch(() => undefined)
    return new Response(null, { status: 200, headers })
  }

  return new Response(file.body, { status: 200, headers })
}

/**
 * Whether an `if-none-match` value covers `etag`.
 *
 * Handles the `*` wildcard and a comma-separated list, and compares weak and
 * strong forms as equal: the weak comparison is the one RFC 9110 specifies for
 * `if-none-match`, and a proxy that downgraded our strong tag to `W/"…"` on
 * the way out would otherwise make every conditional request a full download.
 */
const matchesEtag = (header: string | null, etag: string): boolean => {
  if (header === null) return false
  if (header.trim() === '*') return true
  const strong = etag.startsWith('W/') ? etag.slice(2) : etag
  return header.split(',').some((candidate) => {
    const trimmed = candidate.trim()
    return (trimmed.startsWith('W/') ? trimmed.slice(2) : trimmed) === strong
  })
}
