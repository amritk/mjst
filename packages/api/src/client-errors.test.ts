import { describe, expect, it } from 'vitest'

import {
  isMalformedBodyError,
  isUnexpectedStatusError,
  malformedBodyError,
  unexpectedStatusError,
} from './client-errors'

describe('client-errors', () => {
  it('builds a malformed-body error that the guard recognizes and narrows', () => {
    const response = new Response('not json', { status: 200 })
    const parseError = new SyntaxError('Unexpected token')
    const error = malformedBodyError('getUser', response, parseError)
    expect(error).toBeInstanceOf(Error)
    expect(error.name).toBe('MalformedBodyError')
    expect(error.message).toBe("Malformed body for 200 response of 'getUser'")
    expect(error.cause).toBe(parseError)
    expect(isMalformedBodyError(error)).toBe(true)
    if (isMalformedBodyError(error)) expect(error.response).toBe(response)
  })

  it('builds an unexpected-status error that the guard recognizes and narrows', () => {
    const response = new Response('{"error":"validation_failed"}', { status: 400 })
    const error = unexpectedStatusError('getUser', response)
    expect(error).toBeInstanceOf(Error)
    expect(error.name).toBe('UnexpectedStatusError')
    expect(error.message).toBe("Undeclared 400 response for 'getUser'")
    expect(isUnexpectedStatusError(error)).toBe(true)
    if (isUnexpectedStatusError(error)) expect(error.response).toBe(response)
  })

  it('keeps the two markers distinct — one guard never matches the other error', () => {
    const malformed = malformedBodyError('a', new Response(), new SyntaxError('x'))
    const unexpected = unexpectedStatusError('a', new Response())
    expect(isUnexpectedStatusError(malformed)).toBe(false)
    expect(isMalformedBodyError(unexpected)).toBe(false)
  })

  it('rejects unrelated values', () => {
    expect(isMalformedBodyError(new Error('nope'))).toBe(false)
    expect(isMalformedBodyError(undefined)).toBe(false)
    expect(isMalformedBodyError({ response: new Response() })).toBe(false)
    expect(isUnexpectedStatusError(new Error('nope'))).toBe(false)
    expect(isUnexpectedStatusError(undefined)).toBe(false)
    expect(isUnexpectedStatusError({ response: new Response() })).toBe(false)
  })
})
