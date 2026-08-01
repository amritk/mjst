import { describe, expect, it } from 'vitest'

import { createDocs, docsHtml, SCALAR_VERSION } from './create-docs'

describe('create-docs', () => {
  it('serves an HTML reference page pointing at the spec', async () => {
    const docs = createDocs()
    const response = docs(new Request('http://localhost/docs'))
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8')
    const html = await response.text()
    expect(html).toContain('/openapi.json')
    expect(html).toContain('@scalar/api-reference')
  })

  it('honors a HEAD request with no body', async () => {
    const docs = createDocs()
    const response = docs(new Request('http://localhost/docs', { method: 'HEAD' }))
    expect(response.status).toBe(200)
    expect(await response.text()).toBe('')
  })

  it('rejects non-GET methods with 405 and an allow header', () => {
    const docs = createDocs()
    const response = docs(new Request('http://localhost/docs', { method: 'POST' }))
    expect(response.status).toBe(405)
    expect(response.headers.get('allow')).toBe('GET, HEAD')
  })

  it('points the reference at a custom spec url', () => {
    expect(docsHtml({ specUrl: '/v1/openapi.json' })).toContain('data-url="/v1/openapi.json"')
  })

  it('escapes the title and spec url', () => {
    const html = docsHtml({ title: '<script>x</script>', specUrl: '/a"b' })
    expect(html).not.toContain('<script>x</script>')
    expect(html).toContain('&lt;script&gt;')
    expect(html).toContain('/a&quot;b')
  })

  it('allows pinning the CDN origin', () => {
    expect(docsHtml({ cdn: 'https://assets.example' })).toContain('https://assets.example/@scalar/api-reference')
  })

  it('escapes the cdn so it cannot break out of the src attribute', () => {
    // These options routinely come from config, not from a literal in the
    // source — an unescaped quote here would close `src` and let the rest of
    // the value become attributes (an `onload` handler, say).
    const html = docsHtml({ cdn: 'https://x" onload="alert(1)' })
    expect(html).not.toContain('onload="alert(1)"')
    expect(html).toContain('&quot; onload=&quot;')
  })

  it('pins the bundle version by default', () => {
    expect(docsHtml()).toContain(`/@scalar/api-reference@${SCALAR_VERSION}"`)
  })

  it('drops the version segment when it is explicitly empty', () => {
    // The self-hosted-single-file shape: a fixed path with no version in it.
    expect(docsHtml({ cdn: 'https://assets.example', version: '' })).toContain(
      'src="https://assets.example/@scalar/api-reference"',
    )
  })

  it('sets integrity and crossorigin when a hash is supplied', () => {
    const html = docsHtml({ integrity: 'sha384-abc123' })
    expect(html).toContain('integrity="sha384-abc123"')
    // Without CORS the browser cannot read the bytes it is meant to hash, so
    // an SRI-checked script would be blocked outright.
    expect(html).toContain('crossorigin="anonymous"')
  })

  it('omits integrity entirely when no hash is supplied', () => {
    const html = docsHtml()
    expect(html).not.toContain('integrity')
    expect(html).not.toContain('crossorigin')
  })

  it('escapes an integrity hash', () => {
    expect(docsHtml({ integrity: 'sha384-a" onerror="x' })).not.toContain('onerror="x"')
  })
})
