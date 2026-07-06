import { describe, expect, it } from 'vitest'

import { quoteJsString } from './quote-js-string'

describe('quote-js-string', () => {
  it('quotes plain text without the full escaper', () => {
    expect(quoteJsString("[User] field 'name' expected string, got ")).toBe(
      '"[User] field \'name\' expected string, got "',
    )
  })

  it('matches JSON.stringify exactly for plain text', () => {
    const plain = "[Order] field 'total' must be >= 0"
    expect(quoteJsString(plain)).toBe(JSON.stringify(plain))
  })

  it('escapes quotes, backslashes, controls, and line separators via JSON.stringify', () => {
    for (const hostile of ['break " out', 'back\\slash', 'new\nline', 'tab\tchar', 'ls sep', 'ps sep']) {
      const literal = quoteJsString(hostile)
      expect(literal).toBe(JSON.stringify(hostile))
      // The literal must round-trip through an actual JS evaluation unchanged.
      expect(new Function(`return ${literal}`)()).toBe(hostile)
    }
  })
})
