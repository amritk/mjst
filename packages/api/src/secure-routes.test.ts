import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { compileToModule } from './compile/compile-to-module'
import { createApi } from './create-api'
import { defineContract } from './define-contract'
import { requireContext } from './require-context'
import { routeImplementer } from './route-implementer'
import { secureRoutes, securityGuard } from './secure-routes'
import * as utils from './secure-routes.test-utils'
import { toFetchHandler } from './to-fetch-handler'
import type { AnyRouteContract, ApiRequest, ContextGuardInput } from './types'

type AppContext = { readonly session: { readonly role: string } | null }

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
  return { session: role === undefined ? null : { role } }
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
    // Neither alternative satisfied: the last denial (the api-key 401) is returned.
    expect((await api.handle(request('/either', { 'x-role': 'user' }))).status).toBe(401)
    // First alternative satisfied.
    expect((await api.handle(request('/either', { 'x-role': 'admin' }))).status).toBe(200)
    // Second alternative satisfied without a session at all.
    expect((await api.handle(request('/either', { 'x-api-key': 'let-me-in' }))).status).toBe(200)
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
    // The document default reaches /profile through the merged guard array.
    expect(source).toContain('runGuards(profileRoute.guards, context, 0)')

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
