import { describe, expect, it } from 'vitest'

import { isUnexpectedStatusError, unexpectedStatusError } from './unexpected-status-error'

describe('unexpected-status-error', () => {
  it('builds a plain Error that the guard recognizes and narrows', () => {
    const response = new Response('{"error":"validation_failed"}', { status: 400 })
    const error = unexpectedStatusError('getUser', response)
    expect(error).toBeInstanceOf(Error)
    expect(error.message).toBe("Undeclared 400 response for 'getUser'")
    expect(isUnexpectedStatusError(error)).toBe(true)
    if (isUnexpectedStatusError(error)) expect(error.response).toBe(response)
  })

  it('rejects unrelated values', () => {
    expect(isUnexpectedStatusError(new Error('nope'))).toBe(false)
    expect(isUnexpectedStatusError(undefined)).toBe(false)
    expect(isUnexpectedStatusError({ response: new Response() })).toBe(false)
  })
})
