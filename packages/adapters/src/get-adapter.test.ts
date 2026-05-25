import { describe, expect, it } from 'vitest'

import { getAdapter } from './get-adapter'

describe('getAdapter', () => {
  it('returns the TypeBox adapter', () => {
    const adapter = getAdapter('typebox')
    expect(adapter.format).toBe('typebox')
    expect(adapter.toJSONSchema({ type: 'string' })).toEqual({ type: 'string' })
  })

  it('throws an actionable error for not-yet-supported formats', () => {
    expect(() => getAdapter('zod')).toThrow(/No adapter is available for input format 'zod' yet/)
  })
})
