import { describe, expect, it } from 'vitest'

import { childRole } from './child-role'

describe('child-role', () => {
  it('classifies the instance-holding keywords as value positions', () => {
    expect(childRole('schema', 'enum')).toBe('value')
    expect(childRole('schema', 'const')).toBe('value')
    expect(childRole('schema', 'default')).toBe('value')
    expect(childRole('schema', 'examples')).toBe('value')
  })

  it('classifies applicators as schema positions', () => {
    expect(childRole('schema', 'items')).toBe('schema')
    expect(childRole('schema', 'allOf')).toBe('schema')
    expect(childRole('schema', 'if')).toBe('schema')
    expect(childRole('schema', 'not')).toBe('schema')
    expect(childRole('schema', 'additionalProperties')).toBe('schema')
    expect(childRole('schema', 'contentSchema')).toBe('schema')
  })

  it('classifies name-keyed containers as schema maps', () => {
    expect(childRole('schema', 'properties')).toBe('schemaMap')
    expect(childRole('schema', 'patternProperties')).toBe('schemaMap')
    expect(childRole('schema', '$defs')).toBe('schemaMap')
    expect(childRole('schema', 'definitions')).toBe('schemaMap')
    expect(childRole('schema', 'dependentSchemas')).toBe('schemaMap')
  })

  it('treats every key of a schema map as a name, never a keyword', () => {
    // The trap in classifying by key alone: a definition named `enum` is a
    // definition, and a property named `$ref` is a property.
    expect(childRole('schemaMap', 'enum')).toBe('schema')
    expect(childRole('schemaMap', 'const')).toBe('schema')
    expect(childRole('schemaMap', '$ref')).toBe('schema')
    expect(childRole('schemaMap', 'properties')).toBe('schema')
  })

  it('gives array members the role of the array', () => {
    // `allOf[0]` is a schema, `enum[0]` is an instance.
    expect(childRole(childRole('schema', 'allOf'), 0)).toBe('schema')
    expect(childRole(childRole('schema', 'enum'), 0)).toBe('value')
    expect(childRole(childRole('schema', 'x-vendor'), 0)).toBe('unknown')
  })

  it('leaves unrecognized keywords unknown, and keeps them that way', () => {
    // Extension territory (OpenAPI's own keywords, `x-` blocks) keeps the
    // structural walk it has always had, so nothing inside is reinterpreted.
    expect(childRole('schema', 'components')).toBe('unknown')
    expect(childRole('unknown', 'enum')).toBe('unknown')
    expect(childRole('unknown', 'properties')).toBe('unknown')
    expect(childRole('unknown', '$defs')).toBe('unknown')
  })

  it('never descends out of a value position', () => {
    expect(childRole('value', 'properties')).toBe('value')
    expect(childRole('value', 0)).toBe('value')
  })
})
