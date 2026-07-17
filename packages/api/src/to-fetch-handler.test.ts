import { describe, expect, it } from 'vitest'

import { createApi } from './create-api'
import { createCors } from './create-cors'
import { defineRoute } from './define-route'
import { toFetchHandler } from './to-fetch-handler'

const echo = defineRoute({
  method: 'post',
  path: '/echo/{id}',
  request: {
    params: { type: 'object', properties: { id: { type: 'integer' } }, required: ['id'] },
    query: { type: 'object', properties: { upper: { type: 'boolean' } } },
    body: { type: 'object', properties: { message: { type: 'string' } }, required: ['message'] },
  },
  responses: {
    200: { body: { type: 'object', properties: { id: {}, message: {} } } },
  },
  handler: ({ params, query, body }) => ({
    status: 200,
    body: { id: params.id, message: query.upper === true ? body.message.toUpperCase() : body.message },
  }),
})

const empty = defineRoute({
  method: 'delete',
  path: '/things/{id}',
  responses: { 204: {} },
  handler: () => ({ status: 204, headers: { 'x-deleted': 'yes' } }),
})

describe('to-fetch-handler', () => {
  const handler = toFetchHandler(createApi({ routes: [echo, empty] }))

  it('translates a Request through the pipeline and back to a Response', async () => {
    const response = await handler(
      new Request('http://localhost/echo/7?upper=true', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ message: 'hi' }),
      }),
    )
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('application/json')
    expect(await response.json()).toEqual({ id: 7, message: 'HI' })
  })

  it('sends bodyless replies with custom headers and no content', async () => {
    const response = await handler(new Request('http://localhost/things/3', { method: 'DELETE' }))
    expect(response.status).toBe(204)
    expect(response.headers.get('x-deleted')).toBe('yes')
    expect(await response.text()).toBe('')
  })

  it('answers 400 for a malformed JSON body', async () => {
    const response = await handler(new Request('http://localhost/echo/7', { method: 'POST', body: 'not json' }))
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: 'invalid_json' })
  })

  it('answers 404 for unknown paths', async () => {
    const response = await handler(new Request('http://localhost/missing'))
    expect(response.status).toBe(404)
  })

  it('serves the OpenAPI document', async () => {
    const response = await handler(new Request('http://localhost/openapi.json'))
    expect(response.status).toBe(200)
    const document = (await response.json()) as { openapi: string }
    expect(document.openapi).toBe('3.1.0')
  })

  it('routes mount prefixes to the sub-handler with the raw Request', async () => {
    const mounted = toFetchHandler(createApi({ routes: [empty] }), {
      // A Better-Auth-style self-contained handler owning /api/auth/*.
      mounts: { '/api/auth': (request) => Response.json({ auth: true, url: request.url }, { status: 418 }) },
    })
    const exact = await mounted(new Request('http://localhost/api/auth'))
    expect(exact.status).toBe(418)
    const nested = await mounted(new Request('http://localhost/api/auth/sign-in/email?flow=1', { method: 'POST' }))
    expect(nested.status).toBe(418)
    expect(await nested.json()).toEqual({ auth: true, url: 'http://localhost/api/auth/sign-in/email?flow=1' })
    // A sibling path that merely shares the prefix text is not mounted.
    const sibling = await mounted(new Request('http://localhost/api/authors'))
    expect(sibling.status).toBe(404)
  })

  it('rejects mount prefixes without a leading slash at construction', () => {
    expect(() =>
      toFetchHandler(createApi({ routes: [empty] }), { mounts: { 'api/auth': () => new Response(null) } }),
    ).toThrow(/must start with/)
  })

  it('streams a contentType response body through untouched', async () => {
    const chat = defineRoute({
      method: 'post',
      path: '/chat',
      responses: { 200: { contentType: 'text/plain; charset=utf-8' } },
      handler: () => {
        const encoder = new TextEncoder()
        const stream = new ReadableStream<Uint8Array>({
          start: (controller) => {
            controller.enqueue(encoder.encode('hello '))
            controller.enqueue(encoder.encode('stream'))
            controller.close()
          },
        })
        return { status: 200, headers: { 'x-frame-protocol': '1' }, body: stream }
      },
    })
    const streaming = toFetchHandler(createApi({ routes: [chat] }))
    const response = await streaming(new Request('http://localhost/chat', { method: 'POST' }))
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('text/plain; charset=utf-8')
    expect(response.headers.get('x-frame-protocol')).toBe('1')
    expect(await response.text()).toBe('hello stream')
  })

  it('sends string and byte bodies for contentType statuses without JSON encoding', async () => {
    const csv = defineRoute({
      method: 'get',
      path: '/export',
      responses: { 200: { contentType: 'text/csv' } },
      handler: () => ({ status: 200, body: 'a,b\n1,2' }),
    })
    const exporter = toFetchHandler(createApi({ routes: [csv] }))
    const response = await exporter(new Request('http://localhost/export'))
    // JSON.stringify would have wrapped the payload in quotes.
    expect(await response.text()).toBe('a,b\n1,2')
    expect(response.headers.get('content-type')).toBe('text/csv')
  })

  it('gives handlers the raw body text for signature verification', async () => {
    const webhook = defineRoute({
      method: 'post',
      path: '/webhook',
      responses: { 200: { body: { type: 'object', properties: { raw: { type: 'string' } } } } },
      // No body schema — the pipeline must not consume the stream first.
      handler: async ({ request }) => ({ status: 200, body: { raw: await request.readText() } }),
    })
    const hooked = toFetchHandler(createApi({ routes: [webhook] }))
    const payload = '{"spacing": "matters  for  hmac"}'
    const response = await hooked(new Request('http://localhost/webhook', { method: 'POST', body: payload }))
    expect(await response.json()).toEqual({ raw: payload })
  })

  it('exposes the request abort signal to handlers', async () => {
    let seen: AbortSignal | undefined
    const probe = defineRoute({
      method: 'get',
      path: '/signal',
      responses: { 204: {} },
      handler: ({ request }) => {
        seen = request.signal
        return { status: 204 }
      },
    })
    const controller = new AbortController()
    const handlerWithSignal = toFetchHandler(createApi({ routes: [probe] }))
    await handlerWithSignal(new Request('http://localhost/signal', { signal: controller.signal }))
    expect(seen).toBeInstanceOf(AbortSignal)
  })

  it('answers 413 when the declared body exceeds maxBodyBytes', async () => {
    const capped = toFetchHandler(createApi({ routes: [echo] }), { maxBodyBytes: 16 })
    const response = await capped(
      new Request('http://localhost/echo/1', {
        method: 'POST',
        body: JSON.stringify({ message: 'far too long for a 16 byte limit' }),
      }),
    )
    expect(response.status).toBe(413)
    expect(await response.json()).toEqual({ error: 'payload_too_large' })
  })

  it('answers 413 when a handler-initiated raw read exceeds maxBodyBytes', async () => {
    const webhook = defineRoute({
      method: 'post',
      path: '/webhook',
      responses: { 200: {} },
      handler: async ({ request }) => {
        await request.readText()
        return { status: 200 }
      },
    })
    const capped = toFetchHandler(createApi({ routes: [webhook] }), { maxBodyBytes: 8 })
    const response = await capped(
      new Request('http://localhost/webhook', { method: 'POST', body: 'well beyond eight bytes' }),
    )
    expect(response.status).toBe(413)
  })

  it('runs onRequest gates in order and short-circuits into onResponse', async () => {
    const order: string[] = []
    const gated = toFetchHandler(createApi({ routes: [empty] }), {
      onRequest: [
        (request) => {
          order.push('gate-1')
          return request.headers.get('x-blocked') === '1'
            ? new Response(JSON.stringify({ error: 'rate_limited' }), { status: 429 })
            : undefined
        },
        () => {
          order.push('gate-2')
          return undefined
        },
      ],
      onResponse: [
        (response) => {
          order.push('decorate')
          response.headers.set('x-stamped', 'yes')
          return undefined
        },
      ],
    })

    const blocked = await gated(new Request('http://localhost/things/1', { headers: { 'x-blocked': '1' } }))
    expect(blocked.status).toBe(429)
    // The 429 still gets decorated, and gate-2 never ran.
    expect(blocked.headers.get('x-stamped')).toBe('yes')
    expect(order).toEqual(['gate-1', 'decorate'])

    order.length = 0
    const passed = await gated(new Request('http://localhost/things/1', { method: 'DELETE' }))
    expect(passed.status).toBe(204)
    expect(passed.headers.get('x-stamped')).toBe('yes')
    expect(order).toEqual(['gate-1', 'gate-2', 'decorate'])
  })

  it('decorates 404s and mount responses too', async () => {
    const stamped = toFetchHandler(createApi({ routes: [empty] }), {
      mounts: { '/api/auth': () => new Response(null, { status: 200 }) },
      onResponse: (response) => {
        response.headers.set('x-security', 'on')
        return undefined
      },
    })
    const missing = await stamped(new Request('http://localhost/nope'))
    expect(missing.status).toBe(404)
    expect(missing.headers.get('x-security')).toBe('on')
    const mounted = await stamped(new Request('http://localhost/api/auth/session'))
    expect(mounted.headers.get('x-security')).toBe('on')
  })

  it('answers HEAD via the GET route with the same headers and no body', async () => {
    const users = defineRoute({
      method: 'get',
      path: '/users/{id}',
      request: { params: { type: 'object', properties: { id: { type: 'integer' } }, required: ['id'] } },
      responses: { 200: { body: { type: 'object', properties: { id: {} } } } },
      handler: ({ params }) => ({ status: 200, headers: { 'x-lookup': 'hit' }, body: { id: params.id } }),
    })
    const heady = toFetchHandler(createApi({ routes: [users] }))
    const response = await heady(new Request('http://localhost/users/7', { method: 'HEAD' }))
    expect(response.status).toBe(200)
    expect(response.headers.get('x-lookup')).toBe('hit')
    expect(response.headers.get('content-type')).toContain('application/json')
    expect(await response.text()).toBe('')
  })

  it('validates HEAD requests exactly like GET', async () => {
    const users = defineRoute({
      method: 'get',
      path: '/users/{id}',
      request: { params: { type: 'object', properties: { id: { type: 'integer' } }, required: ['id'] } },
      responses: { 200: {} },
      handler: () => ({ status: 200 }),
    })
    const heady = toFetchHandler(createApi({ routes: [users] }))
    const response = await heady(new Request('http://localhost/users/not-a-number', { method: 'HEAD' }))
    expect(response.status).toBe(400)
    expect(await response.text()).toBe('')
  })

  it('cancels a streaming body instead of leaking it on HEAD', async () => {
    let cancelled = false
    const csv = defineRoute({
      method: 'get',
      path: '/export',
      responses: { 200: { contentType: 'text/csv' } },
      handler: () => ({
        status: 200,
        body: new ReadableStream<Uint8Array>({
          pull: (controller) => controller.enqueue(new TextEncoder().encode('a,b\n')),
          cancel: () => {
            cancelled = true
          },
        }),
      }),
    })
    const exporter = toFetchHandler(createApi({ routes: [csv] }))
    const response = await exporter(new Request('http://localhost/export', { method: 'HEAD' }))
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('text/csv')
    expect(await response.text()).toBe('')
    expect(cancelled).toBe(true)
  })

  it('serves HEAD on the OpenAPI path and keeps HEAD 404s and 405s intact', async () => {
    const openapi = await handler(new Request('http://localhost/openapi.json', { method: 'HEAD' }))
    expect(openapi.status).toBe(200)
    expect(await openapi.text()).toBe('')

    const missing = await handler(new Request('http://localhost/missing', { method: 'HEAD' }))
    expect(missing.status).toBe(404)
    expect(await missing.text()).toBe('')

    // /echo/{id} only serves POST — HEAD gets the 405, not the GET fallback.
    const wrongMethod = await handler(new Request('http://localhost/echo/7', { method: 'HEAD' }))
    expect(wrongMethod.status).toBe(405)
    expect(wrongMethod.headers.get('allow')).toBe('POST')
    expect(await wrongMethod.text()).toBe('')
  })

  it('advertises HEAD in allow lists whenever GET is allowed', async () => {
    const users = defineRoute({
      method: 'get',
      path: '/users',
      responses: { 200: {} },
      handler: () => ({ status: 200 }),
    })
    const heady = toFetchHandler(createApi({ routes: [users] }))
    const response = await heady(new Request('http://localhost/users', { method: 'PUT' }))
    expect(response.status).toBe(405)
    expect(response.headers.get('allow')).toBe('GET, HEAD')
  })

  it('lets a handler read the body after the pipeline validated it', async () => {
    const signed = defineRoute({
      method: 'post',
      path: '/signed',
      request: { body: { type: 'object', properties: { message: { type: 'string' } }, required: ['message'] } },
      responses: { 200: { body: { type: 'object', properties: { parsed: {}, raw: {} } } } },
      // Both the declared schema and the raw bytes — the webhook-HMAC shape
      // combined with parsed access. All reads share one buffered body.
      handler: async ({ body, request }) => ({
        status: 200,
        body: { parsed: body.message, raw: await request.readText() },
      }),
    })
    const hooked = toFetchHandler(createApi({ routes: [signed] }))
    const payload = '{"message":  "spacing kept"}'
    const response = await hooked(new Request('http://localhost/signed', { method: 'POST', body: payload }))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ parsed: 'spacing kept', raw: payload })
  })

  it('serves repeated and mixed raw reads from the same buffered body', async () => {
    const greedy = defineRoute({
      method: 'post',
      path: '/greedy',
      responses: { 200: { body: { type: 'object', properties: { first: {}, second: {}, byteLength: {} } } } },
      handler: async ({ request }) => {
        const first = await request.readText()
        const second = await request.readText()
        const bytes = await request.readBytes()
        return { status: 200, body: { first, second, byteLength: bytes.byteLength } }
      },
    })
    const hooked = toFetchHandler(createApi({ routes: [greedy] }))
    const response = await hooked(new Request('http://localhost/greedy', { method: 'POST', body: 'read me twice' }))
    expect(await response.json()).toEqual({ first: 'read me twice', second: 'read me twice', byteLength: 13 })
  })

  it('answers 500 when the reply body cannot be serialized', async () => {
    const cyclic = defineRoute({
      method: 'get',
      path: '/cyclic',
      responses: { 200: { body: { type: 'object' } } },
      handler: () => {
        const body: Record<string, unknown> = {}
        body['self'] = body
        return { status: 200, body }
      },
    })
    const broken = toFetchHandler(createApi({ routes: [cyclic] }))
    const response = await broken(new Request('http://localhost/cyclic'))
    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({ error: 'internal_error' })
  })

  it('answers 500 when a reply header name is invalid', async () => {
    const badHeader = defineRoute({
      method: 'get',
      path: '/bad-header',
      responses: { 204: {} },
      handler: () => ({ status: 204, headers: { 'bad header\n': 'x' } }),
    })
    const broken = toFetchHandler(createApi({ routes: [badHeader] }))
    const response = await broken(new Request('http://localhost/bad-header'))
    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({ error: 'internal_error' })
  })

  it('wires createCors preflight and decoration through the hook chain', async () => {
    const cors = createCors({ origin: (origin) => origin, credentials: true, exposeHeaders: ['x-demo-used'] })
    const handlerWithCors = toFetchHandler(createApi({ routes: [empty] }), {
      onRequest: [cors.onRequest],
      onResponse: [cors.onResponse],
    })

    const preflight = await handlerWithCors(
      new Request('http://localhost/things/9', {
        method: 'OPTIONS',
        headers: { origin: 'https://shop.example', 'access-control-request-method': 'DELETE' },
      }),
    )
    expect(preflight.status).toBe(204)
    expect(preflight.headers.get('access-control-allow-origin')).toBe('https://shop.example')

    const actual = await handlerWithCors(
      new Request('http://localhost/things/9', { method: 'DELETE', headers: { origin: 'https://shop.example' } }),
    )
    expect(actual.status).toBe(204)
    expect(actual.headers.get('access-control-allow-origin')).toBe('https://shop.example')
    expect(actual.headers.get('access-control-allow-credentials')).toBe('true')
    expect(actual.headers.get('access-control-expose-headers')).toBe('x-demo-used')
  })
})
