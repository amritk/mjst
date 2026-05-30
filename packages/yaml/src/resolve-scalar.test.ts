import { describe, expect, it } from 'vitest'

import { resolveDoubleQuoted, resolvePlainValue, resolveSingleQuoted } from './resolve-scalar'

describe('resolve-scalar', () => {
  it('resolves the null forms', () => {
    expect(resolvePlainValue('')).toBeNull()
    expect(resolvePlainValue('~')).toBeNull()
    expect(resolvePlainValue('null')).toBeNull()
    expect(resolvePlainValue('NULL')).toBeNull()
  })

  it('resolves booleans only for the canonical spellings', () => {
    expect(resolvePlainValue('true')).toBe(true)
    expect(resolvePlainValue('False')).toBe(false)
    // YAML 1.2 core schema does not treat yes/no/on/off as booleans.
    expect(resolvePlainValue('yes')).toBe('yes')
    expect(resolvePlainValue('off')).toBe('off')
  })

  it('resolves integers in decimal, hex, and octal', () => {
    expect(resolvePlainValue('42')).toBe(42)
    expect(resolvePlainValue('-7')).toBe(-7)
    expect(resolvePlainValue('0x1F')).toBe(31)
    expect(resolvePlainValue('0o17')).toBe(15)
  })

  it('resolves floats including infinity and nan', () => {
    expect(resolvePlainValue('3.14')).toBe(3.14)
    expect(resolvePlainValue('1e3')).toBe(1000)
    expect(resolvePlainValue('-.inf')).toBe(Number.NEGATIVE_INFINITY)
    expect(Number.isNaN(resolvePlainValue('.nan') as number)).toBe(true)
  })

  it('keeps version-like and ambiguous text as strings', () => {
    // The killer case: an OpenAPI version must not become a float.
    expect(resolvePlainValue('1.0.0')).toBe('1.0.0')
    expect(resolvePlainValue('3.1.0')).toBe('3.1.0')
    expect(resolvePlainValue('name')).toBe('name')
    expect(resolvePlainValue('true story')).toBe('true story')
  })

  it('unescapes single-quoted scalars', () => {
    expect(resolveSingleQuoted("it''s fine")).toBe("it's fine")
    expect(resolveSingleQuoted('plain')).toBe('plain')
  })

  it('unescapes double-quoted scalars', () => {
    expect(resolveDoubleQuoted('a\\nb')).toBe('a\nb')
    expect(resolveDoubleQuoted('tab\\there')).toBe('tab\there')
    expect(resolveDoubleQuoted('quote\\"end')).toBe('quote"end')
    expect(resolveDoubleQuoted('\\u00e9')).toBe('é')
    expect(resolveDoubleQuoted('plain')).toBe('plain')
  })

  it('folds multi-line flow scalars', () => {
    expect(resolveDoubleQuoted('one\ntwo')).toBe('one two')
    expect(resolveSingleQuoted('one\n\ntwo')).toBe('one\ntwo')
  })
})
