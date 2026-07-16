import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { createApi } from '../create-api'
import { toFetchHandler } from '../to-fetch-handler'
import type { AnyRouteContract } from '../types'
import { compileToModule } from './compile-to-module'
import * as corpus from './compile-to-module.test-utils'

const routes: Record<string, AnyRouteContract> = { ...corpus }
const info = { title: 'Differential', version: '1.0.0' }

const emit = (): string =>
  compileToModule({
    routesImport: '../compile-to-module.test-utils',
    runtimeImport: '../../index',
    validatorsImport: '@amritk/runtime-validators',
    routes,
    info,
  })

/**
 * The compiled engine only counts as an optimization if it is observationally
 * identical to the runtime engine, so every corpus request runs through both
 * and the responses must agree on status, content type, headers, and body.
 */
describe('compile-to-module', () => {
  it('emits inlined guards for the safe subset and interpreter fallbacks outside it', () => {
    const source = emit()
    // getUser params (bare integer) inlines; listUsers query (minimum/array) does not.
    expect(source).toContain("typeof v0 !== 'number' || !Number.isInteger(v0)")
    expect(source).toContain('const guardQuery_listUsers = validateGuard(schemaQuery_listUsers)')
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
        fetch: (request: Request) => Response | Promise<Response>
      }
      const runtime = toFetchHandler(createApi({ routes: Object.values(routes), info }))

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
      ]

      for (const makeRequest of cases) {
        const fromRuntime = await runtime(makeRequest())
        const fromCompiled = await compiledModule.fetch(makeRequest())
        const label = makeRequest().method + ' ' + new URL(makeRequest().url).pathname

        expect(fromCompiled.status, label).toBe(fromRuntime.status)
        expect(contentType(fromCompiled), label).toBe(contentType(fromRuntime))
        for (const header of ['x-deleted', 'x-served-by']) {
          expect(fromCompiled.headers.get(header), label).toBe(fromRuntime.headers.get(header))
        }
        const [runtimeText, compiledText] = [await fromRuntime.text(), await fromCompiled.text()]
        if (runtimeText === '' || compiledText === '') {
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

const contentType = (response: Response): string => (response.headers.get('content-type') ?? '').split(';')[0] ?? ''
