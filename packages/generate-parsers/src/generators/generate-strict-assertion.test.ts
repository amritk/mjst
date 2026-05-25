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

    expect(lines).toContain('missing required property "createdAt"')
    expect(lines).toContain('!(input.createdAt instanceof Date)')
    expect(lines).toContain('field "createdAt" must be Date')
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
