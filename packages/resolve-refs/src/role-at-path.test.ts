import { describe, expect, it } from 'vitest'

import { roleAtPath } from './role-at-path'

describe('role-at-path', () => {
  it('treats the document root as a schema', () => {
    expect(roleAtPath([])).toBe('schema')
  })

  it('lands in a schema for a definition, whatever it is named', () => {
    expect(roleAtPath(['$defs', 'a_string'])).toBe('schema')
    expect(roleAtPath(['$defs', 'enum'])).toBe('schema')
    expect(roleAtPath(['properties', 'foo', 'items'])).toBe('schema')
  })

  it('lands in a value position for a target inside instance data', () => {
    // A ref *into* an enum member points at data, so inlining it verbatim is
    // exactly right — nothing in there gets resolved.
    expect(roleAtPath(['enum', 0])).toBe('value')
    expect(roleAtPath(['$defs', 'a', 'const', 'nested'])).toBe('value')
  })

  it('stays unknown for targets outside the vocabulary', () => {
    // An OpenAPI component keeps the behavior it had before roles existed.
    expect(roleAtPath(['components', 'schemas', 'Pet'])).toBe('unknown')
  })
})
