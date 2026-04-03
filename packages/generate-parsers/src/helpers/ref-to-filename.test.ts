import { describe, expect, it } from 'bun:test'
import { refToFilename } from './ref-to-filename'

describe('ref-to-filename', () => {
  it('extracts filename from simple ref', () => {
    expect(refToFilename('#/$defs/contact')).toBe('contact')
  })

  it('extracts filename from kebab-case ref', () => {
    expect(refToFilename('#/$defs/server-variable')).toBe('server-variable')
  })

  it('extracts filename from multi-word ref', () => {
    expect(refToFilename('#/$defs/external-documentation')).toBe('external-documentation')
  })

  it('extracts filename from refs with multiple path segments', () => {
    expect(refToFilename('#/components/schemas/user-profile')).toBe('user-profile')
  })

  it('extracts filename from single word ref', () => {
    expect(refToFilename('#/$defs/info')).toBe('info')
  })

  it('handles refs with numbers', () => {
    expect(refToFilename('#/$defs/oauth2-flow')).toBe('oauth2-flow')
  })

  it('removes -or-reference suffix', () => {
    expect(refToFilename('#/$defs/callbacks-or-reference')).toBe('callbacks')
  })

  it('removes -or-reference suffix from multi-word refs', () => {
    expect(refToFilename('#/$defs/request-body-or-reference')).toBe('request-body')
  })

  it('removes -or-reference suffix from single word refs', () => {
    expect(refToFilename('#/$defs/example-or-reference')).toBe('example')
  })

  it('converts PascalCase definitions keys to kebab-case', () => {
    expect(refToFilename('#/definitions/ServerVariable')).toBe('server-variable')
    expect(refToFilename('#/definitions/Contact')).toBe('contact')
    expect(refToFilename('#/definitions/ExternalDocumentation')).toBe('external-documentation')
  })

  it('converts consecutive uppercase acronyms correctly', () => {
    expect(refToFilename('#/definitions/APIKeySecurityScheme')).toBe('api-key-security-scheme')
  })

  it('handles OAuth mixed-case acronym correctly', () => {
    expect(refToFilename('#/definitions/OAuthFlows')).toBe('oauth-flows')
    expect(refToFilename('#/definitions/ImplicitOAuthFlow')).toBe('implicit-oauth-flow')
    expect(refToFilename('#/definitions/OAuth2SecurityScheme')).toBe('oauth2-security-scheme')
  })
})
