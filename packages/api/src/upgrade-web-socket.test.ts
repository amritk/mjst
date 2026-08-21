import { describe, expect, it } from 'vitest'

import { createApi } from './create-api'
import { routeFactory } from './route-factory'
import { toFetchHandler } from './to-fetch-handler'
import type { WebSocketUpgrader } from './upgrade-web-socket'
import { upgradeWebSocket } from './upgrade-web-socket'

/**
 * Stands in for Bun's `Server`. `accepts` is the whole point of the fake: an
 * HTTP/3 connection is exactly a server whose `upgrade` returns `false`.
 */
const fakeServer = (accepts: boolean): WebSocketUpgrader & { calls: unknown[] } => {
  const calls: unknown[] = []
  return {
    calls,
    upgrade: (request, options) => {
      calls.push({ url: request.url, options })
      return accepts
    },
  }
}

const chatApi = (server: WebSocketUpgrader) => {
  const route = routeFactory<{ server: WebSocketUpgrader }>()
  const chat = route({
    method: 'get',
    path: '/ws/{room}',
    request: { params: { type: 'object', properties: { room: { type: 'string' } }, required: ['room'] } },
    responses: { 426: {} },
    handler: ({ params, request, context }) =>
      upgradeWebSocket(context.server, request, { data: { room: params.room } }) ?? {
        status: 426 as const,
        headers: { upgrade: 'websocket' },
      },
  })
  return createApi({
    routes: [chat],
    info: { title: 'chat', version: '1.0.0' },
    context: () => ({ server }),
  })
}

describe('upgrade-web-socket', () => {
  it('returns a raw reply when the runtime accepts the upgrade', () => {
    const server = fakeServer(true)
    const reply = upgradeWebSocket(server, { raw: new Request('http://localhost/ws') } as never)
    expect(reply?.raw).toBeInstanceOf(Response)
  })

  it('returns undefined when the runtime refuses, so the route decides the status', () => {
    const server = fakeServer(false)
    expect(upgradeWebSocket(server, { raw: new Request('http://localhost/ws') } as never)).toBeUndefined()
  })

  it('forwards data and headers to the runtime upgrade', () => {
    const server = fakeServer(true)
    upgradeWebSocket(server, { raw: new Request('http://localhost/ws') } as never, {
      data: { room: 'lobby' },
      headers: { 'set-cookie': 'a=1' },
    })
    expect(server.calls).toEqual([
      { url: 'http://localhost/ws', options: { data: { room: 'lobby' }, headers: { 'set-cookie': 'a=1' } } },
    ])
  })

  it('answers an accepted handshake through the routed pipeline', async () => {
    const server = fakeServer(true)
    const handler = toFetchHandler(chatApi(server))
    const reply = await handler(new Request('http://localhost/ws/lobby'))
    // The validated path param has to reach `ws.data`: the websocket handlers
    // run outside the request and cannot read `params` themselves.
    expect(server.calls).toEqual([{ url: 'http://localhost/ws/lobby', options: { data: { room: 'lobby' } } }])
    expect(reply.status).toBeLessThan(300)
  })

  it('answers a refused handshake with the route’s declared status', async () => {
    // This is the HTTP/3 case: Bun's QUIC listener does not bootstrap
    // WebSockets, so `upgrade()` returns false and the contract's 426 — not a
    // 500 — is what the client sees, telling it to retry over HTTP/1.1.
    const handler = toFetchHandler(chatApi(fakeServer(false)))
    const reply = await handler(new Request('http://localhost/ws/lobby'))
    expect(reply.status).toBe(426)
    expect(reply.headers.get('upgrade')).toBe('websocket')
  })

  it('runs the contract before the upgrade, so an invalid path never reaches the runtime', async () => {
    const server = fakeServer(true)
    const handler = toFetchHandler(chatApi(server))
    const reply = await handler(new Request('http://localhost/ws'))
    expect(reply.status).toBe(404)
    expect(server.calls).toEqual([])
  })
})
