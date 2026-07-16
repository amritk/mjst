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
}
const info = { title: 'Differential', version: '1.0.0' }

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
    contextExport: 'createAppContext',
    mounts: { '/mounted': 'mountEcho' },
    onRequestExports: ['gateTeapot'],
    onResponseExports: ['stampHeader'],
    errorsExport: 'corpusErrors',
    onErrorExport: 'corpusOnError',
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
          context: corpus.createAppContext,
          errors: corpus.corpusErrors,
          onError: corpus.corpusOnError,
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
      ]

      for (const makeRequest of cases) {
        const fromRuntime = await runtime(makeRequest(), ENV)
        const fromCompiled = await compiledModule.fetch(makeRequest(), ENV)
        const label = makeRequest().method + ' ' + new URL(makeRequest().url).pathname

        expect(fromCompiled.status, label).toBe(fromRuntime.status)
        expect(contentType(fromCompiled), label).toBe(contentType(fromRuntime))
        for (const header of ['x-deleted', 'x-served-by', 'x-stamped', 'x-frame-protocol']) {
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

const contentType = (response: Response): string => (response.headers.get('content-type') ?? '').split(';')[0] ?? ''
