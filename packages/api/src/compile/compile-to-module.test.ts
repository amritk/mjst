import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { createApi } from '../create-api'
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
}
const info = { title: 'Differential', version: '1.0.0' }

/** Document-level OpenAPI extras, passed identically to both engines. */
const OPENAPI_EXTRAS = {
  servers: [{ url: 'https://api.example.com' }],
  securitySchemes: { apiKey: { type: 'apiKey', name: 'x-api-key', in: 'header' } },
  security: [{ apiKey: [] }],
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
    onRequestExports: ['gateTeapot'],
    onResponseExports: ['stampHeader'],
    errorsExport: 'corpusErrors',
    onErrorExport: 'corpusOnError',
    observeExport: 'recordObservation',
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
        }),
        {
          mounts: { '/mounted': corpus.mountEcho },
          onRequest: [corpus.gateTeapot],
          onResponse: [corpus.stampHeader],
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
        // lists come from /users, which serves GET and POST; HEAD rides along
        // with GET).
        () => new Request('http://localhost/users', { method: 'PUT' }),
        () => new Request('http://localhost/users/7', { method: 'PUT' }),
        () => new Request('http://localhost/health', { method: 'DELETE' }),
        () => new Request('http://localhost/chat'),
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
        for (const header of ['x-deleted', 'x-served-by', 'x-stamped', 'x-frame-protocol', 'x-cache', 'allow']) {
          expect(fromCompiled.headers.get(header), label).toBe(fromRuntime.headers.get(header))
        }
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
    } finally {
      rmSync(fixtureDir, { recursive: true, force: true })
    }
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

const form = (body: string, mediaType = 'application/x-www-form-urlencoded'): Request =>
  new Request('http://localhost/form', { method: 'POST', headers: { 'content-type': mediaType }, body })

const multipart = (parts: Readonly<Record<string, string | File>>): Request => {
  const data = new FormData()
  for (const [key, value] of Object.entries(parts)) data.append(key, value)
  // The Request constructor stamps the boundary-carrying multipart header.
  return new Request('http://localhost/upload', { method: 'POST', body: data })
}

const contentType = (response: Response): string => (response.headers.get('content-type') ?? '').split(';')[0] ?? ''
