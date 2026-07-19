import { validate, validateGuard } from '@amritk/runtime-validators'

import { defineRoute } from '../define-route'
import { routeFactory } from '../route-factory'
import type { FetchOnRequest, FetchOnResponse } from '../to-fetch-handler'
import type {
  AnyRouteContract,
  ApiRequest,
  ApiResponse,
  ContextFactoryInput,
  ErrorFormatters,
  OnErrorDetails,
  RequestObservation,
  UnmatchedObservation,
  ValidatorCompiler,
} from '../types'

/**
 * The differential corpus: routes chosen so every emitter path is exercised —
 * inlined guards and interpreter fallbacks, generated serializers and
 * JSON.stringify fallbacks, static and parameterized paths, empty replies,
 * custom headers, thrown errors, and a handler that reads the raw request.
 */

/** Static path, serializer-eligible response. */
export const health = defineRoute({
  method: 'get',
  path: '/health',
  responses: {
    200: {
      body: { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'], additionalProperties: false },
    },
  },
  handler: () => ({ status: 200, body: { ok: true } }),
})

/** Params guard inlines (bare integer); 200 serializes; 404 is empty. */
export const getUser = defineRoute({
  method: 'get',
  path: '/users/{id}',
  request: {
    params: { type: 'object', properties: { id: { type: 'integer' } }, required: ['id'] },
  },
  responses: {
    200: {
      body: {
        type: 'object',
        properties: { id: { type: 'integer' }, name: { type: 'string' }, email: { type: 'string' } },
        required: ['id', 'name'],
        additionalProperties: false,
      },
    },
    404: {},
  },
  handler: ({ params }) =>
    params.id === 404 ? { status: 404 } : { status: 200, body: { id: params.id, name: 'Ada' } },
})

/** Query guard bails to the interpreter (minimum, array); response has no serializer. */
export const listUsers = defineRoute({
  method: 'get',
  path: '/users',
  request: {
    query: {
      type: 'object',
      properties: {
        limit: { type: 'integer', minimum: 1 },
        tags: { type: 'array', items: { type: 'string' } },
      },
    },
  },
  responses: { 200: { body: { type: 'object' } } },
  handler: ({ query }) => ({ status: 200, body: { limit: query.limit ?? null, tags: query.tags ?? [] } }),
})

/**
 * Body guard bails to the interpreter: `additionalProperties: true` is outside
 * the inline subset (harmless semantically — it is the default — which makes
 * it a safe way to keep the fallback path covered).
 */
export const createUser = defineRoute({
  method: 'post',
  path: '/users',
  request: {
    body: {
      type: 'object',
      properties: { name: { type: 'string', minLength: 1 }, age: { type: 'integer' } },
      required: ['name'],
      additionalProperties: true,
    },
  },
  responses: {
    201: {
      body: {
        type: 'object',
        properties: { name: { type: 'string' }, age: { type: 'integer' } },
        required: ['name'],
        additionalProperties: false,
      },
    },
  },
  handler: ({ body }) => ({
    status: 201,
    body: body.age === undefined ? { name: body.name } : { name: body.name, age: body.age },
  }),
})

/** Path captures without a params schema; empty reply with a custom header. */
export const removeThing = defineRoute({
  method: 'delete',
  path: '/things/{id}',
  responses: { 204: {} },
  handler: () => ({ status: 204, headers: { 'x-deleted': 'yes' } }),
})

/** A throwing handler — both engines must answer the same bare 500. */
export const boom = defineRoute({
  method: 'get',
  path: '/boom',
  responses: { 200: {} },
  handler: () => {
    throw new Error('nope')
  },
})

/**
 * The widened inline-guard subset in one schema: enum, numeric bounds, code
 * point string lengths, pattern, primitive arrays with bounds, a nested
 * closed object, and OpenAPI nullable. This must compile to an inline guard
 * (no interpreter) and still agree with the runtime engine on every verdict.
 */
export const submitMetric = defineRoute({
  method: 'post',
  path: '/metrics',
  request: {
    body: {
      type: 'object',
      properties: {
        kind: { enum: ['latency', 'error'] },
        value: { type: 'number', minimum: 0, exclusiveMaximum: 10000 },
        unit: { type: 'string', minLength: 1, maxLength: 8 },
        labels: { type: 'array', items: { type: 'string', pattern: '^[a-z]+$' }, maxItems: 3 },
        meta: {
          type: 'object',
          properties: { host: { type: 'string' } },
          required: ['host'],
          additionalProperties: false,
        },
        note: { type: 'string', nullable: true },
      },
      required: ['kind', 'value'],
      additionalProperties: false,
    },
  },
  responses: { 201: {} },
  handler: () => ({ status: 201 }),
})

/** The app context both engines build per request — async on purpose. */
export type CorpusContext = {
  readonly tenant: string
  readonly viaHeader: string | null
  readonly gateTenant: string | null
}

export const createAppContext = async ({ request, env, locals }: ContextFactoryInput): Promise<CorpusContext> => ({
  tenant: (env as { tenant?: string } | undefined)?.tenant ?? 'none',
  viaHeader: request.header('x-ctx') ?? null,
  // What the onRequest gate resolved into the shared locals bag — proves the
  // factory sees the same object the gates wrote.
  gateTenant: (locals?.['tenant'] as string | undefined) ?? null,
})

/** Exercises the app context: env binding + request access through the factory. */
export const whoami = routeFactory<CorpusContext>()({
  method: 'get',
  path: '/whoami',
  responses: { 200: { body: { type: 'object' } } },
  handler: ({ context }) => ({
    status: 200,
    body: { tenant: context.tenant, viaHeader: context.viaHeader, gateTenant: context.gateTenant },
  }),
})

/** Reads the platform request through the escape hatch — both engines run on fetch, so both must see a Request. */
export const platformInfo = defineRoute({
  method: 'get',
  path: '/platform',
  responses: { 200: { body: { type: 'object' } } },
  handler: ({ request }) => ({
    status: 200,
    body: {
      isRequest: request.raw instanceof Request,
      rawUrlPath: request.raw instanceof Request ? new URL(request.raw.url).pathname : null,
    },
  }),
})

/** Repeated set-cookie headers: arrays must serialize as separate header lines. */
export const login = defineRoute({
  method: 'post',
  path: '/login',
  responses: { 200: { body: { type: 'object' } } },
  handler: () => ({
    status: 200,
    headers: {
      'set-cookie': ['session=abc123; Path=/; HttpOnly', 'csrf=xyz789; Path=/'],
      'x-single': 'one',
    },
    body: { ok: true },
  }),
})

/**
 * Post-validation refinement: a cross-field constraint JSON Schema cannot
 * express, plus a throwing refine (start = 13) that must take the onError
 * path in both engines.
 */
export const bookSlot = defineRoute({
  method: 'post',
  path: '/slots',
  request: {
    body: {
      type: 'object',
      properties: { start: { type: 'integer' }, end: { type: 'integer' } },
      required: ['start', 'end'],
    },
  },
  refine: ({ body }) => {
    if (body.start === 13) throw new Error('refine crashed')
    return body.start < body.end ? undefined : [{ path: '/end', message: 'end must be after start' }]
  },
  responses: { 201: {} },
  handler: () => ({ status: 201 }),
})

/**
 * An async refine over the same cross-field constraint as `bookSlot`: both
 * engines must await the promise, route resolved issues through the standard
 * envelope, and send a rejected refine (start = 13) down the onError path.
 */
export const bookSlotAsync = defineRoute({
  method: 'post',
  path: '/slots-async',
  request: {
    body: {
      type: 'object',
      properties: { start: { type: 'integer' }, end: { type: 'integer' } },
      required: ['start', 'end'],
    },
  },
  refine: async ({ body }) => {
    // A microtask hop makes the promise genuinely asynchronous.
    await Promise.resolve()
    if (body.start === 13) throw new Error('async refine crashed')
    return body.start < body.end ? undefined : [{ path: '/end', message: 'end must be after start' }]
  },
  responses: { 201: {} },
  handler: () => ({ status: 201 }),
})

/**
 * An explicitly declared options route: it must win over the automatic
 * OPTIONS answer in both engines.
 */
export const optionsProbe = defineRoute({
  method: 'options',
  path: '/users',
  responses: { 200: { body: { type: 'object' } } },
  handler: () => ({ status: 200, headers: { 'x-options': 'explicit' }, body: { custom: true } }),
})

/** Reads the shared locals bag the gate populated; writes its own note for the decorator. */
export const localsEcho = defineRoute({
  method: 'get',
  path: '/locals-echo',
  responses: { 200: { body: { type: 'object' } } },
  handler: ({ request }) => {
    const locals = request.locals ?? {}
    locals['handlerNote'] = 'seen'
    return { status: 200, body: { tenant: (locals['tenant'] as string | undefined) ?? null } }
  },
})

/** A Better-Auth-style self-contained sub-handler for prefix mounting. */
export const mountEcho = (request: Request): Response =>
  Response.json({ mounted: true, url: request.url }, { status: 418 })

/** Reads the raw request (header lookup) and replies with custom headers. */
export const echoHeader = defineRoute({
  method: 'get',
  path: '/header-echo',
  responses: { 200: { body: { type: 'object' } } },
  handler: ({ request }) => ({
    status: 200,
    body: { test: request.header('x-test') ?? null },
    headers: { 'x-served-by': 'corpus' },
  }),
})

/** A validated headers slot: required string plus a coerced integer. */
export const tenantInfo = defineRoute({
  method: 'get',
  path: '/tenant',
  request: {
    headers: {
      type: 'object',
      properties: { 'x-api-key': { type: 'string', minLength: 4 }, 'x-retry-count': { type: 'integer' } },
      required: ['x-api-key'],
    },
  },
  responses: { 200: { body: { type: 'object' } } },
  handler: ({ headers }) => ({
    status: 200,
    body: { key: headers['x-api-key'], retries: headers['x-retry-count'] ?? 0 },
  }),
})

/** A validated cookies slot: required session, coerced counter, tracking noise ignored. */
export const dashboard = defineRoute({
  method: 'get',
  path: '/dashboard',
  request: {
    cookies: {
      type: 'object',
      properties: { session: { type: 'string', minLength: 4 }, visits: { type: 'integer' } },
      required: ['session'],
    },
  },
  responses: { 200: { body: { type: 'object' } } },
  handler: ({ cookies }) => ({ status: 200, body: { session: cookies.session, visits: cookies.visits ?? 0 } }),
})

/** A raw streaming status — the agent-chat shape. */
export const streamChat = defineRoute({
  method: 'post',
  path: '/chat',
  responses: { 200: { contentType: 'text/plain; charset=utf-8' } },
  handler: () => {
    const encoder = new TextEncoder()
    const body = new ReadableStream<Uint8Array>({
      start: (controller) => {
        controller.enqueue(encoder.encode('token-1 '))
        controller.enqueue(encoder.encode('token-2'))
        controller.close()
      },
    })
    return { status: 200, headers: { 'x-frame-protocol': '1' }, body }
  },
})

/** A raw string status — no JSON quoting allowed. */
export const csvExport = defineRoute({
  method: 'get',
  path: '/export',
  responses: { 200: { contentType: 'text/csv' } },
  handler: () => ({ status: 200, body: 'a,b\n1,2' }),
})

/** Reads the raw body text itself — the webhook-signature shape. */
export const rawEcho = defineRoute({
  method: 'post',
  path: '/raw-echo',
  responses: { 200: { body: { type: 'object' } } },
  handler: async ({ request }) => ({ status: 200, body: { raw: await request.readText() } }),
})

/** Shared titled schema: both engines must hoist it into components.schemas. */
const buildInfoSchema = {
  title: 'BuildInfo',
  type: 'object',
  properties: { sha: { type: 'string' } },
  required: ['sha'],
} as const

/** Deprecated + per-operation security: OpenAPI annotations must match. */
export const buildInfo = defineRoute({
  method: 'get',
  path: '/build-info',
  deprecated: true,
  security: [{ apiKey: [] }],
  responses: { 200: { body: buildInfoSchema } },
  handler: () => ({ status: 200, body: { sha: 'abc123' } }),
})

/** Documented response headers on a reply that actually sets them. */
export const releaseInfo = defineRoute({
  method: 'get',
  path: '/release-info',
  responses: { 200: { body: buildInfoSchema, headers: { 'x-cache': { type: 'string' } } } },
  handler: () => ({ status: 200, headers: { 'x-cache': 'hit' }, body: { sha: 'abc123' } }),
})

/** A form-encoded body: coerced fields, array accumulation, 415 on JSON. */
export const submitForm = defineRoute({
  method: 'post',
  path: '/form',
  request: {
    body: {
      type: 'object',
      properties: {
        name: { type: 'string', minLength: 1 },
        age: { type: 'integer', minimum: 18 },
        tags: { type: 'array', items: { type: 'string' } },
      },
      required: ['name', 'age'],
    },
    bodyType: 'form',
  },
  responses: { 201: { body: { type: 'object' } } },
  handler: ({ body }) => ({ status: 201, body }),
})

/** A multipart body: coerced string parts plus a File part read by the handler. */
export const uploadFile = defineRoute({
  method: 'post',
  path: '/upload',
  request: {
    body: {
      type: 'object',
      properties: { title: { type: 'string', minLength: 1 }, attachment: {} },
      required: ['title', 'attachment'],
    },
    bodyType: 'multipart',
  },
  responses: { 200: { body: { type: 'object' } } },
  handler: async ({ body }) => {
    const { title, attachment } = body as { title: string; attachment: File }
    return {
      status: 200,
      body: { title, filename: attachment.name, byteLength: (await attachment.arrayBuffer()).byteLength },
    }
  },
})

/** A greedy tail capture: the rest of the path, decoded and rejoined. */
export const fileProxy = defineRoute({
  method: 'get',
  path: '/files/{path+}',
  request: {
    params: { type: 'object', properties: { path: { type: 'string', minLength: 3 } }, required: ['path'] },
  },
  responses: { 200: { body: { type: 'object', properties: { path: {} } } } },
  handler: ({ params }) => ({ status: 200, body: { path: params.path } }),
})

/**
 * Reads the body three ways after the pipeline already consumed the declared
 * schema — the webhook-HMAC-plus-parsed-access shape. Exercises the shared
 * buffered read in both engines.
 */
export const doubleRead = defineRoute({
  method: 'post',
  path: '/double-read',
  request: { body: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] } },
  responses: { 200: { body: { type: 'object' } } },
  handler: async ({ body, request }) => ({
    status: 200,
    body: { parsed: body.name, raw: await request.readText(), byteLength: (await request.readBytes()).byteLength },
  }),
})

/** What the corpus observer keeps per observation, engine-comparable. `route` is null for unmatched requests. */
export type RecordedObservation = { route: string | null; status: number; durationOk: boolean }

/** Both engines record here; the differential test splices per request. */
export const observations: RecordedObservation[] = []

export const recordObservation = (observation: RequestObservation): void => {
  observations.push({
    route: observation.route.path,
    status: observation.status,
    durationOk: Number.isFinite(observation.durationMs) && observation.durationMs >= 0,
  })
}

/** The unmatched (404/405) observer — `route` is always undefined here. */
export const recordUnmatched = (observation: UnmatchedObservation): void => {
  observations.push({
    route: observation.route ?? null,
    status: observation.status,
    durationOk: Number.isFinite(observation.durationMs) && observation.durationMs >= 0,
  })
}

/** An onRequest gate: blocks flagged requests before mounts and routing. */
export const gateTeapot: FetchOnRequest = (request) =>
  request.headers.get('x-block') === '1'
    ? new Response(JSON.stringify({ error: 'blocked' }), {
        status: 418,
        headers: { 'content-type': 'application/json' },
      })
    : undefined

/** An auth-gate stand-in: resolves the tenant once into the shared locals bag. */
export const gateResolveTenant: FetchOnRequest = (request, _env, _executionContext, locals) => {
  locals['tenant'] = request.headers.get('x-tenant') ?? 'anonymous'
  return undefined
}

/** An onResponse decorator: stamps every outgoing response. */
export const stampHeader: FetchOnResponse = (response) => {
  response.headers.set('x-stamped', 'yes')
  return undefined
}

/** Stamps what the gate and handler left in locals — the rate-limit-counter shape. */
export const stampLocals: FetchOnResponse = (response, _request, locals) => {
  response.headers.set('x-locals', `${String(locals['tenant'] ?? 'none')}:${String(locals['handlerNote'] ?? 'none')}`)
  return undefined
}

/**
 * A createSentry-style onError: proves both engines hand thrown errors the
 * same route contract and platform values, since everything it reads shows
 * up in the response the differential test compares.
 */
export const corpusOnError = (error: unknown, request: ApiRequest, details: OnErrorDetails): ApiResponse => ({
  status: 500,
  body: {
    error: 'handled',
    message: error instanceof Error ? error.message : 'unknown',
    route: details.route.path,
    method: details.route.method,
    tenant: (details.env as { tenant?: string } | undefined)?.tenant ?? null,
    // The locals the gate resolved must be visible here too — the error path
    // shares the same per-request bag as the pipeline.
    gateTenant: (request.locals?.['tenant'] as string | undefined) ?? null,
  },
})

/**
 * A custom ValidatorCompiler both engines can share: the interpreter's
 * verdicts, tightened so any object carrying a `compilerProbe` key is
 * rejected. The probe is observable through ordinary requests, which is how
 * the differential test proves every guard really came from this compiler
 * (the interpreter and the inline guards would both accept the probe).
 */
export const corpusCompile: ValidatorCompiler = (schema) => {
  const guard = validateGuard(schema)
  return {
    guard: (value): value is unknown =>
      guard(value) && !(typeof value === 'object' && value !== null && 'compilerProbe' in value),
    collect: validate(schema),
  }
}

/**
 * Reply body violates the declared 200 schema (`ok` must be a boolean).
 * Typed as AnyRouteContract on purpose: defineRoute would reject this reply
 * at compile time, and response validation exists exactly for what the type
 * checker cannot see in erased/dynamic code.
 */
export const badReply: AnyRouteContract = {
  method: 'get',
  path: '/bad-reply',
  responses: {
    200: {
      body: { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'], additionalProperties: false },
    },
  },
  handler: () => ({ status: 200, body: { ok: 'yes' } }),
}

/** Replies with a status the contract never declared — a 500 under validateResponses. */
export const undeclaredStatus: AnyRouteContract = {
  method: 'get',
  path: '/undeclared',
  responses: { 200: {} },
  handler: () => ({ status: 201, body: { oops: true } }),
}

/** Declared response headers: `?bad=true` sets one that violates its schema. */
export const strictHeaders = defineRoute({
  method: 'get',
  path: '/strict-headers',
  request: { query: { type: 'object', properties: { bad: { type: 'boolean' } } } },
  responses: {
    200: {
      body: { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'], additionalProperties: false },
      headers: { 'x-count': { type: 'string', minLength: 3 } },
    },
  },
  handler: ({ query }) => ({
    status: 200,
    headers: { 'x-count': query.bad === true ? 'x' : 'abc' },
    body: { ok: true },
  }),
})

/** Set when the endless stream's consumer hangs up — the abort-detection probe. */
export const endlessState = { cancelled: false }

/** Streams forever; only a client disconnect (stream cancel) can end it. */
export const endlessStream = defineRoute({
  method: 'get',
  path: '/endless',
  responses: { 200: { contentType: 'application/octet-stream' } },
  handler: () => {
    const bytes = new Uint8Array(64 * 1024)
    const body = new ReadableStream<Uint8Array>({
      pull: (controller) => controller.enqueue(bytes),
      cancel: () => {
        endlessState.cancelled = true
      },
    })
    return { status: 200, body }
  },
})

/** Custom error envelopes — both engines must shape cold paths identically. */
export const corpusErrors: ErrorFormatters = {
  notFound: (request) => ({
    status: 404,
    body: {
      error: 'nothing at ' + request.path,
      gateTenant: (request.locals?.['tenant'] as string | undefined) ?? null,
    },
  }),
  validationFailed: (failure, request) => ({
    status: 422,
    body: {
      problem: failure.source,
      count: failure.errors.length,
      // Refinement failures flow through this formatter too, custom paths intact.
      paths: failure.errors.map((error) => error.path),
      gateTenant: (request.locals?.['tenant'] as string | undefined) ?? null,
    },
  }),
  payloadTooLarge: () => ({ status: 413, body: { error: 'over the corpus limit' } }),
}
