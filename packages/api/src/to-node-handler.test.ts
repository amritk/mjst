import type { Server } from 'node:http'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { describe, expect, it } from 'vitest'

import { createApi } from './create-api'
import { defineRoute } from './define-route'
import { toNodeHandler } from './to-node-handler'

const getUser = defineRoute({
  method: 'get',
  path: '/users/{id}',
  request: {
    params: { type: 'object', properties: { id: { type: 'integer' } }, required: ['id'] },
    query: { type: 'object', properties: { verbose: { type: 'boolean' } } },
  },
  responses: {
    200: { body: { type: 'object', properties: { id: {}, verbose: {} } } },
  },
  handler: ({ params, query }) => ({ status: 200, body: { id: params.id, verbose: query.verbose ?? false } }),
})

const createUser = defineRoute({
  method: 'post',
  path: '/users',
  request: { body: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] } },
  responses: { 201: { body: { type: 'object', properties: { name: {} } } } },
  handler: ({ body }) => ({ status: 201, body: { name: body.name } }),
})

/**
 * Runs a real node:http server for the duration of one test so the adapter is
 * exercised against genuine IncomingMessage/ServerResponse streams.
 */
const withServer = async (server: Server, run: (origin: string) => Promise<void>): Promise<void> => {
  await new Promise<void>((resolve) => server.listen(0, resolve))
  try {
    const { port } = server.address() as AddressInfo
    await run('http://127.0.0.1:' + port)
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
  }
}

describe('to-node-handler', () => {
  it('serves requests through node:http, including lazy query parsing', async () => {
    const handler = toNodeHandler(createApi({ routes: [getUser, createUser] }))
    await withServer(createServer(handler), async (origin) => {
      const response = await fetch(origin + '/users/5?verbose=true')
      expect(response.status).toBe(200)
      expect(response.headers.get('content-type')).toBe('application/json')
      expect(await response.json()).toEqual({ id: 5, verbose: true })
    })
  })

  it('reads and validates JSON bodies from the request stream', async () => {
    const handler = toNodeHandler(createApi({ routes: [createUser] }))
    await withServer(createServer(handler), async (origin) => {
      const created = await fetch(origin + '/users', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Ada' }),
      })
      expect(created.status).toBe(201)
      expect(await created.json()).toEqual({ name: 'Ada' })

      const invalid = await fetch(origin + '/users', { method: 'POST', body: 'not json' })
      expect(invalid.status).toBe(400)
      expect(await invalid.json()).toEqual({ error: 'invalid_json' })
    })
  })

  it('answers 404 itself when used without a next callback', async () => {
    const handler = toNodeHandler(createApi({ routes: [getUser] }))
    await withServer(createServer(handler), async (origin) => {
      const response = await fetch(origin + '/missing')
      expect(response.status).toBe(404)
    })
  })

  it('passes unmatched requests to next() in middleware position', async () => {
    const handler = toNodeHandler(createApi({ routes: [getUser] }))
    // The wrapping listener plays the role of the next middleware in an
    // Express-style chain.
    const server = createServer((request, response) => {
      void handler(request, response, () => {
        response.writeHead(418)
        response.end()
      })
    })
    await withServer(server, async (origin) => {
      expect((await fetch(origin + '/users/1')).status).toBe(200)
      expect((await fetch(origin + '/missing')).status).toBe(418)
    })
  })
})
