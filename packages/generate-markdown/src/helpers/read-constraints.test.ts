import { describe, expect, it } from 'vitest'
import { readConstraints } from '#helpers/read-constraints'

describe('read-constraints', () => {
  it('reads nothing from a plain property', () => {
    expect(readConstraints({ type: 'string' }, 'json')).toEqual([])
  })

  it('reads format and pattern', () => {
    expect(readConstraints({ type: 'string', format: 'uri', pattern: '^[a-z]$' }, 'json')).toEqual([
      'format: uri',
      'pattern: ^[a-z]$',
    ])
  })

  it('reads the numeric bounds in a readable order', () => {
    expect(readConstraints({ type: 'number', maximum: 10, minimum: 1 }, 'json')).toEqual(['minimum: 1', 'maximum: 10'])
  })

  it('reads the length and size bounds', () => {
    expect(readConstraints({ minLength: 1, maxLength: 40, minItems: 2, maxItems: 3 }, 'json')).toEqual([
      'minLength: 1',
      'maxLength: 40',
      'minItems: 2',
      'maxItems: 3',
    ])
  })

  it('reads the exclusive bounds and multipleOf', () => {
    expect(readConstraints({ exclusiveMinimum: 0, exclusiveMaximum: 10, multipleOf: 2 }, 'json')).toEqual([
      'exclusiveMinimum: 0',
      'exclusiveMaximum: 10',
      'multipleOf: 2',
    ])
  })

  it('reads uniqueItems only when it is on', () => {
    expect(readConstraints({ uniqueItems: true }, 'json')).toEqual(['uniqueItems: true'])
    expect(readConstraints({ uniqueItems: false }, 'json')).toEqual([])
  })

  // The schema is parsed JSON, so a keyword can hold anything.
  it('ignores keywords of the wrong type', () => {
    expect(readConstraints({ minimum: '1', pattern: 5, format: '' } as never, 'json')).toEqual([])
  })
})
