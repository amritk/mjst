import { describe, expect, it } from 'vitest'

import { formBodySerializer } from './form-body-serializer'

describe('form-body-serializer', () => {
  it('registers for the form bodyType', () => {
    expect(formBodySerializer.bodyType).toBe('form')
    // URLSearchParams carries its own content-type header, so none is declared.
    expect(formBodySerializer.contentType).toBeUndefined()
  })

  it('serializes to urlencoded pairs with array repeats', () => {
    const body = formBodySerializer.serialize({ name: 'Ada', age: 30, tags: ['a', 'b'] })
    expect(body).toBeInstanceOf(URLSearchParams)
    expect(String(body)).toBe('name=Ada&age=30&tags=a&tags=b')
  })
})
