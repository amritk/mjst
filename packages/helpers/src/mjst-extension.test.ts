import type { JSONSchema } from 'json-schema-typed/draft-2020-12'
import { describe, expect, it } from 'vitest'

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
    expect(getMjstInstanceOf({ 'x-mjst': { instanceOf: 'Date; doEvil()' } })).toBeUndefined()
    expect(getMjstInstanceOf({ 'x-mjst': { instanceOf: '' } })).toBeUndefined()
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
