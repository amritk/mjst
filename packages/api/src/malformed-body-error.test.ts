import { describe, expect, it } from 'vitest'

import { isMalformedBodyError, malformedBodyError } from './malformed-body-error'

describe('malformed-body-error', () => {
  it('builds a plain Error that the guard recognizes and narrows', () => {
    const response = new Response('not json', { status: 200 })
    const parseError = new SyntaxError('Unexpected token')
    const error = malformedBodyError('getUser', response, parseError)
    expect(error).toBeInstanceOf(Error)
    expect(error.message).toBe("Malformed body for 200 response of 'getUser'")
    expect(error.cause).toBe(parseError)
    expect(isMalformedBodyError(error)).toBe(true)
    if (isMalformedBodyError(error)) expect(error.response).toBe(response)
  })

  it('rejects unrelated values', () => {
    expect(isMalformedBodyError(new Error('nope'))).toBe(false)
    expect(isMalformedBodyError(undefined)).toBe(false)
    expect(isMalformedBodyError({ response: new Response() })).toBe(false)
  })
})
