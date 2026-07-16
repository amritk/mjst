import { describe, expect, it } from 'vitest'

import { isPayloadTooLargeError, payloadTooLargeError } from './payload-too-large'

describe('payload-too-large', () => {
  it('recognizes its own errors', () => {
    expect(isPayloadTooLargeError(payloadTooLargeError(1024))).toBe(true)
  })

  it('mentions the limit in the message', () => {
    expect(payloadTooLargeError(2048).message).toContain('2048')
  })

  it('does not match ordinary errors or non-errors', () => {
    expect(isPayloadTooLargeError(new Error('boom'))).toBe(false)
    expect(isPayloadTooLargeError(undefined)).toBe(false)
    expect(isPayloadTooLargeError('payload too large')).toBe(false)
  })
})
