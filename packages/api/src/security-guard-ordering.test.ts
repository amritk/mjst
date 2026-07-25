import { describe, expect, it } from 'vitest'

import { createApi } from './create-api'
import { defineContract } from './define-contract'
import { payloadTooLargeError } from './payload-too-large'
import { requireContext } from './require-context'
import { routeImplementer } from './route-implementer'
import type { SecurityGuard } from './secure-routes'
import { secureRoutes, securityGuard } from './secure-routes'
import type {
  AnyRouteContract,
  Api,
  ApiOptions,
  ApiRequest,
  ContextGuardInput,
  ErasedGuard,
  OnErrorDetails,
  SecurityRequirements,
  ValidationFailureBody,
} from './types'

type AppContext = { readonly session: { readonly role: string } | null }

/**
 * Counters for the three body readers. A guarded route must not touch any of
 * them for a caller it is about to deny, so a test proves the point by showing
 * these all stayed at zero.
 */
type BodyReads = {
  json: number
  text: number
  bytes: number
}

const bodyReads = (): BodyReads => ({ json: 0, text: 0, bytes: 0 })

type RequestOptions = {
  readonly search?: string
  readonly body?: unknown
  readonly headers?: Readonly<Record<string, string>>
  /** Counters the readers bump, when a test wants to watch them. */
  readonly reads?: BodyReads
  /** What every reader rejects with — how an oversized body reaches the pipeline. */
  readonly readError?: unknown
}

/**
 * Builds the framework-neutral request an adapter would produce, with the body
 * readers instrumented so a test can tell whether the pipeline reached them.
 */
const request = (method: string, path: string, options: RequestOptions = {}): ApiRequest => {
  const count = (kind: keyof BodyReads): void => {
    if (options.reads !== undefined) options.reads[kind] += 1
  }
  const serialized = (): string => JSON.stringify(options.body ?? null)
  return {
    method,
    path,
    searchParams: () => new URLSearchParams(options.search ?? ''),
    header: (name) => options.headers?.[name],
    readBody: () => {
      count('json')
      if (options.readError !== undefined) return Promise.reject(options.readError)
      return 'body' in options
        ? Promise.resolve(options.body)
        : Promise.reject(new SyntaxError('Unexpected end of input'))
    },
    readText: () => {
      count('text')
      return options.readError !== undefined ? Promise.reject(options.readError) : Promise.resolve(serialized())
    },
    readBytes: () => {
      count('bytes')
      return options.readError !== undefined
        ? Promise.reject(options.readError)
        : Promise.resolve(new TextEncoder().encode(serialized()))
    },
  }
}

/** Session resolved from the `x-role` header, so a bare request is anonymous. */
const sessionContext = ({ request: incoming }: { readonly request: ApiRequest }): AppContext => {
  const role = incoming.header('x-role')
  return { session: role === undefined ? null : { role } }
}

const unauthorized = { status: 401, body: { error: 'unauthorized' } } as const

const errorSchema = {
  type: 'object',
  properties: { error: { type: 'string' } },
  required: ['error'],
  additionalProperties: false,
} as const

const okSchema = {
  type: 'object',
  properties: { ok: { type: 'boolean' } },
  required: ['ok'],
  additionalProperties: false,
} as const

/**
 * The note body's field names are deliberately distinctive: a pre-auth
 * validation failure would spell them out in the response, which is exactly
 * what the information-disclosure test greps for.
 */
const noteSchema = {
  type: 'object',
  properties: { title: { type: 'string', minLength: 1 }, authorEmail: { type: 'string' } },
  required: ['title', 'authorEmail'],
  additionalProperties: false,
} as const

const idSchema = { type: 'object', properties: { id: { type: 'integer' } }, required: ['id'] } as const

const documentSecurity: SecurityRequirements = [{ bearerAuth: [] }]

const implement = routeImplementer<AppContext>()

/**
 * Wires one route behind a single security guard the way an app does it: the
 * document-level requirement, resolved into `securityGuards` by `secureRoutes`,
 * with the same declaration handed to `createApi`.
 */
const secure = (
  route: AnyRouteContract,
  guard: SecurityGuard<never>,
  extras: Omit<ApiOptions, 'routes' | 'security'> = {},
): Api =>
  createApi({
    routes: secureRoutes([route], {
      securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', [securityGuard]: guard } },
      security: documentSecurity,
    }),
    security: documentSecurity,
    ...extras,
  })

/** A minimal secured route, for the cases that only need one guard to hang off. */
const thing = implement(
  defineContract({
    method: 'get',
    path: '/thing',
    responses: { 200: { body: okSchema }, 401: { body: errorSchema } },
  }),
  () => ({ status: 200, body: { ok: true } }),
)

/** The same shape as the guarded notes route, but never passed through `secureRoutes`. */
const openNotes = implement(
  defineContract({
    method: 'post',
    path: '/open/{id}',
    request: { params: idSchema, body: noteSchema },
    responses: { 200: { body: okSchema } },
  }),
  () => ({ status: 200, body: { ok: true } }),
)

type NotesHarness = {
  readonly api: Api
  /** The pipeline stages that ran, in order. */
  readonly calls: string[]
  /** The app context each stage saw, so identity can be compared across them. */
  readonly contexts: {
    readonly built: unknown[]
    readonly security: unknown[]
    readonly handler: unknown[]
  }
}

/**
 * A guarded `POST /notes/{id}` carrying everything a security guard is supposed
 * to run ahead of — a body schema, a `refine`, and the route's own guard — with
 * every stage recording itself, so one request tells the whole ordering story.
 */
const buildNotes = (extras: Omit<ApiOptions, 'routes' | 'security' | 'context'> = {}): NotesHarness => {
  const calls: string[] = []
  const contexts = { built: [] as unknown[], security: [] as unknown[], handler: [] as unknown[] }

  const requireSession = requireContext((gate: ContextGuardInput<AppContext>) => {
    calls.push('security')
    contexts.security.push(gate.context)
    return gate.context.session !== null
  }, unauthorized)

  const notes = implement(
    defineContract({
      method: 'post',
      path: '/notes/{id}',
      request: { params: idSchema, body: noteSchema },
      refine: () => {
        calls.push('refine')
        return undefined
      },
      responses: { 200: { body: okSchema }, 401: { body: errorSchema }, 402: { body: errorSchema } },
    }),
    {
      guards: [
        () => {
          calls.push('own-guard')
          return undefined
        },
      ],
      handler: ({ context }) => {
        calls.push('handler')
        contexts.handler.push(context)
        return { status: 200, body: { ok: true } }
      },
    },
  )

  const api = secure(notes, requireSession, {
    context: (input) => {
      calls.push('context')
      const value = sessionContext(input)
      contexts.built.push(value)
      return value
    },
    ...extras,
  })
  return { api, calls, contexts }
}

/** A valid note body, so only the slot a test breaks is ever the invalid one. */
const note = { title: 'Notes on the pipeline', authorEmail: 'ada@example.com' }

type StrictOverrides = {
  readonly path?: string
  readonly search?: string
  readonly tenant?: string
  readonly sid?: string
  readonly role?: string
}

/** A request to the strict route that is valid in every slot the overrides leave alone. */
const strictRequest = (overrides: StrictOverrides): ApiRequest =>
  request('GET', overrides.path ?? '/strict/1', {
    search: overrides.search ?? 'limit=5',
    headers: {
      'x-tenant': overrides.tenant ?? 'acme',
      cookie: 'sid=' + (overrides.sid ?? 'abcdef'),
      ...(overrides.role !== undefined ? { 'x-role': overrides.role } : {}),
    },
  })

/** A guarded route declaring every string-transport slot, so each can be broken on its own. */
const buildStrict = (): Api => {
  const requireSession = requireContext(
    (gate: ContextGuardInput<AppContext>) => gate.context.session !== null,
    unauthorized,
  )
  const strict = implement(
    defineContract({
      method: 'get',
      path: '/strict/{id}',
      request: {
        params: idSchema,
        query: { type: 'object', properties: { limit: { type: 'integer', minimum: 1 } }, required: ['limit'] },
        headers: {
          type: 'object',
          properties: { 'x-tenant': { type: 'string', minLength: 3 } },
          required: ['x-tenant'],
        },
        cookies: { type: 'object', properties: { sid: { type: 'string', minLength: 3 } }, required: ['sid'] },
      },
      responses: { 200: { body: okSchema }, 401: { body: errorSchema } },
    }),
    () => ({ status: 200, body: { ok: true } }),
  )
  return secure(strict, requireSession, { context: sessionContext })
}

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : 'unknown')

describe('security-guard-ordering', () => {
  it('denies an anonymous caller without reading the body, refining, or running the route own guards', async () => {
    const { api, calls } = buildNotes()
    const reads = bodyReads()
    const response = await api.handle(
      request('POST', '/notes/1', { body: note, headers: { 'content-type': 'application/json' }, reads }),
    )
    expect(response).toEqual(unauthorized)
    // Everything past the security guard is app-visible work a deny-by-default
    // API owes an unauthenticated caller nothing of.
    expect(reads).toEqual({ json: 0, text: 0, bytes: 0 })
    expect(calls).toEqual(['context', 'security'])
  })

  it('runs the whole pipeline once the security guard admits the request', async () => {
    const { api, calls } = buildNotes()
    const reads = bodyReads()
    const response = await api.handle(
      request('POST', '/notes/1', {
        body: note,
        headers: { 'content-type': 'application/json', 'x-role': 'user' },
        reads,
      }),
    )
    expect(response).toEqual({ status: 200, body: { ok: true } })
    expect(reads.json).toBe(1)
    expect(calls).toEqual(['context', 'security', 'refine', 'own-guard', 'handler'])
  })

  it('answers an invalid body with the denial rather than a 400 enumerating the schema', async () => {
    const { api, calls } = buildNotes()
    const reads = bodyReads()
    const anonymous = await api.handle(request('POST', '/notes/1', { body: { title: '' }, reads }))
    expect(anonymous).toEqual(unauthorized)
    expect(reads.json).toBe(0)
    expect(calls).toEqual(['context', 'security'])
    // The information-disclosure fix: not one schema field name reaches a
    // caller who was never allowed to know the route's shape.
    const serialized = JSON.stringify(anonymous)
    expect(serialized).not.toContain('title')
    expect(serialized).not.toContain('authorEmail')
    expect(serialized).not.toContain('validation_failed')

    // The body really is invalid, and the 400 it earns an authenticated caller
    // does spell the schema out — which is what makes the assertions above
    // meaningful rather than vacuous.
    const authenticated = await api.handle(
      request('POST', '/notes/1', { body: { title: '' }, headers: { 'x-role': 'user' } }),
    )
    expect(authenticated.status).toBe(400)
    expect((authenticated.body as ValidationFailureBody).source).toBe('body')
    expect(JSON.stringify(authenticated)).toContain('authorEmail')
  })

  it('does not answer 415 for a mismatched content-type before authorizing', async () => {
    const { api } = buildNotes()
    const headers = { 'content-type': 'text/plain' }
    expect(await api.handle(request('POST', '/notes/1', { body: note, headers }))).toEqual(unauthorized)

    const authenticated = await api.handle(
      request('POST', '/notes/1', { body: note, headers: { ...headers, 'x-role': 'user' } }),
    )
    expect(authenticated).toEqual({ status: 415, body: { error: 'unsupported_media_type' } })
  })

  it('does not answer 413 for an oversized body before authorizing', async () => {
    const { api } = buildNotes()
    const reads = bodyReads()
    const readError = payloadTooLargeError(8)
    expect(await api.handle(request('POST', '/notes/1', { readError, reads }))).toEqual(unauthorized)
    expect(reads).toEqual({ json: 0, text: 0, bytes: 0 })

    const authenticated = await api.handle(request('POST', '/notes/1', { readError, headers: { 'x-role': 'user' } }))
    expect(authenticated).toEqual({ status: 413, body: { error: 'payload_too_large' } })
  })

  it('denies an anonymous caller with invalid params, query, headers, or cookies instead of 400ing', async () => {
    const api = buildStrict()
    const broken: ReadonlyArray<readonly [ValidationFailureBody['source'], StrictOverrides]> = [
      ['params', { path: '/strict/abc' }],
      ['query', { search: 'limit=0' }],
      ['headers', { tenant: 'no' }],
      ['cookies', { sid: 'x' }],
    ]
    for (const [source, overrides] of broken) {
      expect(await api.handle(strictRequest(overrides))).toEqual(unauthorized)
      // And each slot is genuinely invalid, which the same request with a
      // session proves — otherwise the assertion above would pass vacuously.
      const authenticated = await api.handle(strictRequest({ ...overrides, role: 'user' }))
      expect(authenticated.status).toBe(400)
      expect((authenticated.body as ValidationFailureBody).source).toBe(source)
    }
  })

  it('builds the app context exactly once and hands the guard and the handler the same value', async () => {
    const { api, contexts } = buildNotes()
    const response = await api.handle(request('POST', '/notes/1', { body: note, headers: { 'x-role': 'user' } }))
    expect(response.status).toBe(200)
    // Hoisting the factory ahead of the guards must not make it run twice.
    expect(contexts.built).toHaveLength(1)
    expect(contexts.security[0]).toBe(contexts.built[0])
    expect(contexts.handler[0]).toBe(contexts.built[0])

    // A denied request pays for the factory exactly once too.
    const denied = buildNotes()
    expect(await denied.api.handle(request('POST', '/notes/1', { body: note }))).toEqual(unauthorized)
    expect(denied.contexts.built).toHaveLength(1)
  })

  it('runs the route own guards only after validation, with the security guard ahead of both', async () => {
    const { api, calls } = buildNotes()
    const response = await api.handle(
      request('POST', '/notes/1', { body: { title: '' }, headers: { 'x-role': 'user' } }),
    )
    expect(response.status).toBe(400)
    // Security passed, then validation failed — the route's own guard (and the
    // refine before it) still belong after validation.
    expect(calls).toEqual(['context', 'security'])
  })

  it('sends a throwing security guard down the onError path', async () => {
    let details: OnErrorDetails | undefined
    const api = secure(
      thing,
      () => {
        throw new Error('guard blew up')
      },
      {
        onError: (error, _request, errorDetails) => {
          details = errorDetails
          return { status: 500, body: { error: messageOf(error) } }
        },
      },
    )
    expect(await api.handle(request('GET', '/thing'))).toEqual({ status: 500, body: { error: 'guard blew up' } })
    // Unlike the document endpoint, a route error still names its contract.
    expect(details?.route?.path).toBe('/thing')
  })

  it('sends a rejecting async security guard down the onError path', async () => {
    const api = secure(
      thing,
      async () => {
        await Promise.resolve()
        throw new Error('async guard blew up')
      },
      { onError: (error) => ({ status: 500, body: { error: messageOf(error) } }) },
    )
    expect(await api.handle(request('GET', '/thing'))).toEqual({ status: 500, body: { error: 'async guard blew up' } })
  })

  it('sends a throwing context factory on a secured route down the onError path', async () => {
    const api = secure(thing, () => undefined, {
      context: () => {
        throw new Error('no database')
      },
      onError: (error) => ({ status: 503, body: { error: messageOf(error) } }),
    })
    expect(await api.handle(request('GET', '/thing'))).toEqual({ status: 503, body: { error: 'no database' } })
  })

  it('answers a bare 500 when a security guard or the context factory throws with no onError', async () => {
    const guardApi = secure(thing, () => {
      throw new Error('nope')
    })
    expect(await guardApi.handle(request('GET', '/thing'))).toEqual({ status: 500, body: { error: 'internal_error' } })

    const contextApi = secure(thing, () => undefined, {
      context: () => {
        throw new Error('nope')
      },
    })
    expect(await contextApi.handle(request('GET', '/thing'))).toEqual({
      status: 500,
      body: { error: 'internal_error' },
    })
  })

  it('lets a security guard deny with a raw Response', async () => {
    const raw = new Response('go away', { status: 418, headers: { 'content-type': 'text/plain' } })
    // Response validation is on to prove the raw escape hatch skips it, exactly
    // as it does for a handler's raw reply.
    const api = secure(thing, () => raw, { validateResponses: true })
    const response = await api.handle(request('GET', '/thing'))
    expect(response.status).toBe(418)
    expect(response.raw).toBe(raw)
    expect(response.body).toBeUndefined()
  })

  it('returns a denial as-is under validateResponses when the route declares its status', async () => {
    const { api } = buildNotes({ validateResponses: true })
    expect(await api.handle(request('POST', '/notes/1', { body: note }))).toEqual(unauthorized)
  })

  it('runs a denial through response validation like any other reply', async () => {
    // The 401 is declared, but with a body the schema rejects — the denial takes
    // the handler reply's path, so response validation catches it.
    const api = secure(thing, () => ({ status: 401, body: { error: 42 } }), { validateResponses: true })
    const response = await api.handle(request('GET', '/thing'))
    expect(response.status).toBe(500)
    expect((response.body as { error: string }).error).toBe('invalid_response')
  })

  it('keeps the context factory after validation for a route with no security guards', async () => {
    let built = 0
    const api = createApi({
      routes: [openNotes],
      context: () => {
        built += 1
        return { session: null }
      },
    })
    const rejected = await api.handle(request('POST', '/open/abc', { body: note }))
    expect(rejected.status).toBe(400)
    // The standing performance guarantee for unsecured routes: a request that
    // cannot succeed never pays for a session lookup or a database handle.
    expect(built).toBe(0)

    const accepted = await api.handle(request('POST', '/open/1', { body: note }))
    expect(accepted).toEqual({ status: 200, body: { ok: true } })
    expect(built).toBe(1)
  })

  it('reports a security guard that outgrew the body cap as a 413', async () => {
    // A guard that reads the body itself (signature verification) hits the cap
    // as a thrown error. That is the transport's 413, not a guard crash — the
    // same rule the handler and the body reader already follow, and what the
    // compiled engine reports, so the engines agree.
    const contract = defineContract({
      method: 'get',
      path: '/verify',
      responses: { 200: { body: { type: 'object' } }, 401: { body: { type: 'object' } } },
    })
    const throwing: SecurityGuard = () => {
      throw payloadTooLargeError(8)
    }
    const routes = secureRoutes([routeImplementer()(contract, () => ({ status: 200, body: {} }))], {
      securitySchemes: { sig: { type: 'http', scheme: 'bearer', [securityGuard]: throwing } },
      security: [{ sig: [] }],
    })
    const api = createApi({ routes, onError: () => ({ status: 500, body: { error: 'went-to-onError' } }) })
    expect(await api.handle(request('GET', '/verify'))).toEqual({
      status: 413,
      body: { error: 'payload_too_large' },
    })
  })

  it('reports an OpenAPI document guard that outgrew the body cap as a 413', async () => {
    // Typed as a plain route guard rather than a `SecurityGuard`: nothing
    // declares a security requirement for the document, so a document guard is
    // never handed scopes.
    const gate: ErasedGuard = () => {
      throw payloadTooLargeError(8)
    }
    const api = createApi({
      routes: [],
      openApiGuards: [gate],
      onError: () => ({ status: 500, body: { error: 'went-to-onError' } }),
    })
    expect(await api.handle(request('GET', '/openapi.json'))).toEqual({
      status: 413,
      body: { error: 'payload_too_large' },
    })
  })
})
