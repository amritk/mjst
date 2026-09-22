import { validate } from '@amritk/runtime-validators'
import { describe, expect, it } from 'vitest'

import { evaluateValidator } from './evaluate-generated.test-utils'
import { generateValidatorFunction } from './generate-validator-function'

/**
 * `format` emits no check: it stays an annotation, matching JSON Schema and the
 * interpreter's own default. That is a deliberate limitation rather than an
 * oversight, so it is pinned here — both halves of it.
 *
 * The half that matters to callers: a generated validator agrees with the
 * default interpreter and *disagrees* with one built with `{ formats: 'all' }`,
 * which is how `@amritk/lint` and `createApi({ formats })` run it. Anyone
 * teaching the generator to emit format checks should delete the second
 * expectation, not work around it.
 */

const SCHEMA = {
  type: 'object',
  properties: { id: { type: 'string', format: 'uuid' } },
  required: ['id'],
} as const

describe('format is an annotation', () => {
  it('emits no check, matching the interpreter default and not formats: all', () => {
    const source = generateValidatorFunction(SCHEMA as never, 'Root')
    const generated = evaluateValidator(source)
    const badFormat = { id: 'not-a-uuid' }

    // Nothing in the emitted source references the keyword or its value.
    expect(source).not.toMatch(/uuid|format/i)

    expect(generated(badFormat)).toBe(true)
    expect(validate(SCHEMA as never)(badFormat)).toBe(true)
    expect(validate(SCHEMA as never, { formats: 'all' })(badFormat)).not.toBe(true)

    // The rest of the schema is still enforced — this is a scoped gap, not a
    // schema the generator gives up on.
    expect(generated({ id: 42 })).not.toBe(true)
    expect(generated({})).not.toBe(true)
  })

  it('never quietly ignores a narrowing keyword the way it ignores format', () => {
    // The contrast that defines the rule: ignoring `format` is a defensible
    // reading of the spec, ignoring `unevaluatedProperties` is not. So the
    // generator either enforces it…
    const schema = { type: 'object', properties: { a: {} }, unevaluatedProperties: false }
    const generated = evaluateValidator(generateValidatorFunction(schema as never, 'Root'))
    expect(generated({ a: 1 })).toBe(true)
    expect(generated({ b: 1 })).not.toBe(true)
    expect(validate(schema as never)({ b: 1 })).not.toBe(true)

    // …or, for the shapes flat code genuinely cannot see through, refuses to
    // generate at all. Never a validator that says yes where the interpreter
    // says no.
    const dynamic = { $dynamicRef: '#node', properties: { a: {} }, unevaluatedProperties: false }
    expect(() => generateValidatorFunction(dynamic as never, 'Root')).toThrow(/unsupported "unevaluatedProperties"/)
  })
})
