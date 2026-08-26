import { describe, expect, it } from 'vitest'

import { mergeTraits } from './merge-traits'

describe('merge-traits', () => {
  it('lays traits down in order, target last', () => {
    const merged = mergeTraits({ name: 'msg', contentType: 'application/json' }, [
      { contentType: 'text/plain', headers: { type: 'object' } },
      { contentType: 'application/xml' },
    ])
    expect(merged).toEqual({
      name: 'msg',
      contentType: 'application/json',
      headers: { type: 'object' },
    })
  })

  it('lets a trait contribute keys the target lacks', () => {
    const merged = mergeTraits({ payload: { type: 'object' } }, [{ schemaFormat: 'application/vnd.apache.avro' }])
    expect(merged['schemaFormat']).toBe('application/vnd.apache.avro')
  })

  it('drops the applied traits key from the result', () => {
    const merged = mergeTraits({ traits: [{ name: 'x' }], name: 'msg' }, [{ name: 'trait' }])
    expect('traits' in merged).toBe(false)
    expect(merged['name']).toBe('msg')
  })

  it('keeps a __proto__ trait key as a plain property', () => {
    const trait = JSON.parse('{"__proto__": {"polluted": true}}') as Record<string, unknown>
    const merged = mergeTraits({}, [trait])
    expect(Object.getPrototypeOf(merged)).toBe(Object.prototype)
    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined()
  })
})
