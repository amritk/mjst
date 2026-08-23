import { describe, expect, it } from 'vitest'
import { formatList, formatValue } from '#helpers/format-value'

describe('format-value', () => {
  it('quotes a string so the reader knows to type the quotes', () => {
    expect(formatValue('localhost')).toBe('<code>"localhost"</code>')
  })

  it('writes a boolean and a number bare', () => {
    expect(formatValue(true)).toBe('<code>true</code>')
    expect(formatValue(1.5)).toBe('<code>1.5</code>')
  })

  // A default nothing filled in is an empty cell, not the word `null`.
  it('renders an absent default as an empty cell', () => {
    expect(formatValue(undefined)).toBe('')
    expect(formatValue(null)).toBe('')
  })

  // `1e400` interpolates as `Infinity`, which no JSON parser accepts — the
  // reader would be told to type something that cannot be read back.
  it('does not document a number JSON cannot hold', () => {
    // Parsed, not written: `1e400` is a number literal the compiler rounds, and
    // it reaches here the way every schema value does — through `JSON.parse`.
    expect(formatValue(JSON.parse('1e400'))).toBe('<code>null</code>')
    expect(formatValue(Number.NaN)).toBe('<code>null</code>')
  })

  // A raw newline would end the `<table>`'s HTML block mid-row, and every tag
  // after it would render as literal text.
  it('escapes a control character rather than writing it raw', () => {
    expect(formatValue('a\nb')).toBe('<code>"a\\nb"</code>')
    expect(formatValue('<b>')).not.toContain('<b>')
  })

  // A listed `null` is a value in its own right — dropping it would contradict
  // the Type column and leave a dangling separator.
  it('lists a null value rather than blanking it', () => {
    expect(formatList(['a', null, 1])).toBe('<code>"a"</code>, <code>null</code>, <code>1</code>')
  })
})
