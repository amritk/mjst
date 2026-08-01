import { describe, expect, it } from 'vitest'

import { buildParamsObject } from './build-params-object'
import type { Coercion } from './types'

describe('build-params-object', () => {
  it('returns the captured object untouched when nothing needs coercing', () => {
    const raw = { slug: 'hello' }
    expect(buildParamsObject(raw, new Map())).toBe(raw)
  })

  it('coerces planned keys', () => {
    const plan = new Map<string, Coercion>([
      ['id', 'number'],
      ['archived', 'boolean'],
    ])
    expect(buildParamsObject({ id: '7', archived: 'true', slug: 'x' }, plan)).toEqual({
      id: 7,
      archived: true,
      slug: 'x',
    })
  })

  // A pattern may name a capture `{__proto__}`. Copying it with a plain
  // assignment would run the prototype setter and lose the capture before the
  // guard ever saw it.
  it('keeps a captured parameter named __proto__ as an ordinary own property', () => {
    const raw = JSON.parse('{"__proto__":"7","slug":"x"}') as Record<string, string>
    const plan = new Map<string, Coercion>([['__proto__', 'number']])
    const result = buildParamsObject(raw, plan)
    expect(Object.getOwnPropertyNames(result).sort()).toEqual(['__proto__', 'slug'])
    expect(result['__proto__']).toBe(7)
    expect(Object.getPrototypeOf(result)).toBe(Object.prototype)
  })

  it('keeps unparseable values as strings for the validator to reject', () => {
    const plan = new Map<string, Coercion>([['id', 'number']])
    expect(buildParamsObject({ id: 'abc' }, plan)).toEqual({ id: 'abc' })
  })
})
