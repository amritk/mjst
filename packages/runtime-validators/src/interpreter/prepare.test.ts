import { describe, expect, it } from 'vitest'
import { prepareValidator } from '@/interpreter/prepare'

describe('prepare', () => {
  it('hands back the same validator for the same schema and configuration', () => {
    const schema = { type: 'object', properties: { a: { type: 'string' } } }
    expect(prepareValidator(schema, undefined, false)).toBe(prepareValidator(schema, undefined, false))
    // Mode and formats are part of the key, so these are genuinely different validators.
    expect(prepareValidator(schema, undefined, true)).not.toBe(prepareValidator(schema, undefined, false))
    expect(prepareValidator(schema, { formats: 'all' }, false)).not.toBe(prepareValidator(schema, undefined, false))
  })

  it('stops caching past a bounded number of configurations for one schema', () => {
    // The per-schema cache lives as long as the schema, so an unbounded one leaks:
    // a caller deriving `limits` per request mints a new key every call and pins a
    // validator forever. Past the cap we simply hand back a fresh validator — the
    // cache could never have helped a caller varying its configuration per call.
    const schema = { type: 'string' }
    for (let i = 0; i < 200; i++) prepareValidator(schema, { limits: { maxSteps: 1000 + i } }, false)

    const late = { limits: { maxSteps: 999_999 } }
    expect(prepareValidator(schema, late, false)).not.toBe(prepareValidator(schema, late, false))
    // Uncached still means correct.
    expect(prepareValidator(schema, late, false)('hello')).toBe(true)
    expect(prepareValidator(schema, late, false)(42)).toBe(false)
  })

  it('caches the first configurations a schema is asked for', () => {
    const schema = { type: 'number' }
    const first = { limits: { maxDepth: 42 } }
    expect(prepareValidator(schema, first, false)).toBe(prepareValidator(schema, first, false))
  })
})
