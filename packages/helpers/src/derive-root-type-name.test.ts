import { describe, expect, it } from 'vitest'

import { deriveRootTypeName } from './derive-root-type-name'

describe('derive-root-type-name', () => {
  it('derives a PascalCase name from a single-word title', () => {
    expect(deriveRootTypeName({ title: 'Document' })).toBe('Document')
  })

  it('joins multi-word titles into PascalCase', () => {
    expect(deriveRootTypeName({ title: 'OpenAPI Document' })).toBe('OpenAPIDocument')
  })

  it('preserves acronyms intact', () => {
    expect(deriveRootTypeName({ title: 'JSON Schema' })).toBe('JSONSchema')
  })

  it('splits on non-alphanumeric separators', () => {
    expect(deriveRootTypeName({ title: 'my-config_file.spec' })).toBe('MyConfigFileSpec')
  })

  it('drops leading digits so the name is a valid identifier', () => {
    expect(deriveRootTypeName({ title: '3 amigos' })).toBe('Amigos')
  })

  it('falls back to Document when the title is missing', () => {
    expect(deriveRootTypeName({ type: 'object' })).toBe('Document')
  })

  it('falls back to Document when the title is not a string', () => {
    expect(deriveRootTypeName({ title: 42 })).toBe('Document')
  })

  it('falls back to Document for a title with no usable characters', () => {
    expect(deriveRootTypeName({ title: '   ---   ' })).toBe('Document')
  })

  it('falls back to Document for boolean schemas', () => {
    expect(deriveRootTypeName(true)).toBe('Document')
    expect(deriveRootTypeName(false)).toBe('Document')
  })
})
