import { describe, expect, it } from 'vitest'

import { createSecurityHeaders } from './create-security-headers'

const decorate = (decorator: ReturnType<typeof createSecurityHeaders>, response = new Response(null)): Response => {
  // The decorator hands back the response to stamp — the same one when its
  // headers were already writable, a clone when they were not — so the
  // assertions have to read whichever came back, not the input.
  const stamped = decorator(response, new Request('http://localhost/'), {})
  return (stamped as Response | undefined) ?? response
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

  it('stamps a response whose headers are immutable', () => {
    // What a proxying mount returns. Setting a header on it directly throws,
    // and a throwing decorator collapses the whole reply to a 500 — so a
    // `createSecurityHeaders` + `mounts` app would 500 on every proxied route.
    const proxied = Response.redirect('https://example.com/next', 302)
    const stamped = decorate(createSecurityHeaders(), proxied)
    expect(stamped).not.toBe(proxied)
    expect(stamped.status).toBe(302)
    expect(stamped.headers.get('location')).toBe('https://example.com/next')
    expect(stamped.headers.get('x-content-type-options')).toBe('nosniff')
  })

  it('leaves an immutable response alone when every header is opted out', () => {
    // Nothing to stamp means nothing to clone: the probe never runs.
    const proxied = Response.redirect('https://example.com/next', 302)
    const stamped = decorate(
      createSecurityHeaders({
        contentTypeOptions: false,
        frameOptions: false,
        referrerPolicy: false,
        crossOriginOpenerPolicy: false,
        crossOriginResourcePolicy: false,
        originAgentCluster: false,
        dnsPrefetchControl: false,
      }),
      proxied,
    )
    expect(stamped).toBe(proxied)
  })
})
