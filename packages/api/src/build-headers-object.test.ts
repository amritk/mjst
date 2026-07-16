import { validate, validateGuard } from '@amritk/runtime-validators'
import { describe, expect, it } from 'vitest'

import { buildHeadersObject } from './build-headers-object'
import { compileRoute } from './compile-route'
import { defineRoute } from './define-route'
import type { AnyRouteContract, CompiledHeaders } from './types'

const compiledHeaders = (schema: unknown): CompiledHeaders => {
  const route = compileRoute(
    defineRoute({
      method: 'get',
      path: '/x',
      request: { headers: schema },
      responses: { 200: {} },
      handler: () => ({ status: 200 }),
    }) as AnyRouteContract,
    (input) => ({ guard: validateGuard(input), collect: validate(input) }),
    false,
  )
  return route.headers as CompiledHeaders
}

const lookup =
  (headers: Readonly<Record<string, string>>) =>
  (name: string): string | undefined =>
    headers[name]

describe('build-headers-object', () => {
  it('reads declared headers case-insensitively but keys by the schema name', () => {
    const compiled = compiledHeaders({
      type: 'object',
      properties: { 'X-Api-Key': { type: 'string' } },
      required: ['X-Api-Key'],
    })
    // The transport hands out lowercase names; the schema authored mixed case.
    const result = buildHeadersObject(lookup({ 'x-api-key': 'secret' }), compiled)
    expect(result).toEqual({ 'X-Api-Key': 'secret' })
  })

  it('omits absent headers so required can reject them', () => {
    const compiled = compiledHeaders({
      type: 'object',
      properties: { 'x-tenant-id': { type: 'string' } },
      required: ['x-tenant-id'],
    })
    const result = buildHeadersObject(lookup({}), compiled)
    expect(result).toEqual({})
    expect(compiled.guard(result)).toBe(false)
  })

  it('coerces declared number and boolean headers', () => {
    const compiled = compiledHeaders({
      type: 'object',
      properties: { 'x-retry-count': { type: 'integer' }, 'x-dry-run': { type: 'boolean' } },
    })
    const result = buildHeadersObject(lookup({ 'x-retry-count': '3', 'x-dry-run': 'true' }), compiled)
    expect(result).toEqual({ 'x-retry-count': 3, 'x-dry-run': true })
  })

  it('leaves unparseable values as strings for honest validator errors', () => {
    const compiled = compiledHeaders({
      type: 'object',
      properties: { 'x-retry-count': { type: 'integer' } },
    })
    const result = buildHeadersObject(lookup({ 'x-retry-count': 'lots' }), compiled)
    expect(result).toEqual({ 'x-retry-count': 'lots' })
    expect(compiled.guard(result)).toBe(false)
  })

  it('never reads undeclared headers', () => {
    const compiled = compiledHeaders({ type: 'object', properties: { 'x-known': { type: 'string' } } })
    const seen: string[] = []
    const result = buildHeadersObject((name) => {
      seen.push(name)
      return undefined
    }, compiled)
    expect(result).toEqual({})
    expect(seen).toEqual(['x-known'])
  })
})
