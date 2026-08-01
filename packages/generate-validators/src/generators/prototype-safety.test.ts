import { validate } from '@amritk/runtime-validators'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

import { generateBooleanGuard, generateValidatorFunction } from './generate-validator-function'

/**
 * A schema may name a property after something every object already inherits —
 * `constructor`, `toString`, `hasOwnProperty`, `__proto__`. Every one of those
 * used to break the generated validator, in both directions:
 *
 *  - `__proto__` vanished from the schema during the `nullable` rewrite (a plain
 *    `copy['__proto__'] = …` fires the prototype setter instead of creating a
 *    property), so the validator carried NO checks for it — a validation bypass.
 *  - `constructor` / `toString` / `hasOwnProperty` were read straight off the
 *    object, so the *prototype's* value answered: a valid document was reported
 *    as `must be string` at `/hasOwnProperty`, and a required `toString` could
 *    never be reported missing because `'toString' in obj` is always true.
 *
 * The oracle here is `@amritk/runtime-validators`, not Ajv: Ajv has both of these
 * bugs itself (it drops a `__proto__` entry from `properties`, and it reads
 * inherited members), so it cannot referee this particular question. The
 * interpreter is spec-correct — it looks every prototype-member name up with
 * `Object.hasOwn` — and it is the engine mjst ships for runtime schemas, so
 * agreeing with it is the contract that matters.
 *
 * Schemas and documents are built with `JSON.parse` on purpose: an object literal
 * would set the prototype rather than create a `__proto__` key, which is exactly
 * the hazard under test and not how a `.json` file reaches the generator.
 */
const evalModule = (code: string): Record<string, unknown> => {
  const js = ts.transpileModule(code, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const moduleExports: Record<string, unknown> = {}
  new Function('exports', js)(moduleExports)
  return moduleExports
}

/** Generates `validateDoc` + `isDoc` and returns both, ready to run. */
const build = (schema: unknown) => {
  const code =
    // biome-ignore lint/suspicious/noExplicitAny: the fixtures come from JSON.parse
    `${generateValidatorFunction(schema as any, 'Doc')}\n\n${generateBooleanGuard(schema as any, 'Doc')}`
  const exports = evalModule(code)
  return {
    code,
    validate: exports['validateDoc'] as (input: unknown) => unknown,
    guard: exports['isDoc'] as (input: unknown) => boolean,
  }
}

/** Asserts the generated validator AND its type guard agree with the interpreter. */
const expectInterpreterParity = (schema: unknown, values: readonly unknown[]): void => {
  const { validate: ours, guard } = build(schema)
  // biome-ignore lint/suspicious/noExplicitAny: the fixtures come from JSON.parse
  const reference = validate(schema as any)
  for (const value of values) {
    const expected = reference(value) === true
    expect(ours(value) === true, `validateDoc disagreed on ${JSON.stringify(value)}`).toBe(expected)
    expect(guard(value), `isDoc disagreed on ${JSON.stringify(value)}`).toBe(expected)
  }
}

describe('prototype-safety', () => {
  it('keeps a "__proto__" property schema through the nullable rewrite', () => {
    const schema = JSON.parse('{"type":"object","properties":{"__proto__":{"type":"string","minLength":3}}}')
    const { code } = build(schema)

    // The whole failure mode was the checks going missing, so pin that they exist.
    expect(code).toContain('must be string')
    expect(code).toContain('must have at least 3 characters')

    expectInterpreterParity(schema, [
      JSON.parse('{"__proto__":"abc"}'),
      JSON.parse('{"__proto__":"ab"}'),
      JSON.parse('{"__proto__":5}'),
      {},
    ])
  })

  it('enforces a required "__proto__" property instead of only its presence', () => {
    const schema = JSON.parse(
      '{"type":"object","properties":{"__proto__":{"type":"string","minLength":3}},"required":["__proto__"]}',
    )
    expectInterpreterParity(schema, [
      JSON.parse('{"__proto__":"abc"}'),
      JSON.parse('{"__proto__":"ab"}'),
      JSON.parse('{"__proto__":true}'),
      {},
    ])
  })

  it('reads a prototype-member property off the document, not off Object.prototype', () => {
    const schema = JSON.parse(
      '{"type":"object","properties":{"constructor":{"type":"string"},"hasOwnProperty":{"type":"string"},"ok":{"type":"string"}}}',
    )
    const { validate: ours } = build(schema)

    // Every one of these is absent from the document, so nothing may be reported.
    expect(ours(JSON.parse('{"ok":"x"}'))).toBe(true)
    expectInterpreterParity(schema, [
      JSON.parse('{"ok":"x"}'),
      JSON.parse('{"constructor":"hello","ok":"x"}'),
      JSON.parse('{"constructor":1}'),
      {},
    ])
  })

  it('reports a required prototype-member property as missing', () => {
    const schema = JSON.parse('{"type":"object","properties":{"toString":{"type":"string"}},"required":["toString"]}')
    const { validate: ours } = build(schema)

    const result = ours({}) as { valid: false; errors: { message: string }[] }
    expect(result).not.toBe(true)
    expect(result.errors[0]?.message).toBe("must have required property 'toString'")

    expectInterpreterParity(schema, [{}, JSON.parse('{"toString":"y"}'), JSON.parse('{"toString":7}')])
  })

  it('gates dependentRequired on own properties', () => {
    const schema = JSON.parse(
      '{"type":"object","dependentRequired":{"toString":["ok"]},"properties":{"ok":{"type":"string"}}}',
    )
    expectInterpreterParity(schema, [
      {},
      JSON.parse('{"toString":"a"}'),
      JSON.parse('{"toString":"a","ok":"b"}'),
      JSON.parse('{"ok":"b"}'),
    ])
  })

  it('keeps a "__proto__" patternProperties entry through the nullable rewrite', () => {
    const schema = JSON.parse('{"type":"object","patternProperties":{"__proto__":{"type":"number"}}}')
    expectInterpreterParity(schema, [
      JSON.parse('{"__proto__":1}'),
      JSON.parse('{"__proto__":"nope"}'),
      { ['x__proto__y']: 'nope' },
      {},
    ])
  })

  /**
   * The own-property guard is not free — `Object.hasOwn` is a call the engine
   * cannot fold the way it folds `in`, and spelling every presence check that way
   * cost roughly half the throughput on an all-present object. So it is spent only
   * where an inherited value could actually answer. This test is the load-bearing
   * half of that trade: it pins that a risky name still gets the guard, so a
   * future tidy-up cannot quietly widen the cheap spelling to cover `toString`.
   */
  it('spends the own-property guard only on names an object can inherit', () => {
    const schema = JSON.parse(
      '{"type":"object","properties":{"toString":{"type":"string"},"ok":{"type":"string"}},"required":["toString","ok"]}',
    )
    const { code } = build(schema)

    expect(code).toContain('Object.hasOwn(obj, "toString")')
    expect(code).toContain('!("ok" in obj)')
    expect(code).not.toContain('Object.hasOwn(obj, "ok")')
  })
})
