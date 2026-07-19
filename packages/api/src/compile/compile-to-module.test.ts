import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'

import { createApi } from '../create-api'
import { hashContracts } from '../hash-contracts'
import { toFetchHandler } from '../to-fetch-handler'
import type { AnyRouteContract } from '../types'
import { compileToModule } from './compile-to-module'
import * as corpus from './compile-to-module.test-utils'

const routes: Record<string, AnyRouteContract> = {
  health: corpus.health,
  getUser: corpus.getUser,
  listUsers: corpus.listUsers,
  createUser: corpus.createUser,
  removeThing: corpus.removeThing,
  boom: corpus.boom,
  echoHeader: corpus.echoHeader,
  whoami: corpus.whoami,
  submitMetric: corpus.submitMetric,
  tenantInfo: corpus.tenantInfo,
  streamChat: corpus.streamChat,
  csvExport: corpus.csvExport,
  rawEcho: corpus.rawEcho,
  doubleRead: corpus.doubleRead,
  fileProxy: corpus.fileProxy,
  submitForm: corpus.submitForm,
  uploadFile: corpus.uploadFile,
  buildInfo: corpus.buildInfo,
  releaseInfo: corpus.releaseInfo,
  dashboard: corpus.dashboard,
  platformInfo: corpus.platformInfo,
  login: corpus.login,
  bookSlot: corpus.bookSlot,
  bookSlotAsync: corpus.bookSlotAsync,
  optionsProbe: corpus.optionsProbe,
  localsEcho: corpus.localsEcho,
}
const info = { title: 'Differential', version: '1.0.0' }

/** Document-level OpenAPI extras, passed identically to both engines. */
const OPENAPI_EXTRAS = {
  servers: [{ url: 'https://api.example.com' }],
  securitySchemes: { apiKey: { type: 'apiKey', name: 'x-api-key', in: 'header' } },
  security: [{ apiKey: [] }],
  tags: [{ name: 'users', description: 'User management' }],
} as const

/** Workers-style bindings passed to both engines on every request. */
const ENV = { tenant: 'acme' }

/** Small enough to trip on purpose, large enough for every valid corpus body. */
const MAX_BODY_BYTES = 256

const emit = (): string =>
  compileToModule({
    routesImport: '../compile-to-module.test-utils',
    runtimeImport: '../../index',
    validatorsImport: '@amritk/runtime-validators',
    routes,
    info,
    ...OPENAPI_EXTRAS,
    contextExport: 'createAppContext',
    mounts: { '/mounted': 'mountEcho' },
    onRequestExports: ['gateResolveTenant', 'gateTeapot'],
    onResponseExports: ['stampHeader', 'stampLocals'],
    errorsExport: 'corpusErrors',
    onErrorExport: 'corpusOnError',
    observeExport: 'recordObservation',
    observeUnmatchedExport: 'recordUnmatched',
    maxBodyBytes: MAX_BODY_BYTES,
  })

/**
 * The compiled engine only counts as an optimization if it is observationally
 * identical to the runtime engine, so every corpus request runs through both
 * and the responses must agree on status, content type, headers, and body.
 */
describe('compile-to-module', () => {
  it('emits inlined guards for the safe subset and interpreter fallbacks outside it', () => {
    const source = emit()
    // getUser params (bare integer) and listUsers query (bounds + typed array)
    // both inline; createUser body carries `additionalProperties: true`, which
    // is outside the subset, so it falls back to the interpreter.
    expect(source).toContain('!Number.isInteger(')
    expect(source).toMatch(/const guardQuery_listUsers = \(input\) =>/)
    expect(source).toContain('const guardBody_createUser = validateGuard(schemaBody_createUser)')
    // The widened subset — enum, bounds, code point lengths, pattern, nested
    // closed object, nullable — compiles fully inline with its helpers.
    expect(source).toMatch(/const guardBody_submitMetric = \(input\) =>/)
    expect(source).toContain('codePoints(')
    expect(source).toContain('compileRx(')
    // health 200 serializes positionally; listUsers 200 (open schema) has no serializer.
    expect(source).toContain('serialize_health_200')
    expect(source).not.toContain('serialize_listUsers_200')
    // No eval anywhere in the output.
    expect(source).not.toMatch(/\beval\(|new Function\(/)
  })

  it('answers every corpus request identically to the runtime engine', async () => {
    const fixtureDir = join(dirname(fileURLToPath(import.meta.url)), '.fixtures')
    mkdirSync(fixtureDir, { recursive: true })
    const fixturePath = join(fixtureDir, 'generated-diff.ts')
    writeFileSync(fixturePath, emit())
    try {
      // A computed specifier keeps the type checker from resolving a module
      // that only exists while this test runs.
      const compiledModule = (await import(fixturePath)) as {
        fetch: (request: Request, env?: unknown) => Response | Promise<Response>
      }
      const runtime = toFetchHandler(
        createApi({
          routes: Object.values(routes),
          info,
          ...OPENAPI_EXTRAS,
          context: corpus.createAppContext,
          errors: corpus.corpusErrors,
          onError: corpus.corpusOnError,
          observe: corpus.recordObservation,
          observeUnmatched: corpus.recordUnmatched,
        }),
        {
          mounts: { '/mounted': corpus.mountEcho },
          onRequest: [corpus.gateResolveTenant, corpus.gateTeapot],
          onResponse: [corpus.stampHeader, corpus.stampLocals],
          maxBodyBytes: MAX_BODY_BYTES,
        },
      )

      const cases: ReadonlyArray<() => Request> = [
        () => new Request('http://localhost/health'),
        () => new Request('http://localhost/users/7'),
        // Trailing slash and percent-encoded parameter normalization.
        () => new Request('http://localhost/users/7/'),
        () => new Request('http://localhost/users/%37'),
        // Declared alternate status with an empty body.
        () => new Request('http://localhost/users/404'),
        // Invalid params — the error list must match exactly.
        () => new Request('http://localhost/users/abc'),
        () => new Request('http://localhost/users?limit=5&tags=a&tags=b'),
        () => new Request('http://localhost/users?limit=0'),
        () => new Request('http://localhost/users'),
        // Encoded queries exercise the URLSearchParams fallback of the fast
        // string parser in both engines.
        () => new Request('http://localhost/users?tags=a%20b&tags=c+d&limit=7'),
        () => new Request('http://localhost/users?tags=%E2%9C%93'),
        () => post({ name: 'Ada', age: 30 }),
        () => post({ name: 'Ada' }),
        () => post({ name: '' }),
        () =>
          new Request('http://localhost/users', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: 'not json',
          }),
        () => new Request('http://localhost/things/3', { method: 'DELETE' }),
        () => new Request('http://localhost/boom'),
        () => new Request('http://localhost/header-echo', { headers: { 'x-test': 'hi' } }),
        () => new Request('http://localhost/header-echo'),
        () => new Request('http://localhost/openapi.json'),
        () => new Request('http://localhost/missing'),
        () => new Request('http://localhost/users/7', { method: 'PATCH' }),
        // App context: env binding + header through the async factory.
        () => new Request('http://localhost/whoami', { headers: { 'x-ctx': 'from-header' } }),
        () => new Request('http://localhost/whoami'),
        // Prefix mount: exact prefix, nested path, and a non-match sibling.
        () => new Request('http://localhost/mounted'),
        () => new Request('http://localhost/mounted/deep/path?q=1', { method: 'POST' }),
        () => new Request('http://localhost/mountedsibling'),
        // The widened inline-guard subset: both engines must agree on every
        // verdict, valid and invalid alike.
        () => metric({ kind: 'latency', value: 12.5, unit: 'ms', labels: ['api', 'edge'], note: null }),
        () => metric({ kind: 'latency', value: 0, meta: { host: 'a1' } }),
        () => metric({ kind: 'throughput', value: 1 }), // enum violation
        () => metric({ kind: 'error', value: -1 }), // minimum violation
        () => metric({ kind: 'error', value: 10000 }), // exclusiveMaximum boundary
        () => metric({ kind: 'error', value: 1, unit: '' }), // minLength violation
        () => metric({ kind: 'error', value: 1, unit: 'microsecs' }), // maxLength violation
        () => metric({ kind: 'error', value: 1, unit: '🚀' }), // astral char: one code point, two UTF-16 units
        () => metric({ kind: 'error', value: 1, labels: ['UPPER'] }), // pattern violation
        () => metric({ kind: 'error', value: 1, labels: ['a', 'b', 'c', 'd'] }), // maxItems violation
        () => metric({ kind: 'error', value: 1, meta: { host: 'x', extra: true } }), // closed nested object
        () => metric({ kind: 'error', value: 1, meta: {} }), // missing nested required
        () => metric({ kind: 'error', value: 1, rogue: true }), // closed root object
        () => metric({ kind: 'error', value: 1, note: 7 }), // nullable does not admit non-null junk
        // Headers slot: valid, coerced integer, missing required, too short.
        () => new Request('http://localhost/tenant', { headers: { 'x-api-key': 'secret', 'x-retry-count': '2' } }),
        () => new Request('http://localhost/tenant', { headers: { 'x-api-key': 'secret' } }),
        () => new Request('http://localhost/tenant'),
        () => new Request('http://localhost/tenant', { headers: { 'x-api-key': 'abc' } }),
        // Raw statuses: a streamed body and a CSV string, byte for byte.
        () => new Request('http://localhost/chat', { method: 'POST' }),
        () => new Request('http://localhost/export'),
        // Raw body access: whitespace must survive exactly (HMAC shape).
        () => new Request('http://localhost/raw-echo', { method: 'POST', body: '{ "spacing":   "matters" }' }),
        // Body size cap: the declared body path and the handler-read path.
        () => post({ name: 'x'.repeat(MAX_BODY_BYTES) }),
        () => new Request('http://localhost/raw-echo', { method: 'POST', body: 'y'.repeat(MAX_BODY_BYTES + 1) }),
        // The onRequest gate short-circuits before mounts and routing.
        () => new Request('http://localhost/health', { headers: { 'x-block': '1' } }),
        () => new Request('http://localhost/mounted/deep', { headers: { 'x-block': '1' } }),
        // Cookies: valid with tracking noise, coercion failure, missing required,
        // quoted + percent-encoded values.
        () => new Request('http://localhost/dashboard', { headers: { cookie: '_ga=x; session=abc123; visits=2' } }),
        () => new Request('http://localhost/dashboard', { headers: { cookie: 'session=abc123; visits=lots' } }),
        () => new Request('http://localhost/dashboard', { headers: { cookie: 'visits=2' } }),
        () => new Request('http://localhost/dashboard'),
        () => new Request('http://localhost/dashboard', { headers: { cookie: 'session="abc%20123"' } }),
        // 405: wrong method on static and dynamic paths (multi-method allow
        // lists come from /users, which serves GET, POST, and an explicit
        // OPTIONS; HEAD rides along with GET and OPTIONS joins every list).
        () => new Request('http://localhost/users', { method: 'PUT' }),
        () => new Request('http://localhost/users/7', { method: 'PUT' }),
        () => new Request('http://localhost/health', { method: 'DELETE' }),
        () => new Request('http://localhost/chat'),
        // OPTIONS: the explicit route wins on /users; paths served only
        // under other methods answer an automatic 204 with the allow list
        // (static and dynamic); an unknown path stays a 404.
        () => new Request('http://localhost/users', { method: 'OPTIONS' }),
        () => new Request('http://localhost/health', { method: 'OPTIONS' }),
        () => new Request('http://localhost/users/7', { method: 'OPTIONS' }),
        () => new Request('http://localhost/nowhere-at-all', { method: 'OPTIONS' }),
        // Async refine: accepted, resolved issues (through the custom
        // validationFailed formatter), and a rejected refine down onError.
        () => slotAsync({ start: 1, end: 5 }),
        () => slotAsync({ start: 5, end: 2 }),
        () => slotAsync({ start: 13, end: 20 }),
        // Conditional document requests: the wildcard matches whatever etag
        // both engines derived; a stale validator still gets the full 200.
        () => new Request('http://localhost/openapi.json', { headers: { 'if-none-match': '*' } }),
        () => new Request('http://localhost/openapi.json', { headers: { 'if-none-match': '"deadbeef"' } }),
        // HEAD falls back to GET routes with the body stripped: static,
        // dynamic, query-validated, raw contentType, and the failure shapes
        // (validation error, 404, POST-only 405) plus the OpenAPI document.
        () => new Request('http://localhost/health', { method: 'HEAD' }),
        () => new Request('http://localhost/users/7', { method: 'HEAD' }),
        () => new Request('http://localhost/users/abc', { method: 'HEAD' }),
        () => new Request('http://localhost/users?limit=5', { method: 'HEAD' }),
        () => new Request('http://localhost/export', { method: 'HEAD' }),
        () => new Request('http://localhost/openapi.json', { method: 'HEAD' }),
        () => new Request('http://localhost/missing', { method: 'HEAD' }),
        () => new Request('http://localhost/chat', { method: 'HEAD' }),
        () => new Request('http://localhost/health', { method: 'HEAD', headers: { 'x-block': '1' } }),
        // The shared buffered body read: pipeline validation plus two raw
        // handler reads of the same stream.
        () =>
          new Request('http://localhost/double-read', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: '{"name":  "Ada"}',
          }),
        // Query keys named like object plumbing stay ordinary data.
        () => new Request('http://localhost/users?limit=5&__proto__=evil'),
        // Greedy tail: single and nested segments, per-segment decoding,
        // the min-length validation failure, the bare prefix (404), and the
        // HEAD fallback over a greedy route.
        () => new Request('http://localhost/files/report.pdf'),
        () => new Request('http://localhost/files/docs/2026/report.pdf'),
        () => new Request('http://localhost/files/dir%20one/nested%2Ename'),
        () => new Request('http://localhost/files/ab'),
        () => new Request('http://localhost/files'),
        () => new Request('http://localhost/files/docs/x.txt', { method: 'HEAD' }),
        () => new Request('http://localhost/files/docs/x.txt', { method: 'POST' }),
        // Form bodies: valid with coercion + arrays, a coercion-driven
        // validation failure (error lists must match exactly), and the 415
        // for a JSON payload on a form route.
        () => form('name=Ada&age=30&tags=a&tags=b'),
        () => form('name=Ada&age=seventeen'),
        () => form('{"name":"Ada"}', 'application/json'),
        // 415 for a mislabeled body on a JSON route.
        () =>
          new Request('http://localhost/users', {
            method: 'POST',
            headers: { 'content-type': 'text/plain' },
            body: '{"name":"Ada"}',
          }),
        // Multipart: coerced fields + a File part the handler reads, a
        // missing required part, and garbage bytes under a multipart header.
        () => multipart({ title: 'report', attachment: new File([new Uint8Array(5)], 'r.bin') }),
        () => multipart({ title: 'no-file' }),
        () =>
          new Request('http://localhost/upload', {
            method: 'POST',
            headers: { 'content-type': 'multipart/form-data; boundary=nope' },
            body: 'not multipart',
          }),
        // OpenAPI annotations (deprecated, security, shared titled schema,
        // response headers) flow through the /openapi.json case above; these
        // exercise the routes themselves.
        () => new Request('http://localhost/build-info'),
        () => new Request('http://localhost/release-info'),
        // The platform-request escape hatch: both engines run on fetch, so
        // both must expose the same Request through `request.raw`.
        () => new Request('http://localhost/platform?x=1'),
        // Repeated set-cookie headers from a string[] value (compared via
        // getSetCookie below), next to an ordinary single-valued header.
        () => new Request('http://localhost/login', { method: 'POST' }),
        // Refinement: pass, cross-field failure (through the custom
        // validationFailed formatter, custom path intact), and a throwing
        // refine that must take the onError path.
        () => slot({ start: 1, end: 5 }),
        () => slot({ start: 5, end: 2 }),
        () => slot({ start: 13, end: 20 }),
        // Refinement runs only after schema validation — this fails the slot
        // check, never reaching refine.
        () => slot({ start: 'soon', end: 2 }),
        // The locals bag: gate → handler → decorator flow, with and without
        // the tenant header the gate resolves.
        () => new Request('http://localhost/locals-echo', { headers: { 'x-tenant': 'acme-inc' } }),
        () => new Request('http://localhost/locals-echo'),
        // The context factory sees the same bag the gate wrote.
        () => new Request('http://localhost/whoami', { headers: { 'x-tenant': 'acme-inc' } }),
        // Unmatched requests with the tenant gate: the 404 formatter and the
        // unmatched observer both see the shared locals.
        () => new Request('http://localhost/nowhere', { headers: { 'x-tenant': 'acme-inc' } }),
      ]

      for (const makeRequest of cases) {
        corpus.observations.length = 0
        const fromRuntime = await runtime(makeRequest(), ENV)
        const runtimeObservations = corpus.observations.splice(0)
        const fromCompiled = await compiledModule.fetch(makeRequest(), ENV)
        const compiledObservations = corpus.observations.splice(0)
        const label = makeRequest().method + ' ' + new URL(makeRequest().url).pathname

        // The observe hook must fire for the same requests with the same
        // route pattern and outcome status in both engines (durations differ,
        // so only their well-formedness is compared).
        expect(compiledObservations, label + ' observations').toEqual(runtimeObservations)

        expect(fromCompiled.status, label).toBe(fromRuntime.status)
        expect(contentType(fromCompiled), label).toBe(contentType(fromRuntime))
        for (const header of [
          'x-deleted',
          'x-served-by',
          'x-stamped',
          'x-frame-protocol',
          'x-cache',
          'x-single',
          'x-locals',
          'x-options',
          'allow',
          'etag',
          'cache-control',
        ]) {
          expect(fromCompiled.headers.get(header), label).toBe(fromRuntime.headers.get(header))
        }
        // Repeated set-cookie values must survive as separate header lines in
        // both engines — getSetCookie is the only un-folded view.
        expect(fromCompiled.headers.getSetCookie(), label).toEqual(fromRuntime.headers.getSetCookie())
        const [runtimeText, compiledText] = [await fromRuntime.text(), await fromCompiled.text()]
        if (runtimeText === '' || compiledText === '' || contentType(fromRuntime) !== 'application/json') {
          // Raw statuses (streams, CSV) must match byte for byte.
          expect(compiledText, label).toBe(runtimeText)
        } else {
          // Key order may differ (serializers emit required keys first); JSON
          // objects are unordered, so compare parsed values.
          expect(JSON.parse(compiledText), label).toEqual(JSON.parse(runtimeText))
        }
      }

      // Conditional GET with the real validator: both engines must have baked
      // the same strong etag, and a revalidation against it must 304.
      const runtimeDoc = await runtime(new Request('http://localhost/openapi.json'), ENV)
      const etag = runtimeDoc.headers.get('etag')
      expect(etag).toMatch(/^"[0-9a-f]{8}"$/)
      const compiledDoc = await compiledModule.fetch(new Request('http://localhost/openapi.json'), ENV)
      expect(compiledDoc.headers.get('etag')).toBe(etag)
      const conditional = { headers: { 'if-none-match': etag ?? '' } }
      const runtimeRevalidated = await runtime(new Request('http://localhost/openapi.json', conditional), ENV)
      const compiledRevalidated = await compiledModule.fetch(
        new Request('http://localhost/openapi.json', conditional),
        ENV,
      )
      expect(runtimeRevalidated.status).toBe(304)
      expect(compiledRevalidated.status).toBe(304)
      expect(await runtimeRevalidated.text()).toBe('')
      expect(await compiledRevalidated.text()).toBe('')
      expect(runtimeRevalidated.headers.get('etag')).toBe(etag)
      expect(compiledRevalidated.headers.get('etag')).toBe(etag)
    } finally {
      rmSync(fixtureDir, { recursive: true, force: true })
    }
  })

  it('applies the default 1 MiB body cap, and Infinity restores unbounded reads, identically to the runtime', async () => {
    const fixtureDir = join(dirname(fileURLToPath(import.meta.url)), '.fixtures-body-cap')
    mkdirSync(fixtureDir, { recursive: true })
    try {
      const capRoutes = { createUser: corpus.createUser, rawEcho: corpus.rawEcho }
      const emitWith = (maxBodyBytes: number | undefined): string =>
        compileToModule({
          routesImport: '../compile-to-module.test-utils',
          runtimeImport: '../../index',
          validatorsImport: '@amritk/runtime-validators',
          routes: capRoutes,
          info,
          ...(maxBodyBytes === undefined ? {} : { maxBodyBytes }),
        })
      const load = async (name: string, source: string): Promise<(request: Request) => Promise<Response>> => {
        const fixturePath = join(fixtureDir, name)
        writeFileSync(fixturePath, source)
        const module = (await import(fixturePath)) as {
          default: { fetch: (request: Request) => Response | Promise<Response> }
        }
        return async (request) => module.default.fetch(request)
      }

      const compiledDefault = await load('generated-default-cap.ts', emitWith(undefined))
      const compiledUnbounded = await load('generated-unbounded.ts', emitWith(Number.POSITIVE_INFINITY))
      const runtimeDefault = toFetchHandler(createApi({ routes: Object.values(capRoutes), info }))
      const runtimeUnbounded = toFetchHandler(createApi({ routes: Object.values(capRoutes), info }), {
        maxBodyBytes: Number.POSITIVE_INFINITY,
      })

      // Just over 1 MiB: rejected by default in both engines — via the
      // declared-body path and via a handler-initiated raw read alike.
      const oversized = (): Request =>
        new Request('http://localhost/users', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name: 'x'.repeat(1_048_577) }),
        })
      const oversizedRaw = (): Request =>
        new Request('http://localhost/raw-echo', { method: 'POST', body: 'y'.repeat(1_048_577) })
      for (const makeRequest of [oversized, oversizedRaw]) {
        const fromRuntime = await runtimeDefault(makeRequest())
        const fromCompiled = await compiledDefault(makeRequest())
        expect(fromRuntime.status).toBe(413)
        expect(fromCompiled.status).toBe(413)
        expect(await fromCompiled.text()).toBe(await fromRuntime.text())
      }

      // The same oversized bodies pass once Infinity disables the cap.
      for (const makeRequest of [oversized, oversizedRaw]) {
        const fromRuntime = await runtimeUnbounded(makeRequest())
        const fromCompiled = await compiledUnbounded(makeRequest())
        expect(fromRuntime.status).toBe(fromCompiled.status)
        expect(fromRuntime.status).toBeLessThan(400)
      }

      // Small bodies stay unaffected by the default cap.
      const small = new Request('http://localhost/users', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Ada' }),
      })
      expect((await compiledDefault(small)).status).toBe(201)
    } finally {
      rmSync(fixtureDir, { recursive: true, force: true })
    }
  }, 20_000)

  it('bakes the default cap, the Infinity opt-out, tags, and the document etag into the emitted source', () => {
    const source = emit()
    // The differential emit pins maxBodyBytes to 256; a bare emit carries the
    // shared 1 MiB default instead.
    expect(source).toContain("readBytesCapped(request.body, request.headers.get('content-length'), 256)")
    const bare = compileToModule({ routesImport: './x', routes: { health: corpus.health } })
    expect(bare).toContain("readBytesCapped(request.body, request.headers.get('content-length'), 1048576)")
    // Infinity removes the capped reader entirely — the plain arrayBuffer
    // read has no limit to enforce.
    const unbounded = compileToModule({
      routesImport: './x',
      routes: { health: corpus.health },
      maxBodyBytes: Number.POSITIVE_INFINITY,
    })
    expect(unbounded).not.toContain('readBytesCapped')
    expect(unbounded).toContain('request.arrayBuffer()')
    // Document-level tags flow into the embedded document, and the etag is a
    // quoted 8-hex-digit strong validator baked next to it.
    expect(source).toContain('User management')
    expect(source).toMatch(/const OPENAPI_ETAG = "\\"[0-9a-f]{8}\\""/)
  })

  it('rejects duplicate routes and invalid export names at emit time', () => {
    expect(() => compileToModule({ routesImport: './x', routes: { a: corpus.health, b: corpus.health } })).toThrow(
      /Duplicate route/,
    )
    expect(() => compileToModule({ routesImport: './x', routes: { 'not-an-identifier': corpus.health } })).toThrow(
      /valid identifier/,
    )
  })

  it('omits the OpenAPI constant when serving is disabled', () => {
    const source = compileToModule({ routesImport: './x', routes: { health: corpus.health }, openApiPath: false })
    expect(source).not.toContain('OPENAPI_JSON')
  })

  it('bakes the contracts hash and warns at init only when the routes module drifted', async () => {
    const fixtureDir = join(dirname(fileURLToPath(import.meta.url)), '.fixtures-stale')
    mkdirSync(fixtureDir, { recursive: true })
    try {
      // The same route at two schema revisions: the emitter always bakes
      // minLength 1, while the on-disk routes module carries either revision —
      // simulating an app that edited a schema without regenerating.
      const pingContract = (minLength: number): AnyRouteContract => ({
        method: 'post',
        path: '/ping',
        request: {
          body: { type: 'object', properties: { name: { type: 'string', minLength } }, required: ['name'] },
        },
        responses: { 200: { body: { type: 'object' } } },
        handler: () => ({ status: 200, body: { ok: true } }),
      })
      const routesSource = (minLength: number): string =>
        `export const ping = { method: 'post', path: '/ping', request: { body: { type: 'object', properties: { name: { type: 'string', minLength: ${minLength} } }, required: ['name'] } }, responses: { 200: { body: { type: 'object' } } }, handler: () => ({ status: 200, body: { ok: true } }) }\n`
      const emitAgainst = (routesImport: string): string =>
        compileToModule({
          routesImport,
          runtimeImport: '../../index',
          validatorsImport: '@amritk/runtime-validators',
          routes: { ping: pingContract(1) },
          info,
        })

      const source = emitAgainst('./routes-fresh')
      expect(source).toContain(`export const contractsHash = '${hashContracts([pingContract(1)])}'`)

      writeFileSync(join(fixtureDir, 'routes-fresh.ts'), routesSource(1))
      writeFileSync(join(fixtureDir, 'routes-stale.ts'), routesSource(5))
      writeFileSync(join(fixtureDir, 'generated-fresh.ts'), source)
      writeFileSync(join(fixtureDir, 'generated-stale.ts'), emitAgainst('./routes-stale'))

      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
      try {
        // Contracts match the baked hash: init must stay silent.
        await import(join(fixtureDir, 'generated-fresh.ts'))
        expect(errorSpy).not.toHaveBeenCalled()
        // The routes module drifted after compile: init warns (never throws —
        // a stale module must keep serving).
        const staleModule = (await import(join(fixtureDir, 'generated-stale.ts'))) as {
          fetch: (request: Request) => Response | Promise<Response>
        }
        expect(errorSpy).toHaveBeenCalledTimes(1)
        expect(String(errorSpy.mock.calls[0]?.[0])).toMatch(/[Ss]tale.*compileToModule/s)
        // The stale module still answers requests.
        const response = await staleModule.fetch(
          new Request('http://localhost/ping', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: '{"name":"Ada"}',
          }),
        )
        expect(response.status).toBe(200)
      } finally {
        errorSpy.mockRestore()
      }
    } finally {
      rmSync(fixtureDir, { recursive: true, force: true })
    }
  }, 20_000)

  it('routes every guard through the exported compiler, matching the runtime compile option', async () => {
    const fixtureDir = join(dirname(fileURLToPath(import.meta.url)), '.fixtures-custom-compile')
    mkdirSync(fixtureDir, { recursive: true })
    try {
      const compileRoutes = { getUser: corpus.getUser, listUsers: corpus.listUsers, createUser: corpus.createUser }
      const source = compileToModule({
        routesImport: '../compile-to-module.test-utils',
        runtimeImport: '../../index',
        validatorsImport: '@amritk/runtime-validators',
        routes: compileRoutes,
        info,
        compileExport: 'corpusCompile',
      })
      // No inlined guard bodies and no interpreter imports: every guard and
      // collector must come from the exported compiler at module init.
      expect(source).not.toMatch(/const guard\w+ = \(input\) =>/)
      expect(source).not.toContain('validateGuard(')
      expect(source).not.toContain('@amritk/runtime-validators')
      expect(source).toContain('corpusCompile(schemaParams_getUser)')
      expect(source).toContain('corpusCompile(schemaQuery_listUsers)')
      expect(source).toContain('corpusCompile(schemaBody_createUser)')

      const fixturePath = join(fixtureDir, 'generated-custom-compile.ts')
      writeFileSync(fixturePath, source)
      const compiledModule = (await import(fixturePath)) as {
        fetch: (request: Request) => Response | Promise<Response>
      }
      const runtime = toFetchHandler(
        createApi({ routes: Object.values(compileRoutes), info, compile: corpus.corpusCompile }),
      )
      const cases: ReadonlyArray<() => Request> = [
        () => new Request('http://localhost/users/7'),
        () => new Request('http://localhost/users?limit=5'),
        // The probe key passes the schemas but the custom compiler rejects
        // it — both engines must agree, which proves the compiled engine
        // really consulted the compiler for the query and body guards.
        () => new Request('http://localhost/users?compilerProbe=1'),
        () => post({ name: 'Ada' }),
        () => post({ name: 'Ada', compilerProbe: true }),
        () => post({ name: '' }),
      ]
      for (const makeRequest of cases) {
        const fromRuntime = await runtime(makeRequest())
        const fromCompiled = await compiledModule.fetch(makeRequest())
        const label = makeRequest().method + ' ' + makeRequest().url
        expect(fromCompiled.status, label).toBe(fromRuntime.status)
        const [runtimeText, compiledText] = [await fromRuntime.text(), await fromCompiled.text()]
        if (runtimeText === '' || compiledText === '') {
          expect(compiledText, label).toBe(runtimeText)
        } else {
          expect(JSON.parse(compiledText), label).toEqual(JSON.parse(runtimeText))
        }
      }
    } finally {
      rmSync(fixtureDir, { recursive: true, force: true })
    }
  }, 20_000)

  it('validates replies against the response contracts identically to the runtime engine', async () => {
    const fixtureDir = join(dirname(fileURLToPath(import.meta.url)), '.fixtures-validate-responses')
    mkdirSync(fixtureDir, { recursive: true })
    try {
      const replyRoutes = {
        health: corpus.health,
        getUser: corpus.getUser,
        badReply: corpus.badReply,
        undeclaredStatus: corpus.undeclaredStatus,
        strictHeaders: corpus.strictHeaders,
        csvExport: corpus.csvExport,
      }
      const source = compileToModule({
        routesImport: '../compile-to-module.test-utils',
        runtimeImport: '../../index',
        validatorsImport: '@amritk/runtime-validators',
        routes: replyRoutes,
        info,
        validateResponses: true,
      })
      // Schema-derived fast serializers are skipped: with validation on,
      // bodies serialize via JSON.stringify exactly like the runtime engine.
      expect(source).not.toContain('serialize_')
      expect(source).toContain('invalidResponse(')

      const fixturePath = join(fixtureDir, 'generated-validate-responses.ts')
      writeFileSync(fixturePath, source)
      const compiledModule = (await import(fixturePath)) as {
        fetch: (request: Request) => Response | Promise<Response>
      }
      const runtime = toFetchHandler(createApi({ routes: Object.values(replyRoutes), info, validateResponses: true }))

      const cases: ReadonlyArray<() => Request> = [
        // Contract-abiding replies pass untouched, body and headers alike.
        () => new Request('http://localhost/health'),
        () => new Request('http://localhost/users/7'),
        () => new Request('http://localhost/strict-headers'),
        // A declared status with no schemas passes with no validators.
        () => new Request('http://localhost/users/404'),
        // A contract-violating body → the runtime's invalid_response 500.
        () => new Request('http://localhost/bad-reply'),
        // An undeclared status → 500 with an empty error list.
        () => new Request('http://localhost/undeclared'),
        // A declared reply header violating its schema → 500, source 'headers'.
        () => new Request('http://localhost/strict-headers?bad=true'),
        // Raw contentType statuses skip body validation in both engines.
        () => new Request('http://localhost/export'),
      ]
      for (const makeRequest of cases) {
        const fromRuntime = await runtime(makeRequest())
        const fromCompiled = await compiledModule.fetch(makeRequest())
        const label = new URL(makeRequest().url).pathname + new URL(makeRequest().url).search
        expect(fromCompiled.status, label).toBe(fromRuntime.status)
        const [runtimeText, compiledText] = [await fromRuntime.text(), await fromCompiled.text()]
        const isJson = (fromRuntime.headers.get('content-type') ?? '').startsWith('application/json')
        if (!isJson || runtimeText === '' || compiledText === '') {
          expect(compiledText, label).toBe(runtimeText)
        } else {
          expect(JSON.parse(compiledText), label).toEqual(JSON.parse(runtimeText))
        }
      }

      // The 500's shape is the pipeline's own, not a generic error.
      const invalid = (await (await compiledModule.fetch(new Request('http://localhost/bad-reply'))).json()) as {
        error: string
        status: number
        errors: unknown[]
      }
      expect(invalid.error).toBe('invalid_response')
      expect(invalid.status).toBe(200)
      expect(invalid.errors.length).toBeGreaterThan(0)

      // With both options set, the reply validators come from the exported
      // compiler too — no interpreter import remains.
      const withCompiler = compileToModule({
        routesImport: '../compile-to-module.test-utils',
        runtimeImport: '../../index',
        validatorsImport: '@amritk/runtime-validators',
        routes: replyRoutes,
        info,
        validateResponses: true,
        compileExport: 'corpusCompile',
      })
      expect(withCompiler).toContain('corpusCompile(replyBody_badReply_200Schema)')
      expect(withCompiler).toContain('corpusCompile(replyHeaders_strictHeaders_200Schema)')
      expect(withCompiler).not.toContain('validateGuard(')
    } finally {
      rmSync(fixtureDir, { recursive: true, force: true })
    }
  }, 20_000)
})

const post = (body: unknown): Request =>
  new Request('http://localhost/users', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })

const metric = (body: unknown): Request =>
  new Request('http://localhost/metrics', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })

const slot = (body: unknown): Request =>
  new Request('http://localhost/slots', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })

const slotAsync = (body: unknown): Request =>
  new Request('http://localhost/slots-async', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })

const form = (body: string, mediaType = 'application/x-www-form-urlencoded'): Request =>
  new Request('http://localhost/form', { method: 'POST', headers: { 'content-type': mediaType }, body })

const multipart = (parts: Readonly<Record<string, string | File>>): Request => {
  const data = new FormData()
  for (const [key, value] of Object.entries(parts)) data.append(key, value)
  // The Request constructor stamps the boundary-carrying multipart header.
  return new Request('http://localhost/upload', { method: 'POST', body: data })
}

const contentType = (response: Response): string => (response.headers.get('content-type') ?? '').split(';')[0] ?? ''
