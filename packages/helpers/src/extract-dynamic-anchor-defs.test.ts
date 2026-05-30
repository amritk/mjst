import { describe, expect, it } from 'vitest'

import { extractDynamicAnchorDefs } from './extract-dynamic-anchor-defs'

describe('extract-dynamic-anchor-defs', () => {
  it('collects refs for every $defs entry with a $dynamicAnchor', () => {
    const schema = {
      $defs: {
        schema: { $dynamicAnchor: 'meta', type: 'object' },
        contact: { type: 'object' },
        node: { $dynamicAnchor: 'node', type: 'string' },
      },
    }

    expect(extractDynamicAnchorDefs(schema)).toEqual(['#/$defs/schema', '#/$defs/node'])
  })

  it('returns an empty array when no $defs are present', () => {
    expect(extractDynamicAnchorDefs({ type: 'object' })).toEqual([])
  })

  it('returns an empty array when no definition has a $dynamicAnchor', () => {
    expect(extractDynamicAnchorDefs({ $defs: { a: { type: 'string' } } })).toEqual([])
  })

  it('ignores a non-object schema', () => {
    expect(extractDynamicAnchorDefs(true)).toEqual([])
  })
})
