import { describe, expect, it } from 'vitest'

import { createStatic } from './create-static'
import type { StaticFile, StaticReader } from './create-static'

const FILES: Readonly<Record<string, StaticFile>> = {
  './public/app.css': { body: 'body { color: red }', size: 19, lastModified: 1_700_000_000_000 },
  './public/index.html': { body: '<h1>hi</h1>', size: 11, lastModified: 1_700_000_000_000 },
  './public/data.bin': { body: new Uint8Array([1, 2, 3]), size: 3, lastModified: 1_700_000_000_000 },
  './public/nometa.txt': { body: 'no metadata here' },
  './public/.env': { body: 'SECRET=1', size: 8, lastModified: 1_700_000_000_000 },
}

const read: StaticReader = (path) => FILES[path]

const gate = (overrides: { dotfiles?: 'deny' | 'allow' } = {}) =>
  createStatic({
    root: './public',
    prefix: '/assets',
    read,
    cacheControl: 'public, max-age=60',
    ...(overrides.dotfiles === undefined ? {} : { dotfiles: overrides.dotfiles }),
  })

const get = (path: string, headers: Record<string, string> = {}, method = 'GET'): Request =>
  new Request(`http://localhost${path}`, { method, headers })

const call = async (request: Request): Promise<Response | undefined> =>
  (await gate()(request, undefined, undefined, {})) as Response | undefined

describe('create-static', () => {
  it('serves a file with a content type guessed from the extension', async () => {
    const response = await call(get('/assets/app.css'))
    expect(response?.status).toBe(200)
    expect(response?.headers.get('content-type')).toBe('text/css; charset=utf-8')
    expect(await response?.text()).toBe('body { color: red }')
  })

  it('sets cache-control, content-length, etag, and last-modified', async () => {
    const response = await call(get('/assets/app.css'))
    expect(response?.headers.get('cache-control')).toBe('public, max-age=60')
    expect(response?.headers.get('content-length')).toBe('19')
    expect(response?.headers.get('etag')).toMatch(/^"[0-9a-f]+-[0-9a-f]+"$/)
    expect(response?.headers.get('last-modified')).toBe(new Date(1_700_000_000_000).toUTCString())
  })

  it('answers 304 to a matching if-none-match, with no body', async () => {
    const first = await call(get('/assets/app.css'))
    const etag = first?.headers.get('etag') ?? ''
    const second = await call(get('/assets/app.css', { 'if-none-match': etag }))
    expect(second?.status).toBe(304)
    expect(second?.body).toBeNull()
    // The validators repeat on a 304 so the cached entry stays fresh.
    expect(second?.headers.get('etag')).toBe(etag)
    expect(second?.headers.has('content-length')).toBe(false)
  })

  it('treats a weak etag as matching, since a proxy may have downgraded ours', async () => {
    const first = await call(get('/assets/app.css'))
    const etag = first?.headers.get('etag') ?? ''
    const second = await call(get('/assets/app.css', { 'if-none-match': `W/${etag}` }))
    expect(second?.status).toBe(304)
  })

  it('honours a wildcard if-none-match', async () => {
    expect((await call(get('/assets/app.css', { 'if-none-match': '*' })))?.status).toBe(304)
  })

  it('matches an etag inside a comma-separated list', async () => {
    const first = await call(get('/assets/app.css'))
    const etag = first?.headers.get('etag') ?? ''
    const second = await call(get('/assets/app.css', { 'if-none-match': `"other", ${etag}` }))
    expect(second?.status).toBe(304)
  })

  it('serves a full response when the etag does not match', async () => {
    const response = await call(get('/assets/app.css', { 'if-none-match': '"stale"' }))
    expect(response?.status).toBe(200)
  })

  it('omits the etag when the reader supplies no metadata', async () => {
    // Degrading to "no conditional requests" beats inventing a validator that
    // would then be wrong.
    const response = await call(get('/assets/nometa.txt'))
    expect(response?.status).toBe(200)
    expect(response?.headers.has('etag')).toBe(false)
    expect(response?.headers.has('content-length')).toBe(false)
  })

  it('answers HEAD with the headers and no body', async () => {
    const response = await call(get('/assets/app.css', {}, 'HEAD'))
    expect(response?.status).toBe(200)
    expect(response?.body).toBeNull()
    expect(response?.headers.get('content-length')).toBe('19')
  })

  it('serves binary bodies', async () => {
    const response = await call(get('/assets/data.bin'))
    expect(new Uint8Array(await (response as Response).arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]))
    expect(response?.headers.get('content-type')).toBe('application/octet-stream')
  })

  it('falls through for a path outside the prefix, so the API still routes it', async () => {
    expect(await call(get('/api/users'))).toBeUndefined()
  })

  it('falls through for a missing file, so the client sees the API’s own 404', async () => {
    expect(await call(get('/assets/missing.css'))).toBeUndefined()
  })

  it('falls through for an unsafe method rather than answering 405 for paths it does not own', async () => {
    expect(await call(get('/assets/app.css', {}, 'POST'))).toBeUndefined()
  })

  it('refuses a percent-encoded traversal', async () => {
    expect(await call(get('/assets/%2e%2e%2fpublic%2f.env'))).toBeUndefined()
  })

  it('refuses a dotfile by default', async () => {
    expect(await call(get('/assets/.env'))).toBeUndefined()
  })

  it('serves a dotfile when the caller opts in', async () => {
    const response = (await gate({ dotfiles: 'allow' })(get('/assets/.env'), undefined, undefined, {})) as Response
    expect(response.status).toBe(200)
  })

  it('returns synchronously on a miss, so an API request never allocates a promise', () => {
    // The gate runs ahead of routing on every request; a promise per miss is a
    // cost every non-static request would pay.
    expect(gate()(get('/api/users'), undefined, undefined, {})).toBeUndefined()
  })

  it('lets the reader override the guessed content type', async () => {
    const typed = createStatic({
      root: './public',
      prefix: '/assets',
      read: () => ({ body: 'x', type: 'application/x-custom' }),
    })
    const response = (await typed(get('/assets/whatever.css'), undefined, undefined, {})) as Response
    expect(response.headers.get('content-type')).toBe('application/x-custom')
  })

  it('stamps extra headers on served files', async () => {
    const stamped = createStatic({
      root: './public',
      prefix: '/assets',
      read,
      headers: { 'x-served-by': 'static' },
    })
    const response = (await stamped(get('/assets/app.css'), undefined, undefined, {})) as Response
    expect(response.headers.get('x-served-by')).toBe('static')
  })

  it('accepts a prefix written with a trailing slash', async () => {
    const trailing = createStatic({ root: './public', prefix: '/assets/', read })
    const response = (await trailing(get('/assets/app.css'), undefined, undefined, {})) as Response
    expect(response.status).toBe(200)
  })
})
