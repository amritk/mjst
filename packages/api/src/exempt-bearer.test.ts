import { describe, expect, it } from 'vitest'

import { createCsrf } from './create-csrf'
import { exemptBearer } from './exempt-bearer'

const post = (headers: Record<string, string>): Request =>
  new Request('https://api.test/thing', { method: 'POST', headers })

describe('exempt-bearer', () => {
  it('exempts a request carrying a bearer token', () => {
    expect(exemptBearer(post({ authorization: 'Bearer abc123' }))).toBe(true)
  })

  it('matches the scheme case-insensitively, per RFC 9110', () => {
    expect(exemptBearer(post({ authorization: 'bearer abc123' }))).toBe(true)
    expect(exemptBearer(post({ authorization: 'BEARER abc123' }))).toBe(true)
  })

  it('does not exempt a request with no authorization header', () => {
    expect(exemptBearer(post({}))).toBe(false)
  })

  it('does not exempt a bare scheme with no credential after it', () => {
    expect(exemptBearer(post({ authorization: 'Bearer' }))).toBe(false)
    expect(exemptBearer(post({ authorization: 'Bearer   ' }))).toBe(false)
  })

  it('does not exempt another auth scheme', () => {
    // Basic rides on ambient browser credentials the way cookies do, so the
    // reasoning that makes the bearer exemption safe does not extend to it.
    expect(exemptBearer(post({ authorization: 'Basic dXNlcjpwYXNz' }))).toBe(false)
  })

  it('lets a native POST through createCsrf that would otherwise 403', async () => {
    const csrf = createCsrf({ exempt: exemptBearer })
    const denied = await csrf.onRequest(post({}), undefined, undefined, {})
    expect(denied?.status).toBe(403)

    const allowed = await csrf.onRequest(post({ authorization: 'Bearer abc123' }), undefined, undefined, {})
    expect(allowed).toBeUndefined()
  })

  it('still guards a browser request that only claims an origin', async () => {
    const csrf = createCsrf({ exempt: exemptBearer })
    // The loose "no Origin means not a browser" test would have let this
    // through; a cross-site form post is exactly what must not pass.
    const denied = await csrf.onRequest(post({ origin: 'https://evil.test' }), undefined, undefined, {})
    expect(denied?.status).toBe(403)
  })
})
