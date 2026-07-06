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

  it('derives the name from the fallback filename when the title is missing', () => {
    expect(deriveRootTypeName({ type: 'object' }, 'spec-plan')).toBe('SpecPlan')
    expect(deriveRootTypeName({ type: 'object' }, 'program')).toBe('Program')
  })

  it('prefers a usable title over the fallback filename', () => {
    expect(deriveRootTypeName({ title: 'My Config' }, 'spec-plan')).toBe('MyConfig')
  })

  it('uses the fallback filename when the title has no usable characters', () => {
    expect(deriveRootTypeName({ title: '   ---   ' }, 'spec-plan')).toBe('SpecPlan')
  })

  it('falls back to Document when neither title nor filename is usable', () => {
    expect(deriveRootTypeName({ type: 'object' }, '   ')).toBe('Document')
    expect(deriveRootTypeName(true, 'spec-plan')).toBe('SpecPlan')
  })
})
