import { validate, validateGuard } from '@amritk/runtime-validators'
import { describe, expect, it } from 'vitest'

import { compileRoute } from './compile-route'
import { defineRoute } from './define-route'
import type { ValidatorCompiler } from './types'

const compile: ValidatorCompiler = (schema) => ({ guard: validateGuard(schema), collect: validate(schema) })

const route = defineRoute({
  method: 'post',
  path: '/users/{id}',
  request: {
    params: { type: 'object', properties: { id: { type: 'integer' } }, required: ['id'] },
    body: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
  },
  responses: {
    200: { body: { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'] } },
    404: {},
  },
  handler: () => ({ status: 404 }),
})

describe('compile-route', () => {
  it('uppercases the method and parses the path', () => {
    const compiled = compileRoute(route, compile, false)
    expect(compiled.method).toBe('POST')
    expect(compiled.segments).toEqual(['users', { name: 'id' }])
  })

  it('compiles working validators for declared request slots', () => {
    const compiled = compileRoute(route, compile, false)
    expect(compiled.params?.guard({ id: 1 })).toBe(true)
    expect(compiled.params?.guard({ id: 'x' })).toBe(false)
    expect(compiled.body?.guard({ name: 'Ada' })).toBe(true)
    expect(compiled.query).toBeUndefined()
  })

  it('builds coercion plans from the schemas', () => {
    const compiled = compileRoute(route, compile, false)
    expect(compiled.params?.coercions.get('id')).toBe('number')
  })

  it('only compiles response validators when response validation is on', () => {
    expect(compileRoute(route, compile, false).responses).toBeUndefined()
    const compiled = compileRoute(route, compile, true)
    // Only the 200 carries a body schema; the bare 404 has nothing to validate.
    expect(compiled.responses?.size).toBe(1)
    expect(compiled.responses?.get(200)?.body?.guard({ ok: true })).toBe(true)
    expect(compiled.responses?.get(200)?.body?.guard({ ok: 'yes' })).toBe(false)
  })
})
