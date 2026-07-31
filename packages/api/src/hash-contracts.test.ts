import { describe, expect, it } from 'vitest'

import { hashContracts } from './hash-contracts'
import type { AnyContract, AnyRouteContract } from './types'

const base: AnyContract = {
  method: 'post',
  path: '/users',
  summary: 'Create a user',
  tags: ['users'],
  security: [{ apiKey: [] }],
  request: {
    body: {
      type: 'object',
      properties: { name: { type: 'string', minLength: 1 }, age: { type: 'integer' } },
      required: ['name'],
    },
  },
  responses: {
    201: { body: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] } },
    409: { description: 'Already exists' },
  },
}

describe('hash-contracts', () => {
  it('produces an 8-hex-digit hash', () => {
    expect(hashContracts([base])).toMatch(/^[0-9a-f]{8}$/)
  })

  it('is stable under object key order at every level', () => {
    // The same contract with every object's keys declared in a different
    // order — schemas included — must fingerprint identically, because key
    // order changes nothing about what the compiled module baked.
    const reordered: AnyContract = {
      responses: {
        409: { description: 'Already exists' },
        201: { body: { required: ['name'], properties: { name: { type: 'string' } }, type: 'object' } },
      },
      request: {
        body: {
          required: ['name'],
          properties: { age: { type: 'integer' }, name: { minLength: 1, type: 'string' } },
          type: 'object',
        },
      },
      security: [{ apiKey: [] }],
      tags: ['users'],
      summary: 'Create a user',
      path: '/users',
      method: 'post',
    }
    expect(hashContracts([reordered])).toBe(hashContracts([base]))
  })

  it('ignores handler, guard, and refine body changes', () => {
    // The compiled module imports these live, so rewriting one must never
    // flag a build as stale — only adding or removing one does (below).
    const withHandler: AnyRouteContract = { ...base, handler: () => ({ status: 201, body: { name: 'a' } }) }
    const withOtherHandler: AnyRouteContract = { ...base, handler: () => ({ status: 201, body: { name: 'b' } }) }
    expect(hashContracts([withHandler])).toBe(hashContracts([base]))
    expect(hashContracts([withOtherHandler])).toBe(hashContracts([base]))

    const guarded: AnyRouteContract = { ...withHandler, guards: [() => undefined] }
    const guardedDifferently: AnyRouteContract = {
      ...withHandler,
      guards: [() => ({ status: 401, body: { error: 'nope' } })],
    }
    expect(hashContracts([guardedDifferently])).toBe(hashContracts([guarded]))

    const refined: AnyRouteContract = { ...withHandler, refine: () => undefined }
    const refinedDifferently: AnyRouteContract = { ...withHandler, refine: () => [{ path: '/x', message: 'no' }] }
    expect(hashContracts([refinedDifferently])).toBe(hashContracts([refined]))
  })

  it('changes when a guard, security guard, or refine is added or removed', () => {
    // The emitter decides at build time whether a route has any of these and
    // emits (or omits) the code that runs them, so their *presence* is part of
    // what a compiled module baked. Missing it meant a guard added after a
    // compile was silently not enforced, with no hash change to warn about it.
    const withHandler: AnyRouteContract = { ...base, handler: () => ({ status: 201, body: { name: 'a' } }) }
    const original = hashContracts([withHandler])
    const variants: AnyRouteContract[] = [
      { ...withHandler, guards: [() => undefined] },
      { ...withHandler, securityGuards: [() => undefined] },
      { ...withHandler, refine: () => undefined },
    ]
    for (const variant of variants) {
      expect(hashContracts([variant])).not.toBe(original)
    }
    // A second guard on the same route is a change too — a removal reads as
    // one from the other side of the comparison.
    expect(hashContracts([{ ...withHandler, guards: [() => undefined, () => undefined] }])).not.toBe(
      hashContracts([{ ...withHandler, guards: [() => undefined] }]),
    )
  })

  it('changes when routing or schemas change', () => {
    const original = hashContracts([base])
    const variants: AnyContract[] = [
      { ...base, method: 'put' },
      { ...base, path: '/members' },
      {
        ...base,
        request: {
          body: {
            type: 'object',
            properties: { name: { type: 'string', minLength: 2 }, age: { type: 'integer' } },
            required: ['name'],
          },
        },
      },
      { ...base, request: { ...base.request, bodyType: 'form' } },
      { ...base, responses: { ...base.responses, 201: { body: { type: 'object' } } } },
    ]
    for (const variant of variants) {
      expect(hashContracts([variant])).not.toBe(original)
    }
  })

  it('changes when OpenAPI-visible annotations change', () => {
    const original = hashContracts([base])
    const variants: AnyContract[] = [
      { ...base, summary: 'Register a user' },
      { ...base, description: 'Longer text' },
      { ...base, tags: ['accounts'] },
      { ...base, operationId: 'createUser' },
      { ...base, deprecated: true },
      { ...base, security: [] },
      { ...base, responses: { ...base.responses, 200: { contentType: 'text/plain' } } },
      { ...base, responses: { ...base.responses, 201: { ...base.responses[201], headers: { 'x-id': {} } } } },
    ]
    for (const variant of variants) {
      expect(hashContracts([variant])).not.toBe(original)
    }
  })

  it('covers every route in the list', () => {
    const other: AnyContract = { method: 'get', path: '/health', responses: { 200: {} } }
    expect(hashContracts([base, other])).not.toBe(hashContracts([base]))
    expect(hashContracts([])).toMatch(/^[0-9a-f]{8}$/)
  })
})
