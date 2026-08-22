import { describe, expect, it } from 'vitest'

import { aas2, aas2_0, aas2_6, aas3, aas3_0, aasFormats } from './formats'

const doc = (asyncapi: unknown): unknown => ({ asyncapi })

describe('asyncapi formats', () => {
  it('matches a major by its version prefix', () => {
    expect(aas2(doc('2.0.0'))).toBe(true)
    expect(aas2(doc('2.6.0'))).toBe(true)
    expect(aas3(doc('3.0.0'))).toBe(true)
    expect(aas2(doc('3.0.0'))).toBe(false)
    expect(aas3(doc('2.6.0'))).toBe(false)
  })

  it('matches a minor exactly, without mistaking 2.10 for 2.1', () => {
    expect(aas2_0(doc('2.0.0'))).toBe(true)
    expect(aas2_0(doc('2.0'))).toBe(true)
    expect(aas2_6(doc('2.6.4'))).toBe(true)
    expect(aas2_0(doc('2.6.0'))).toBe(false)
    expect(aasFormats['aas2.1']?.(doc('2.10.0'))).toBe(false)
    // A minor with no bundled schema still belongs to its major, so the style
    // rules keep running on it.
    expect(aas2(doc('2.10.0'))).toBe(true)
  })

  it('matches nothing when there is no asyncapi version to read', () => {
    for (const format of [aas2, aas3, aas2_0, aas3_0]) {
      expect(format(doc(undefined))).toBe(false)
      expect(format(doc(3))).toBe(false)
      expect(format({ openapi: '3.0.0' })).toBe(false)
      expect(format(null)).toBe(false)
      expect(format('2.0.0')).toBe(false)
      expect(format([])).toBe(false)
    }
  })

  it('exposes both the dotted and underscored spelling of every minor', () => {
    for (const [dotted, underscored] of [
      ['aas2.0', 'aas2_0'],
      ['aas2.6', 'aas2_6'],
      ['aas3.0', 'aas3_0'],
    ]) {
      expect(aasFormats[dotted as string]).toBe(aasFormats[underscored as string])
    }
  })
})
