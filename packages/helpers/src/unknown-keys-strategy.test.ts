import { describe, expect, it } from 'vitest'

import { DEFAULT_UNKNOWN_KEYS, isUnknownKeysStrategy, UNKNOWN_KEYS_STRATEGIES } from './unknown-keys-strategy'

describe('unknown-keys-strategy', () => {
  it('accepts every listed strategy', () => {
    for (const strategy of UNKNOWN_KEYS_STRATEGIES) expect(isUnknownKeysStrategy(strategy)).toBe(true)
  })

  it('rejects anything that is not a listed strategy', () => {
    for (const value of ['count', 'for-in', '', 42, null, undefined, ['count-keys']]) {
      expect(isUnknownKeysStrategy(value), JSON.stringify(value)).toBe(false)
    }
  })

  // Bun is the runtime this repo benches on, and `Object.keys` is the form that
  // never loses there — pinned so a default flipped for a Node number is a
  // deliberate change, not an accident.
  it('defaults to counting own keys with Object.keys', () => {
    expect(DEFAULT_UNKNOWN_KEYS).toBe('count-keys')
    expect(isUnknownKeysStrategy(DEFAULT_UNKNOWN_KEYS)).toBe(true)
  })
})
