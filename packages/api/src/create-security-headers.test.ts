import { describe, expect, it } from 'vitest'

import { createSecurityHeaders } from './create-security-headers'

const decorate = (decorator: ReturnType<typeof createSecurityHeaders>, response = new Response(null)): Response => {
  decorator(response, new Request('http://localhost/'), {})
  return response
}

describe('create-security-headers', () => {
  it('stamps the conservative baseline by default', () => {
    const response = decorate(createSecurityHeaders())
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    expect(response.headers.get('x-frame-options')).toBe('SAMEORIGIN')
    expect(response.headers.get('referrer-policy')).toBe('no-referrer')
    expect(response.headers.get('cross-origin-opener-policy')).toBe('same-origin')
    expect(response.headers.get('origin-agent-cluster')).toBe('?1')
  })

  it('leaves HSTS and CSP off unless asked', () => {
    const response = decorate(createSecurityHeaders())
    expect(response.headers.has('strict-transport-security')).toBe(false)
    expect(response.headers.has('content-security-policy')).toBe(false)
  })

  it('enables HSTS with a default value and CSP with the given policy', () => {
    const response = decorate(
      createSecurityHeaders({ strictTransportSecurity: true, contentSecurityPolicy: "default-src 'self'" }),
    )
    expect(response.headers.get('strict-transport-security')).toBe('max-age=15552000; includeSubDomains')
    expect(response.headers.get('content-security-policy')).toBe("default-src 'self'")
  })

  it('omits a header set to false and overrides one set to a string', () => {
    const response = decorate(createSecurityHeaders({ frameOptions: false, referrerPolicy: 'strict-origin' }))
    expect(response.headers.has('x-frame-options')).toBe(false)
    expect(response.headers.get('referrer-policy')).toBe('strict-origin')
  })

  it('never clobbers a header the handler already set', () => {
    const response = new Response(null, { headers: { 'x-frame-options': 'DENY' } })
    decorate(createSecurityHeaders(), response)
    expect(response.headers.get('x-frame-options')).toBe('DENY')
  })
})
