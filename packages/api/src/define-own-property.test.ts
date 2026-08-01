import { describe, expect, it } from 'vitest'

import { defineOwnProperty } from './define-own-property'

describe('define-own-property', () => {
  it('writes an ordinary key like a plain assignment', () => {
    const record: Record<string, unknown> = {}
    defineOwnProperty(record, 'session', 'abc')
    expect(record).toEqual({ session: 'abc' })
  })

  // The whole reason this function exists: `record['__proto__'] = value` runs
  // the prototype setter, so the entry never becomes a property at all.
  it('writes __proto__ as an own property instead of hitting the prototype setter', () => {
    const record: Record<string, unknown> = {}
    defineOwnProperty(record, '__proto__', 'kept')
    expect(Object.getOwnPropertyNames(record)).toEqual(['__proto__'])
    expect(Object.hasOwn(record, '__proto__')).toBe(true)
    expect(record['__proto__']).toBe('kept')
    expect(Object.getPrototypeOf(record)).toBe(Object.prototype)
  })

  // An object value is the case a plain assignment would actually act on —
  // it would replace the prototype rather than be ignored.
  it('leaves the prototype alone even when the value is an object', () => {
    const record: Record<string, unknown> = {}
    defineOwnProperty(record, '__proto__', { polluted: true })
    expect(Object.getPrototypeOf(record)).toBe(Object.prototype)
    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined()
    expect(record['__proto__']).toEqual({ polluted: true })
  })

  it('overwrites a previously defined __proto__ rather than throwing', () => {
    const record: Record<string, unknown> = {}
    defineOwnProperty(record, '__proto__', 'first')
    defineOwnProperty(record, '__proto__', 'second')
    expect(record['__proto__']).toBe('second')
  })

  // Other prototype members are ordinary writable properties, so they need no
  // special handling — the guard is deliberately narrow.
  it('writes other prototype-shadowing names normally', () => {
    const record: Record<string, unknown> = {}
    defineOwnProperty(record, 'toString', 'ok')
    expect(Object.hasOwn(record, 'toString')).toBe(true)
    expect(record['toString']).toBe('ok')
  })
})
