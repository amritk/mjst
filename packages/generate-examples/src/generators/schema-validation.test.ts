import type { JSONSchema } from 'json-schema-typed/draft-2020-12'
import { describe, expect, it, vi } from 'vitest'

import { makeInstanceCheck, withResolvableDefs } from './schema-validation'

/**
 * Two ways the validity filter can stop filtering without anyone noticing, both
 * of which turn `makeInstanceCheck` into an accept-all that looks exactly like a
 * check that ran and approved:
 *
 * 1. The definitions a schema needs never travel with it, so the guard cannot be
 *    built. Reachability is walked over `$ref`, and `$dynamicRef`/`$recursiveRef`
 *    are invisible to that walk — every 2020-12 recursive schema lost its filter.
 * 2. The guard genuinely cannot be built or run (a `pattern` the ReDoS screen
 *    rejects, a `$ref` out of the fragment). Falling back to "valid" is right;
 *    doing it silently is not.
 *
 * The `$dynamicRef` cases assert on *behaviour* — the guard still rejects a bad
 * value — rather than on `$defs` being present, since a spliced `$defs` the
 * validator cannot use would pass the weaker assertion and still ship the bug.
 */

/** Runs `body` with `console.warn` captured, so a test can assert on the text. */
const captureWarnings = <T>(body: () => T): { result: T; warnings: string[] } => {
  const warnings: string[] = []
  const spy = vi.spyOn(console, 'warn').mockImplementation((message: unknown) => {
    warnings.push(String(message))
  })
  try {
    return { result: body(), warnings }
  } finally {
    spy.mockRestore()
  }
}

describe('schema-validation', () => {
  it('keeps the guard working for a schema whose only reference is a $dynamicRef', () => {
    const root = {
      $defs: { node: { $dynamicAnchor: 'node', type: 'string' } },
      type: 'object',
      properties: { a: { $dynamicRef: '#node' } },
    }
    const check = makeInstanceCheck(root.properties.a as JSONSchema, root)

    expect(check(123)).toBe(false)
    expect(check('ok')).toBe(true)
  })

  it('carries the definitions a $dynamicRef needs, wherever the keyword is buried', () => {
    const root = {
      $defs: { node: { $dynamicAnchor: 'node', type: 'string' } },
      type: 'object',
      properties: {
        a: { type: 'array', items: { allOf: [{ $dynamicRef: '#node' }] } },
      },
    }
    const check = makeInstanceCheck(root.properties.a as JSONSchema, root)

    expect(check([123])).toBe(false)
    expect(check(['ok'])).toBe(true)
  })

  it('carries the definitions when only a reachable definition uses a $dynamicRef', () => {
    const root = {
      $defs: {
        wrapper: { type: 'object', properties: { value: { $dynamicRef: '#node' } }, required: ['value'] },
        node: { $dynamicAnchor: 'node', type: 'string' },
      },
      type: 'object',
      properties: { a: { $ref: '#/$defs/wrapper' } },
    }
    const check = makeInstanceCheck(root.properties.a as JSONSchema, root)

    expect(check({ value: 123 })).toBe(false)
    expect(check({ value: 'ok' })).toBe(true)
  })

  it('splices the root definitions for a $recursiveRef', () => {
    const root = {
      $recursiveAnchor: true,
      $defs: { node: { $recursiveAnchor: true, type: 'string' } },
      type: 'object',
      properties: { a: { $recursiveRef: '#' } },
    }

    expect(withResolvableDefs(root.properties.a as JSONSchema, root)['$defs']).toEqual(root.$defs)
  })

  it('still splices only the reachable definitions when nothing is dynamic', () => {
    const root = {
      $defs: {
        used: { type: 'string' },
        unused: { type: 'number' },
      },
      type: 'object',
      properties: { a: { $ref: '#/$defs/used' } },
    }

    expect(withResolvableDefs(root.properties.a as JSONSchema, root)['$defs']).toEqual({ used: root.$defs.used })
  })

  it('warns when the guard cannot be built at all', () => {
    // The ReDoS screen refuses this pattern up front, so no guard ever exists.
    const schema = { type: 'string', pattern: '^(x+)+y$' } satisfies JSONSchema
    const { result, warnings } = captureWarnings(() => makeInstanceCheck(schema)('anything'))

    expect(result).toBe(true)
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('cannot validate generated values')
    expect(warnings[0]).toContain('^(x+)+y$')
    expect(warnings[0]).toContain('ReDoS')
  })

  it('warns when the guard throws on a value', () => {
    // Builds fine, then fails on the first value: the `$ref` leaves the fragment.
    const schema = { $ref: '#/components/schemas/GuardThrowsProbe' } satisfies JSONSchema
    const { result, warnings } = captureWarnings(() => makeInstanceCheck(schema)('anything'))

    expect(result).toBe(true)
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('cannot validate generated values')
    expect(warnings[0]).toContain('#/components/schemas/GuardThrowsProbe')
  })

  it('reports the same undecidable schema only once', () => {
    const schema = { type: 'string', pattern: '^(repeat+)+once$' } satisfies JSONSchema
    const { warnings } = captureWarnings(() => {
      makeInstanceCheck(schema)('a')
      makeInstanceCheck(schema)('b')
      makeInstanceCheck({ type: 'string', pattern: '^(repeat+)+once$' } satisfies JSONSchema)('c')
    })

    expect(warnings).toHaveLength(1)
  })

  it('says nothing for a schema it can actually decide', () => {
    const schema = { type: 'object', not: { required: ['forbidden'] } } satisfies JSONSchema
    const { result, warnings } = captureWarnings(() => makeInstanceCheck(schema)({ forbidden: 1 }))

    expect(result).toBe(false)
    expect(warnings).toEqual([])
  })
})
