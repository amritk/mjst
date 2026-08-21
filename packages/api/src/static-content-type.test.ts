import { describe, expect, it } from 'vitest'

import { staticContentType } from './static-content-type'

describe('static-content-type', () => {
  it('types a stylesheet with a charset', () => {
    // Both halves matter under nosniff: the wrong type means the stylesheet is
    // not applied at all, and a missing charset mangles non-ASCII content.
    expect(staticContentType('./public/app.css')).toBe('text/css; charset=utf-8')
  })

  it('types the common script and document extensions', () => {
    expect(staticContentType('/a/b/main.js')).toBe('text/javascript; charset=utf-8')
    expect(staticContentType('/a/b/main.mjs')).toBe('text/javascript; charset=utf-8')
    expect(staticContentType('/a/index.html')).toBe('text/html; charset=utf-8')
    expect(staticContentType('/a/data.json')).toBe('application/json; charset=utf-8')
  })

  it('types images and fonts without a charset', () => {
    expect(staticContentType('logo.svg')).toBe('image/svg+xml')
    expect(staticContentType('logo.PNG')).toBe('image/png')
    expect(staticContentType('body.woff2')).toBe('font/woff2')
  })

  it('falls back to octet-stream for an unknown extension', () => {
    expect(staticContentType('archive.xyz')).toBe('application/octet-stream')
  })

  it('falls back for a file with no extension', () => {
    expect(staticContentType('/public/LICENSE')).toBe('application/octet-stream')
  })

  it('does not read a dot from a directory name as the file’s extension', () => {
    expect(staticContentType('/assets/v1.2/README')).toBe('application/octet-stream')
  })

  it('treats a leading dot as the whole name, not an extension', () => {
    // `.css` is a file named `.css`, not a stylesheet extension on an empty name.
    expect(staticContentType('/public/.css')).toBe('application/octet-stream')
  })
})
