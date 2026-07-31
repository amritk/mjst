import type { JSONSchema } from 'json-schema-typed/draft-2020-12'
import { describe, expect, it, vi } from 'vitest'

import { getMjstBrand, getMjstInstanceOf, getMjstPrimitive, MJST_EXTENSION_KEY } from './mjst-extension'

describe('getMjstInstanceOf', () => {
  it('reads a valid instanceOf class name', () => {
    expect(getMjstInstanceOf({ 'x-mjst': { instanceOf: 'Date' } })).toBe('Date')
  })

  it('returns undefined when the extension is absent', () => {
    expect(getMjstInstanceOf({ type: 'string' })).toBeUndefined()
  })

  it('returns undefined for a boolean schema', () => {
    expect(getMjstInstanceOf(true as unknown as JSONSchema)).toBeUndefined()
  })

  it('rejects instanceOf values that are not safe identifiers', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    expect(getMjstInstanceOf({ 'x-mjst': { instanceOf: 'Date; doEvil()' } })).toBeUndefined()
    expect(getMjstInstanceOf({ 'x-mjst': { instanceOf: '' } })).toBeUndefined()

    warn.mockRestore()
  })

  // An identifier-shaped name was accepted and emitted verbatim, so
  // `NotAGlobalClass` produced a TS2304 plus a runtime ReferenceError and
  // `globalThis` produced `g?: globalThis` (not a type) plus a TypeError from
  // `x instanceof globalThis`. Only classes the generators handle are honoured.
  it('warns about and ignores a class the generators do not support', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    expect(getMjstInstanceOf({ 'x-mjst': { instanceOf: 'NotAGlobalClass' } })).toBeUndefined()
    expect(getMjstInstanceOf({ 'x-mjst': { instanceOf: 'globalThis' } })).toBeUndefined()
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('unsupported x-mjst instanceOf "NotAGlobalClass"'))

    warn.mockRestore()
  })

  it('warns once per unsupported class name rather than once per schema node', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    getMjstInstanceOf({ 'x-mjst': { instanceOf: 'RepeatedClass' } })
    getMjstInstanceOf({ 'x-mjst': { instanceOf: 'RepeatedClass' } })

    expect(warn.mock.calls.filter(([message]) => String(message).includes('RepeatedClass'))).toHaveLength(1)

    warn.mockRestore()
  })

  it('exposes the extension key', () => {
    expect(MJST_EXTENSION_KEY).toBe('x-mjst')
  })
})

describe('getMjstPrimitive', () => {
  it('reads a supported primitive', () => {
    expect(getMjstPrimitive({ 'x-mjst': { primitive: 'bigint' } })).toBe('bigint')
  })

  it('ignores unsupported primitives', () => {
    expect(getMjstPrimitive({ 'x-mjst': { primitive: 'symbol' } })).toBeUndefined()
    expect(getMjstPrimitive({ 'x-mjst': { primitive: 'evil()' } })).toBeUndefined()
  })

  it('returns undefined when the extension is absent', () => {
    expect(getMjstPrimitive({ type: 'string' })).toBeUndefined()
  })
})

describe('getMjstBrand', () => {
  it('reads a safe brand name', () => {
    expect(getMjstBrand({ 'x-mjst': { brand: 'UserId' } })).toBe('UserId')
    expect(getMjstBrand({ 'x-mjst': { brand: 'order-id 2' } })).toBe('order-id 2')
  })

  it('rejects brand names that could break out of a string literal', () => {
    expect(getMjstBrand({ 'x-mjst': { brand: "x'; doEvil()" } })).toBeUndefined()
    expect(getMjstBrand({ 'x-mjst': { brand: 'a\\b' } })).toBeUndefined()
    expect(getMjstBrand({ 'x-mjst': { brand: '' } })).toBeUndefined()
  })

  it('returns undefined when the extension is absent', () => {
    expect(getMjstBrand({ type: 'string' })).toBeUndefined()
  })
})
