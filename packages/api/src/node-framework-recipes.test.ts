import type { Server } from 'node:http'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import express from 'express'
import Fastify, { type FastifyInstance } from 'fastify'
import Koa from 'koa'
import { describe, expect, it } from 'vitest'

import { createApi } from './create-api'
import { defineRoute } from './define-route'
import { toNodeHandler } from './to-node-handler'
import type { Api } from './types'

/**
 * Pins the Node adapter against the real Express, Fastify, and Koa packages —
 * the recipes the README publishes. Each of the three hands the socket over
 * differently (`next()`, `reply.hijack()`, `ctx.respond = false`), and a
 * recipe that gets it wrong does not fail loudly: the framework writes its own
 * reply over ours, or the request hangs until the client gives up. Only a
 * round trip through the genuine router catches that, so these run servers
 * rather than stand-ins.
 */
const createUser = defineRoute({
  method: 'post',
  path: '/api/users',
  request: { body: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] } },
  responses: { 201: { body: { type: 'object', properties: { name: {} } } } },
  handler: ({ body }) => ({ status: 201, body: { name: body.name } }),
})

const api = createApi({ routes: [createUser], openApiPath: false })

const withServer = async (server: Server, run: (origin: string) => Promise<void>): Promise<void> => {
  await new Promise<void>((resolve) => server.listen(0, resolve))
  try {
    const { port } = server.address() as AddressInfo
    await run('http://127.0.0.1:' + port)
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
  }
}

/**
 * The three assertions every recipe owes: a contract route answers (with its
 * body read from an untouched stream), a route the framework itself owns still
 * answers, and a path neither knows lands on the framework's own 404 rather
 * than the pipeline's.
 */
const expectRecipeWorks = async (origin: string, ownBody: unknown): Promise<void> => {
  const created = await fetch(origin + '/api/users', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'ada' }),
    signal: AbortSignal.timeout(5000),
  })
  expect(created.status).toBe(201)
  expect(await created.json()).toEqual({ name: 'ada' })

  const own = await fetch(origin + '/own', { signal: AbortSignal.timeout(5000) })
  expect(own.status).toBe(200)
  expect(await own.json()).toEqual(ownBody)

  const missing = await fetch(origin + '/nowhere', { signal: AbortSignal.timeout(5000) })
  expect(missing.status).toBe(404)
}

/** The README's Fastify recipe, verbatim, as a reusable hook. */
const attachToFastify = (app: FastifyInstance, target: Api): void => {
  const nodeHandler = toNodeHandler(target)
  app.addHook('onRequest', async (request, reply) => {
    const path = request.url.split('?')[0] ?? '/'
    if (!target.matches(request.method, path)) return
    reply.hijack()
    void nodeHandler(request.raw, reply.raw)
  })
}

describe('node-framework-recipes', () => {
  it('serves contract routes through Express middleware and falls through for the rest', async () => {
    const app = express()
    app.use(toNodeHandler(api))
    app.get('/own', (_request, response) => {
      response.json({ from: 'express' })
    })
    await withServer(createServer(app), async (origin) => {
      await expectRecipeWorks(origin, { from: 'express' })
    })
  })

  it('strips an Express mount prefix before the adapter sees the path', async () => {
    // `app.use('/api', …)` rewrites req.url to the remainder, so a contract
    // written without the prefix still matches — the alternative the README
    // offers to spelling /api into every path.
    const prefixed = createApi({
      routes: [{ ...createUser, path: '/users' }],
      openApiPath: false,
    })
    const app = express()
    app.use('/api', toNodeHandler(prefixed))
    await withServer(createServer(app), async (origin) => {
      const created = await fetch(origin + '/api/users', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'ada' }),
        signal: AbortSignal.timeout(5000),
      })
      expect(created.status).toBe(201)
      expect(await created.json()).toEqual({ name: 'ada' })
    })
  })

  it('serves contract routes from a Fastify onRequest hook, leaving its own router intact', async () => {
    const app = Fastify()
    attachToFastify(app, api)
    app.get('/own', async () => ({ from: 'fastify' }))
    await app.ready()
    await withServer(app.server, async (origin) => {
      await expectRecipeWorks(origin, { from: 'fastify' })
    })
  })

  it('reaches the Fastify hook for paths Fastify has no route for', async () => {
    // The whole recipe rests on this: Fastify routes before it runs hooks, so
    // if global onRequest hooks skipped unrouted requests, every contract path
    // would 404 before the adapter ran.
    const app = Fastify()
    attachToFastify(app, api)
    await app.ready()
    await withServer(app.server, async (origin) => {
      const created = await fetch(origin + '/api/users', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'ada' }),
        signal: AbortSignal.timeout(5000),
      })
      expect(created.status).toBe(201)
      expect(await created.json()).toEqual({ name: 'ada' })
    })
  })

  it('serves contract routes through Koa middleware with ctx.respond disabled', async () => {
    const nodeHandler = toNodeHandler(api)
    const app = new Koa()
    app.use(async (ctx, next) => {
      if (!api.matches(ctx.method, ctx.path)) {
        await next()
        return
      }
      ctx.respond = false
      await nodeHandler(ctx.req, ctx.res)
    })
    app.use((ctx) => {
      if (ctx.path !== '/own') return
      ctx.body = { from: 'koa' }
    })
    await withServer(createServer(app.callback()), async (origin) => {
      await expectRecipeWorks(origin, { from: 'koa' })
    })
  })
})
