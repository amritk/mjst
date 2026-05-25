import type { JSONSchema } from 'json-schema-typed/draft-2020-12'
import { describe, expect, it } from 'vitest'

import { getMjstInstanceOf, MJST_EXTENSION_KEY } from './mjst-extension'

describe('getMjstInstanceOf', () => {
  it('reads a valid instanceOf class name', () => {
    expect(getMjstInstanceOf({ 'x-mjst': { instanceOf: 'Date' } })).toBe('Date')
  })

  it('returns undefined when the extension is absent', () => {
    expect(getMjstInstanceOf({ type: 'string' })).toBeUndefined()
  })

  it('returns undefined for a boolean schema', () => {
    expect(getMjstInstanceOf(true as unknown as JSONSchema)).toBeUndefined()
  })

  it('rejects instanceOf values that are not safe identifiers', () => {
    expect(getMjstInstanceOf({ 'x-mjst': { instanceOf: 'Date; doEvil()' } })).toBeUndefined()
    expect(getMjstInstanceOf({ 'x-mjst': { instanceOf: '' } })).toBeUndefined()
  })

  it('exposes the extension key', () => {
    expect(MJST_EXTENSION_KEY).toBe('x-mjst')
  })
})
