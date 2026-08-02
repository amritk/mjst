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

  it('keys the cache on the registry, so two registries never share a validator', () => {
    // A stale hit here would be a silently wrong verdict: same schema, same
    // options, but a `$ref` resolved against somebody else's document.
    const schema = { $ref: 'https://example.com/a.json' }
    const first = { schemas: { 'https://example.com/a.json': { type: 'string' } } }
    const second = { schemas: { 'https://example.com/a.json': { type: 'number' } } }

    expect(prepareValidator(schema, first, false)).toBe(prepareValidator(schema, first, false))
    expect(prepareValidator(schema, second, false)).not.toBe(prepareValidator(schema, first, false))
    expect(prepareValidator(schema, first, false)('x')).toBe(true)
    expect(prepareValidator(schema, second, false)('x')).toBe(false)
    // And no registry at all is a third, distinct configuration.
    expect(prepareValidator(schema, undefined, false)).not.toBe(prepareValidator(schema, first, false))
  })

  it('notices a document added to a registry it has already seen', () => {
    // The contract is that a registry is immutable once passed, but building one
    // up across calls is the mistake that contract invites — so the URI set is
    // part of the key and an added document is a miss rather than a stale hit.
    const schema = { $ref: 'https://example.com/b.json' }
    const schemas: Record<string, unknown> = {}
    const options = { schemas }

    const before = prepareValidator(schema, options, false)
    schemas['https://example.com/b.json'] = { type: 'string' }

    expect(prepareValidator(schema, options, false)).not.toBe(before)
    expect(prepareValidator(schema, options, false)('x')).toBe(true)
  })

  it('caches the first configurations a schema is asked for', () => {
    const schema = { type: 'number' }
    const first = { limits: { maxDepth: 42 } }
    expect(prepareValidator(schema, first, false)).toBe(prepareValidator(schema, first, false))
  })
})
