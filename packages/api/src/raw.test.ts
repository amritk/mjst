import { describe, expect, it } from 'vitest'

import { createApi } from './create-api'
import { defineRoute } from './define-route'
import { raw } from './raw'
import type { ApiRequest, RawReply } from './types'

const request = (method: string, path: string): ApiRequest => ({
  method,
  path,
  searchParams: () => new URLSearchParams(),
  header: () => undefined,
  readBody: () => Promise.reject(new SyntaxError('no body')),
  readText: () => Promise.resolve(''),
  readBytes: () => Promise.resolve(new Uint8Array()),
})

const errorBody = {
  type: 'object',
  properties: { error: { type: 'string' } },
  required: ['error'],
  additionalProperties: false,
} as const

const okBody = {
  type: 'object',
  properties: { id: { type: 'string' } },
  required: ['id'],
  additionalProperties: false,
} as const

describe('raw', () => {
  it('wraps a Response so the pipeline sends it verbatim, skipping response validation', async () => {
    const escapeRoute = defineRoute({
      method: 'get',
      path: '/escape',
      responses: { 200: { body: okBody } },
      // The 202 is undeclared and the body does not match the 200 schema — the
      // escape hatch bypasses both checks.
      handler: () => raw(new Response('raw bytes', { status: 202, headers: { 'content-type': 'text/plain' } })),
    })
    const api = createApi({ routes: [escapeRoute], validateResponses: true })
    const response = await api.handle(request('GET', '/escape'))
    expect(response.status).toBe(202)
    expect(response.raw).toBeInstanceOf(Response)
    expect(response.body).toBeUndefined()
    expect(await response.raw?.text()).toBe('raw bytes')
  })

  it('still honors a bare Response from a pre-0.10 handler', async () => {
    const legacy = defineRoute({
      method: 'get',
      path: '/legacy',
      responses: { 200: { body: okBody } },
      // The types no longer offer a bare `Response` — hence the cast — but the
      // pipeline keeps sending one, so handlers written against 0.7–0.9 (and
      // untyped JavaScript ones) do not silently degrade into a reply whose
      // `headers` is a `Headers` and whose `body` is a stream.
      handler: (() => new Response('legacy', { status: 202 })) as unknown as () => RawReply,
    })
    const api = createApi({ routes: [legacy], validateResponses: true })
    const response = await api.handle(request('GET', '/legacy'))
    expect(response.status).toBe(202)
    expect(response.raw).toBeInstanceOf(Response)
    expect(await response.raw?.text()).toBe('legacy')
  })

  it('carries a guard denial out untouched', async () => {
    const denial = new Response('nope', { status: 403 })
    const gated = defineRoute({
      method: 'get',
      path: '/gated',
      responses: { 200: { body: okBody } },
      guards: [() => raw(denial)],
      handler: () => ({ status: 200, body: { id: 'x' } }),
    })
    const api = createApi({ routes: [gated], validateResponses: true })
    const response = await api.handle(request('GET', '/gated'))
    expect(response.status).toBe(403)
    expect(response.raw).toBe(denial)
  })
})

/**
 * The regression 0.7.0 introduced by putting a bare `Response` in the handler
 * and guard return unions.
 *
 * `Response.status` is a plain `number`, which makes `Response` match on
 * `status` for *every* declared status; TypeScript then requires the reply to
 * be assignable to `Response` as well, and reports the miss as a misleading
 * "'502' is not assignable to '503'". `RawReply` has no `status`, so the reply
 * union's discriminant is left intact.
 *
 * The routes below therefore give **every** declared status a body of a
 * non-unit type on purpose: if any status declared no body (or a `contentType`
 * one), `body` would itself become a discriminant, exclude `Response` from the
 * match, and mask the defect. Both cases are type-level assertions — they fail
 * `types:check`, not the runtime expectations, if the escape hatch ever goes
 * back to a bare `Response`.
 */
describe('union-status replies', () => {
  type EmbedResult = { readonly ok: true } | { readonly ok: false; readonly status: 502 | 503; readonly error: string }

  it('accepts a handler reply whose status is a union of declared statuses', async () => {
    const triggerEmbed = (): EmbedResult => ({ ok: false, status: 503, error: 'upstream_unavailable' })
    const embed = defineRoute({
      method: 'post',
      path: '/embed',
      responses: { 202: { body: okBody }, 502: { body: errorBody }, 503: { body: errorBody } },
      handler: () => {
        const result = triggerEmbed()
        // `result.status` is `502 | 503`; the contract declares both.
        if (!result.ok) return { status: result.status, body: { error: result.error } }
        return { status: 202, body: { id: 'queued' } }
      },
    })
    const api = createApi({ routes: [embed], validateResponses: true })
    const response = await api.handle(request('POST', '/embed'))
    expect(response.status).toBe(503)
    expect(response.body).toEqual({ error: 'upstream_unavailable' })
  })

  it('accepts a guard denial whose status is a union of declared statuses', async () => {
    const deny = (): { readonly status: 401 | 403; readonly error: string } | undefined => ({
      status: 403,
      error: 'forbidden',
    })
    const gated = defineRoute({
      method: 'get',
      path: '/gated',
      responses: { 200: { body: okBody }, 401: { body: errorBody }, 403: { body: errorBody } },
      guards: [
        () => {
          const denial = deny()
          // Same shape on the guard side: both statuses are declared.
          return denial === undefined ? undefined : { status: denial.status, body: { error: denial.error } }
        },
      ],
      handler: () => ({ status: 200, body: { id: 'x' } }),
    })
    const api = createApi({ routes: [gated], validateResponses: true })
    const response = await api.handle(request('GET', '/gated'))
    expect(response.status).toBe(403)
    expect(response.body).toEqual({ error: 'forbidden' })
  })
})
