import { describe, expect, it } from 'vitest'

import { detectAsyncApiVersion } from './detect-version'

describe('detect-version', () => {
  it('classifies 2.x and 3.x majors', () => {
    expect(detectAsyncApiVersion({ asyncapi: '2.0.0' })).toEqual({ major: 2, version: '2.0.0' })
    expect(detectAsyncApiVersion({ asyncapi: '2.6.0' })).toEqual({ major: 2, version: '2.6.0' })
    expect(detectAsyncApiVersion({ asyncapi: '3.0.0' })).toEqual({ major: 3, version: '3.0.0' })
  })

  it('rejects non-documents and other versions', () => {
    expect(detectAsyncApiVersion(undefined)).toBeUndefined()
    expect(detectAsyncApiVersion(null)).toBeUndefined()
    expect(detectAsyncApiVersion('2.6.0')).toBeUndefined()
    expect(detectAsyncApiVersion([])).toBeUndefined()
    expect(detectAsyncApiVersion({})).toBeUndefined()
    expect(detectAsyncApiVersion({ asyncapi: 2.6 })).toBeUndefined()
    expect(detectAsyncApiVersion({ asyncapi: '4.0.0' })).toBeUndefined()
    expect(detectAsyncApiVersion({ openapi: '3.1.0' })).toBeUndefined()
  })

  it('anchors the major, so 20.x is not 2.x', () => {
    expect(detectAsyncApiVersion({ asyncapi: '20.0.0' })).toBeUndefined()
  })

  it('reads own properties only', () => {
    // A prototype-planted `asyncapi` must not make plain objects documents.
    const polluted = Object.create({ asyncapi: '2.6.0' }) as Record<string, unknown>
    expect(detectAsyncApiVersion(polluted)).toBeUndefined()
  })
})
