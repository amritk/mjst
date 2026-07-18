import { describe, expect, it } from 'vitest'

import { createApi } from './create-api'
import type {
  ClientReplyOf,
  ErrorBodyOf,
  ErrorStatusOf,
  RequestBodyOf,
  RequestCookiesOf,
  RequestHeadersOf,
  RequestParamsOf,
  RequestQueryOf,
  ResponseBodyOf,
  ResponseStatusOf,
  SuccessBodyOf,
  SuccessStatusOf,
} from './create-client'
import { createClient } from './create-client'
import { defineContract } from './define-contract'
import { defineRoute } from './define-route'
import { implementRoute } from './implement-route'
import { toFetchHandler } from './to-fetch-handler'
import type { RouteReplyOf } from './types'
import { isUnexpectedStatusError } from './unexpected-status-error'

/**
 * The contracts are pure data (defineContract) and the server binds handlers
 * separately — exactly the split a frontend/server pair would use. The client
 * talks to the real pipeline through its injectable fetch, so these tests
 * cover the whole loop with no network.
 */
const getUser = defineContract({
  method: 'get',
  path: '/users/{id}',
  request: {
    params: { type: 'object', properties: { id: { type: 'integer' } }, required: ['id'] },
    query: {
      type: 'object',
      properties: { verbose: { type: 'boolean' }, tags: { type: 'array', items: { type: 'string' } } },
    },
  },
  responses: {
    200: {
      body: {
        type: 'object',
        properties: { id: { type: 'integer' }, name: { type: 'string' } },
        required: ['id', 'name'],
      },
    },
    404: {},
  },
})

const chat = defineContract({
  method: 'post',
  path: '/chat',
  request: {
    body: { type: 'object', properties: { message: { type: 'string' } }, required: ['message'] },
    headers: { type: 'object', properties: { 'x-api-key': { type: 'string' } }, required: ['x-api-key'] },
  },
  responses: { 200: { contentType: 'text/plain; charset=utf-8' }, 401: {} },
})

const readFile = defineContract({
  method: 'get',
  path: '/files/{path+}',
  request: { params: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } },
  responses: { 200: { body: { type: 'object', properties: { path: {} } } } },
})

const health = defineContract({
  method: 'get',
  path: '/health',
  responses: { 200: { body: { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'] } } },
})

const contracts = { getUser, chat, readFile, health }

const routes = [
  implementRoute(getUser, ({ params }) =>
    params.id === 7 ? { status: 200, body: { id: 7, name: 'Ada' } } : { status: 404 },
  ),
  implementRoute(chat, ({ headers, body }) =>
    headers['x-api-key'] === 'secret' ? { status: 200, body: `echo: ${body.message}` } : { status: 401 },
  ),
  implementRoute(readFile, ({ params }) => ({ status: 200, body: { path: params.path } })),
  implementRoute(health, () => ({ status: 200, body: { ok: true } })),
]

/** Routes the client's requests straight into the fetch adapter — no sockets. */
const makeClient = (captured?: Request[]) => {
  const handler = toFetchHandler(createApi({ routes }))
  return createClient(contracts, 'https://api.test', {
    fetch: (url, init) => {
      const request = new Request(url, init)
      // Cloned so assertions can read the body after the server consumed it.
      captured?.push(request.clone())
      return handler(request)
    },
  })
}

describe('create-client', () => {
  it('calls a route with typed params and returns the discriminated reply', async () => {
    const client = makeClient()
    const reply = await client.getUser({ params: { id: 7 }, query: {} })
    expect(reply.status).toBe(200)
    if (reply.status === 200) {
      // Narrowed by status: body is the schema-typed object.
      expect(reply.body.name).toBe('Ada')
      expect(reply.response.headers.get('content-type')).toContain('application/json')
    }
  })

  it('returns declared empty-body statuses without reading a body', async () => {
    const client = makeClient()
    const reply = await client.getUser({ params: { id: 1 }, query: {} })
    expect(reply.status).toBe(404)
    expect(reply.body).toBeUndefined()
  })

  it('serializes query values with array repeats and skips undefined', async () => {
    const captured: Request[] = []
    const client = makeClient(captured)
    await client.getUser({ params: { id: 7 }, query: { verbose: true, tags: ['a', 'b'] } })
    expect(new URL(captured[0]?.url ?? '').search).toBe('?verbose=true&tags=a&tags=b')
  })

  it('percent-encodes plain path parameters but keeps greedy slashes', async () => {
    const captured: Request[] = []
    const client = makeClient(captured)
    const reply = await client.readFile({ params: { path: 'docs/2026/q1 report.pdf' } })
    expect(new URL(captured[0]?.url ?? '').pathname).toBe('/files/docs/2026/q1%20report.pdf')
    if (reply.status === 200) expect(reply.body).toEqual({ path: 'docs/2026/q1 report.pdf' })
  })

  it('exposes the raw Response for contentType statuses instead of parsing', async () => {
    const client = makeClient()
    const reply = await client.chat({ body: { message: 'hi' }, headers: { 'x-api-key': 'secret' } })
    expect(reply.status).toBe(200)
    if (reply.status === 200) {
      // The stream is untouched — the caller reads it.
      expect(await reply.response.text()).toBe('echo: hi')
      expect(reply.response.headers.get('content-type')).toBe('text/plain; charset=utf-8')
    }
  })

  it('sends declared headers plus ad-hoc extras and JSON bodies', async () => {
    const captured: Request[] = []
    const client = makeClient(captured)
    await client.chat({ body: { message: 'x' }, headers: { 'x-api-key': 'secret', 'x-trace': 'abc' } })
    const sent = captured[0]
    expect(sent?.headers.get('x-api-key')).toBe('secret')
    expect(sent?.headers.get('x-trace')).toBe('abc')
    expect(sent?.headers.get('content-type')).toBe('application/json')
    expect(await sent?.json()).toEqual({ message: 'x' })
  })

  it('merges client-level headers from a per-call (async) provider', async () => {
    const captured: Request[] = []
    const handler = toFetchHandler(createApi({ routes }))
    let token = 'first'
    const client = createClient(contracts, 'https://api.test/', {
      fetch: (url, init) => {
        const request = new Request(url, init)
        captured.push(request)
        return handler(request)
      },
      headers: () => Promise.resolve({ authorization: `Bearer ${token}` }),
    })
    await client.health()
    token = 'second'
    await client.health()
    expect(captured.map((request) => request.headers.get('authorization'))).toEqual(['Bearer first', 'Bearer second'])
  })

  it('takes no argument at all for contracts without request slots', async () => {
    const client = makeClient()
    const reply = await client.health()
    if (reply.status === 200) expect(reply.body.ok).toBe(true)
  })

  it('throws a recognizable error for statuses the contract never declared', async () => {
    const client = makeClient()
    // id 'abc' fails validation server-side: a 400 the contract does not declare.
    const failed = client.getUser({ params: { id: 'abc' as unknown as number }, query: {} })
    await expect(failed).rejects.toThrow(/Undeclared 400 response for 'getUser'/)
    const error = await failed.catch((thrown: unknown) => thrown)
    expect(isUnexpectedStatusError(error)).toBe(true)
    if (isUnexpectedStatusError(error)) {
      // The response rides along unread, so error handling can inspect it.
      expect(error.response.status).toBe(400)
      expect(((await error.response.json()) as { error: string }).error).toBe('validation_failed')
    }
  })

  it('aborts through the per-call signal', async () => {
    const client = createClient(contracts, 'https://api.test', {
      fetch: (_url, init) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(new Error('aborted')))
        }),
    })
    const controller = new AbortController()
    const call = client.health({ signal: controller.signal })
    controller.abort()
    await expect(call).rejects.toThrow('aborted')
  })

  it('sends form bodies as urlencoded pairs with array repeats', async () => {
    const signup = defineContract({
      method: 'post',
      path: '/signup',
      request: {
        body: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            age: { type: 'integer' },
            tags: { type: 'array', items: { type: 'string' } },
          },
          required: ['name', 'age'],
        },
        bodyType: 'form',
      },
      responses: { 201: { body: { type: 'object' } } },
    })
    const server = toFetchHandler(
      createApi({ routes: [implementRoute(signup, ({ body }) => ({ status: 201, body }))] }),
    )
    const client = createClient({ signup }, 'https://api.test', {
      fetch: (url, init) => server(new Request(url, init)),
    })
    const reply = await client.signup({ body: { name: 'Ada', age: 30, tags: ['a', 'b'] } })
    expect(reply.status).toBe(201)
    // The server coerced the urlencoded strings back per the schema.
    if (reply.status === 201) expect(reply.body).toEqual({ name: 'Ada', age: 30, tags: ['a', 'b'] })
  })

  it('sends multipart bodies with File parts intact', async () => {
    const upload = defineContract({
      method: 'post',
      path: '/upload',
      request: {
        body: {
          type: 'object',
          properties: { title: { type: 'string' }, attachment: {} },
          required: ['title', 'attachment'],
        },
        bodyType: 'multipart',
      },
      responses: { 200: { body: { type: 'object' } } },
    })
    const server = toFetchHandler(
      createApi({
        routes: [
          implementRoute(upload, async ({ body }) => {
            const { title, attachment } = body as { title: string; attachment: File }
            return {
              status: 200,
              body: { title, name: attachment.name, byteLength: (await attachment.arrayBuffer()).byteLength },
            }
          }),
        ],
      }),
    )
    const client = createClient({ upload }, 'https://api.test', {
      fetch: (url, init) => server(new Request(url, init)),
    })
    const reply = await client.upload({
      body: { title: 'report', attachment: new File([new Uint8Array(5)], 'r.bin') },
    })
    if (reply.status === 200) expect(reply.body).toEqual({ title: 'report', name: 'r.bin', byteLength: 5 })
  })

  it('serializes declared cookies onto the cookie header', async () => {
    const dashboard = defineContract({
      method: 'get',
      path: '/dashboard',
      request: {
        cookies: {
          type: 'object',
          properties: { session: { type: 'string' }, visits: { type: 'integer' } },
          required: ['session'],
        },
      },
      responses: { 200: { body: { type: 'object' } } },
    })
    const server = toFetchHandler(
      createApi({
        routes: [
          implementRoute(dashboard, ({ cookies }) => ({
            status: 200,
            body: { session: cookies.session, visits: cookies.visits ?? 0 },
          })),
        ],
      }),
    )
    const client = createClient({ dashboard }, 'https://api.test', {
      fetch: (url, init) => server(new Request(url, init)),
    })
    const reply = await client.dashboard({ cookies: { session: 'abc 123', visits: 2 } })
    // The value round-trips percent-encoded — the server unquotes and decodes.
    if (reply.status === 200) expect(reply.body).toEqual({ session: 'abc 123', visits: 2 })
  })

  it('works with one-shot defineRoute values too — routes are contracts', async () => {
    const ping = defineRoute({
      method: 'get',
      path: '/ping',
      responses: { 200: { body: { type: 'object', properties: { pong: { type: 'boolean' } }, required: ['pong'] } } },
      handler: () => ({ status: 200, body: { pong: true } }),
    })
    const server = toFetchHandler(createApi({ routes: [ping] }))
    const client = createClient({ ping }, 'https://api.test', {
      fetch: (url, init) => server(new Request(url, init)),
    })
    const reply = await client.ping()
    if (reply.status === 200) expect(reply.body.pong).toBe(true)
  })

  it('names response body types straight from the contracts', async () => {
    // The motivating shape: an error status whose body the frontend must read
    // exactly — previously an inline `as { ... }` cast at every use site.
    const demoChat = defineContract({
      method: 'post',
      path: '/demo/chat',
      request: { body: { type: 'object', properties: { message: { type: 'string' } }, required: ['message'] } },
      responses: {
        200: {
          contentType: 'text/plain; charset=utf-8',
          // Documented for consumers that parse the trailing frame themselves.
          body: { type: 'object', properties: { used: { type: 'integer' } }, required: ['used'] },
        },
        402: {
          body: {
            type: 'object',
            properties: {
              error: { type: 'string' },
              requiresVerification: { type: 'boolean' },
              used: { type: 'integer' },
              remaining: { type: 'integer' },
            },
            required: ['error', 'requiresVerification', 'used', 'remaining'],
          },
        },
      },
    })

    // The 402 body, named once from the contract instead of cast at use sites.
    type LimitBody = ResponseBodyOf<typeof demoChat, 402>
    const limit: LimitBody = { error: 'demo_limit', requiresVerification: true, used: 5, remaining: 0 }
    expect(limit.remaining).toBe(0)
    // @ts-expect-error — remaining is a number, not a string
    const wrongLimit: LimitBody = { error: 'demo_limit', requiresVerification: true, used: 5, remaining: 'none' }
    void wrongLimit

    // A raw (contentType) status that documents a body schema still names the
    // payload type, for code that parses the stream itself.
    type FrameBody = ResponseBodyOf<typeof demoChat, 200>
    const frame: FrameBody = { used: 3 }
    void frame

    // Statuses declared without a body come out undefined; omitting the
    // status yields the union across every declared one.
    const empty: ResponseBodyOf<typeof getUser, 404> = undefined
    void empty
    const anyBody: ResponseBodyOf<typeof demoChat> = limit
    void anyBody

    // ClientReplyOf names the union a method resolves with.
    const client = makeClient()
    const reply: ClientReplyOf<typeof getUser> = await client.getUser({ params: { id: 7 }, query: {} })
    expect(reply.status).toBe(200)
  })

  it('names request slot types from the contracts', () => {
    // Declared slots come out schema-typed — the shapes a form model or
    // composable holds before calling the client.
    const params: RequestParamsOf<typeof getUser> = { id: 7 }
    expect(params.id).toBe(7)
    // @ts-expect-error — id is declared as an integer
    const badParams: RequestParamsOf<typeof getUser> = { id: 'seven' }
    void badParams
    const query: RequestQueryOf<typeof getUser> = { verbose: true, tags: ['a'] }
    void query
    const body: RequestBodyOf<typeof chat> = { message: 'hi' }
    void body
    // @ts-expect-error — message is required
    const badBody: RequestBodyOf<typeof chat> = {}
    void badBody
    const headers: RequestHeadersOf<typeof chat> = { 'x-api-key': 'secret' }
    void headers
    // Undeclared slots come out undefined, mirroring what handlers see.
    const noBody: RequestBodyOf<typeof getUser> = undefined
    void noBody
    const noCookies: RequestCookiesOf<typeof chat> = undefined
    void noCookies
  })

  it('names status classes and success/error body unions from the contracts', () => {
    const metered = defineContract({
      method: 'post',
      path: '/metered',
      responses: {
        200: { body: { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'] } },
        402: {
          body: {
            type: 'object',
            properties: { error: { type: 'string' }, remaining: { type: 'integer' } },
            required: ['error', 'remaining'],
          },
        },
        503: {},
      },
    })

    // The declared statuses are the domain for exhaustive switches.
    const declared: ResponseStatusOf<typeof metered> = 402
    expect(declared).toBe(402)
    // @ts-expect-error — 500 is not declared
    const undeclared: ResponseStatusOf<typeof metered> = 500
    void undeclared

    // Status classes split by leading digit: 2xx success, 4xx/5xx error.
    const success: SuccessStatusOf<typeof metered> = 200
    void success
    // @ts-expect-error — 402 is not a success status
    const notSuccess: SuccessStatusOf<typeof metered> = 402
    void notSuccess
    const failureStatus: ErrorStatusOf<typeof metered> = 402
    void failureStatus
    const alsoFailure: ErrorStatusOf<typeof metered> = 503
    void alsoFailure

    // The generated-SDK-style "data" and "error" unions, named from the
    // contract: 2xx bodies on one side, 4xx/5xx bodies on the other.
    const data: SuccessBodyOf<typeof metered> = { ok: true }
    void data
    // @ts-expect-error — the 402 body is not a success body
    const wrongData: SuccessBodyOf<typeof metered> = { error: 'limit', remaining: 0 }
    void wrongData
    const failure: ErrorBodyOf<typeof metered> = { error: 'demo_limit', remaining: 0 }
    void failure
    // 503 declares no body, so undefined is part of the error union.
    const emptyFailure: ErrorBodyOf<typeof metered> = undefined
    void emptyFailure

    // A contract with no declared error statuses has an empty error union.
    const noErrors: [ErrorBodyOf<typeof health>] extends [never] ? true : false = true
    expect(noErrors).toBe(true)
  })

  it('names the handler reply union from a contract — the server-side twin', () => {
    // A reply builder shared across handlers can type its return once.
    const missing = (): RouteReplyOf<typeof getUser> => ({ status: 404 })
    expect(missing().status).toBe(404)
    const found: RouteReplyOf<typeof getUser> = { status: 200, body: { id: 1, name: 'Ada' } }
    void found
    // @ts-expect-error — 500 is not declared by the contract
    const undeclared: RouteReplyOf<typeof getUser> = { status: 500 }
    void undeclared
    // @ts-expect-error — the 200 body must match its schema
    const wrongBody: RouteReplyOf<typeof getUser> = { status: 200, body: { id: 1 } }
    void wrongBody

    // Routes from defineRoute are contracts too — helpers accept them as-is.
    const ping = defineRoute({
      method: 'get',
      path: '/ping',
      responses: { 200: { body: { type: 'object', properties: { pong: { type: 'boolean' } }, required: ['pong'] } } },
      handler: () => ({ status: 200, body: { pong: true } }),
    })
    const pong: ResponseBodyOf<typeof ping, 200> = { pong: true }
    void pong
  })

  it('rejects wrongly-typed inputs at compile time', () => {
    const client = makeClient()
    // @ts-expect-error — id must be a number
    void client.getUser({ params: { id: 'seven' }, query: {} }).catch(() => undefined)
    // @ts-expect-error — params are required when declared
    void client.getUser({ query: {} }).catch(() => undefined)
    // @ts-expect-error — declared headers are required
    void client.chat({ body: { message: 'x' } }).catch(() => undefined)
    expect(true).toBe(true)
  })
})
