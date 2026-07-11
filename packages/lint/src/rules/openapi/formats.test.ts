import { describe, expect, it } from 'vitest'

import { oas2, oas3, oas3_0, oas3_1, oas3_2 } from './formats'

describe('formats', () => {
  it('matches Swagger 2.0 only for the exact string version', () => {
    expect(oas2({ swagger: '2.0' })).toBe(true)
    expect(oas2({ swagger: 2.0 })).toBe(false)
    expect(oas2({ openapi: '3.0.0' })).toBe(false)
  })

  it('matches every 3.x document under oas3', () => {
    expect(oas3({ openapi: '3.0.0' })).toBe(true)
    expect(oas3({ openapi: '3.1.0' })).toBe(true)
    expect(oas3({ openapi: '3.2.0' })).toBe(true)
    expect(oas3({ swagger: '2.0' })).toBe(false)
  })

  it('anchors minor versions so 3.10.x is not mistaken for 3.1.x', () => {
    // The bug this guards: a prefix check (`startsWith('3.1')`) would classify
    // `3.10.0` as OpenAPI 3.1.
    expect(oas3_1({ openapi: '3.10.0' })).toBe(false)
    expect(oas3_0({ openapi: '3.10.0' })).toBe(false)
    expect(oas3_2({ openapi: '3.20.0' })).toBe(false)
    // But a real 3.10 document is still recognized as generic 3.x.
    expect(oas3({ openapi: '3.10.0' })).toBe(true)
  })

  it('matches the intended minor version exactly', () => {
    expect(oas3_0({ openapi: '3.0.3' })).toBe(true)
    expect(oas3_1({ openapi: '3.1.0' })).toBe(true)
    expect(oas3_2({ openapi: '3.2.0' })).toBe(true)
    expect(oas3_1({ openapi: '3.0.0' })).toBe(false)
  })

  it('treats a bare minor (no patch) as that minor version', () => {
    expect(oas3_1({ openapi: '3.1' })).toBe(true)
    expect(oas3_0({ openapi: '3.0' })).toBe(true)
  })

  it('ignores documents with a non-string or missing version', () => {
    expect(oas3({ openapi: 3 })).toBe(false)
    expect(oas3_1({ openapi: null })).toBe(false)
    expect(oas3({})).toBe(false)
    expect(oas2('not an object')).toBe(false)
  })
})
