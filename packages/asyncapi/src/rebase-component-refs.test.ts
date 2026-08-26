import { describe, expect, it } from 'vitest'

import { rebaseComponentRefs } from './rebase-component-refs'
import type { ExtractionIssue } from './types'

const document = {
  asyncapi: '3.0.0',
  components: {
    schemas: {
      user: { type: 'object', properties: { pet: { $ref: '#/components/schemas/pet' } } },
      pet: { type: 'object', properties: { owner: { $ref: '#/components/schemas/user' } } },
      wrapped: {
        schemaFormat: 'application/schema+json;version=draft-2020-12',
        schema: { type: 'string' },
      },
      avro: { schemaFormat: 'application/vnd.apache.avro;version=1.9.0', schema: { type: 'record' } },
    },
  },
}

describe('rebase-component-refs', () => {
  it('copies referenced components into $defs and rewrites the refs', () => {
    const issues: ExtractionIssue[] = []
    const rebased = rebaseComponentRefs(
      { type: 'object', properties: { user: { $ref: '#/components/schemas/user' } } },
      document,
      'asyncapi',
      issues,
      '#/x',
    )
    expect((rebased['properties'] as Record<string, unknown>)['user']).toEqual({ $ref: '#/$defs/user' })
    const defs = rebased['$defs'] as Record<string, Record<string, unknown>>
    // `pet` arrives transitively through `user`, and the cycle back terminates.
    expect(Object.keys(defs).sort()).toEqual(['pet', 'user'])
    expect(JSON.stringify(rebased)).not.toContain('#/components/')
    expect(issues).toEqual([])
  })

  it('keeps a deeper pointer tail on the rewritten ref', () => {
    const issues: ExtractionIssue[] = []
    const rebased = rebaseComponentRefs(
      { $ref: '#/components/schemas/user/properties/pet' },
      document,
      'asyncapi',
      issues,
      '#/x',
    )
    expect(rebased['$ref']).toBe('#/$defs/user/properties/pet')
    expect((rebased['$defs'] as Record<string, unknown>)['user']).toBeDefined()
  })

  it('unwraps a multi-format component with its own dialect', () => {
    const issues: ExtractionIssue[] = []
    const rebased = rebaseComponentRefs({ $ref: '#/components/schemas/wrapped' }, document, 'asyncapi', issues, '#/x')
    expect((rebased['$defs'] as Record<string, unknown>)['wrapped']).toEqual({ type: 'string' })
  })

  it('turns an unsupported-format component into an unconstrained schema with an issue', () => {
    const issues: ExtractionIssue[] = []
    const rebased = rebaseComponentRefs({ $ref: '#/components/schemas/avro' }, document, 'asyncapi', issues, '#/x')
    expect((rebased['$defs'] as Record<string, unknown>)['avro']).toEqual({})
    expect(issues[0]?.message).toContain('avro')
  })

  it('turns a ref to an undeclared component into an unconstrained schema with an issue', () => {
    const issues: ExtractionIssue[] = []
    const rebased = rebaseComponentRefs({ $ref: '#/components/schemas/ghost' }, document, 'asyncapi', issues, '#/x')
    expect(rebased['$ref']).toBe('#/$defs/ghost')
    expect((rebased['$defs'] as Record<string, unknown>)['ghost']).toEqual({})
    expect(issues[0]?.message).toContain('undeclared component')
  })

  it('moves a component aside when the root already claims its name in $defs', () => {
    const issues: ExtractionIssue[] = []
    const rebased = rebaseComponentRefs(
      {
        type: 'object',
        properties: { remote: { $ref: '#/components/schemas/user' }, local: { $ref: '#/$defs/user' } },
        $defs: { user: { type: 'string' } },
      },
      document,
      'asyncapi',
      issues,
      '#/x',
    )
    const defs = rebased['$defs'] as Record<string, Record<string, unknown>>
    // The root's own definition survives untouched; the component gets a
    // prefixed key and the remote ref follows it there.
    expect(defs['user']).toEqual({ type: 'string' })
    expect((rebased['properties'] as Record<string, Record<string, unknown>>)['remote']?.['$ref']).toBe(
      '#/$defs/component-user',
    )
    expect(defs['component-user']?.['type']).toBe('object')
  })

  it('leaves refs inside instance data alone', () => {
    const issues: ExtractionIssue[] = []
    const rebased = rebaseComponentRefs(
      { type: 'object', default: { $ref: '#/components/schemas/user' } },
      document,
      'asyncapi',
      issues,
      '#/x',
    )
    // The `default` value is data the author wrote, not a reference.
    expect(rebased['default']).toEqual({ $ref: '#/components/schemas/user' })
    expect(rebased['$defs']).toBeUndefined()
  })
})
