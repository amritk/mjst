import { describe, expect, it } from 'vitest'

import { buildValidatorSchema } from './build-schema'
import { evaluateGenerated } from './evaluate-generated.test-utils'
import { generateCoerceFunction } from './generate-coerce-function'
import { generateValidatorFunction } from './generate-validator-function'
import { linkGenerated } from './link-generated.test-utils'

type Coerced = { valid: true; value: unknown } | { valid: false; errors: { path: string; keyword: string }[] }

/** The validator and its coercing half, compiled together as a file carries them. */
const compile = (schema: Record<string, unknown>): ((input: unknown) => Coerced) => {
  const code =
    generateValidatorFunction(schema as never, 'Root') + '\n\n' + generateCoerceFunction(schema as never, 'Root').code
  return evaluateGenerated(code)['coerceRoot'] as (input: unknown) => Coerced
}

/** The whole generated file set, linked, for a schema whose `$ref`s cross files. */
const compileLinked = async (schema: Record<string, unknown>): Promise<(input: unknown) => Coerced> =>
  linkGenerated(
    await buildValidatorSchema(schema as never, 'Root', '', undefined, undefined, undefined, true),
    'index',
    'coerceRoot',
  )

describe('generate-coerce-function', () => {
  it('coerces a scalar property toward the type the schema declares', () => {
    const coerce = compile({
      type: 'object',
      properties: { flag: { type: 'boolean' }, count: { type: 'integer' }, name: { type: 'string' } },
    })

    expect(coerce({ flag: 'true', count: '3', name: 7 })).toEqual({
      valid: true,
      value: { flag: true, count: 3, name: '7' },
    })
  })

  // The whole reason this is not a parser. A repairing parser turns `"many"`
  // into `0` and reports nothing, which for config validation is worse than
  // useless — it swallows the mistake. Here the value that cannot be coerced
  // reaches the validator untouched, so the error names what the caller wrote.
  it('reports the original error when a value cannot be coerced', () => {
    const coerce = compile({ type: 'object', properties: { count: { type: 'integer' } } })

    expect(coerce({ count: 'many' })).toEqual({
      valid: false,
      errors: [{ message: 'must be number', path: '/count', keyword: 'type', params: { type: 'integer' } }],
    })
  })

  it('applies the constraint keywords to the coerced value, not the original', () => {
    const coerce = compile({ type: 'object', properties: { count: { type: 'integer', minimum: 5 } } })

    // `"3"` is a valid integer once coerced and only then fails `minimum` — an
    // answer neither "reject the string" nor "repair to something valid" gives.
    expect(coerce({ count: '3' })).toEqual({
      valid: false,
      errors: [{ message: 'must be >= 5', path: '/count', keyword: 'minimum', params: { comparison: '>=', limit: 5 } }],
    })
    expect(coerce({ count: '7' })).toEqual({ valid: true, value: { count: 7 } })
  })

  it('never modifies the input', () => {
    const coerce = compile({ type: 'object', properties: { flag: { type: 'boolean' } } })
    const input = { flag: 'true' }

    const result = coerce(input)

    expect(result).toEqual({ valid: true, value: { flag: true } })
    expect(input).toEqual({ flag: 'true' })
  })

  // What lets a caller skip the defensive clone Ajv's in-place coercion forces.
  it('returns the input by reference when nothing needed coercing', () => {
    const coerce = compile({
      type: 'object',
      properties: { inner: { type: 'object', properties: { flag: { type: 'boolean' } } } },
    })
    const input = { inner: { flag: true } }

    const result = coerce(input)

    expect(result.valid && result.value).toBe(input)
  })

  it('shares the parts it did not touch with the input', () => {
    const coerce = compile({
      type: 'object',
      properties: {
        touched: { type: 'object', properties: { n: { type: 'integer' } } },
        untouched: { type: 'object', properties: { n: { type: 'integer' } } },
      },
    })
    const untouched = { n: 1 }
    const input = { touched: { n: '2' }, untouched }

    const result = coerce(input)

    expect(result.valid && result.value).not.toBe(input)
    expect(result.valid && (result.value as { untouched: unknown }).untouched).toBe(untouched)
  })

  it('coerces through arrays, tuple positions and nested objects', () => {
    const coerce = compile({
      type: 'object',
      properties: {
        list: { type: 'array', items: { type: 'number' } },
        pair: { type: 'array', prefixItems: [{ type: 'boolean' }, { type: 'integer' }], items: { type: 'string' } },
        deep: { type: 'object', properties: { inner: { type: 'object', properties: { n: { type: 'integer' } } } } },
      },
    })

    expect(coerce({ list: ['1', 2], pair: ['true', '2', 3], deep: { inner: { n: '4' } } })).toEqual({
      valid: true,
      value: { list: [1, 2], pair: [true, 2, '3'], deep: { inner: { n: 4 } } },
    })
  })

  it('coerces the keys patternProperties and additionalProperties reach', () => {
    const coerce = compile({
      type: 'object',
      properties: { known: { type: 'integer' } },
      patternProperties: { '^x-': { type: 'string' } },
      additionalProperties: { type: 'boolean' },
    })

    expect(coerce({ known: '1', 'x-a': 2, other: 'true' })).toEqual({
      valid: true,
      value: { known: 1, 'x-a': '2', other: true },
    })
  })

  // A union is not a reason to give up. `string | { … }` is the commonest shape
  // in a hand-written config schema, and a number written where the short form
  // goes has exactly one reading — the object branch cannot take a scalar, so it
  // never competes for one.
  it('coerces through a union when only one branch can take the value', () => {
    const coerce = compile({
      type: 'object',
      properties: {
        short: { anyOf: [{ type: 'string' }, { type: 'object', properties: { verb: { type: 'string' } } }] },
        numOrNull: { type: ['number', 'null'] },
        numOrBool: { anyOf: [{ type: 'number' }, { type: 'boolean' }] },
      },
    })

    expect(coerce({ short: 7, numOrNull: '3', numOrBool: 'true' })).toEqual({
      valid: true,
      value: { short: '7', numOrNull: 3, numOrBool: true },
    })
  })

  it('leaves a value that is already one of the offered types alone', () => {
    // Where this parts company with Ajv, which walks its own coercion list in
    // order and so makes `"1"` a number under `['number', 'string']` while
    // leaving it a string under `['string', 'number']`. The answer should not
    // depend on the order someone wrote the union in.
    const coerce = compile({
      type: 'object',
      properties: {
        numberFirst: { type: ['number', 'string'] },
        stringFirst: { type: ['string', 'number'] },
      },
    })

    expect(coerce({ numberFirst: '1', stringFirst: '1' })).toEqual({
      valid: true,
      value: { numberFirst: '1', stringFirst: '1' },
    })
  })

  it('leaves a value two branches could equally take alone', () => {
    // `true` could be `1` or `"true"` with equal justification, so it stays what
    // the caller wrote and the validator says what is wrong with it.
    const coerce = compile({ type: 'object', properties: { d: { type: ['number', 'string'] } } })

    expect(coerce({ d: true })).toEqual({
      valid: false,
      errors: [
        {
          message: 'must be number or string',
          path: '/d',
          keyword: 'type',
          params: { type: ['number', 'string'] },
        },
      ],
    })
  })

  // The shape that motivated union coercion: `plain` and `inUnion.enabled` are
  // the same `{ type: 'boolean' }`, and only one of them sat under an `anyOf`.
  // Through a `$ref`, so the branch test has to cross a file the same way the
  // validator does.
  it('coerces a scalar inside an object branch of a union', async () => {
    const coerce = await compileLinked({
      type: 'object',
      properties: { plain: { type: 'boolean' }, inUnion: { $ref: '#/$defs/method' } },
      $defs: {
        method: {
          anyOf: [
            { type: 'string' },
            {
              type: 'object',
              properties: { enabled: { type: 'boolean' }, endpoint: { type: 'string' } },
              required: ['enabled'],
            },
          ],
        },
      },
    })

    expect(coerce({ plain: 'true' })).toEqual({ valid: true, value: { plain: true } })
    expect(coerce({ inUnion: { enabled: 'true' } })).toEqual({ valid: true, value: { inUnion: { enabled: true } } })
    expect(coerce({ inUnion: { enabled: true, endpoint: 42 } })).toEqual({
      valid: true,
      value: { inUnion: { enabled: true, endpoint: '42' } },
    })
    expect(coerce({ inUnion: 7 })).toEqual({ valid: true, value: { inUnion: '7' } })
  })

  // Coercing eagerly into the first branch is Ajv's behaviour, and it answers
  // `"false"` here: the string branch takes the coerced value, and the `const`
  // branch written for exactly this input is never reached. A config reading
  // `keyOpt === false` then sees a truthy string.
  it('prefers a branch that matches as written over coercing into an earlier one', () => {
    const coerce = compile({
      type: 'object',
      properties: { keyOpt: { anyOf: [{ type: 'string' }, { const: false }] } },
    })

    expect(coerce({ keyOpt: false })).toEqual({ valid: true, value: { keyOpt: false } })
    expect(coerce({ keyOpt: 5 })).toEqual({ valid: true, value: { keyOpt: '5' } })
  })

  it('coerces through a union nested inside a union', () => {
    const coerce = compile({
      type: 'object',
      properties: {
        auth: {
          anyOf: [
            { type: 'string' },
            {
              type: 'object',
              properties: {
                token: {
                  anyOf: [{ const: false }, { type: 'object', properties: { ttl: { type: 'integer' } } }],
                },
              },
            },
          ],
        },
      },
    })

    expect(coerce({ auth: { token: { ttl: '60' } } })).toEqual({ valid: true, value: { auth: { token: { ttl: 60 } } } })
    // The inner union's `const` branch still wins as written, one level down.
    expect(coerce({ auth: { token: false } })).toEqual({ valid: true, value: { auth: { token: false } } })
    expect(coerce({ auth: 3 })).toEqual({ valid: true, value: { auth: '3' } })
  })

  it('judges a branch by all of its keywords, not only its type', () => {
    // `"7"` is already a string, but not one the string branch takes, so the
    // number branch is the only reading left.
    const coerce = compile({
      type: 'object',
      properties: { d: { anyOf: [{ type: 'string', minLength: 3 }, { type: 'number' }] } },
    })

    expect(coerce({ d: '7' })).toEqual({ valid: true, value: { d: 7 } })
    expect(coerce({ d: 'seven' })).toEqual({ valid: true, value: { d: 'seven' } })
  })

  it('coerces through oneOf the same way', () => {
    const coerce = compile({
      type: 'object',
      properties: {
        d: {
          oneOf: [
            { type: 'object', properties: { kind: { const: 'a' }, n: { type: 'integer' } }, required: ['kind'] },
            { type: 'object', properties: { kind: { const: 'b' }, n: { type: 'boolean' } }, required: ['kind'] },
          ],
        },
      },
    })

    expect(coerce({ d: { kind: 'a', n: '2' } })).toEqual({ valid: true, value: { d: { kind: 'a', n: 2 } } })
    expect(coerce({ d: { kind: 'b', n: 'true' } })).toEqual({ valid: true, value: { d: { kind: 'b', n: true } } })
  })

  // The tie-break, and it is observable. Two branches coercing the same input
  // into two different values are two readings of what the caller meant; picking
  // the first-declared one would make the answer depend on the order the union
  // was written in, which `coerceUnion` already refuses to do for scalars.
  it('declines when the branches disagree, and reports the value as written', () => {
    const coerce = compile({
      type: 'object',
      properties: {
        d: {
          anyOf: [
            { type: 'object', properties: { a: { type: 'integer' } }, required: ['a'] },
            { type: 'object', properties: { b: { type: 'boolean' } }, required: ['b'] },
          ],
        },
      },
    })

    // Branch one makes `a` a number, branch two makes `b` a boolean, and each
    // result satisfies its own branch. Neither is more right than the other.
    const result = coerce({ d: { a: '1', b: 'true' } })

    expect(result.valid).toBe(false)
    // Either branch alone is unambiguous.
    expect(coerce({ d: { a: '1' } })).toEqual({ valid: true, value: { d: { a: 1 } } })
    expect(coerce({ d: { b: 'true' } })).toEqual({ valid: true, value: { d: { b: true } } })
  })

  it('takes a coercion two branches agree on', () => {
    const coerce = compile({
      type: 'object',
      properties: {
        d: {
          anyOf: [
            { type: 'object', properties: { port: { type: 'integer' }, host: { type: 'string' } }, required: ['host'] },
            { type: 'object', properties: { port: { type: 'integer' }, path: { type: 'string' } }, required: ['path'] },
          ],
        },
      },
    })

    expect(coerce({ d: { port: '80', host: 'a', path: 'b' } })).toEqual({
      valid: true,
      value: { d: { port: 80, host: 'a', path: 'b' } },
    })
  })

  it('takes a scalar coercion two offered types agree on', () => {
    // Both readings of `"1"` are the number `1`, so there is nothing to choose
    // between. Counting them as two answers declined a value with only one.
    const coerce = compile({
      type: 'object',
      properties: { d: { anyOf: [{ type: 'number' }, { type: 'integer' }] }, e: { type: ['number', 'integer'] } },
    })

    expect(coerce({ d: '1', e: '2' })).toEqual({ valid: true, value: { d: 1, e: 2 } })
  })

  it('emits no union walk when a branch accepts anything', () => {
    const { code } = generateCoerceFunction(
      {
        type: 'object',
        properties: { d: { anyOf: [{ type: 'object', properties: { n: { type: 'integer' } } }, {}] } },
      } as never,
      'Root',
    )

    // `{}` takes every value as written, so nothing under this union is ever
    // coerced — and no branch test is left behind unread.
    expect(code).toContain('export const coerceRootValue = (input: unknown): unknown => input')
    expect(code).not.toContain('_matches')
  })

  it('emits no walk at all for a schema with nothing to coerce', () => {
    const { code } = generateCoerceFunction({ type: 'object', properties: { a: { enum: ['x'] } } } as never, 'Root')

    // The identity case is emitted as the identity, so a schema that coerces
    // nothing pays nothing and hands every value straight back.
    expect(code).toContain('export const coerceRootValue = (input: unknown): unknown => input')
    expect(code).not.toContain('coerceScalar(')
  })

  it('names the referenced file’s walk for a $ref position', () => {
    const { code } = generateCoerceFunction(
      { type: 'object', properties: { retry: { $ref: '#/$defs/retryConfig' } } } as never,
      'Root',
    )

    // A coercion has to cross a file boundary the same way validation does.
    expect(code).toContain('coerceRetryConfigValue(')
  })

  it('applies the type suffix to a $ref walk name', () => {
    const { code } = generateCoerceFunction(
      { type: 'object', properties: { retry: { $ref: '#/$defs/retry' } } } as never,
      'Root',
      'Object',
    )

    expect(code).toContain('coerceRetryObjectValue(')
  })

  // This pass *writes*, which makes a prototype read worse here than elsewhere:
  // an inherited key that gets coerced is written onto the copy as the object's
  // own, inventing data the caller never sent. (What the validator then makes of
  // a polluted prototype is its own contract, pinned in `polluted-prototype`; the
  // walk is asserted on directly so this test is about the walk.)
  it('reads keys as own properties, not through the prototype', () => {
    const code =
      generateValidatorFunction({ type: 'object', properties: { flag: { type: 'boolean' } } } as never, 'Root') +
      '\n\n' +
      generateCoerceFunction({ type: 'object', properties: { flag: { type: 'boolean' } } } as never, 'Root').code
    const walk = evaluateGenerated(code)['coerceRootValue'] as (input: unknown) => unknown

    const polluted = Object.prototype as Record<string, unknown>
    try {
      polluted['flag'] = 'true'
      const input = {}

      expect(walk(input)).toBe(input)
      expect(Object.hasOwn(walk(input) as object, 'flag')).toBe(false)
    } finally {
      delete polluted['flag']
    }
  })

  it('does not turn an array hole into an element', () => {
    const schema = { type: 'array', items: { type: 'boolean' } }
    const code =
      generateValidatorFunction(schema as never, 'Root') + '\n\n' + generateCoerceFunction(schema as never, 'Root').code
    const walk = evaluateGenerated(code)['coerceRootValue'] as (input: unknown) => unknown

    const polluted = Array.prototype as unknown as Record<number, unknown>
    try {
      polluted[0] = 'true'
      const input: unknown[] = new Array(2)
      input[1] = true

      expect(Object.hasOwn(walk(input) as object, 0)).toBe(false)
    } finally {
      delete polluted[0]
    }
  })
})
