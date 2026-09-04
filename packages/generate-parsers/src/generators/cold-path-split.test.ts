import type { JSONSchema } from 'json-schema-typed/draft-2020-12'
import { describe, expect, it } from 'vitest'

import { evalGenerated } from './differential.test-utils'
import { generateParserFunction } from './generate-parser-function'

/**
 * A generated parser is fast because the engine can inline it into its caller
 * and then delete the object it builds. Both of those stop the moment the
 * function gets big — and the cold half is what makes it big: a
 * `throw new Error(...)` per field, each carrying a template literal and an
 * `"x" in input` probe, none of which a valid document ever executes.
 *
 * So the emitter splits: the exported parser holds the loads, one boolean chain
 * and the literal built from those loads, and everything else lives in a
 * `_parse…Slow` function it hands off to. These tests pin that split by its
 * observable signature — no `throw` and no template literal anywhere in a
 * fast-path function — because it is invisible to every behavioural test in the
 * suite and would be undone by an innocent-looking edit.
 */
describe('cold-path-split', () => {
  /** The moltar `assert` benchmark shape: seven scalars plus one nested object. */
  const assertSchema = (closed: boolean): JSONSchema => ({
    type: 'object',
    properties: {
      number: { type: 'number' },
      negNumber: { type: 'number' },
      maxNumber: { type: 'number' },
      string: { type: 'string' },
      longString: { type: 'string' },
      boolean: { type: 'boolean' },
      deeplyNested: {
        type: 'object',
        properties: { foo: { type: 'string' }, num: { type: 'number' }, bool: { type: 'boolean' } },
        required: ['foo', 'num', 'bool'],
        ...(closed ? { additionalProperties: false } : {}),
      },
    },
    required: ['number', 'negNumber', 'maxNumber', 'string', 'longString', 'boolean', 'deeplyNested'],
    ...(closed ? { additionalProperties: false } : {}),
  })

  const assertInput = {
    number: 1,
    negNumber: -1,
    maxNumber: Number.MAX_VALUE,
    string: 'string',
    longString: 'x'.repeat(1000),
    boolean: true,
    deeplyNested: { foo: 'bar', num: 1, bool: false },
  }

  /**
   * The emitted functions, keyed by name. Every declaration the emitter writes
   * starts at column zero and is separated from the next by a blank line, and no
   * function body contains one — so a blank-line split is an exact decomposition.
   */
  const functions = (source: string): Map<string, string> => {
    const found = new Map<string, string>()
    for (const block of source.split('\n\n')) {
      const name = /^(?:export )?const ([A-Za-z0-9_$]+) = /.exec(block)?.[1]
      if (name !== undefined) found.set(name, block)
    }
    return found
  }

  /** The parsers on the hot path: every emitted `parse…`, minus the `_parse…Slow` halves. */
  const fastPathFunctions = (source: string): [string, string][] =>
    [...functions(source)].filter(([name]) => name.startsWith('parse'))

  it.each([
    ['parseSafe (strict + stripUnknown)', { strict: true, stripUnknown: true }, false],
    ['parseStrict (additionalProperties: false)', { strict: true }, true],
    ['coerce (the default)', {}, false],
  ])('keeps every diagnostic out of the fast path — %s', (_label, options, closed) => {
    const source = generateParserFunction(assertSchema(closed), 'Assert', options)
    const fastPaths = fastPathFunctions(source)

    // Root plus the nested sub-parser: the split applies at every level, not
    // just the exported one.
    expect(fastPaths.map(([name]) => name)).toEqual(['parseAssert_DeeplyNested', 'parseAssert'])

    for (const [name, body] of fastPaths) {
      expect(`${name}: ${body}`).not.toContain('throw')
      // A template literal is the tell for a per-field message being built in
      // place; the fast path never formats a string.
      expect(`${name}: ${body}`).not.toContain('`')
    }
  })

  it('puts the diagnostics in the cold function, in the order they were emitted before', () => {
    const source = generateParserFunction(assertSchema(false), 'Assert', { strict: true, stripUnknown: true })
    const cold = functions(source).get('_parseAssertSlow')
    expect(cold).toBeDefined()

    const messages = [...(cold as string).matchAll(/\[Assert\] ([^"`$]+)/g)].map((match) => match[1])
    expect(messages).toEqual([
      'expected object, got ',
      "missing required property 'number'",
      "field 'number' expected number, got ",
      "missing required property 'negNumber'",
      "field 'negNumber' expected number, got ",
      "missing required property 'maxNumber'",
      "field 'maxNumber' expected number, got ",
      "missing required property 'string'",
      "field 'string' expected string, got ",
      "missing required property 'longString'",
      "field 'longString' expected string, got ",
      "missing required property 'boolean'",
      "field 'boolean' expected boolean, got ",
      "missing required property 'deeplyNested'",
      "field 'deeplyNested' expected object, got ",
    ])
  })

  it('reads every field exactly once on the fast path, nested fields included', () => {
    const source = generateParserFunction(assertSchema(false), 'Assert', { strict: true, stripUnknown: true })
    const hot = functions(source).get('parseAssert') as string

    for (const key of ['number', 'string', 'boolean', 'deeplyNested']) {
      expect(hot.split(`input.${key}`).length - 1).toBe(1)
    }
    // The nested reads are bound once each, then shared by the shape test and
    // the literal — `{ foo: n.foo }` after `typeof n.foo` would be two loads.
    for (const key of ['foo', 'num', 'bool']) {
      expect(hot).toContain(`const _deeplyNested_${key} = (_deeplyNested as Record<string, any>).${key};`)
      expect(hot.split(`).${key}`).length - 1).toBe(1)
    }
  })

  it('drops the redundant array guard the object test already covers', () => {
    const source = generateParserFunction(assertSchema(false), 'Assert', { strict: true, stripUnknown: true })
    const hot = functions(source).get('parseAssert') as string

    // `isObject(_deeplyNested)` in the guard already rejected arrays, and
    // `typeof _deeplyNested_foo === "string"` would reject one regardless.
    expect(hot).not.toContain('Array.isArray')
    // Still rejected, whichever check does it.
    const parse = evalGenerated<(input: unknown) => unknown>(source, 'parseAssert')
    expect(() => parse({ ...assertInput, deeplyNested: [] })).toThrow("field 'deeplyNested' expected object")
  })

  it('parses and rejects exactly as the single-function form did', () => {
    for (const [options, closed] of [
      [{ strict: true, stripUnknown: true }, false],
      [{ strict: true }, true],
    ] as const) {
      const parse = evalGenerated<(input: unknown) => unknown>(
        generateParserFunction(assertSchema(closed), 'Assert', options),
        'parseAssert',
      )

      expect(parse(structuredClone(assertInput))).toEqual(assertInput)
      // A null-prototype object cannot take the fast path (its own-key count is
      // checked behind a prototype test), so this is the cold function returning
      // rather than throwing — the reason it is not typed `never`.
      expect(parse(Object.assign(Object.create(null), structuredClone(assertInput)))).toEqual(assertInput)

      expect(() => parse({ ...assertInput, number: 'one' })).toThrow("field 'number' expected number")
      expect(() => parse({ ...assertInput, deeplyNested: { foo: 'bar', num: 1 } })).toThrow(
        "missing required property 'bool'",
      )
      expect(() => parse(null)).toThrow('[Assert] expected object, got null')
      expect(() => parse([])).toThrow('[Assert] expected object, got object')
    }
  })

  it('strips undeclared keys at every level, and rejects them when the schema closes', () => {
    const withExtras = {
      ...structuredClone(assertInput),
      extra: 'drop me',
      deeplyNested: { foo: 'bar', num: 1, bool: false, nestedExtra: 1 },
    }

    const strip = evalGenerated<(input: unknown) => unknown>(
      generateParserFunction(assertSchema(false), 'Assert', { strict: true, stripUnknown: true }),
      'parseAssert',
    )
    expect(strip(structuredClone(withExtras))).toEqual(assertInput)

    const closed = evalGenerated<(input: unknown) => unknown>(
      generateParserFunction(assertSchema(true), 'Assert', { strict: true }),
      'parseAssert',
    )
    expect(() => closed(structuredClone(withExtras))).toThrow('[Assert] unknown property "extra"')
  })

  it('leaves a parser with no fast path as one function', () => {
    // `propertyNames` is a keyword no flat guard can mirror, so this parser has
    // nothing to protect and nothing to move out.
    const source = generateParserFunction(
      { type: 'object', properties: { a: { type: 'string' } }, required: ['a'], propertyNames: { maxLength: 4 } },
      'Named',
      { strict: true },
    )
    expect(source).not.toContain('_parseNamedSlow')
    expect(source).toContain('throw new Error')
  })

  it('keeps the warning loop on every path when --log-warnings is on', () => {
    // The loop has to run for valid documents too, so there is no cold half to
    // split off and the parser stays whole.
    const source = generateParserFunction(assertSchema(false), 'Assert', { logWarnings: true })
    expect(source).not.toContain('_parseAssertSlow')
    expect(source).toContain('console.warn')
  })
})
