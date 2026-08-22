import { describe, expect, it } from 'vitest'

import { aas2, aas2_0, aas2_6, aas3, aas3_0, aasFormats } from './formats'
import { ASYNCAPI_VERSIONS } from './schemas'

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

  it('exposes both the dotted and underscored spelling of every bundled minor', () => {
    // Driven off the bundled version list rather than a hand-written trio, which
    // left 2.2–2.5 with no coverage at all.
    for (const version of ASYNCAPI_VERSIONS) {
      const dotted = `aas${version}`
      const underscored = `aas${version.replace('.', '_')}`
      expect(aasFormats[dotted], dotted).toBeDefined()
      expect(aasFormats[dotted], version).toBe(aasFormats[underscored])
      expect(aasFormats[dotted]?.({ asyncapi: `${version}.0` }), version).toBe(true)
    }
  })

  it('does not treat a different major as 2.x or 3.x', () => {
    // `/^2\.\d/` rather than `/^2/`: a hypothetical 20.x must not inherit the
    // 2.x ruleset.
    expect(aas2({ asyncapi: '20.0.0' })).toBe(false)
    expect(aas3({ asyncapi: '30.0.0' })).toBe(false)
    expect(aas2({ asyncapi: '2' })).toBe(false)
  })
})
