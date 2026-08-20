import { describe, expect, it } from 'vitest'

import { hasOwnCheck, missingCheck, safeAccessor, safeKey } from './safe-accessor'

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
  // The trailing `as any` is what keeps the emitted code compiling: every other
  // accessor is a property-access path, which TypeScript narrows across repeated
  // reads, and a conditional expression is not.
  it('guards Object.prototype member names with an own-property check', () => {
    expect(safeAccessor('input', 'constructor')).toBe(
      '((input != null && Object.hasOwn(input, "constructor") ? input["constructor"] : undefined) as any)',
    )
    expect(safeAccessor('input', '__proto__')).toBe(
      '((input != null && Object.hasOwn(input, "__proto__") ? input["__proto__"] : undefined) as any)',
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
      '((input != null && Object.hasOwn(input, "toString") ? input["toString"] : undefined) as any)',
    )
  })

  // `in` walks the prototype chain, so `"toString" in {}` is true and a
  // `required: ["toString"]` could never be reported missing. Only the names an
  // object can actually inherit pay for `Object.hasOwn` — it is the slower test,
  // and no JSON document inherits `id`.
  it('presence-checks Object.prototype member names with Object.hasOwn', () => {
    expect(hasOwnCheck('input', 'toString')).toBe('Object.hasOwn(input, "toString")')
    expect(hasOwnCheck('input', '__proto__')).toBe('Object.hasOwn(input, "__proto__")')
    expect(hasOwnCheck('input', 'constructor')).toBe('Object.hasOwn(input, "constructor")')
  })

  it('keeps the cheaper `in` for every other name', () => {
    expect(hasOwnCheck('input', 'id')).toBe('"id" in input')
    expect(hasOwnCheck('input', 'x-linkedin')).toBe('"x-linkedin" in input')
  })

  it('escapes schema-controlled key names in a presence check', () => {
    expect(hasOwnCheck('input', 'it"s')).toBe('"it\\"s" in input')
  })

  // `!"k" in obj` parses as `(!"k") in obj`, which is why the negation is not
  // something a caller should spell by hand.
  it('parenthesizes the negated presence check', () => {
    expect(missingCheck('input', 'id')).toBe('!("id" in input)')
    expect(missingCheck('input', 'toString')).toBe('!(Object.hasOwn(input, "toString"))')
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
