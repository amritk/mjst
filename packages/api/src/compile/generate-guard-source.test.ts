import { describe, expect, it } from 'vitest'

import { generateGuardSource } from './generate-guard-source'

describe('generate-guard-source', () => {
  it('inlines a flat object of bare primitives', () => {
    const source = generateGuardSource({
      type: 'object',
      properties: { id: { type: 'integer' }, name: { type: 'string' }, active: { type: 'boolean' } },
      required: ['id', 'name'],
    })
    expect(source).toContain("typeof input !== 'object' || input === null || Array.isArray(input)")
    expect(source).toContain("typeof v0 !== 'number' || !Number.isInteger(v0)")
    expect(source).toContain("typeof v1 !== 'string'")
    // Optional property: only checked when present.
    expect(source).toContain("if (v2 !== undefined && (typeof v2 !== 'boolean')) return false")
  })

  it('bails on any keyword outside the subset', () => {
    // Constraint keywords change semantics the inline form cannot reproduce.
    expect(generateGuardSource({ type: 'object', properties: { n: { type: 'string', minLength: 1 } } })).toBeUndefined()
    expect(generateGuardSource({ type: 'object', properties: { n: { type: 'array' } } })).toBeUndefined()
    expect(generateGuardSource({ type: 'object', properties: {}, additionalProperties: false })).toBeUndefined()
    expect(generateGuardSource({ type: 'string' })).toBeUndefined()
    expect(generateGuardSource(true)).toBeUndefined()
    // Required key without a property schema has presence-only semantics.
    expect(generateGuardSource({ type: 'object', properties: {}, required: ['ghost'] })).toBeUndefined()
  })
})
