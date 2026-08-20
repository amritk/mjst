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

/** Wraps `leaf` in `depth` levels of `{ not: … }` — a schema deep enough to overflow a recursive walk. */
const nestedSchema = (depth: number, leaf: unknown = { type: 'string' }): unknown => {
  let schema = leaf
  for (let i = 0; i < depth; i++) schema = { not: schema }
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

  it('screens the patterns in a registered document too', () => {
    // A document the caller loaded from elsewhere is a schema this validator will
    // really run, so it gets the same up-front screen as the one under validation.
    expect(() =>
      validate(
        { $ref: 'https://example.com/lib.json' },
        { schemas: { 'https://example.com/lib.json': { pattern: '(a+)+$' } } },
      ),
    ).toThrow(/catastrophic backtracking|ReDoS/i)
  })

  it('lets an unsafe pattern through when explicitly opted in', () => {
    const validator = validate({ type: 'string', pattern: '(a+)+$' }, { limits: { allowUnsafePatterns: true } })
    expect(validator('aaaa')).toBe(true)
  })

  it('flags an ambiguous alternation repeated by an unbounded quantifier', () => {
    // Star height 1, so the nested-quantifier rule misses these entirely — yet
    // `/^(a|a)+$/.test('a'.repeat(28) + '!')` takes well over a second, doubling
    // with each added character. Two branches that provably match the same single
    // character give an n-character input 2^n parses.
    for (const unsafe of ['^(a|a)+$', '(a|[a-z])+', '(x|\\w)*', '(\\.|.)+', '(ab|ab)+', '(5|\\d){1,}']) {
      expect(hasUnsafeRegex(unsafe), unsafe).toBe(true)
    }
    // A bounded quantifier caps the blow-up (2^10 parses), so it is not flagged.
    expect(hasUnsafeRegex('(a|a){1,10}')).toBe(false)
    // Documenting the gap, not endorsing it: the screen only proves ambiguity when
    // one branch is a single literal character, so two overlapping *classes* get
    // through even though they are genuinely exponential. See the module comment.
    expect(hasUnsafeRegex('([0-9]|\\d)+')).toBe(false)
  })

  it('leaves unambiguous alternations alone, including ones sharing a first character', () => {
    // `(ab|ac)+` shares a first character but is linear — the branches diverge
    // before the group can repeat — so a first-character overlap test would be a
    // false positive here. We only flag provable single-character ambiguity.
    for (const safe of [
      '^(ab|ac)+$',
      '^(https?|ftp)://',
      '^(GET|POST|PUT|DELETE)$',
      '^(\\+|-)?\\d+(\\.\\d+)?$',
      '^(a|b|c)+$',
      '(foo|bar)*',
    ]) {
      expect(hasUnsafeRegex(safe), safe).toBe(false)
    }
  })

  it('screens a pattern that is only reachable through a $ref into an unfamiliar container', () => {
    // OpenAPI parks its subschemas under `components/schemas` and reaches them by
    // `$ref`. A screen that walks a fixed list of subschema keywords never sees
    // them, so this pattern used to be compiled and run unscreened — 30 characters
    // of input then burned over a second of CPU.
    expect(() =>
      validateGuard({
        $ref: '#/components/schemas/A',
        components: { schemas: { A: { type: 'string', pattern: '^(a+)+$' } } },
      }),
    ).toThrow(/backtracking|ReDoS/i)

    // Same for a container we have never heard of at all.
    expect(() => validate({ 'x-vendor-bag': { anything: { pattern: '(a*)*' } } })).toThrow(/backtracking|ReDoS/i)
  })

  it('does not mistake a regex-shaped string in const/enum data for a pattern', () => {
    // `(a+)+` here is a data constant, not a `pattern` keyword — must not be screened.
    expect(validate({ const: '(a+)+' })('(a+)+')).toBe(true)
    expect(validate({ enum: ['(a*)*', 'ok'] })('ok')).toBe(true)
    // The walk is otherwise unrestricted, so the data keywords are what keep an
    // object *value* carrying a `pattern` property from being screened as one.
    expect(validate({ const: { pattern: '(a+)+' } })({ pattern: '(a+)+' })).toBe(true)
    expect(validate({ enum: [{ pattern: '(a*)*' }] })({ pattern: '(a*)*' })).toBe(true)
    expect(validate({ type: 'object', default: { pattern: '(a+)+' } })({})).toBe(true)
  })

  it('rejects a pattern whose groups nest past the native stack limit, as a limit error', () => {
    // The screen recurses per `(`, on the native stack, and the pattern is
    // untrusted — so a deeply nested one used to surface as a `RangeError` that
    // `isValidationLimitError` does not recognize. It has to fail the same loud,
    // catchable way every other rejected pattern does.
    const nestedGroups = `${'('.repeat(30_000)}a${')'.repeat(30_000)}`
    let thrown: unknown
    try {
      validate({ type: 'string', pattern: nestedGroups })
    } catch (error) {
      thrown = error
    }
    expect(isValidationLimitError(thrown)).toBe(true)
    expect((thrown as Error).message).toMatch(/nests groups too deeply/i)
    expect(hasUnsafeRegex(nestedGroups)).toBe(true)
  })

  it('screens a very wide alternation in bounded time', () => {
    // Rule 2's pairwise scan is quadratic in the branch count, so a couple of
    // kilobytes of `(a|b|c|…)+` used to pin a CPU inside the very screen that
    // exists to stop a pattern pinning a CPU. The shared comparison budget caps
    // it; ordinary alternations are far too small to notice.
    const wide = Array.from({ length: 20_000 }, (_, i) => `[\\u${(0x0400 + i).toString(16).padStart(4, '0')}]`).join(
      '|',
    )
    const started = performance.now()
    // Distinct branches, so nothing here is genuinely ambiguous — the point is
    // only that answering takes bounded work.
    expect(hasUnsafeRegex(`(${wide})+`)).toBe(false)
    expect(performance.now() - started).toBeLessThan(2_000)
  })

  it('rejects a schema nested far past the native stack limit without a RangeError', () => {
    // The pattern screen and the anchor search both run before `maxDepth` applies,
    // so a recursive walk there surfaced as an uncatchable `RangeError` —
    // `isValidationLimitError` returned false and a consumer's limit handler fell
    // through to a 500. Building must succeed; the depth cap then does its job.
    const guard = validateGuard(nestedSchema(20_000))
    let thrown: unknown
    try {
      guard('x')
    } catch (error) {
      thrown = error
    }
    expect(isValidationLimitError(thrown)).toBe(true)
    expect((thrown as Error).message).toMatch(/maximum depth/i)
  })

  it('finds an $anchor buried below the native stack limit', () => {
    // The anchor search walks the whole document, so it faces the same depth as
    // the pattern screen and must survive it.
    const schema = { $ref: '#deep', $defs: { buried: nestedSchema(20_000, { $anchor: 'deep', type: 'string' }) } }
    expect(validateGuard(schema)('hello')).toBe(true)
    expect(validateGuard(schema)(42)).toBe(false)
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
