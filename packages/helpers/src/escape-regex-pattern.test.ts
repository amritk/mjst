import { describe, expect, it } from 'vitest'

import { escapeRegexPattern, regexFlagsFor, regexLiteral } from './escape-regex-pattern'

describe('escape-regex-pattern', () => {
  it('escapes bare forward slashes so the regex literal does not close early', () => {
    expect(escapeRegexPattern('a/b')).toBe('a\\/b')
    // Input \d{4}/\d{2}/\d{2} → \d{4}\/\d{2}\/\d{2}
    expect(escapeRegexPattern('\\d{4}/\\d{2}/\\d{2}')).toBe('\\d{4}\\/\\d{2}\\/\\d{2}')
  })

  it('leaves backslash escape sequences exactly as-is (does not double them)', () => {
    // \d must stay \d — doubling it would match a literal backslash, not a digit.
    expect(escapeRegexPattern('\\d+')).toBe('\\d+')
    expect(escapeRegexPattern('\\w\\s')).toBe('\\w\\s')
  })

  it('does not double-escape an already-escaped slash', () => {
    // \/ (escaped slash) stays \/, not \\\/.
    expect(escapeRegexPattern('\\/')).toBe('\\/')
  })

  it('leaves regex metacharacters that do not affect the literal untouched', () => {
    expect(escapeRegexPattern('^[a-z]+$')).toBe('^[a-z]+$')
  })

  it('emits (?:) for the empty pattern so the literal does not become a comment', () => {
    // An empty body would emit `//` — a line comment, not a regex literal — and
    // break the generated file. `(?:)` matches everything, like the empty pattern.
    const escaped = escapeRegexPattern('')
    expect(escaped).toBe('(?:)')
    expect(new RegExp(escaped).test('anything')).toBe(true)
  })

  it('round-trips: the escaped body parses to a regex equivalent to the source pattern', () => {
    for (const pattern of ['\\d{4}/\\d{2}', 'a/b/c', '^https?:\\/\\/', '\\w+@\\w+']) {
      // Build the literal the generator emits and read its source back out.
      const re = new RegExp(escapeRegexPattern(pattern))
      // The RegExp's own source, with \/ normalized back to /, equals the input.
      expect(re.source.replace(/\\\//g, '/')).toBe(pattern.replace(/\\\//g, '/'))
    }
  })

  it('throws a clear error for an invalid regex pattern', () => {
    // `([` is not a valid regex; emitting it verbatim would break the generated
    // file, so generation must fail loudly instead.
    expect(() => escapeRegexPattern('([')).toThrow(/Invalid regex pattern/)
  })

  it('escapes raw line terminators so the emitted regex literal stays on one line', () => {
    // A raw newline / CR inside a `/…/` literal is a syntax error; escaping it to
    // `\n` / `\r` keeps the literal intact while matching the same character.
    expect(escapeRegexPattern('a\nb')).toBe('a\\nb')
    expect(escapeRegexPattern('a\rb')).toBe('a\\rb')
    expect(escapeRegexPattern('a\u2028b')).toBe('a\\u2028b')
    expect(escapeRegexPattern('a\u2029b')).toBe('a\\u2029b')
    // The escaped body still compiles and matches the original character.
    expect(new RegExp(escapeRegexPattern('a\nb')).test('a\nb')).toBe(true)
  })

  it('picks the `u` flag for a pattern that admits it, and none for one that does not', () => {
    expect(regexFlagsFor('^[a-z]+$')).toBe('u')
    expect(regexFlagsFor('\\p{Letter}')).toBe('u')
    // `\-` outside a character class is an identity escape `u` mode forbids, so a
    // pattern using one has to compile without the flag rather than fail to compile.
    expect(regexFlagsFor('\\-')).toBe('')
    expect(() => new RegExp('\\-', 'u')).toThrow()
  })

  it('builds a complete literal whose flags follow the pattern', () => {
    expect(regexLiteral('^[a-z]+$')).toBe('/^[a-z]+$/u')
    expect(regexLiteral('\\d{4}/\\d{2}')).toBe('/\\d{4}\\/\\d{2}/u')
    expect(regexLiteral('\\-')).toBe('/\\-/')
    expect(regexLiteral('')).toBe('/(?:)/u')
  })

  it('reads a Unicode property escape as a property, which is what the flag is for', () => {
    // Without `u`, `\p{Letter}` is the literal `p{Letter}` and matches nothing
    // sensible — the JSON Schema Test Suite case this closes.
    expect(new RegExp('\\p{Letter}').test('a')).toBe(false)
    const literal = regexLiteral('\\p{Letter}')
    const [, source, flags] = /^\/(.*)\/(\w*)$/.exec(literal) as RegExpExecArray
    expect(new RegExp(source as string, flags).test('a')).toBe(true)
  })

  it('escapes an unpaired surrogate so the emitted literal survives UTF-8', () => {
    const lone = JSON.parse('"^\\ud800$"') as string
    const literal = regexLiteral(lone)

    expect(literal).toBe('/^\\ud800$/u')
    expect(new TextDecoder().decode(new TextEncoder().encode(literal))).toBe(literal)
    // The escape matches the identical character, so the pattern still means
    // what its author wrote.
    const compiled = new Function(`return ${literal}`)() as RegExp
    expect(compiled.test(lone.slice(1, -1))).toBe(true)
  })

  it('leaves a well-formed surrogate pair verbatim', () => {
    expect(regexLiteral('^😀$')).toBe('/^😀$/u')
    expect((new Function('return /^😀$/u')() as RegExp).test('😀')).toBe(true)
  })
})
