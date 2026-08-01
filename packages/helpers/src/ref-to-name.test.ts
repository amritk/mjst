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

  it('produces a valid identifier for dotted keys (Kubernetes-style)', () => {
    expect(refToName('#/$defs/io.k8s.api.core.v1.Pod')).toBe('IoK8sApiCoreV1Pod')
  })

  it('prefixes a leading digit so the name is a usable identifier', () => {
    expect(refToName('#/$defs/123abc')).toBe('_123abc')
  })

  it('splits on spaces and other non-identifier characters', () => {
    expect(refToName('#/$defs/foo bar')).toBe('FooBar')
  })

  // Splitting on `[^A-Za-z0-9]` dropped every character of a non-ASCII name, so
  // each one fell through to the `_` fallback and a document with two of them
  // emitted two types called `_`. TypeScript identifiers are defined in terms of
  // ID_Start/ID_Continue, so these names are legal to emit verbatim.
  it('keeps non-ASCII definition names instead of collapsing them to "_"', () => {
    expect(refToName('#/$defs/中文')).toBe('中文')
    expect(refToName('#/$defs/日本')).toBe('日本')
    expect(refToName('#/$defs/Ключ')).toBe('Ключ')
    expect(refToName('#/$defs/café-münchen')).toBe('CaféMünchen')
  })

  it('appends the suffix to a non-ASCII name', () => {
    expect(refToName('#/$defs/中文', 'Object')).toBe('中文Object')
  })

  // Nothing identifier-shaped survives, so `refToFilename` hands over a
  // ref-derived fallback — distinct per ref, rather than one shared `_`.
  it('keeps two names that normalize away to nothing distinct', () => {
    expect(refToName('#/$defs/+++')).not.toBe(refToName('#/$defs/---'))
    expect(refToName('#/$defs/+++')).toMatch(/^Ref[0-9a-z]+$/)
  })
})
