import { describe, expect, it } from 'vitest'
import { ARRAY_ITEM_SEGMENT } from '#reference/child-entries'
import { deriveExample } from '#reference/derive-example'

describe('derive-example', () => {
  it('derives nothing when the property has no examples', () => {
    expect(deriveExample({ type: 'string' }, ['name'])).toBeUndefined()
  })

  // A bare `'@acme/api'` leaves the reader to guess where it goes; the wrapped
  // form is something they can paste into their config file.
  it('wraps the first example back into the shape of the config', () => {
    expect(deriveExample({ examples: ['@acme/api'] }, ['targets', 'typescript', 'packageName'])).toEqual({
      value: { targets: { typescript: { packageName: '@acme/api' } } },
    })
  })

  it('wraps an array hop in brackets', () => {
    expect(deriveExample({ examples: ['cursor'] }, ['pagination', ARRAY_ITEM_SEGMENT, 'name'])).toEqual({
      value: { pagination: [{ name: 'cursor' }] },
    })
  })

  it('uses only the first example', () => {
    expect(deriveExample({ examples: ['a', 'b'] }, ['mode'])).toEqual({ value: { mode: 'a' } })
  })

  it('derives from a root-level property with an empty path', () => {
    expect(deriveExample({ examples: [1] }, [])).toEqual({ value: 1 })
  })

  // JSON can produce a property named `__proto__`; a computed key would set the
  // prototype and the example would render as `{}`.
  it('keeps a property named __proto__ in the example', () => {
    const derived = deriveExample({ examples: ['here'] }, ['__proto__'])
    expect(JSON.stringify(derived?.value)).toBe('{"__proto__":"here"}')
  })

  it('ignores a malformed examples keyword', () => {
    expect(deriveExample({ examples: 'nope' } as never, ['a'])).toBeUndefined()
  })
})
