import { describe, expect, it } from 'vitest'

import { safeAccessor, safeKey } from './safe-accessor'

describe('safe-accessor', () => {
  it('uses dot notation for simple identifiers', () => {
    expect(safeAccessor('input', 'name')).toBe('input.name')
  })

  it('uses bracket notation for hyphenated keys', () => {
    expect(safeAccessor('input', 'x-linkedin')).toBe('input["x-linkedin"]')
  })

  it('uses optional chaining with bracket notation for hyphenated keys', () => {
    expect(safeAccessor('input?', 'x-linkedin')).toBe('input?.["x-linkedin"]')
  })

  it('uses dot notation for underscored identifiers', () => {
    expect(safeAccessor('input', '_private')).toBe('input._private')
  })

  it('uses bracket notation for keys starting with numbers', () => {
    expect(safeAccessor('input', '0foo')).toBe('input["0foo"]')
  })

  it('uses bracket notation for keys with dots', () => {
    expect(safeAccessor('input', 'foo.bar')).toBe('input["foo.bar"]')
  })

  it('escapes quotes and backslashes in bracket keys to prevent code injection', () => {
    expect(safeAccessor('input', "a']; evil(); //")).toBe('input["a\']; evil(); //"]')
    expect(safeAccessor('input', 'it"s')).toBe('input["it\\"s"]')
    expect(safeAccessor('input', 'a\\b')).toBe('input["a\\\\b"]')
  })

  // A dot *or* a bracket read walks the prototype chain, so both forms answer
  // `Object` for `constructor` and `Object.prototype` for `__proto__` on an
  // input that carries neither. That made `input.constructor === undefined`
  // impossible to satisfy — `validateDocShape` returned false for every valid
  // object — and made the parser copy a `__proto__` key the input never had.
  it('guards Object.prototype member names with an own-property check', () => {
    expect(safeAccessor('input', 'constructor')).toBe(
      '(input != null && Object.hasOwn(input, "constructor") ? input["constructor"] : undefined)',
    )
    expect(safeAccessor('input', '__proto__')).toBe(
      '(input != null && Object.hasOwn(input, "__proto__") ? input["__proto__"] : undefined)',
    )
  })

  it('guards inherited method names too', () => {
    for (const key of ['toString', 'valueOf', 'hasOwnProperty', 'isPrototypeOf', 'toLocaleString']) {
      expect(safeAccessor('input', key)).toContain(`Object.hasOwn(input, "${key}")`)
    }
  })

  // The `!= null` test already covers what the `?.` was there for, and
  // `Object.hasOwn` throws on null/undefined, so it has to short-circuit anyway.
  it('drops the optional-chaining marker in favour of the null guard', () => {
    expect(safeAccessor('input?', 'toString')).toBe(
      '(input != null && Object.hasOwn(input, "toString") ? input["toString"] : undefined)',
    )
  })

  it('returns unquoted key for simple identifiers', () => {
    expect(safeKey('name')).toBe('name')
  })

  it('returns quoted key for hyphenated names', () => {
    expect(safeKey('x-linkedin')).toBe('"x-linkedin"')
  })

  it('returns quoted key for names with dots', () => {
    expect(safeKey('foo.bar')).toBe('"foo.bar"')
  })

  it('escapes quotes and backslashes in object-literal keys', () => {
    expect(safeKey("it's")).toBe('"it\'s"')
    expect(safeKey('a": 1, evil')).toBe('"a\\": 1, evil"')
  })
})
