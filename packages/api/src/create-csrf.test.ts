import { describe, expect, it } from 'vitest'

import { createCsrf } from './create-csrf'

const request = (method: string, headers: Record<string, string> = {}): Request =>
  new Request('http://localhost/', { method, headers })

describe('create-csrf', () => {
  it('lets safe methods through', async () => {
    const csrf = createCsrf()
    expect(await csrf.onRequest(request('GET'), undefined, undefined, {})).toBeUndefined()
  })

  it('rejects an unsafe request with no token', async () => {
    const csrf = createCsrf()
    const blocked = await csrf.onRequest(request('POST'), undefined, undefined, {})
    expect(blocked?.status).toBe(403)
    expect(await blocked?.json()).toEqual({ error: 'csrf_failed' })
  })

  it('rejects when header and cookie tokens disagree', async () => {
    const csrf = createCsrf()
    const blocked = await csrf.onRequest(
      request('POST', { cookie: 'csrf_token=abc', 'x-csrf-token': 'xyz' }),
      undefined,
      undefined,
      {},
    )
    expect(blocked?.status).toBe(403)
  })

  it('rejects an unsafe request whose cookie and header tokens are both empty', async () => {
    const csrf = createCsrf()
    const blocked = await csrf.onRequest(
      request('POST', { cookie: 'csrf_token=', 'x-csrf-token': '' }),
      undefined,
      undefined,
      {},
    )
    expect(blocked?.status).toBe(403)
  })

  it('allows an unsafe request when the tokens match', async () => {
    const csrf = createCsrf()
    const result = await csrf.onRequest(
      request('POST', { cookie: 'csrf_token=match', 'x-csrf-token': 'match' }),
      undefined,
      undefined,
      {},
    )
    expect(result).toBeUndefined()
  })

  it('seeds a token cookie when the request had none', () => {
    const csrf = createCsrf({ generate: () => 'seeded' })
    const response = new Response(null)
    csrf.onResponse(response, request('GET'), {})
    expect(response.headers.get('set-cookie')).toContain('csrf_token=seeded')
    expect(response.headers.get('set-cookie')).toContain('SameSite=Lax')
    expect(response.headers.get('set-cookie')).toContain('Secure')
  })

  it('does not reseed when a token cookie is already present', () => {
    const csrf = createCsrf()
    const response = new Response(null)
    csrf.onResponse(response, request('GET', { cookie: 'csrf_token=existing' }), {})
    expect(response.headers.get('set-cookie')).toBeNull()
  })

  it('honors exemptions', async () => {
    const csrf = createCsrf({ exempt: (r) => new URL(r.url).pathname.startsWith('/api/') })
    const exempt = new Request('http://localhost/api/webhook', { method: 'POST' })
    expect(await csrf.onRequest(exempt, undefined, undefined, {})).toBeUndefined()
  })

  it('seeds the cookie on a response whose headers are immutable', async () => {
    // What a proxying mount returns: mutating its headers in place throws, and
    // a throwing decorator would cost the whole response.
    const csrf = createCsrf()
    const proxied = Response.redirect('https://example.com/next', 302)
    const decorated = await csrf.onResponse(proxied, request('GET'), {})
    expect(decorated).toBeInstanceOf(Response)
    expect((decorated as Response).headers.get('set-cookie')).toContain('csrf_token=')
    expect((decorated as Response).status).toBe(302)
  })
})
