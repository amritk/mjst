import { describe, expect, it } from 'vitest'

import { generateObjectStrictAssertion, generateScalarStrictAssertion } from './generate-strict-assertion'

describe('generate-strict-assertion x-mjst instanceOf', () => {
  it('asserts instanceof for a required Date property', () => {
    const schema = {
      type: 'object' as const,
      properties: { createdAt: { 'x-mjst': { instanceOf: 'Date' } } },
      required: ['createdAt'],
    }
    const lines = generateObjectStrictAssertion(schema, 'Event').join('\n')

    expect(lines).toContain("missing required property 'createdAt'")
    expect(lines).toContain('!(input.createdAt instanceof Date)')
    expect(lines).toContain("field 'createdAt' must be Date")
  })

  it('guards undefined before asserting instanceof for an optional Date property', () => {
    const schema = {
      type: 'object' as const,
      properties: { createdAt: { 'x-mjst': { instanceOf: 'Date' } } },
    }
    const lines = generateObjectStrictAssertion(schema, 'Event').join('\n')

    expect(lines).toContain('input.createdAt !== undefined && !(input.createdAt instanceof Date)')
  })

  it('asserts instanceof for a top-level Date schema', () => {
    const line = generateScalarStrictAssertion({ 'x-mjst': { instanceOf: 'Date' } }, 'When')

    expect(line).toContain('!(input instanceof Date)')
    expect(line).toContain('expected Date')
  })
})

describe('generate-strict-assertion x-mjst primitive', () => {
  it('asserts typeof bigint for a required property', () => {
    const schema = {
      type: 'object' as const,
      properties: { balance: { 'x-mjst': { primitive: 'bigint' } } },
      required: ['balance'],
    }
    const lines = generateObjectStrictAssertion(schema, 'Account').join('\n')

    expect(lines).toContain("missing required property 'balance'")
    expect(lines).toContain('typeof input.balance !== "bigint"')
    expect(lines).toContain("field 'balance' must be bigint")
  })

  it('guards undefined before asserting typeof for an optional bigint property', () => {
    const schema = {
      type: 'object' as const,
      properties: { balance: { 'x-mjst': { primitive: 'bigint' } } },
    }
    const lines = generateObjectStrictAssertion(schema, 'Account').join('\n')

    expect(lines).toContain('input.balance !== undefined && typeof input.balance !== "bigint"')
  })

  it('asserts typeof for a top-level bigint schema', () => {
    const line = generateScalarStrictAssertion({ 'x-mjst': { primitive: 'bigint' } }, 'Big')

    expect(line).toContain('typeof input !== "bigint"')
    expect(line).toContain('expected bigint')
  })
})
