import { describe, expect, it } from 'vitest'

import { refToName } from './ref-to-name'

describe('ref-to-name', () => {
  it('converts simple ref to PascalCase', () => {
    expect(refToName('#/$defs/contact')).toBe('Contact')
  })

  it('converts kebab-case ref to PascalCase', () => {
    expect(refToName('#/$defs/server-variable')).toBe('ServerVariable')
  })

  it('converts multi-word kebab-case ref to PascalCase', () => {
    expect(refToName('#/$defs/external-documentation')).toBe('ExternalDocumentation')
  })

  it('handles refs with multiple path segments', () => {
    expect(refToName('#/components/schemas/user-profile')).toBe('UserProfile')
  })

  it('handles single word refs', () => {
    expect(refToName('#/$defs/info')).toBe('Info')
  })

  it('handles refs with numbers', () => {
    expect(refToName('#/$defs/oauth2-flow')).toBe('Oauth2Flow')
  })

  it('converts uppercase acronym keys to PascalCase via kebab normalization', () => {
    expect(refToName('#/$defs/APIKey')).toBe('ApiKey')
  })

  it('derives type name from a URI ref', () => {
    expect(refToName('http://asyncapi.com/definitions/3.1.0/channel.json')).toBe('Channel')
    expect(refToName('http://asyncapi.com/definitions/3.1.0/info.json')).toBe('Info')
  })

  it('derives type name from a URI ref with a fragment', () => {
    expect(refToName('http://asyncapi.com/bindings/sns/0.1.0/channel.json#/definitions/queue')).toBe(
      'BindingsSns010ChannelQueue',
    )
  })

  it('handles draft-07 schema URI', () => {
    expect(refToName('http://json-schema.org/draft-07/schema')).toBe('Draft07Schema')
  })

  it('appends the suffix when one is provided', () => {
    expect(refToName('#/$defs/contact', 'Object')).toBe('ContactObject')
    expect(refToName('#/$defs/server-variable', 'Object')).toBe('ServerVariableObject')
  })

  it('treats an empty suffix the same as omitting it', () => {
    expect(refToName('#/$defs/contact', '')).toBe('Contact')
  })
})
