import { describe, expect, it } from 'bun:test'
import { refToName } from '#parser/helpers/ref-to-name'

describe('ref-to-name', () => {
  it('converts simple ref to PascalCase', () => {
    expect(refToName('#/$defs/contact')).toBe('ContactObject')
  })

  it('converts kebab-case ref to PascalCase', () => {
    expect(refToName('#/$defs/server-variable')).toBe('ServerVariableObject')
  })

  it('converts multi-word kebab-case ref to PascalCase', () => {
    expect(refToName('#/$defs/external-documentation')).toBe('ExternalDocumentationObject')
  })

  it('handles refs with multiple path segments', () => {
    expect(refToName('#/components/schemas/user-profile')).toBe('UserProfileObject')
  })

  it('handles single word refs', () => {
    expect(refToName('#/$defs/info')).toBe('InfoObject')
  })

  it('handles refs with numbers', () => {
    expect(refToName('#/$defs/oauth2-flow')).toBe('Oauth2FlowObject')
  })

  it('preserves existing PascalCase', () => {
    expect(refToName('#/$defs/APIKey')).toBe('APIKeyObject')
  })

  it('removes -or-reference suffix', () => {
    expect(refToName('#/$defs/callbacks-or-reference')).toBe('CallbacksObject')
  })

  it('removes -or-reference suffix from multi-word refs', () => {
    expect(refToName('#/$defs/request-body-or-reference')).toBe('RequestBodyObject')
  })

  it('removes -or-reference suffix from single word refs', () => {
    expect(refToName('#/$defs/example-or-reference')).toBe('ExampleObject')
  })
})
