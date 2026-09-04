import { describe, expect, it } from 'vitest'

import { normalizeSchema } from './normalize-schema'

describe('normalize-schema', () => {
  it('upgrades the AsyncAPI default dialect without a declared $schema', () => {
    // The dialect was declared at the message level, so the schema itself
    // carries no `$schema` — the upgrade must still fire.
    const normalized = normalizeSchema(
      {
        type: 'object',
        properties: { user: { $ref: '#/definitions/user' } },
        definitions: { user: { type: 'object' } },
      },
      'asyncapi',
    )
    expect(normalized['$defs']).toEqual({ user: { type: 'object' } })
    expect(normalized['definitions']).toBeUndefined()
    expect((normalized['properties'] as Record<string, unknown>)['user']).toEqual({ $ref: '#/$defs/user' })
    expect(normalized['$schema']).toBeUndefined()
  })

  it('does not grow an empty $defs onto a schema with no definitions', () => {
    expect(normalizeSchema({ type: 'string' }, 'asyncapi')).toEqual({ type: 'string' })
    expect(normalizeSchema({ type: 'string' }, 'draft-07')).toEqual({ type: 'string' })
  })

  it('keeps an authored $defs alongside upgraded definitions', () => {
    // Draft-07 tools accept unknown keywords, so a schema can carry both
    // blocks; the upgrade must not delete the authored one.
    const normalized = normalizeSchema(
      {
        type: 'object',
        properties: { a: { $ref: '#/$defs/authored' }, b: { $ref: '#/definitions/legacy' } },
        $defs: { authored: { type: 'string' } },
        definitions: { legacy: { type: 'number' } },
      },
      'asyncapi',
    )
    expect(normalized['$defs']).toEqual({ authored: { type: 'string' }, legacy: { type: 'number' } })
    expect((normalized['properties'] as Record<string, unknown>)['b']).toEqual({ $ref: '#/$defs/legacy' })
  })

  it('folds OpenAPI nullable into the type', () => {
    const normalized = normalizeSchema(
      { type: 'object', properties: { name: { type: 'string', nullable: true } } },
      'openapi',
    )
    const name = (normalized['properties'] as Record<string, Record<string, unknown>>)['name']
    expect(name?.['type']).toEqual(['string', 'null'])
  })

  it('passes 2020-12 through untouched', () => {
    const schema = { type: 'object', $defs: { x: { type: 'string' } } }
    expect(normalizeSchema(schema, '2020-12')).toBe(schema)
  })
})
