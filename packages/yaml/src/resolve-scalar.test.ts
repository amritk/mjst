import { describe, expect, it } from 'vitest'

import {
  resolveDoubleQuoted,
  resolvePlainSlice,
  resolvePlainValue,
  resolveSingleQuoted,
  trimTrailingSpaces,
} from './resolve-scalar'

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

  it('keeps the sign on negative hex and octal integers', () => {
    // A leading `-` must survive base conversion: `parseInt` already applies it,
    // so the magnitude must not be re-negated back to a positive number.
    expect(resolvePlainValue('-0x10')).toBe(-16)
    expect(resolvePlainValue('-0o10')).toBe(-8)
    expect(resolvePlainValue('+0x10')).toBe(16)
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

  it('keeps text that only starts like a keyword or a number as a string', () => {
    // Keywords are matched by their first character before the numeric patterns
    // run, and hex/octal only once a `0x`/`0o` is in place; these sit just past
    // each of those gates.
    for (const text of ['nullable', 'Nul', 'nULL', 'trueish', 'tRUE', 'Falsey', 'fALSE', '~x', '.Nan', '.infinity']) {
      expect(resolvePlainValue(text)).toBe(text)
    }
    for (const text of ['+', '-', '0x', '0xZZ', '0o8', '1x10', '--1', '- 1', '+.5x', '12_000']) {
      expect(resolvePlainValue(text)).toBe(text)
    }
  })

  it('resolves every keyword spelling and signed number form', () => {
    expect(resolvePlainValue('Null')).toBeNull()
    expect(resolvePlainValue('TRUE')).toBe(true)
    expect(resolvePlainValue('True')).toBe(true)
    expect(resolvePlainValue('FALSE')).toBe(false)
    expect(resolvePlainValue('+.Inf')).toBe(Number.POSITIVE_INFINITY)
    expect(resolvePlainValue('.INF')).toBe(Number.POSITIVE_INFINITY)
    expect(resolvePlainValue('-.INF')).toBe(Number.NEGATIVE_INFINITY)
    expect(Number.isNaN(resolvePlainValue('.NAN') as number)).toBe(true)
    expect(resolvePlainValue('+12')).toBe(12)
    expect(resolvePlainValue('-0')).toBe(-0)
    expect(resolvePlainValue('-0x1f')).toBe(-31)
    expect(resolvePlainValue('+0o7')).toBe(7)
    expect(resolvePlainValue('-.5')).toBe(-0.5)
  })

  it('resolves a slice of the source exactly as it resolves the text', () => {
    const src = 'name: true, n: 12, v: 3.1.0, e: ~'
    for (const [start, end] of [
      [0, 4],
      [6, 10],
      [12, 13],
      [15, 17],
      [22, 27],
      [32, 33],
    ] as const) {
      const text = src.slice(start, end)
      expect(resolvePlainSlice(text, src, start)).toBe(resolvePlainValue(text))
    }
    // An empty slice is null even when the character at `start` is an ordinary one.
    expect(resolvePlainSlice('', src, 0)).toBeNull()
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

  it('treats invalid and out-of-range escapes as literal without crashing', () => {
    // `\U` over 0x10FFFF would make String.fromCodePoint throw; it must instead
    // keep the escape exactly as written (the parser reports it as BAD_ESCAPE)
    // and leave the trailing characters to be processed normally.
    expect(resolveDoubleQuoted('\\UFFFFFFFF')).toBe('\\UFFFFFFFF')
    // A short/non-hex run must not silently consume the characters that follow it.
    expect(resolveDoubleQuoted('\\xZZ')).toBe('\\xZZ')
    // A valid astral code point still resolves.
    expect(resolveDoubleQuoted('\\U0001F600')).toBe('😀')
  })

  it('folds multi-line flow scalars', () => {
    expect(resolveDoubleQuoted('one\ntwo')).toBe('one two')
    expect(resolveSingleQuoted('one\n\ntwo')).toBe('one\ntwo')
  })

  it('trims trailing spaces and tabs, and returns the same string when there are none', () => {
    expect(trimTrailingSpaces('a b \t ')).toBe('a b')
    expect(trimTrailingSpaces(' \t')).toBe('')
    expect(trimTrailingSpaces('')).toBe('')
    // Interior whitespace is content, and only the tail is trimmed.
    const kept = 'a   b'
    expect(trimTrailingSpaces(kept)).toBe(kept)
  })
})
