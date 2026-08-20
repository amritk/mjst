import { validate } from '@amritk/runtime-validators'
import { describe, expect, it } from 'vitest'

import { evaluateGenerated } from './evaluate-generated.test-utils'
import { generateBooleanGuard, generateValidatorFunction } from './generate-validator-function'

/**
 * Every string a schema carries — a property name, an `enum` member, a `const`,
 * a `pattern` — reaches the generated file as *data*: a quoted literal, or the
 * body of a regex literal. Nothing downstream may read it as code.
 *
 * The generator used to break that rule twice, both times with a `replaceAll`
 * over the finished function text: `errors.push(` was rewritten to its
 * create-on-first-use form, and an unread `(input: unknown` parameter to
 * `(_input: unknown`. Those substrings are perfectly ordinary schema content, so
 * a schema that spelled one had it rewritten inside its own string literal — the
 * validator compared against a key nobody wrote — or inside its own regex
 * literal, where `pattern: "errors.push(x)"` compiled to `/(errors ??= [])…/`, a
 * regex matching nothing at all. `isX` was built without the rewrite, so the two
 * halves of the same file disagreed on the same input.
 *
 * The oracle is `@amritk/runtime-validators`, which interprets the schema and so
 * cannot have a codegen bug of this kind.
 */

/** Generates `validateDoc` + `isDoc` and returns both, ready to run. */
const build = (schema: Record<string, unknown>) => {
  const code = `${generateValidatorFunction(schema as never, 'Doc')}\n\n${generateBooleanGuard(schema as never, 'Doc')}`
  const exports = evaluateGenerated(code)
  return {
    code,
    validate: exports['validateDoc'] as (input: unknown) => unknown,
    guard: exports['isDoc'] as (input: unknown) => boolean,
  }
}

/** Asserts the validator and its guard both agree with the interpreter. */
const expectParity = (schema: Record<string, unknown>, values: readonly unknown[]): void => {
  const { validate: ours, guard } = build(schema)
  const reference = validate(schema as never)
  for (const value of values) {
    const expected = reference(value) === true
    expect(ours(value) === true, `validateDoc disagreed on ${JSON.stringify(value)}`).toBe(expected)
    expect(guard(value), `isDoc disagreed on ${JSON.stringify(value)}`).toBe(expected)
  }
}

/** Substrings the generator itself emits, and so once rewrote wherever it found them. */
const GENERATOR_SPELLINGS = ['errors.push(', '(input: unknown', '(errors ??= []).push('] as const

describe('schema-text-is-data', () => {
  it('keeps a pattern that spells generated code intact', () => {
    // A legal regex: `.` is any character and `push(x)` is a group. Rewritten, it
    // became `/(errors ??= []).push(x)/` — an empty character class, which matches
    // nothing, so every string failed a pattern most strings should pass.
    const schema = { type: 'object', properties: { p: { type: 'string', pattern: 'errors.push(x)' } } }
    const { code } = build(schema)

    expect(code).toContain('/errors.push(x)/u.test(')
    expect(code).not.toContain('/(errors ??= []).push(x)/')
    expectParity(schema, [{ p: 'errorsXpushx' }, { p: 'no match here' }, { p: 'errors!push(x)' }, {}])
  })

  it('keeps enum and const members that spell generated code intact', () => {
    for (const spelling of GENERATOR_SPELLINGS) {
      expectParity({ type: 'object', properties: { p: { enum: [spelling, 'other'] } } }, [
        { p: spelling },
        { p: 'other' },
        { p: 'neither' },
      ])
      expectParity({ type: 'object', properties: { p: { const: spelling } } }, [{ p: spelling }, { p: 'other' }])
    }
  })

  it('keeps property names that spell generated code intact', () => {
    for (const spelling of GENERATOR_SPELLINGS) {
      const schema = {
        type: 'object',
        properties: { [spelling]: { type: 'string', minLength: 2 } },
        required: [spelling],
        additionalProperties: false,
      }
      expectParity(schema, [
        { [spelling]: 'ab' },
        { [spelling]: 'a' },
        { [spelling]: 1 },
        {},
        { [spelling]: 'ab', x: 1 },
      ])
    }
  })

  it('keeps a required-key presence check on a name that spells generated code', () => {
    // The `input` → `_input` rename only ever fires when the body reads nothing,
    // which is precisely the shape a bare presence check has.
    for (const spelling of GENERATOR_SPELLINGS) {
      expectParity({ type: 'object', required: [spelling] }, [{ [spelling]: 1 }, {}, { other: 1 }])
    }
  })

  it('keeps schema text inside a combinator branch intact', () => {
    // Combinator branches are built into a match IIFE, whose checks used to be
    // redirected to a local buffer by the same kind of textual rewrite.
    for (const spelling of GENERATOR_SPELLINGS) {
      expectParity({ anyOf: [{ const: spelling }, { type: 'number' }] }, [spelling, 'other', 7, null])
      expectParity({ not: { const: spelling } }, [spelling, 'other'])
      expectParity({ type: 'array', contains: { const: spelling } }, [[spelling], ['other'], []])
    }
  })
})
