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

  it('keeps unparseable values as strings for the validator to reject', () => {
    const plan = new Map<string, Coercion>([['id', 'number']])
    expect(buildParamsObject({ id: 'abc' }, plan)).toEqual({ id: 'abc' })
  })
})
