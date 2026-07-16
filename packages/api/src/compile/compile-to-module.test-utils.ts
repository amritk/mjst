import { defineRoute } from '../define-route'
import { routeFactory } from '../route-factory'
import type { ContextFactoryInput } from '../types'

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
export type CorpusContext = { readonly tenant: string; readonly viaHeader: string | null }

export const createAppContext = async ({ request, env }: ContextFactoryInput): Promise<CorpusContext> => ({
  tenant: (env as { tenant?: string } | undefined)?.tenant ?? 'none',
  viaHeader: request.header('x-ctx') ?? null,
})

/** Exercises the app context: env binding + request access through the factory. */
export const whoami = routeFactory<CorpusContext>()({
  method: 'get',
  path: '/whoami',
  responses: { 200: { body: { type: 'object' } } },
  handler: ({ context }) => ({ status: 200, body: { tenant: context.tenant, viaHeader: context.viaHeader } }),
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
