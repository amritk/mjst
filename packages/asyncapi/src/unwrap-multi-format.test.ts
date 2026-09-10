import { describe, expect, it } from 'vitest'

import { unwrapMultiFormat } from './unwrap-multi-format'

describe('unwrap-multi-format', () => {
  it('unwraps a multi format schema object', () => {
    const unwrapped = unwrapMultiFormat({
      schemaFormat: 'application/schema+json;version=draft-07',
      schema: { type: 'object' },
    })
    expect(unwrapped.schemaFormat).toBe('application/schema+json;version=draft-07')
    expect(unwrapped.schema).toEqual({ type: 'object' })
  })

  it('passes a bare schema through', () => {
    const schema = { type: 'object', properties: {} }
    expect(unwrapMultiFormat(schema)).toEqual({ schema })
  })

  it('treats a schema key alone as the wrapper, since schemaFormat is optional on it', () => {
    // The 3.0 meta-schema decides on `schema` alone and defaults the format to
    // the AsyncAPI dialect. Demanding `schemaFormat` too read this as a schema
    // whose only keyword is one no dialect defines, and the payload vanished.
    expect(unwrapMultiFormat({ schema: { type: 'object' } })).toEqual({
      schemaFormat: undefined,
      schema: { type: 'object' },
    })
  })

  it('keeps the body of a schema that carries a schemaFormat but no schema', () => {
    // No `schema` key means no wrapper, so `schemaFormat` here is (odd) schema
    // content — losing the body would drop the author's constraints.
    const schema = { schemaFormat: { type: 'string' }, type: 'object' }
    expect(unwrapMultiFormat(schema)).toEqual({ schema })
  })

  it('reads own properties only, so an inherited schema key is not a wrapper', () => {
    // A payload reaching here has been through trait merging and `$ref`
    // resolution; nothing guarantees it was built with a null prototype.
    const schema = Object.create({ schema: { type: 'string' } }) as Record<string, unknown>
    schema['type'] = 'object'
    expect(unwrapMultiFormat(schema)).toEqual({ schema })
  })

  it('passes primitives and arrays through', () => {
    expect(unwrapMultiFormat(undefined)).toEqual({ schema: undefined })
    expect(unwrapMultiFormat(true)).toEqual({ schema: true })
    expect(unwrapMultiFormat([1])).toEqual({ schema: [1] })
  })
})
