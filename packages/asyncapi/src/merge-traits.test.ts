import { describe, expect, it } from 'vitest'

import { mergeTraits } from './merge-traits'

describe('merge-traits', () => {
  it("gives a 2.x trait's value precedence over the message's own", () => {
    // 2.x: the trait is the RFC 7386 patch merged INTO the message, so a
    // trait-set key overrides — the official parser applies it the same way.
    const merged = mergeTraits(
      { name: 'msg', contentType: 'application/json', schemaFormat: 'application/schema+json;version=draft-07' },
      [{ contentType: 'application/xml', schemaFormat: 'application/vnd.apache.avro;version=1.9.0' }],
      'trait',
    )
    expect(merged['contentType']).toBe('application/xml')
    expect(merged['schemaFormat']).toBe('application/vnd.apache.avro;version=1.9.0')
    expect(merged['name']).toBe('msg')
  })

  it("keeps the 3.0 target's value over a trait's", () => {
    // 3.0 inverted the rule: "A property on a trait MUST NOT override the
    // same property on the target object."
    const merged = mergeTraits(
      { name: 'msg', contentType: 'application/json' },
      [{ contentType: 'text/plain' }],
      'target',
    )
    expect(merged['contentType']).toBe('application/json')
  })

  it('applies traits in declaration order', () => {
    expect(mergeTraits({}, [{ contentType: 'a' }, { contentType: 'b' }], 'trait')['contentType']).toBe('b')
    expect(mergeTraits({}, [{ contentType: 'a' }, { contentType: 'b' }], 'target')['contentType']).toBe('b')
  })

  it('merges nested objects key by key instead of replacing them', () => {
    // RFC 7386 recurses into objects — the whole point of a commonHeaders
    // trait is contributing header properties a message extends.
    const target = { headers: { type: 'object', properties: { myHeader: { type: 'string' } } } }
    const trait = { headers: { type: 'object', properties: { correlationId: { type: 'string' } } } }
    for (const precedence of ['trait', 'target'] as const) {
      const merged = mergeTraits(target, [trait], precedence)
      const properties = (merged['headers'] as Record<string, Record<string, unknown>>)['properties']
      expect(properties, precedence).toHaveProperty('myHeader')
      expect(properties, precedence).toHaveProperty('correlationId')
    }
  })

  it('treats a null patch value as a deletion, per RFC 7386', () => {
    const merged = mergeTraits({ contentType: 'application/json', name: 'msg' }, [{ contentType: null }], 'trait')
    expect('contentType' in merged).toBe(false)
    expect(merged['name']).toBe('msg')
  })

  it('replaces arrays wholesale rather than merging them', () => {
    const merged = mergeTraits({ examples: [{ a: 1 }] }, [{ examples: [{ b: 2 }] }], 'trait')
    expect(merged['examples']).toEqual([{ b: 2 }])
  })

  it('lets a trait contribute keys the target lacks, under either precedence', () => {
    expect(mergeTraits({}, [{ schemaFormat: 'application/vnd.apache.avro' }], 'trait')['schemaFormat']).toBe(
      'application/vnd.apache.avro',
    )
    expect(mergeTraits({}, [{ schemaFormat: 'application/vnd.apache.avro' }], 'target')['schemaFormat']).toBe(
      'application/vnd.apache.avro',
    )
  })

  it('drops the applied traits key without mutating the input message', () => {
    const target = { traits: [{ name: 'x' }], name: 'msg' }
    const merged = mergeTraits(target, [{ name: 'trait' }], 'trait')
    expect('traits' in merged).toBe(false)
    // The document node the message came from must survive untouched.
    expect(target.traits).toEqual([{ name: 'x' }])
  })

  it('keeps a __proto__ trait key as a plain property', () => {
    const trait = JSON.parse('{"__proto__": {"polluted": true}}') as Record<string, unknown>
    const merged = mergeTraits({}, [trait], 'trait')
    expect(Object.getPrototypeOf(merged)).toBe(Object.prototype)
    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined()
  })
})
