import { describe, expect, it } from 'vitest'

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

  it('derives filename from a plain URI ref', () => {
    expect(refToFilename('http://asyncapi.com/definitions/3.1.0/channel.json')).toBe('channel')
    expect(refToFilename('http://asyncapi.com/definitions/3.1.0/info.json')).toBe('info')
  })

  it('derives filename from a URI binding ref including version for disambiguation', () => {
    expect(refToFilename('http://asyncapi.com/bindings/kafka/0.5.0/channel.json')).toBe('bindings-kafka-0-5-0-channel')
  })

  it('derives filename from a URI ref with a fragment', () => {
    expect(refToFilename('http://asyncapi.com/bindings/sns/0.1.0/channel.json#/definitions/queue')).toBe(
      'bindings-sns-0-1-0-channel-queue',
    )
  })

  it('handles URI ref with empty fragment (trailing #)', () => {
    expect(refToFilename('http://json-schema.org/draft-07/schema#')).toBe('draft-07-schema')
  })

  // `#` opens a URL fragment in an ESM specifier, so `'./#named.ts'` is
  // unloadable even when the file exists. A plain `$anchor` ref names the anchor.
  it('derives a loadable filename from a plain $anchor ref', () => {
    expect(refToFilename('#named')).toBe('named')
    expect(refToFilename('#Named')).toBe('named')
  })

  // A host-only URI has no path to name the file after. Splitting on `/`
  // regardless left the protocol punctuation in, producing `http:--x` — which
  // Windows will not even create.
  it('names a host-only URI after its host', () => {
    expect(refToFilename('http://x')).toBe('x')
    expect(refToFilename('https://example.com')).toBe('example-com')
  })

  it('normalizes names that would otherwise produce a degenerate file', () => {
    // `.ts`, `...ts`, and a dot-file are all names a build cannot import.
    expect(refToFilename('#/$defs/')).toMatch(/^ref-[0-9a-z]+$/)
    expect(refToFilename('#/$defs/..')).toMatch(/^ref-[0-9a-z]+$/)
    expect(refToFilename('#/$defs/.hidden')).toBe('hidden')
  })

  it('keeps two degenerate refs on separate files', () => {
    expect(refToFilename('#/$defs/')).not.toBe(refToFilename('#/$defs/..'))
  })

  it('folds characters no filesystem or import specifier accepts', () => {
    expect(refToFilename('#/$defs/a:b*c?d')).toBe('a-b-c-d')
    expect(refToFilename('#/$defs/foo bar')).toBe('foo-bar')
  })

  // Not a traversal (every `/` is the split delimiter), but the leftover dashes
  // made for an ugly name; check the shape stays sane.
  it('flattens a URI with dot segments into a plain name', () => {
    expect(refToFilename('http://x.com/../../etc/passwd.json')).toBe('etc-passwd')
  })
})
