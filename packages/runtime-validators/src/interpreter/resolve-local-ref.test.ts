import { describe, expect, it } from 'vitest'

import { resolveLocalRef } from './resolve-local-ref'

describe('resolve-local-ref', () => {
  const root = {
    type: 'object',
    $defs: {
      user: { type: 'object' },
      'weird/key': { type: 'string' },
    },
    definitions: {
      legacy: { type: 'number' },
    },
  }

  it('resolves the whole document for a bare hash', () => {
    expect(resolveLocalRef('#', root)).toBe(root)
    expect(resolveLocalRef('#/', root)).toBe(root)
  })

  it('navigates into $defs', () => {
    expect(resolveLocalRef('#/$defs/user', root)).toBe(root.$defs.user)
  })

  it('navigates into draft-07 definitions', () => {
    expect(resolveLocalRef('#/definitions/legacy', root)).toBe(root.definitions.legacy)
  })

  it('decodes JSON Pointer escapes', () => {
    expect(resolveLocalRef('#/$defs/weird~1key', root)).toBe(root.$defs['weird/key'])
  })

  it('returns undefined for a missing pointer', () => {
    expect(resolveLocalRef('#/$defs/missing', root)).toBeUndefined()
  })

  it('returns undefined for non-local refs', () => {
    expect(resolveLocalRef('https://example.com/schema.json', root)).toBeUndefined()
  })
})
