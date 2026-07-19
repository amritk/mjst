import { describe, expect, it } from 'vitest'

import { multipartBodySerializer } from './multipart-body-serializer'

describe('multipart-body-serializer', () => {
  it('registers for the multipart bodyType', () => {
    expect(multipartBodySerializer.bodyType).toBe('multipart')
    // FormData's content-type must carry the boundary, so fetch stamps it.
    expect(multipartBodySerializer.contentType).toBeUndefined()
  })

  it('keeps File parts intact and stringifies the rest', () => {
    const file = new File([new Uint8Array(5)], 'r.bin')
    const data = multipartBodySerializer.serialize({
      title: 'report',
      attachment: file,
      tags: ['a', 'b'],
      missing: undefined,
    })
    expect(data).toBeInstanceOf(FormData)
    const form = data as FormData
    expect(form.get('title')).toBe('report')
    expect(form.get('attachment')).toBeInstanceOf(File)
    expect(form.getAll('tags')).toEqual(['a', 'b'])
    expect(form.has('missing')).toBe(false)
  })
})
