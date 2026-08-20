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

  // A lone surrogate is a legal JSON string and so a legal property name, enum
  // member, or pattern — but it has no UTF-8 encoding, so writing the generated
  // file turned it into U+FFFD and the literal on disk was a different string
  // than the schema declared.
  it('escapes an unpaired surrogate so the literal survives being written as UTF-8', () => {
    for (const lone of [JSON.parse('"\\ud800"'), JSON.parse('"a\\udfffb"'), JSON.parse('"\\udc00tail"')] as string[]) {
      const literal = quoteJsString(lone)
      expect(literal).toBe(JSON.stringify(lone))
      expect(literal).not.toContain(lone)
      expect(new Function(`return ${literal}`)()).toBe(lone)
      // What survives an encode/decode round trip is what reaches disk.
      expect(new TextDecoder().decode(new TextEncoder().encode(literal))).toBe(literal)
    }
  })

  // Emoji in a property name are common; sending every astral character through
  // the full escaper would cost the fast path for nothing.
  it('keeps a well-formed surrogate pair on the fast path', () => {
    expect(quoteJsString('hi 😀')).toBe('"hi 😀"')
    expect(new Function('return "hi 😀"')()).toBe('hi 😀')
  })
})
