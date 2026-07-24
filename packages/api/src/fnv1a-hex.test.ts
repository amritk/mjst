import { describe, expect, it } from 'vitest'

import { fnv1aHex, fnv1aHexBytes } from './fnv1a-hex'

describe('fnv1a-hex', () => {
  it('hashes the empty string to the FNV offset basis', () => {
    expect(fnv1aHex('')).toBe('811c9dc5')
  })

  it('matches the published FNV-1a test vectors for ASCII input', () => {
    // Reference values from the classic FNV test suite — ASCII input hashes
    // identically whether iterated as bytes or UTF-16 code units.
    expect(fnv1aHex('a')).toBe('e40c292c')
    expect(fnv1aHex('foobar')).toBe('bf9cf968')
  })

  it('is deterministic and stable across calls', () => {
    const input = JSON.stringify({ openapi: '3.1.0', paths: { '/users': {} } })
    expect(fnv1aHex(input)).toBe(fnv1aHex(input))
  })

  it('produces different hashes for different documents', () => {
    expect(fnv1aHex('{"a":1}')).not.toBe(fnv1aHex('{"a":2}'))
  })

  it('always yields exactly 8 lowercase hex digits', () => {
    for (const input of ['', 'x', 'a longer input string', '🚀 non-ascii ✓']) {
      expect(fnv1aHex(input)).toMatch(/^[0-9a-f]{8}$/)
    }
  })

  it('handles non-ascii input deterministically', () => {
    expect(fnv1aHex('héllo ✓')).toBe(fnv1aHex('héllo ✓'))
    expect(fnv1aHex('héllo ✓')).not.toBe(fnv1aHex('hello ?'))
  })
})

describe('fnv1a-hex-bytes', () => {
  it('hashes empty bytes to the FNV offset basis', () => {
    expect(fnv1aHexBytes(new Uint8Array())).toBe('811c9dc5')
  })

  it('matches the string hash for ASCII input', () => {
    expect(fnv1aHexBytes(new TextEncoder().encode('foobar'))).toBe(fnv1aHex('foobar'))
  })

  it('distinguishes bytes that would collide once decoded to text', () => {
    // 0xFF and 0xFE are both lone invalid UTF-8 bytes that TextDecoder maps to
    // U+FFFD — decoding first would collide them; hashing the bytes does not.
    expect(fnv1aHexBytes(new Uint8Array([0xff]))).not.toBe(fnv1aHexBytes(new Uint8Array([0xfe])))
  })

  it('always yields exactly 8 lowercase hex digits', () => {
    for (const bytes of [new Uint8Array(), new Uint8Array([0]), new Uint8Array([0xff, 0x00, 0x80])]) {
      expect(fnv1aHexBytes(bytes)).toMatch(/^[0-9a-f]{8}$/)
    }
  })
})
