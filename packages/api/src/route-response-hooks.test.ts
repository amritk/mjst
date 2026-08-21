import { describe, expect, it } from 'vitest'

import { createApi } from './create-api'
import { defineRoute } from './define-route'
import { raw } from './raw'
import { secureRoutes, securityGuard } from './secure-routes'
import { toFetchHandler } from './to-fetch-handler'
import type { ContextGuardInput } from './types'

const trail = {
  type: 'object',
  properties: { trail: { type: 'string' } },
  required: ['trail'],
  additionalProperties: false,
} as const

const handlerFor = (routes: Parameters<typeof createApi>[0]['routes'], validateResponses = false) =>
  toFetchHandler(createApi({ routes, info: { title: 't', version: '1.0.0' }, validateResponses }))

/**
 * Appends to a reply's `trail`. A hook is handed `RouteReply | RawReply`, so
 * reading `body` needs a narrowing the tests would otherwise repeat at every
 * call site; the cast keeps them to one line and is safe because every route
 * here declares a trail body.
 */
const append = <T>(reply: T, suffix: string): T => {
  const current = reply as unknown as { readonly body: { trail: string } }
  return { ...current, body: { trail: `${current.body.trail}>${suffix}` } } as unknown as T
}

describe('route response hooks', () => {
  it('runs hooks in order, each seeing the previous one’s reply', async () => {
    const route = defineRoute({
      method: 'get',
      path: '/x',
      responses: { 200: { body: trail } },
      onResponse: [(reply) => append(reply, 'one'), (reply) => append(reply, 'two')],
      handler: () => ({ status: 200 as const, body: { trail: 'handler' } }),
    })
    const reply = await handlerFor([route])(new Request('http://localhost/x'))
    expect(await reply.json()).toEqual({ trail: 'handler>one>two' })
  })

  it('keeps the reply when a hook returns undefined', async () => {
    const route = defineRoute({
      method: 'get',
      path: '/x',
      responses: { 200: { body: trail } },
      onResponse: [() => undefined, (reply) => append(reply, 'seen')],
      handler: () => ({ status: 200 as const, body: { trail: 'handler' } }),
    })
    const reply = await handlerFor([route])(new Request('http://localhost/x'))
    expect(await reply.json()).toEqual({ trail: 'handler>seen' })
  })

  it('awaits an async hook before responding', async () => {
    const route = defineRoute({
      method: 'get',
      path: '/x',
      responses: { 200: { body: trail } },
      onResponse: [
        async (reply) => {
          await Promise.resolve()
          return append(reply, 'async')
        },
      ],
      handler: () => ({ status: 200 as const, body: { trail: 'handler' } }),
    })
    const reply = await handlerFor([route])(new Request('http://localhost/x'))
    expect(await reply.json()).toEqual({ trail: 'handler>async' })
  })

  it('sees the validated request context, not just the reply', async () => {
    const seen: unknown[] = []
    const route = defineRoute({
      method: 'get',
      path: '/users/{id}',
      request: { params: { type: 'object', properties: { id: { type: 'integer' } }, required: ['id'] } },
      responses: { 200: { body: trail } },
      onResponse: [
        (reply, context) => {
          // Coerced and validated, exactly as the handler received it — this is
          // what makes per-route timing and audit hooks worth having.
          seen.push(context.params.id)
          return reply
        },
      ],
      handler: () => ({ status: 200 as const, body: { trail: 'handler' } }),
    })
    await handlerFor([route])(new Request('http://localhost/users/7'))
    expect(seen).toEqual([7])
  })

  it('replaces the status when a hook returns a different declared reply', async () => {
    const route = defineRoute({
      method: 'get',
      path: '/x',
      responses: { 200: { body: trail }, 202: { body: trail } },
      onResponse: [() => ({ status: 202 as const, body: { trail: 'swapped' } })],
      handler: () => ({ status: 200 as const, body: { trail: 'handler' } }),
    })
    const reply = await handlerFor([route])(new Request('http://localhost/x'))
    expect(reply.status).toBe(202)
    expect(await reply.json()).toEqual({ trail: 'swapped' })
  })

  it('runs on a guard denial, which is a reply like any other', async () => {
    const route = defineRoute({
      method: 'get',
      path: '/x',
      responses: { 200: { body: trail }, 401: { body: trail } },
      guards: [() => ({ status: 401 as const, body: { trail: 'denied' } })],
      onResponse: [(reply) => append(reply, 'hooked')],
      handler: () => ({ status: 200 as const, body: { trail: 'handler' } }),
    })
    const reply = await handlerFor([route])(new Request('http://localhost/x'))
    expect(reply.status).toBe(401)
    expect(await reply.json()).toEqual({ trail: 'denied>hooked' })
  })

  it('does not run on a security-guard denial, which fires before the context exists', async () => {
    // Security guards run ahead of validation and the context factory on
    // purpose, so an unauthenticated request never reaches app code — which
    // means the RequestContext a hook expects has not been built yet.
    const ran: string[] = []
    const route = defineRoute({
      method: 'get',
      path: '/x',
      security: [{ apiKey: [] }],
      responses: { 200: { body: trail }, 401: { body: trail } },
      onResponse: [
        (reply) => {
          ran.push('hook')
          return reply
        },
      ],
      handler: () => ({ status: 200 as const, body: { trail: 'handler' } }),
    })
    const schemes = {
      apiKey: {
        type: 'apiKey',
        in: 'header',
        name: 'x-key',
        [securityGuard]: ({ request }: ContextGuardInput) =>
          request.header('x-key') === 'ok' ? undefined : { status: 401 as const, body: { trail: 'unauthorized' } },
      },
    } as const
    const handler = handlerFor(secureRoutes([route], { securitySchemes: schemes }))

    const denied = await handler(new Request('http://localhost/x'))
    expect(denied.status).toBe(401)
    expect(ran).toEqual([])

    // The same route, authenticated, does run them.
    const allowed = await handler(new Request('http://localhost/x', { headers: { 'x-key': 'ok' } }))
    expect(allowed.status).toBe(200)
    expect(ran).toEqual(['hook'])
  })

  it('sends a hook’s raw reply verbatim', async () => {
    const route = defineRoute({
      method: 'get',
      path: '/x',
      responses: { 200: { body: trail } },
      onResponse: [() => raw(new Response('taken over', { status: 418 }))],
      handler: () => ({ status: 200 as const, body: { trail: 'handler' } }),
    })
    const reply = await handlerFor([route])(new Request('http://localhost/x'))
    expect(reply.status).toBe(418)
    expect(await reply.text()).toBe('taken over')
  })

  it('takes the handler-error path when a hook throws', async () => {
    const errors: unknown[] = []
    const route = defineRoute({
      method: 'get',
      path: '/x',
      responses: { 200: { body: trail } },
      onResponse: [
        () => {
          throw new Error('hook exploded')
        },
      ],
      handler: () => ({ status: 200 as const, body: { trail: 'handler' } }),
    })
    const handler = toFetchHandler(
      createApi({
        routes: [route],
        info: { title: 't', version: '1.0.0' },
        onError: (error) => {
          errors.push(error)
          return { status: 500, body: { error: 'internal_error' } }
        },
      }),
    )
    const reply = await handler(new Request('http://localhost/x'))
    expect(reply.status).toBe(500)
    expect((errors[0] as Error).message).toBe('hook exploded')
  })

  it('takes the handler-error path when a hook rejects', async () => {
    const route = defineRoute({
      method: 'get',
      path: '/x',
      responses: { 200: { body: trail } },
      onResponse: [() => Promise.reject(new Error('hook rejected'))],
      handler: () => ({ status: 200 as const, body: { trail: 'handler' } }),
    })
    const reply = await handlerFor([route])(new Request('http://localhost/x'))
    expect(reply.status).toBe(500)
  })

  it('validates a hook’s replacement, so it cannot smuggle out an invalid body', async () => {
    // The replacement goes through the same reply validation the handler's
    // would have, which is what keeps the contract the source of truth.
    const route = defineRoute({
      method: 'get',
      path: '/x',
      responses: { 200: { body: trail } },
      onResponse: [() => ({ status: 200 as const, body: { trail: 42 as unknown as string } })],
      handler: () => ({ status: 200 as const, body: { trail: 'handler' } }),
    })
    const reply = await handlerFor([route], true)(new Request('http://localhost/x'))
    expect(reply.status).toBe(500)
    expect(await reply.json()).toMatchObject({ error: 'invalid_response' })
  })

  it('leaves routes without hooks on the untouched path', async () => {
    const route = defineRoute({
      method: 'get',
      path: '/x',
      responses: { 200: { body: trail } },
      handler: () => ({ status: 200 as const, body: { trail: 'handler' } }),
    })
    const reply = await handlerFor([route])(new Request('http://localhost/x'))
    expect(await reply.json()).toEqual({ trail: 'handler' })
  })
})
