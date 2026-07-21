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

  it("recognizes Fastify's body-limit error", () => {
    const error = Object.assign(new Error('Request body is too large'), { code: 'FST_ERR_CTP_BODY_TOO_LARGE' })
    expect(isPayloadTooLargeError(error)).toBe(true)
  })

  it("recognizes Express body-parser's entity.too.large error", () => {
    const error = Object.assign(new Error('request entity too large'), { type: 'entity.too.large', statusCode: 413 })
    expect(isPayloadTooLargeError(error)).toBe(true)
  })

  it('recognizes a plain HTTP error carrying a 413 status', () => {
    expect(isPayloadTooLargeError(Object.assign(new Error('too large'), { statusCode: 413 }))).toBe(true)
    expect(isPayloadTooLargeError(Object.assign(new Error('too large'), { status: 413 }))).toBe(true)
  })

  it('does not remap other framework errors or statuses', () => {
    expect(isPayloadTooLargeError(Object.assign(new Error('bad'), { code: 'FST_ERR_VALIDATION' }))).toBe(false)
    expect(isPayloadTooLargeError(Object.assign(new Error('bad'), { statusCode: 400 }))).toBe(false)
    expect(isPayloadTooLargeError(Object.assign(new Error('bad'), { status: 500 }))).toBe(false)
  })
})
