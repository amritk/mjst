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

  it('requires both wrapper keys, so a schema with a schemaFormat property keeps its body', () => {
    // Without `schema` beside it, `schemaFormat` here is (odd) schema content,
    // not a wrapper — losing the body would drop the author's constraints.
    const schema = { schemaFormat: { type: 'string' }, type: 'object' }
    expect(unwrapMultiFormat(schema)).toEqual({ schema })
  })

  it('passes primitives and arrays through', () => {
    expect(unwrapMultiFormat(undefined)).toEqual({ schema: undefined })
    expect(unwrapMultiFormat(true)).toEqual({ schema: true })
    expect(unwrapMultiFormat([1])).toEqual({ schema: [1] })
  })
})
