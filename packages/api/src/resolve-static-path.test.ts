import { describe, expect, it } from 'vitest'

import { resolveStaticPath } from './resolve-static-path'

const resolve = (pathname: string, overrides: { dotfiles?: 'deny' | 'allow'; root?: string } = {}) =>
  resolveStaticPath({
    pathname,
    prefix: '/assets',
    root: overrides.root ?? './public',
    ...(overrides.dotfiles === undefined ? {} : { dotfiles: overrides.dotfiles }),
  })

describe('resolve-static-path', () => {
  it('resolves a plain file under the root', () => {
    expect(resolve('/assets/app.css')).toBe('./public/app.css')
  })

  it('resolves a nested file', () => {
    expect(resolve('/assets/css/site/app.css')).toBe('./public/css/site/app.css')
  })

  it('decodes percent-escapes inside a segment', () => {
    expect(resolve('/assets/my%20file.txt')).toBe('./public/my file.txt')
  })

  it('rejects a percent-encoded traversal, the escape that survives client normalization', () => {
    // A literal `../..` never reaches the server — clients and proxies collapse
    // it — so this encoded form is the one that actually gets attempted.
    expect(resolve('/assets/%2e%2e%2f%2e%2e%2fetc/passwd')).toBeUndefined()
  })

  it('rejects a literal parent segment', () => {
    expect(resolve('/assets/../secrets.txt')).toBeUndefined()
  })

  it('rejects a parent segment buried mid-path', () => {
    expect(resolve('/assets/css/%2e%2e/%2e%2e/.ssh/id_rsa')).toBeUndefined()
  })

  it('rejects an encoded separator, which would smuggle two segments as one', () => {
    expect(resolve('/assets/a%2fb')).toBeUndefined()
    expect(resolve('/assets/a%5cb')).toBeUndefined()
  })

  it('rejects an encoded NUL, which truncates the path in a filesystem call', () => {
    expect(resolve('/assets/app.css%00.txt')).toBeUndefined()
  })

  it('rejects a malformed escape', () => {
    expect(resolve('/assets/%zz')).toBeUndefined()
  })

  it('denies dotfiles by default, since a document root sits next to .env and .git', () => {
    expect(resolve('/assets/.env')).toBeUndefined()
    expect(resolve('/assets/.git/config')).toBeUndefined()
  })

  it('serves dotfiles when the caller opts in', () => {
    expect(resolve('/assets/.well-known/acme', { dotfiles: 'allow' })).toBe('./public/.well-known/acme')
  })

  it('requires the prefix to end on a segment boundary', () => {
    // Without this check, an `/assets` root would answer for `/assets-private`.
    expect(resolve('/assets-private/secret.txt')).toBeUndefined()
  })

  it('ignores requests outside the prefix', () => {
    expect(resolve('/api/users')).toBeUndefined()
  })

  it('returns undefined for the bare prefix, which names a directory and not a file', () => {
    expect(resolve('/assets')).toBeUndefined()
    expect(resolve('/assets/')).toBeUndefined()
  })

  it('collapses empty segments from doubled slashes', () => {
    expect(resolve('/assets//css//app.css')).toBe('./public/css/app.css')
  })

  it('does not double the separator when the root carries a trailing slash', () => {
    expect(resolve('/assets/app.css', { root: './public/' })).toBe('./public/app.css')
  })

  it('works with an absolute root', () => {
    expect(resolve('/assets/app.css', { root: '/srv/www' })).toBe('/srv/www/app.css')
  })
})
