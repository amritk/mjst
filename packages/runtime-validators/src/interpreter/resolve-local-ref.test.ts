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

  it('does not resolve inherited prototype members', () => {
    // `in` would find `toString`/`constructor` on the prototype chain and resolve
    // to a function, which the interpreter treats as an accept-anything schema.
    // Own-property lookup makes these mistyped pointers fail loudly instead.
    expect(resolveLocalRef('#/toString', root)).toBeUndefined()
    expect(resolveLocalRef('#/constructor', root)).toBeUndefined()
    expect(resolveLocalRef('#/$defs/user/__proto__', root)).toBeUndefined()
    expect(resolveLocalRef('#/$defs/hasOwnProperty', root)).toBeUndefined()
  })

  it('resolves array-index tokens but rejects non-index tokens into arrays', () => {
    const withTuple = { prefixItems: [{ type: 'string' }, { type: 'number' }] }
    expect(resolveLocalRef('#/prefixItems/0', withTuple)).toBe(withTuple.prefixItems[0])
    expect(resolveLocalRef('#/prefixItems/1', withTuple)).toBe(withTuple.prefixItems[1])
    // Out-of-range and non-index tokens (e.g. `length`) must not resolve.
    expect(resolveLocalRef('#/prefixItems/2', withTuple)).toBeUndefined()
    expect(resolveLocalRef('#/prefixItems/length', withTuple)).toBeUndefined()
    expect(resolveLocalRef('#/prefixItems/01', withTuple)).toBeUndefined()
  })

  it('returns undefined for non-local refs', () => {
    expect(resolveLocalRef('https://example.com/schema.json', root)).toBeUndefined()
  })

  it('resolves a plain-name fragment via $anchor search', () => {
    const anchored = {
      type: 'object',
      $defs: { node: { $anchor: 'node', type: 'object' } },
    }
    expect(resolveLocalRef('#node', anchored)).toBe(anchored.$defs.node)
    expect(resolveLocalRef('#missing', anchored)).toBeUndefined()
  })
})
