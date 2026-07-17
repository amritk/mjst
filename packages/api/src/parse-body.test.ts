import { describe, expect, it } from 'vitest'

import { matchesBodyType, parseFormBody, parseMultipartBody } from './parse-body'
import type { Coercion } from './types'

const plan = (entries: Record<string, Coercion>): ReadonlyMap<string, Coercion> => new Map(Object.entries(entries))

describe('matchesBodyType', () => {
  it('accepts JSON media types including structured suffixes, case- and parameter-insensitively', () => {
    expect(matchesBodyType('application/json', 'json')).toBe(true)
    expect(matchesBodyType('application/json; charset=utf-8', 'json')).toBe(true)
    expect(matchesBodyType('Application/JSON', 'json')).toBe(true)
    expect(matchesBodyType('application/problem+json', 'json')).toBe(true)
    expect(matchesBodyType('text/plain', 'json')).toBe(false)
    expect(matchesBodyType('application/x-www-form-urlencoded', 'json')).toBe(false)
  })

  it('matches form and multipart exactly', () => {
    expect(matchesBodyType('application/x-www-form-urlencoded', 'form')).toBe(true)
    expect(matchesBodyType('application/x-www-form-urlencoded; charset=utf-8', 'form')).toBe(true)
    expect(matchesBodyType('multipart/form-data; boundary=xyz', 'multipart')).toBe(true)
    expect(matchesBodyType('application/json', 'form')).toBe(false)
    expect(matchesBodyType('application/json', 'multipart')).toBe(false)
  })
})

describe('parseFormBody', () => {
  it('parses urlencoded pairs with query-style coercion and array accumulation', () => {
    const body = parseFormBody('name=Ada&age=30&tag=a&tag=b', plan({ age: 'number', tag: 'string-array' }))
    expect(body).toEqual({ name: 'Ada', age: 30, tag: ['a', 'b'] })
  })

  it('decodes + and percent escapes like a browser form post', () => {
    expect(parseFormBody('note=hello+world&sym=%E2%9C%93', new Map())).toEqual({ note: 'hello world', sym: '✓' })
  })

  it('keeps __proto__ as an own property', () => {
    const body = parseFormBody('__proto__=evil', new Map())
    expect(Object.getPrototypeOf(body)).toBe(null)
    expect(body['__proto__']).toBe('evil')
  })
})

describe('parseMultipartBody', () => {
  /** Encodes a FormData the way a browser would, returning bytes + the boundary-carrying header. */
  const encode = async (form: FormData): Promise<{ bytes: Uint8Array; contentType: string }> => {
    const request = new Request('http://localhost/', { method: 'POST', body: form })
    return {
      bytes: new Uint8Array(await request.arrayBuffer()),
      contentType: request.headers.get('content-type') ?? '',
    }
  }

  it('parses string fields with coercion and keeps files as File objects', async () => {
    const form = new FormData()
    form.append('name', 'Ada')
    form.append('age', '30')
    form.append('avatar', new File([new Uint8Array([1, 2, 3])], 'a.png', { type: 'image/png' }))
    const { bytes, contentType } = await encode(form)

    const body = await parseMultipartBody(bytes, contentType, plan({ age: 'number' }))
    expect(body['name']).toBe('Ada')
    expect(body['age']).toBe(30)
    const avatar = body['avatar'] as File
    expect(avatar.name).toBe('a.png')
    expect(avatar.type).toBe('image/png')
    expect(new Uint8Array(await avatar.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]))
  })

  it('accumulates repeated string keys into declared arrays', async () => {
    const form = new FormData()
    form.append('tag', 'a')
    form.append('tag', 'b')
    const { bytes, contentType } = await encode(form)
    expect(await parseMultipartBody(bytes, contentType, plan({ tag: 'string-array' }))).toEqual({ tag: ['a', 'b'] })
  })

  it('throws without a boundary-carrying content type', async () => {
    await expect(parseMultipartBody(new Uint8Array(0), undefined, new Map())).rejects.toThrow(/content-type/)
    await expect(parseMultipartBody(new Uint8Array([1]), 'multipart/form-data', new Map())).rejects.toThrow()
  })
})
