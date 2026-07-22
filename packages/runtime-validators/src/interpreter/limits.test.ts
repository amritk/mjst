import { describe, expect, it } from 'vitest'
import { assert } from '@/assert'
import { hasUnsafeRegex, isValidationLimitError } from '@/interpreter/limits'
import { validate } from '@/validate'
import { validateGuard } from '@/validate-guard'

/**
 * Builds a value nested `depth` arrays deep, bottoming out at `[]` so every
 * level is an array — valid against `{ type: 'array', items: { $ref: '#' } }`
 * (a value that bottoms out at a non-array would be legitimately invalid).
 */
const nest = (depth: number): unknown => {
  let value: unknown = []
  for (let i = 0; i < depth; i++) value = [value]
  return value
}

/** Builds an `anyOf` tree nested `depth` deep — `2^depth` branch evaluations against one value. */
const nestedAnyOf = (depth: number): unknown => {
  let schema: unknown = { type: 'string' }
  for (let i = 0; i < depth; i++) schema = { anyOf: [schema, schema] }
  return schema
}

describe('limits', () => {
  it('flags nested unbounded quantifiers as unsafe and leaves ordinary patterns alone', () => {
    for (const unsafe of ['(a+)+', '(a*)*', '(a+)*', '(\\d+)+$', '([a-z]+)+', '((a+))+']) {
      expect(hasUnsafeRegex(unsafe), unsafe).toBe(true)
    }
    for (const safe of ['a+', '[a-z]+', '(abc)+', '^\\d{1,3}$', '(a|b)+', 'a+b+c+', '\\w+@\\w+', '.*']) {
      expect(hasUnsafeRegex(safe), safe).toBe(false)
    }
  })

  it('refuses to build a validator from a schema with a catastrophic pattern', () => {
    expect(() => validate({ type: 'string', pattern: '(a+)+$' })).toThrow(/catastrophic backtracking|ReDoS/i)
    expect(() => validateGuard({ type: 'object', patternProperties: { '(a+)+': { type: 'string' } } })).toThrow(
      /ReDoS|backtracking/i,
    )
    // Nested inside a subschema is still found.
    expect(() => validate({ properties: { name: { pattern: '(x*)*' } } })).toThrow()
  })

  it('lets an unsafe pattern through when explicitly opted in', () => {
    const validator = validate({ type: 'string', pattern: '(a+)+$' }, { limits: { allowUnsafePatterns: true } })
    expect(validator('aaaa')).toBe(true)
  })

  it('does not mistake a regex-shaped string in const/enum data for a pattern', () => {
    // `(a+)+` here is a data constant, not a `pattern` keyword — must not be screened.
    expect(validate({ const: '(a+)+' })('(a+)+')).toBe(true)
    expect(validate({ enum: ['(a*)*', 'ok'] })('ok')).toBe(true)
  })

  it('rejects deeply nested data against a recursive schema instead of overflowing the stack', () => {
    const guard = validateGuard({ type: 'array', items: { $ref: '#' } })
    let thrown: unknown
    try {
      guard(nest(20_000))
    } catch (error) {
      thrown = error
    }
    expect(isValidationLimitError(thrown)).toBe(true)
    expect((thrown as Error).message).toMatch(/maximum depth/i)
  })

  it('still validates realistically nested data under the depth cap', () => {
    const guard = validateGuard({ type: 'array', items: { $ref: '#' } })
    expect(guard(nest(100))).toBe(true)
  })

  it('honors a custom maxDepth', () => {
    const guard = validateGuard({ type: 'array', items: { $ref: '#' } }, { limits: { maxDepth: 10 } })
    expect(guard(nest(3))).toBe(true)
    expect(() => guard(nest(50))).toThrow(/maximum depth/i)
  })

  it('stops an exponential anyOf/oneOf blow-up via the step budget', () => {
    // 2^40 branch evaluations against one value — must trip the budget in well
    // under a second rather than hang. A small maxSteps keeps the test snappy.
    const validator = validate(nestedAnyOf(40), { limits: { maxSteps: 50_000 } })
    let thrown: unknown
    try {
      validator(123)
    } catch (error) {
      thrown = error
    }
    expect(isValidationLimitError(thrown)).toBe(true)
    expect((thrown as Error).message).toMatch(/step budget/i)
  })

  it('trips the default step budget on an exponential schema', () => {
    // No custom limit: the default budget must still stop it (and quickly).
    expect(() => validate(nestedAnyOf(40))(123)).toThrow(/step budget/i)
  })

  it('validates a large array of distinct objects with uniqueItems in ~linear time', () => {
    const items = Array.from({ length: 20_000 }, (_, i) => ({ id: i, tag: `t${i}` }))
    // The old O(n²) pairwise scan would be ~4×10⁸ comparisons; the hash-bucketed
    // path settles distinct objects in ~O(n) and must not trip the step budget.
    expect(validate({ type: 'array', uniqueItems: true })(items)).toBe(true)
  })

  it('still detects duplicate objects, order-independently, under uniqueItems', () => {
    const dup = validate({ type: 'array', uniqueItems: true })
    expect(dup([{ a: 1 }, { a: 2 }, { a: 1 }])).not.toBe(true)
    // Key order must not matter — deepEqual semantics preserved by the hash path.
    expect(
      dup([
        { a: 1, b: 2 },
        { b: 2, a: 1 },
      ]),
    ).not.toBe(true)
    expect(dup([{ a: 1 }, { a: 2 }])).toBe(true)
    // NaN equals itself (SameValueZero), so two NaN elements are duplicates.
    expect(dup([Number.NaN, Number.NaN])).not.toBe(true)
  })

  it('surfaces a limit breach through assert as a throw', () => {
    expect(() => assert(nestedAnyOf(40), 123, { limits: { maxSteps: 50_000 } })).toThrow(/step budget/i)
  })
})
