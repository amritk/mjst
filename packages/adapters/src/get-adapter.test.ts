import { describe, expect, it } from 'vitest'
import * as zodModule from 'zod'

import { getAdapter } from './get-adapter'

const z = ((zodModule as Record<string, unknown>)['z'] ??
  (zodModule as Record<string, unknown>)['default'] ??
  zodModule) as typeof import('zod')['z']

describe('getAdapter', () => {
  it('returns the TypeBox adapter', () => {
    const adapter = getAdapter('typebox')
    expect(adapter.format).toBe('typebox')
    expect(adapter.toJSONSchema({ type: 'string' })).toEqual({ type: 'string' })
  })

  it('returns the Zod adapter, which converts asynchronously', async () => {
    const adapter = getAdapter('zod')
    expect(adapter.format).toBe('zod')

    const result = await adapter.toJSONSchema(z.object({ name: z.string() }))
    expect(result).toMatchObject({ type: 'object', properties: { name: { type: 'string' } } })
  })

  it('throws an actionable error for not-yet-supported formats', () => {
    expect(() => getAdapter('valibot')).toThrow(/No adapter is available for input format 'valibot' yet/)
  })
})
