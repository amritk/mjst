import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { compileToModule } from './compile/compile-to-module'
import { createApi } from './create-api'
import { defineContract } from './define-contract'
import { requireContext } from './require-context'
import { routeImplementer } from './route-implementer'
import { assertRoutesSecured, secureRoutes, securityGuard } from './secure-routes'
import * as utils from './secure-routes.test-utils'
import { toFetchHandler } from './to-fetch-handler'
import type { AnyRouteContract, ApiRequest, ContextGuardInput, ErasedGuard, ErasedRequestContext } from './types'

type AppContext = {
  readonly session: { readonly role: string } | null
  /** What the caller was granted, so scope enforcement is driven by the request like everything else here. */
  readonly scopes: readonly string[]
}

const request = (path: string, headers: Record<string, string> = {}): ApiRequest => ({
  method: 'GET',
  path,
  searchParams: () => new URLSearchParams(),
  header: (name) => headers[name.toLowerCase()],
  readBody: () => Promise.reject(new SyntaxError('no body')),
  readText: () => Promise.resolve(''),
  readBytes: () => Promise.resolve(new Uint8Array()),
})

/** Session resolved from the `x-role` header so requests drive the guards. */
const context = ({ request }: { request: ApiRequest }): AppContext => {
  const role = request.header('x-role')
  const granted = request.header('x-scopes')
  return {
    session: role === undefined ? null : { role },
    scopes: granted === undefined ? [] : granted.split(' '),
  }
}

const unauthorized = { status: 401, body: { error: 'unauthorized' } } as const
const forbidden = { status: 403, body: { error: 'forbidden' } } as const

const requireSession = requireContext(
  (ctx: ContextGuardInput<AppContext>) => ctx.context.session !== null,
  unauthorized,
)
const requireAdmin = requireContext(
  (ctx: ContextGuardInput<AppContext>) => ctx.context.session?.role === 'admin',
  forbidden,
)
// A scheme guard that reads the request rather than the context, for the OR case.
const requireApiKey = requireContext(
  (ctx: ContextGuardInput<AppContext>) => ctx.request.header('x-api-key') === 'let-me-in',
  unauthorized,
)

const errorSchema = {
  type: 'object',
  properties: { error: { type: 'string' } },
  required: ['error'],
  additionalProperties: false,
} as const
const roleSchema = {
  type: 'object',
  properties: { role: { type: 'string' } },
  required: ['role'],
} as const

const implement = routeImplementer<AppContext>()

/** A contract declaring the statuses the guards deny with, plus an optional own security. */
const roleRoute = (path: string, security?: readonly Record<string, readonly string[]>[]) =>
  implement(
    defineContract({
      method: 'get',
      path,
      ...(security !== undefined ? { security } : {}),
      responses: {
        200: { body: roleSchema },
        401: { body: errorSchema },
        402: { body: errorSchema },
        403: { body: errorSchema },
      },
    }),
    ({ context }) => ({ status: 200, body: { role: context.session?.role ?? 'unknown' } }),
  )

const schemes = {
  bearerAuth: { type: 'http', scheme: 'bearer', [securityGuard]: requireSession },
  adminAuth: { type: 'http', scheme: 'bearer', [securityGuard]: requireAdmin },
  apiKey: { type: 'apiKey', name: 'x-api-key', in: 'header', [securityGuard]: requireApiKey },
} as const

const build = (routes: readonly AnyRouteContract[], security?: readonly Record<string, readonly string[]>[]) =>
  createApi({
    routes: secureRoutes(routes, { securitySchemes: schemes, ...(security !== undefined ? { security } : {}) }),
    securitySchemes: schemes,
    ...(security !== undefined ? { security } : {}),
    context,
  })

/**
 * A contract that declares nothing but its 200, so a guard's denial status is
 * genuinely undeclared — that is what the denial-status check is looking for.
 */
const narrowRoute = (path: string, security?: readonly Record<string, readonly string[]>[]) =>
  implement(
    defineContract({
      method: 'get',
      path,
      ...(security !== undefined ? { security } : {}),
      responses: { 200: { body: roleSchema } },
    }),
    ({ context }) => ({ status: 200, body: { role: context.session?.role ?? 'unknown' } }),
  )

/** One scheme whose guard enforces whatever scopes the requirement asked for. */
const requireScopes = requireContext(
  (ctx: ContextGuardInput<AppContext>, scopes) => scopes.every((scope) => ctx.context.scopes.includes(scope)),
  forbidden,
)

const scopedSchemes = { oauth2: { type: 'oauth2', [securityGuard]: requireScopes } }

const scopedApi = (routes: readonly AnyRouteContract[], security?: readonly Record<string, readonly string[]>[]) =>
  createApi({
    routes: secureRoutes(routes, {
      securitySchemes: scopedSchemes,
      ...(security !== undefined ? { security } : {}),
    }),
    context,
  })

/**
 * The context the pipeline hands a security guard: the app context and the raw
 * request, with none of the validated slots filled in yet. Built by hand so a
 * resolved guard can be called directly, which is the only way to see whether
 * it stayed synchronous.
 */
const gateContext = (headers: Record<string, string> = {}): ErasedRequestContext => {
  const gateRequest = request('/gate', headers)
  return {
    params: undefined,
    query: undefined,
    body: undefined,
    headers: undefined,
    cookies: undefined,
    context: context({ request: gateRequest }),
    request: gateRequest,
  } as unknown as ErasedRequestContext
}

/** The single guard `secureRoutes` resolved for a one-route list — the OR combinator, for direct calls. */
const soleGuard = (routes: readonly AnyRouteContract[]): ErasedGuard => {
  const guards = routes[0]?.securityGuards ?? []
  const guard = guards[0]
  if (guard === undefined || guards.length !== 1) throw new Error('expected exactly one resolved security guard')
  return guard
}

const isThenable = (value: unknown): boolean => typeof (value as { then?: unknown } | undefined)?.then === 'function'

describe('secure-routes', () => {
  it('applies the document-level default guard to a route with no own security', async () => {
    const api = build([roleRoute('/profile')], [{ bearerAuth: [] }])
    expect((await api.handle(request('/profile'))).status).toBe(401)
    expect(await api.handle(request('/profile', { 'x-role': 'user' }))).toEqual({ status: 200, body: { role: 'user' } })
  })

  it('treats `security: []` as a public opt-out from the default', async () => {
    const api = build([roleRoute('/health', [])], [{ bearerAuth: [] }])
    // No session, yet served: the empty requirement opted the route out.
    expect(await api.handle(request('/health'))).toEqual({ status: 200, body: { role: 'unknown' } })
  })

  it('lets a per-operation requirement override the default', async () => {
    const api = build([roleRoute('/admin', [{ adminAuth: [] }])], [{ bearerAuth: [] }])
    expect((await api.handle(request('/admin', { 'x-role': 'user' }))).status).toBe(403)
    expect(await api.handle(request('/admin', { 'x-role': 'admin' }))).toEqual({ status: 200, body: { role: 'admin' } })
  })

  it('requires every scheme in a single requirement (AND)', async () => {
    const api = build([roleRoute('/both', [{ bearerAuth: [], adminAuth: [] }])])
    // No session fails the first (bearer) guard.
    expect((await api.handle(request('/both'))).status).toBe(401)
    // Session present but not admin fails the second.
    expect((await api.handle(request('/both', { 'x-role': 'user' }))).status).toBe(403)
    expect((await api.handle(request('/both', { 'x-role': 'admin' }))).status).toBe(200)
  })

  it('accepts any satisfied alternative (OR)', async () => {
    const api = build([roleRoute('/either', [{ adminAuth: [] }, { apiKey: [] }])])
    // Neither alternative satisfied: the *first* alternative's denial (the
    // admin 403) is returned — it is the primary way in, and reporting the
    // last one instead would make the status depend on array order.
    expect((await api.handle(request('/either', { 'x-role': 'user' }))).status).toBe(403)
    // First alternative satisfied.
    expect((await api.handle(request('/either', { 'x-role': 'admin' }))).status).toBe(200)
    // Second alternative satisfied without a session at all.
    expect((await api.handle(request('/either', { 'x-api-key': 'let-me-in' }))).status).toBe(200)
  })

  it('applies an OR requirement declared as the document default', async () => {
    const api = build([roleRoute('/dashboard')], [{ adminAuth: [] }, { apiKey: [] }])
    expect((await api.handle(request('/dashboard', { 'x-role': 'user' }))).status).toBe(403)
    expect((await api.handle(request('/dashboard', { 'x-role': 'admin' }))).status).toBe(200)
    expect((await api.handle(request('/dashboard', { 'x-api-key': 'let-me-in' }))).status).toBe(200)
  })

  it('stops at the first satisfied alternative in an OR', async () => {
    let laterCalls = 0
    const pass = requireContext(() => true, unauthorized)
    const counting = requireContext(() => {
      laterCalls += 1
      return true
    }, unauthorized)
    const pair = {
      first: { type: 'http', scheme: 'bearer', [securityGuard]: pass },
      second: { type: 'http', scheme: 'bearer', [securityGuard]: counting },
    }
    const api = createApi({
      routes: secureRoutes([roleRoute('/or', [{ first: [] }, { second: [] }])], { securitySchemes: pair }),
      context,
    })
    expect((await api.handle(request('/or'))).status).toBe(200)
    // The first alternative passed, so the second alternative's guard never ran.
    expect(laterCalls).toBe(0)
  })

  it('awaits an async scheme guard', async () => {
    const asyncSession = requireContext(async (ctx: ContextGuardInput<AppContext>) => {
      await Promise.resolve()
      return ctx.context.session !== null
    }, unauthorized)
    const api = createApi({
      routes: secureRoutes([roleRoute('/async')], {
        securitySchemes: { s: { type: 'http', scheme: 'bearer', [securityGuard]: asyncSession } },
        security: [{ s: [] }],
      }),
      context,
    })
    expect((await api.handle(request('/async'))).status).toBe(401)
    expect((await api.handle(request('/async', { 'x-role': 'user' }))).status).toBe(200)
  })

  it('rejects an empty requirement object by default', () => {
    // `{}` is OpenAPI's "authentication optional", which is indistinguishable
    // from a typo and would leave the operation public.
    expect(() => secureRoutes([roleRoute('/anon', [{}])], { securitySchemes: schemes })).toThrow(
      /lists an empty security requirement object/,
    )
  })

  it('honors an empty requirement object under allowOptionalSecurity', () => {
    const route = roleRoute('/anon', [{}])
    const [result] = secureRoutes([route], { securitySchemes: schemes, allowOptionalSecurity: true })
    // Opted in, an empty requirement enforces nothing: the route is untouched.
    expect(result).toBe(route)
  })

  it("runs security guards before the route's own guards", async () => {
    const paymentRequired = { status: 402, body: { error: 'payment_required' } } as const
    const guarded = implement(
      defineContract({
        method: 'get',
        path: '/paywalled',
        responses: { 200: { body: roleSchema }, 401: { body: errorSchema }, 402: { body: errorSchema } },
      }),
      { guards: [() => paymentRequired], handler: () => ({ status: 200, body: { role: 'ok' } }) },
    )
    const api = build([guarded], [{ bearerAuth: [] }])
    // The security guard denies first (401), never reaching the 402 own guard.
    expect((await api.handle(request('/paywalled'))).status).toBe(401)
    // With a session the security guard passes and the own guard's 402 wins.
    expect((await api.handle(request('/paywalled', { 'x-role': 'user' }))).status).toBe(402)
  })

  it('leaves routes untouched when there is no effective requirement', () => {
    const route = roleRoute('/open')
    const [result] = secureRoutes([route], { securitySchemes: schemes })
    expect(result).toBe(route)
  })

  it('leaves a public opt-out route untouched by reference', () => {
    const route = roleRoute('/open', [])
    const [result] = secureRoutes([route], { securitySchemes: schemes, security: [{ bearerAuth: [] }] })
    expect(result).toBe(route)
  })

  it('throws when a required scheme has no guard', () => {
    const noGuard = { basic: { type: 'http', scheme: 'basic' } }
    expect(() => secureRoutes([roleRoute('/x')], { securitySchemes: noGuard, security: [{ basic: [] }] })).toThrow(
      /security scheme 'basic'.*has no 'x-guard' guard/,
    )
  })

  it('throws when a required scheme is not defined', () => {
    expect(() => secureRoutes([roleRoute('/x', [{ ghost: [] }])], { securitySchemes: schemes })).toThrow(
      /requires security scheme 'ghost', which is not defined/,
    )
  })

  it('reports a scheme named after an Object.prototype member as undefined, not as guardless', () => {
    // A bare `securitySchemes[name]` lookup resolves 'constructor' to the
    // inherited `Object` function, which then fails the *guard* check — so the
    // build died naming the wrong mistake. Both errors fail closed; this is
    // about the message pointing at the missing scheme.
    expect(() => secureRoutes([roleRoute('/x', [{ constructor: [] }])], { securitySchemes: schemes })).toThrow(
      /requires security scheme 'constructor', which is not defined/,
    )
  })

  it('strips the guard from the generated OpenAPI document', () => {
    const document = build(
      [roleRoute('/profile'), roleRoute('/admin', [{ adminAuth: [] }]), roleRoute('/health', [])],
      [{ bearerAuth: [] }],
    ).openApi()
    const securitySchemes = (document.components as { securitySchemes: Record<string, Record<string, unknown>> })
      .securitySchemes
    // The scheme is documented, but the runtime guard is gone.
    expect(securitySchemes['bearerAuth']).toEqual({ type: 'http', scheme: 'bearer' })
    expect(Object.keys(securitySchemes['bearerAuth'] ?? {})).not.toContain(securityGuard)
    // The document default and per-operation overrides survive verbatim.
    expect(document.security).toEqual([{ bearerAuth: [] }])
    const paths = document.paths as Record<string, Record<string, { security?: unknown }>>
    expect(paths['/admin']?.['get']?.security).toEqual([{ adminAuth: [] }])
    expect(paths['/health']?.['get']?.security).toEqual([])
    // No function survives serialization either.
    expect(JSON.stringify(document)).not.toContain('x-guard')
  })

  it("hands the requirement's scopes to the scheme guard verbatim", async () => {
    const seen: (readonly string[])[] = []
    const recording = requireContext((_ctx: ContextGuardInput<AppContext>, scopes) => {
      seen.push(scopes)
      return true
    }, forbidden)
    const wanted = ['billing:write', 'billing:read']
    const api = createApi({
      routes: secureRoutes([roleRoute('/billing', [{ oauth2: wanted }])], {
        securitySchemes: { oauth2: { type: 'oauth2', [securityGuard]: recording } },
      }),
      context,
    })
    expect((await api.handle(request('/billing'))).status).toBe(200)
    // The requirement's own array reaches the guard — nothing copies, sorts or
    // rewrites the scopes on the way.
    expect(seen).toEqual([wanted])
    expect(seen[0]).toBe(wanted)
  })

  it('enforces two different scope lists on one scheme differently', async () => {
    const api = scopedApi([roleRoute('/write', [{ oauth2: ['billing:write'] }]), roleRoute('/read', [{ oauth2: [] }])])
    // Same scheme, same guard: only the requirement's scopes tell them apart.
    expect((await api.handle(request('/write'))).status).toBe(403)
    expect((await api.handle(request('/read'))).status).toBe(200)
  })

  it('denies a caller missing the required scope and allows one holding it', async () => {
    const api = scopedApi([roleRoute('/reports')], [{ oauth2: ['reports:read'] }])
    expect((await api.handle(request('/reports', { 'x-scopes': 'reports:write' }))).status).toBe(403)
    expect((await api.handle(request('/reports', { 'x-scopes': 'reports:read reports:write' }))).status).toBe(200)
  })

  it('treats an empty scope list as no scope restriction', async () => {
    const api = scopedApi([roleRoute('/any')], [{ oauth2: [] }])
    expect(await api.handle(request('/any'))).toEqual({ status: 200, body: { role: 'unknown' } })
  })

  it('gives each OR alternative its own scopes', async () => {
    const api = scopedApi([roleRoute('/either-scope', [{ oauth2: ['reports:read'] }, { oauth2: ['reports:admin'] }])])
    expect((await api.handle(request('/either-scope', { 'x-scopes': 'unrelated' }))).status).toBe(403)
    // Only the second alternative's scope is held, and it is enough.
    expect((await api.handle(request('/either-scope', { 'x-scopes': 'reports:admin' }))).status).toBe(200)
  })

  it('gives each scheme in an AND requirement its own scopes', async () => {
    const seen: Record<string, readonly string[]> = {}
    const record = (name: string) =>
      requireContext((_ctx: ContextGuardInput<AppContext>, scopes) => {
        seen[name] = scopes
        return true
      }, forbidden)
    const pair = {
      reader: { type: 'oauth2', [securityGuard]: record('reader') },
      writer: { type: 'oauth2', [securityGuard]: record('writer') },
    }
    const api = createApi({
      routes: secureRoutes([roleRoute('/and', [{ reader: ['docs:read'], writer: ['docs:write'] }])], {
        securitySchemes: pair,
      }),
      context,
    })
    expect((await api.handle(request('/and'))).status).toBe(200)
    expect(seen).toEqual({ reader: ['docs:read'], writer: ['docs:write'] })
  })

  it('rejects a document-level empty requirement object', () => {
    // A `[{}]` default would quietly open every operation in the document.
    expect(() => secureRoutes([roleRoute('/anon')], { securitySchemes: schemes, security: [{}] })).toThrow(
      /secureRoutes: GET \/anon lists an empty security requirement object/,
    )
  })

  it('rejects an empty requirement object listed beside a real one', () => {
    expect(() => secureRoutes([roleRoute('/anon', [{ bearerAuth: [] }, {}])], { securitySchemes: schemes })).toThrow(
      /make every other alternative in the list moot/,
    )
  })

  it('honors a document-level empty requirement under allowOptionalSecurity', () => {
    const route = roleRoute('/anon')
    const [result] = secureRoutes([route], {
      securitySchemes: schemes,
      security: [{}],
      allowOptionalSecurity: true,
    })
    expect(result).toBe(route)
  })

  it('leaves a route public when `{}` sits beside a real requirement under allowOptionalSecurity', async () => {
    const api = createApi({
      routes: secureRoutes([roleRoute('/optional', [{ bearerAuth: [] }, {}])], {
        securitySchemes: schemes,
        allowOptionalSecurity: true,
      }),
      context,
    })
    // This is what OpenAPI's "authentication optional" actually means: the
    // sibling `bearerAuth` requirement is moot and the route serves anyone.
    expect(await api.handle(request('/optional'))).toEqual({ status: 200, body: { role: 'unknown' } })
  })

  it("throws when the route's responses omit the guard's denial status", () => {
    expect(() => secureRoutes([narrowRoute('/narrow', [{ adminAuth: [] }])], { securitySchemes: schemes })).toThrow(
      /denies with 403, but the route's `responses` does not declare 403/,
    )
  })

  it('accepts a guard whose denial status the route declares', () => {
    expect(() =>
      secureRoutes([roleRoute('/declared', [{ adminAuth: [] }])], { securitySchemes: schemes }),
    ).not.toThrow()
  })

  it('skips the denial-status check under allowUndeclaredDenials', () => {
    expect(() =>
      secureRoutes([narrowRoute('/narrow', [{ adminAuth: [] }])], {
        securitySchemes: schemes,
        allowUndeclaredDenials: true,
      }),
    ).not.toThrow()
  })

  it('does not check a hand-written guard, whose denial status is unknown', () => {
    // A plain guard may deny differently per request, so there is no single
    // status to compare against the route's `responses`.
    const inline = { type: 'http', scheme: 'bearer', [securityGuard]: () => forbidden }
    expect(() =>
      secureRoutes([narrowRoute('/inline', [{ inline: [] }])], { securitySchemes: { inline } }),
    ).not.toThrow()
  })

  it('returns a declared denial unchanged under validateResponses', async () => {
    const api = createApi({
      routes: secureRoutes([roleRoute('/checked')], { securitySchemes: schemes, security: [{ bearerAuth: [] }] }),
      context,
      validateResponses: true,
    })
    expect(await api.handle(request('/checked'))).toEqual({ status: 401, body: { error: 'unauthorized' } })
  })

  it('turns an undeclared denial into a 500 under validateResponses', async () => {
    // Precisely the failure the denial-status check prevents: opt out of it and
    // the guard's 403 is rejected as a response the route never promised.
    const api = createApi({
      routes: secureRoutes([narrowRoute('/undeclared', [{ adminAuth: [] }])], {
        securitySchemes: schemes,
        allowUndeclaredDenials: true,
      }),
      context,
      validateResponses: true,
    })
    const response = await api.handle(request('/undeclared', { 'x-role': 'user' }))
    expect(response.status).toBe(500)
    expect(response.body).toMatchObject({ error: 'invalid_response', status: 403 })
  })

  it('rejects a route the document default covers but secureRoutes never saw', () => {
    expect(() => createApi({ routes: [roleRoute('/profile')], security: [{ bearerAuth: [] }], context })).toThrow(
      /createApi: GET \/profile is documented as requiring authentication by the document-level `security` default/,
    )
  })

  it('rejects an unresolved route that declares its own security', () => {
    expect(() => createApi({ routes: [roleRoute('/admin', [{ adminAuth: [] }])], context })).toThrow(
      /createApi: GET \/admin is documented as requiring authentication by its own `security`/,
    )
  })

  it('accepts an unresolved route that opted out with `security: []`', () => {
    expect(() =>
      createApi({ routes: [roleRoute('/health', [])], security: [{ bearerAuth: [] }], context }),
    ).not.toThrow()
  })

  it('accepts an unresolved route with no effective requirement', () => {
    expect(() => createApi({ routes: [roleRoute('/open')], context })).not.toThrow()
  })

  it('accepts routes that went through secureRoutes', () => {
    expect(() => build([roleRoute('/profile')], [{ bearerAuth: [] }])).not.toThrow()
  })

  it('names the caller in the unsecured-route error', () => {
    // The compiled engine calls the same assertion, so the message is told who
    // to blame rather than hard-coding `createApi`.
    expect(() => assertRoutesSecured([roleRoute('/profile')], [{ bearerAuth: [] }], 'compileToModule')).toThrow(
      /^compileToModule: GET \/profile is documented/,
    )
  })

  it("returns the first alternative's denial when every alternative denies", async () => {
    const paymentRequired = { status: 402, body: { error: 'payment_required' } } as const
    const trio = {
      pay: { type: 'http', scheme: 'bearer', [securityGuard]: requireContext(() => false, paymentRequired) },
      adminAuth: { type: 'http', scheme: 'bearer', [securityGuard]: requireAdmin },
      apiKey: { type: 'apiKey', name: 'x-api-key', in: 'header', [securityGuard]: requireApiKey },
    }
    const api = createApi({
      routes: secureRoutes([roleRoute('/first-denial', [{ pay: [] }, { adminAuth: [] }, { apiKey: [] }])], {
        securitySchemes: trio,
      }),
      context,
    })
    // Array order decides, and it is the alternative the document lists first
    // that the caller is told about — not whichever denial happened last.
    expect(await api.handle(request('/first-denial'))).toEqual({ status: 402, body: { error: 'payment_required' } })
  })

  it('runs a scheme shared by two alternatives once per request', async () => {
    let sharedCalls = 0
    const shared = requireContext(() => {
      sharedCalls += 1
      return true
    }, unauthorized)
    const trio = {
      shared: { type: 'http', scheme: 'bearer', [securityGuard]: shared },
      adminAuth: { type: 'http', scheme: 'bearer', [securityGuard]: requireAdmin },
      apiKey: { type: 'apiKey', name: 'x-api-key', in: 'header', [securityGuard]: requireApiKey },
    }
    const api = createApi({
      routes: secureRoutes(
        [
          roleRoute('/shared', [
            { shared: [], adminAuth: [] },
            { shared: [], apiKey: [] },
          ]),
        ],
        { securitySchemes: trio },
      ),
      context,
    })
    expect((await api.handle(request('/shared', { 'x-api-key': 'let-me-in' }))).status).toBe(200)
    // The first alternative failed on `adminAuth`, but the `shared` verdict it
    // already produced carried over instead of the guard running twice.
    expect(sharedCalls).toBe(1)
  })

  it("reuses a shared guard's denial across alternatives", async () => {
    let deniedCalls = 0
    const alwaysDenies = requireContext(() => {
      deniedCalls += 1
      return false
    }, unauthorized)
    const pair = {
      shared: { type: 'http', scheme: 'bearer', [securityGuard]: alwaysDenies },
      apiKey: { type: 'apiKey', name: 'x-api-key', in: 'header', [securityGuard]: requireApiKey },
    }
    const api = createApi({
      routes: secureRoutes([roleRoute('/shared-denial', [{ shared: [] }, { shared: [], apiKey: [] }])], {
        securitySchemes: pair,
      }),
      context,
    })
    expect((await api.handle(request('/shared-denial', { 'x-api-key': 'let-me-in' }))).status).toBe(401)
    expect(deniedCalls).toBe(1)
  })

  it('keeps an all-synchronous OR synchronous', () => {
    const guard = soleGuard(
      secureRoutes([roleRoute('/sync-or', [{ adminAuth: [] }, { apiKey: [] }])], { securitySchemes: schemes }),
    )
    const result = guard(gateContext({ 'x-role': 'user' }))
    // Both alternatives are synchronous, so the combinator must hand back the
    // denial itself rather than a promise the pipeline then has to await.
    expect(isThenable(result)).toBe(false)
    expect(result).toEqual(forbidden)
    // A passing synchronous OR stays synchronous too.
    expect(isThenable(guard(gateContext({ 'x-role': 'admin' })))).toBe(false)
  })

  it('resolves an OR whose alternatives are asynchronous', async () => {
    const asyncPass = requireContext(async () => {
      await Promise.resolve()
      return true
    }, unauthorized)
    const asyncAdmin = requireContext(async (ctx: ContextGuardInput<AppContext>) => {
      await Promise.resolve()
      return ctx.context.session?.role === 'admin'
    }, forbidden)
    const asyncKey = requireContext(async (ctx: ContextGuardInput<AppContext>) => {
      await Promise.resolve()
      return ctx.request.header('x-api-key') === 'let-me-in'
    }, unauthorized)
    const trio = {
      asyncPass: { type: 'http', scheme: 'bearer', [securityGuard]: asyncPass },
      asyncAdmin: { type: 'http', scheme: 'bearer', [securityGuard]: asyncAdmin },
      asyncKey: { type: 'apiKey', name: 'x-api-key', in: 'header', [securityGuard]: asyncKey },
    }
    const api = createApi({
      routes: secureRoutes([roleRoute('/async-or', [{ asyncPass: [], asyncAdmin: [] }, { asyncKey: [] }])], {
        securitySchemes: trio,
      }),
      context,
    })
    // The first alternative resolves to its 403, then the second alternative's
    // awaited guard passes and the request is allowed anyway.
    expect((await api.handle(request('/async-or', { 'x-api-key': 'let-me-in' }))).status).toBe(200)
    // Both alternatives deny asynchronously: the first one's 403 still wins.
    expect((await api.handle(request('/async-or'))).status).toBe(403)
  })

  it('honors the merged guards identically in the compiled engine', async () => {
    // The keys are export names in the routes module; the values are the same
    // secured contracts, whose merged `.guards` the emitted loop threads live.
    // The fixture is written under compile/.fixtures/, so specifiers resolve
    // two directories up to src/.
    const source = compileToModule({
      routesImport: '../../secure-routes.test-utils',
      runtimeImport: '../../index',
      validatorsImport: '@amritk/runtime-validators',
      routes: { profileRoute: utils.profileRoute, adminRoute: utils.adminRoute, healthRoute: utils.healthRoute },
      contextExport: 'createSecureContext',
      openApiPath: false,
    })
    // The document default reaches /profile through the live securityGuards
    // array rather than anything inlined at build time.
    expect(source).toContain('profileRoute.securityGuards')

    const fixtureDir = join(dirname(fileURLToPath(import.meta.url)), 'compile', '.fixtures')
    mkdirSync(fixtureDir, { recursive: true })
    const fixturePath = join(fixtureDir, 'generated-secure.ts')
    writeFileSync(fixturePath, source)

    const compiled = (await import(fixturePath)) as { fetch: (request: Request) => Response | Promise<Response> }
    const runtime = toFetchHandler(
      createApi({
        routes: [utils.profileRoute, utils.adminRoute, utils.healthRoute],
        context: utils.createSecureContext,
        openApiPath: false,
      }),
    )

    const cases: ReadonlyArray<readonly [string, Record<string, string>]> = [
      ['/profile', {}],
      ['/profile', { 'x-role': 'user' }],
      ['/admin', { 'x-role': 'user' }],
      ['/admin', { 'x-role': 'admin' }],
      ['/health', {}],
    ]
    for (const [path, headers] of cases) {
      const req = () => new Request('https://x' + path, { headers })
      const [a, b] = await Promise.all([compiled.fetch(req()), runtime(req())])
      expect(a.status).toBe(b.status)
      expect(await a.text()).toBe(await b.text())
    }
  })
})
