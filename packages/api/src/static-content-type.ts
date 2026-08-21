/**
 * Extension to content type, for the file kinds a static root actually serves.
 *
 * Deliberately small. This is not trying to be `mime-db` — a static mount in
 * front of an API serves a build output and a favicon, and the long tail
 * belongs to a CDN. What it must not do is fall back to
 * `application/octet-stream` for stylesheets and scripts: browsers send
 * `x-content-type-options: nosniff` back at us (the package's own
 * `createSecurityHeaders` sets it), and under nosniff a stylesheet served as
 * octet-stream is simply not applied.
 *
 * The charset on the text types matters for the same reason — without it a
 * browser falls back to its locale default and mangles any non-ASCII content.
 */
export const STATIC_CONTENT_TYPES: Readonly<Record<string, string>> = Object.freeze({
  css: 'text/css; charset=utf-8',
  csv: 'text/csv; charset=utf-8',
  gif: 'image/gif',
  htm: 'text/html; charset=utf-8',
  html: 'text/html; charset=utf-8',
  ico: 'image/x-icon',
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  js: 'text/javascript; charset=utf-8',
  json: 'application/json; charset=utf-8',
  map: 'application/json; charset=utf-8',
  md: 'text/markdown; charset=utf-8',
  mjs: 'text/javascript; charset=utf-8',
  mp4: 'video/mp4',
  otf: 'font/otf',
  pdf: 'application/pdf',
  png: 'image/png',
  svg: 'image/svg+xml',
  ttf: 'font/ttf',
  txt: 'text/plain; charset=utf-8',
  wasm: 'application/wasm',
  webm: 'video/webm',
  webp: 'image/webp',
  woff: 'font/woff',
  woff2: 'font/woff2',
  xml: 'application/xml; charset=utf-8',
})

/**
 * Picks a content type from a file path's extension, falling back to
 * `application/octet-stream` for anything unrecognized — the correct answer
 * for "bytes of unknown kind", and safe because a browser will download rather
 * than execute it.
 */
export const staticContentType = (path: string): string => {
  const dot = path.lastIndexOf('.')
  const slash = path.lastIndexOf('/')
  // A dot before the last slash belongs to a directory name, not the file, and
  // a leading dot (`.gitignore`) is the whole name rather than an extension.
  if (dot === -1 || dot < slash + 2) return 'application/octet-stream'
  const extension = path.slice(dot + 1).toLowerCase()
  // `Object.hasOwn`, not a bare lookup: an extension that names an inherited
  // member reads it off `Object.prototype` instead of missing, and the result
  // is not nullish so `??` never fires. A file called `x.constructor` served a
  // `content-type` of the entire `Object` function source, and `x.__proto__`
  // one of `[object Object]`. The same reason `buildCookiesObject` and
  // `secureRoutes` read their maps this way.
  const known = Object.hasOwn(STATIC_CONTENT_TYPES, extension) ? STATIC_CONTENT_TYPES[extension] : undefined
  return known ?? 'application/octet-stream'
}
