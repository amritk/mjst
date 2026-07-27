import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'

import { compileToModule } from './compile/compile-to-module'
import { createApi } from './create-api'
import { findUser } from './formats.test-utils'
import { toFetchHandler } from './to-fetch-handler'
import type { ApiRequest, ValidationFailureBody } from './types'

/**
 * `format` is an annotation in JSON Schema and an opt-in assertion in Ajv, and
 * `@amritk/runtime-validators` follows both. The api had no way to opt in at
 * all, so a contract declaring `format: 'uuid'` accepted any string while the
 * README implied otherwise. These cover the `formats` option that closes that —
 * on both engines, since the same contracts run under `createApi` in
 * development and the compiled module in production.
 */

const request = (path: string, search = ''): ApiRequest => ({
  method: 'GET',
  path,
  searchParams: () => new URLSearchParams(search),
  header: () => undefined,
  readBody: () => Promise.reject(new SyntaxError('Unexpected end of input')),
  readText: () => Promise.resolve(''),
  readBytes: () => Promise.resolve(new Uint8Array()),
})

const UUID = '3f2504e0-4f89-11d3-9a0c-0305e82c3301'

const fixtureDir = join(dirname(fileURLToPath(import.meta.url)), 'compile', '.fixtures')

describe('formats', () => {
  afterAll(() => {
    rmSync(join(fixtureDir, 'generated-formats.ts'), { force: true })
  })

  it('treats format as an annotation by default', async () => {
    const api = createApi({ routes: [findUser] })

    const response = await api.handle(request('/users/not-a-uuid'))

    expect(response.status).toBe(200)
    expect(response.body).toEqual({ id: 'not-a-uuid' })
  })

  it("asserts every format under formats: 'all'", async () => {
    const api = createApi({ routes: [findUser], formats: 'all' })

    const rejected = await api.handle(request('/users/not-a-uuid'))
    const accepted = await api.handle(request(`/users/${UUID}`))

    expect(rejected.status).toBe(400)
    expect((rejected.body as ValidationFailureBody).errors[0]?.path).toBe('/id')
    expect(accepted.status).toBe(200)
  })

  it('asserts only the listed formats when given a list', async () => {
    const api = createApi({ routes: [findUser], formats: ['email'] })

    // uuid is unlisted, so it stays an annotation...
    const params = await api.handle(request('/users/not-a-uuid'))
    // ...while the listed format is enforced in the same request pipeline.
    const query = await api.handle(request(`/users/${UUID}`, 'email=not-an-email'))

    expect(params.status).toBe(200)
    expect(query.status).toBe(400)
    expect((query.body as ValidationFailureBody).errors[0]?.path).toBe('/email')
  })

  it('leaves a custom compiler in charge of its own format handling', async () => {
    // `compile` replaces the engine `formats` configures, so the option must not
    // silently re-enable assertion behind a caller's own validators.
    const api = createApi({
      routes: [findUser],
      formats: 'all',
      compile: () => ({ guard: (_input: unknown): _input is unknown => true, collect: () => true }),
    })

    const response = await api.handle(request('/users/not-a-uuid'))

    expect(response.status).toBe(200)
  })

  it('drops format-bearing schemas out of the inlinable subset when enforcing', () => {
    // Without enforcement the params schema inlines to a straight-line guard and
    // the interpreter is never asked for it; with enforcement the same schema
    // falls back to validateGuard, which owns the format regexes.
    expect(emit()).not.toContain('VALIDATE_OPTIONS')

    const enforcing = emit('all')

    expect(enforcing).toContain('const VALIDATE_OPTIONS = {"formats":"all"}')
    expect(enforcing).toContain('validateGuard(schemaParams_findUser, VALIDATE_OPTIONS)')
    expect(enforcing).toContain('validate(schemaParams_findUser, VALIDATE_OPTIONS)')
    // No eval anywhere in the output, formats or not.
    expect(enforcing).not.toMatch(/\beval\(|new Function\(/)
  })

  it('answers identically to the runtime engine with formats enforced', async () => {
    mkdirSync(fixtureDir, { recursive: true })
    const fixturePath = join(fixtureDir, 'generated-formats.ts')
    writeFileSync(fixturePath, emit('all'))

    // A computed specifier keeps the type checker from resolving a module that
    // only exists while this test runs.
    const compiled = (await import(fixturePath)) as { fetch: (request: Request) => Response | Promise<Response> }
    const runtime = toFetchHandler(createApi({ routes: [findUser], formats: 'all' }))

    // Pinned so the pair cannot agree by both failing to enforce anything.
    const cases = [
      [`/users/${UUID}`, 200],
      ['/users/not-a-uuid', 400],
      [`/users/${UUID}?email=nope`, 400],
    ] as const

    for (const [path, status] of cases) {
      const [fromCompiled, fromRuntime] = await Promise.all([
        compiled.fetch(new Request(`http://localhost${path}`)),
        runtime(new Request(`http://localhost${path}`)),
      ])

      expect(fromCompiled.status).toBe(status)
      expect(fromRuntime.status).toBe(status)
      expect(await fromCompiled.text()).toBe(await fromRuntime.text())
    }
  })
})

const emit = (formats?: 'all'): string =>
  compileToModule({
    routes: { findUser },
    routesImport: '../../formats.test-utils',
    runtimeImport: '../../index',
    validatorsImport: '@amritk/runtime-validators',
    ...(formats === undefined ? {} : { formats }),
  })
