import { describe, expect, it } from 'vitest'

import { createApi } from './create-api'
import { defineRoute } from './define-route'
import type { Api, ApiRequest, ContextGuardInput, ErasedGuard, OnErrorDetails } from './types'

type AppContext = { readonly session: { readonly role: string } | null }

const request = (method: string, path: string, headers: Readonly<Record<string, string>> = {}): ApiRequest => ({
  method,
  path,
  searchParams: () => new URLSearchParams(),
  header: (name) => headers[name],
  readBody: () => Promise.reject(new SyntaxError('no body')),
  readText: () => Promise.resolve(''),
  readBytes: () => Promise.resolve(new Uint8Array()),
})

const unauthorized = { status: 401, body: { error: 'unauthorized' } } as const

/**
 * The one route in the document. Its path pattern is distinctive so a test can
 * check that no part of the schema leaked into a denial.
 */
const getWidget = defineRoute({
  method: 'get',
  path: '/widgets/{id}',
  request: { params: { type: 'object', properties: { id: { type: 'integer' } }, required: ['id'] } },
  responses: { 200: { body: { type: 'object', properties: { id: { type: 'integer' } }, required: ['id'] } } },
  handler: ({ params }) => ({ status: 200, body: { id: params.id } }),
})

/** Denies anyone without an `x-role` header — the document's stand-in for a session check. */
const denyAnonymous: ErasedGuard = (gate) => (gate.request.header('x-role') === undefined ? unauthorized : undefined)

const build = (openApiGuards: readonly ErasedGuard[]): Api => createApi({ routes: [getWidget], openApiGuards })

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : 'unknown')

describe('open-api-guards', () => {
  it('serves the document to anyone when no guards are configured', async () => {
    const api = createApi({ routes: [getWidget] })
    const response = await api.handle(request('GET', '/openapi.json'))
    expect(response.status).toBe(200)
    expect(response.contentType).toBe('application/json')
  })

  it('denies an anonymous request for the document and serves a permitted one', async () => {
    const api = build([denyAnonymous])
    const denied = await api.handle(request('GET', '/openapi.json'))
    expect(denied).toEqual(unauthorized)
    // The point of gating the endpoint: none of the schema goes out with the denial.
    const serialized = JSON.stringify(denied)
    expect(serialized).not.toContain('openapi')
    expect(serialized).not.toContain('/widgets/{id}')

    const allowed = await api.handle(request('GET', '/openapi.json', { 'x-role': 'admin' }))
    expect(allowed.status).toBe(200)
    expect(allowed.contentType).toBe('application/json')
    expect(JSON.parse(allowed.body as string)).toMatchObject({ openapi: '3.1.0' })
  })

  it('runs guards in order and stops at the first denial', async () => {
    const calls: string[] = []
    const api = build([
      (gate) => {
        calls.push('first')
        return gate.request.header('x-role') === undefined ? unauthorized : undefined
      },
      () => {
        calls.push('second')
        return undefined
      },
    ])
    expect((await api.handle(request('GET', '/openapi.json'))).status).toBe(401)
    expect(calls).toEqual(['first'])

    calls.length = 0
    expect((await api.handle(request('GET', '/openapi.json', { 'x-role': 'admin' }))).status).toBe(200)
    expect(calls).toEqual(['first', 'second'])
  })

  it('builds the app context first and hands it to the guards with empty request slots', async () => {
    let built = 0
    const gates: ContextGuardInput<AppContext>[] = []
    const api = createApi({
      routes: [getWidget],
      context: ({ request: incoming }) => {
        built += 1
        const role = incoming.header('x-role')
        return { session: role === undefined ? null : { role } }
      },
      openApiGuards: [
        (gate: ContextGuardInput<AppContext>) => {
          gates.push(gate)
          return gate.context.session === null ? unauthorized : undefined
        },
      ],
    })
    expect((await api.handle(request('GET', '/openapi.json', { 'x-role': 'admin' }))).status).toBe(200)
    expect(built).toBe(1)
    expect(gates[0]?.context).toEqual({ session: { role: 'admin' } })
    // Nothing has been matched or validated yet, so the slots are empty and the
    // raw request is all a document guard has besides the context.
    expect(gates[0]?.params).toBeUndefined()
    expect(gates[0]?.query).toBeUndefined()
    expect(gates[0]?.body).toBeUndefined()
    expect(gates[0]?.headers).toBeUndefined()
    expect(gates[0]?.cookies).toBeUndefined()
    expect(gates[0]?.request.path).toBe('/openapi.json')
  })

  it('keeps if-none-match revalidation working for a permitted caller', async () => {
    const api = build([denyAnonymous])
    const first = await api.handle(request('GET', '/openapi.json', { 'x-role': 'admin' }))
    const etag = (first.headers as Record<string, string>)['etag'] ?? ''
    expect(etag).toMatch(/^"[0-9a-f]{8}"$/)

    const revalidated = await api.handle(request('GET', '/openapi.json', { 'x-role': 'admin', 'if-none-match': etag }))
    expect(revalidated.status).toBe(304)
    expect(revalidated.body).toBeUndefined()

    // A matching etag is not a way past the guard: guards run before the
    // revalidation check, so an anonymous caller is denied, not 304ed.
    const anonymous = await api.handle(request('GET', '/openapi.json', { 'if-none-match': etag }))
    expect(anonymous).toEqual(unauthorized)
  })

  it('honors a raw Response denial', async () => {
    const raw = new Response('nope', { status: 403 })
    const response = await build([() => raw]).handle(request('GET', '/openapi.json'))
    expect(response.status).toBe(403)
    expect(response.raw).toBe(raw)
    expect(response.body).toBeUndefined()
  })

  it('awaits an async guard', async () => {
    const api = build([
      async (gate) => {
        await Promise.resolve()
        return gate.request.header('x-role') === undefined ? unauthorized : undefined
      },
    ])
    expect(await api.handle(request('GET', '/openapi.json'))).toEqual(unauthorized)
    expect((await api.handle(request('GET', '/openapi.json', { 'x-role': 'admin' }))).status).toBe(200)
  })

  it('gates HEAD on the document path as well as GET', async () => {
    const api = build([denyAnonymous])
    expect(await api.handle(request('HEAD', '/openapi.json'))).toEqual(unauthorized)
    expect((await api.handle(request('HEAD', '/openapi.json', { 'x-role': 'admin' }))).status).toBe(200)
  })

  it('routes a throwing guard to onError with no route in the details', async () => {
    let details: OnErrorDetails | undefined
    const api = createApi({
      routes: [getWidget],
      openApiGuards: [
        () => {
          throw new Error('guard blew up')
        },
      ],
      onError: (error, _request, errorDetails) => {
        details = errorDetails
        return { status: 500, body: { error: messageOf(error) } }
      },
    })
    expect(await api.handle(request('GET', '/openapi.json'))).toEqual({ status: 500, body: { error: 'guard blew up' } })
    // The document is answered before route matching, so there is no contract
    // to name — `undefined` here is exactly what marks this path.
    expect(details).toBeDefined()
    expect(details?.route).toBeUndefined()
  })

  it('routes a throwing context factory on the document path to onError', async () => {
    let details: OnErrorDetails | undefined
    const api = createApi({
      routes: [getWidget],
      context: () => {
        throw new Error('no database')
      },
      openApiGuards: [denyAnonymous],
      onError: (error, _request, errorDetails) => {
        details = errorDetails
        return { status: 503, body: { error: messageOf(error) } }
      },
    })
    expect(await api.handle(request('GET', '/openapi.json'))).toEqual({ status: 503, body: { error: 'no database' } })
    expect(details?.route).toBeUndefined()
  })

  it('answers a bare 500 for a throwing guard with no onError', async () => {
    const api = build([
      () => {
        throw new Error('nope')
      },
    ])
    expect(await api.handle(request('GET', '/openapi.json'))).toEqual({
      status: 500,
      body: { error: 'internal_error' },
    })
  })

  it('gates only the document, leaving ordinary routes alone', async () => {
    const api = build([denyAnonymous])
    expect(await api.handle(request('GET', '/widgets/7'))).toEqual({ status: 200, body: { id: 7 } })
  })
})
