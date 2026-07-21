import { describe, expect, it } from 'vitest'

import { createDocs, docsHtml } from './create-docs'

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
})
