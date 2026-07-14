import type { JSONSchema } from 'json-schema-typed/draft-2020-12'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

import { generateParserFunction } from './generate-parser-function'
import { generateObjectStrictAssertion, generateScalarStrictAssertion } from './generate-strict-assertion'

describe('generate-strict-assertion x-mjst instanceOf', () => {
  it('asserts instanceof for a required Date property', () => {
    const schema = {
      type: 'object' as const,
      properties: { createdAt: { 'x-mjst': { instanceOf: 'Date' } } },
      required: ['createdAt'],
    }
    const lines = generateObjectStrictAssertion(schema, 'Event').join('\n')

    expect(lines).toContain("missing required property 'createdAt'")
    expect(lines).toContain('!(input.createdAt instanceof Date)')
    expect(lines).toContain("field 'createdAt' must be Date")
  })

  it('guards undefined before asserting instanceof for an optional Date property', () => {
    const schema = {
      type: 'object' as const,
      properties: { createdAt: { 'x-mjst': { instanceOf: 'Date' } } },
    }
    const lines = generateObjectStrictAssertion(schema, 'Event').join('\n')

    expect(lines).toContain('input.createdAt !== undefined && !(input.createdAt instanceof Date)')
  })

  it('asserts instanceof for a top-level Date schema', () => {
    const line = generateScalarStrictAssertion({ 'x-mjst': { instanceOf: 'Date' } }, 'When')

    expect(line).toContain('!(input instanceof Date)')
    expect(line).toContain('expected Date')
  })
})

describe('generate-strict-assertion x-mjst primitive', () => {
  it('asserts typeof bigint for a required property', () => {
    const schema = {
      type: 'object' as const,
      properties: { balance: { 'x-mjst': { primitive: 'bigint' } } },
      required: ['balance'],
    }
    const lines = generateObjectStrictAssertion(schema, 'Account').join('\n')

    expect(lines).toContain("missing required property 'balance'")
    expect(lines).toContain('typeof input.balance !== "bigint"')
    expect(lines).toContain("field 'balance' must be bigint")
  })

  it('guards undefined before asserting typeof for an optional bigint property', () => {
    const schema = {
      type: 'object' as const,
      properties: { balance: { 'x-mjst': { primitive: 'bigint' } } },
    }
    const lines = generateObjectStrictAssertion(schema, 'Account').join('\n')

    expect(lines).toContain('input.balance !== undefined && typeof input.balance !== "bigint"')
  })

  it('asserts typeof for a top-level bigint schema', () => {
    const line = generateScalarStrictAssertion({ 'x-mjst': { primitive: 'bigint' } }, 'Big')

    expect(line).toContain('typeof input !== "bigint"')
    expect(line).toContain('expected bigint')
  })
})

/**
 * Compiles a generated strict parser and returns it as a callable, with the
 * `isObject` runtime helper injected — the same execution harness the
 * differential conformance test uses.
 */
const evalParser = (code: string, name: string): ((input: unknown) => unknown) => {
  const js = ts.transpileModule(code, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const moduleExports: Record<string, unknown> = {}
  const isObject = (v: unknown): v is Record<string, unknown> =>
    typeof v === 'object' && v !== null && !Array.isArray(v)
  new Function('exports', 'isObject', js)(moduleExports, isObject)
  return moduleExports[name] as (input: unknown) => unknown
}

const strictParser = (schema: JSONSchema, typeName: string): ((input: unknown) => unknown) =>
  evalParser(generateParserFunction(schema, typeName, { strict: true, useRefImports: false }), `parse${typeName}`)

describe('generate-strict-assertion array items and unions', () => {
  it('throws on a wrong-typed array item on the slow path', () => {
    // The fast path proves item types via `.every`; this pins that the slow
    // path re-checks them too instead of letting `[1]` through a `string[]`.
    const parse = strictParser(
      {
        type: 'object',
        properties: { tags: { type: 'array', items: { type: 'string' }, minItems: 1 } },
        required: ['tags'],
      },
      'Doc',
    )

    expect(() => parse({ tags: [1] })).toThrow("[Doc] field 'tags' items expected string")
    expect(parse({ tags: ['a'] })).toEqual({ tags: ['a'] })
    expect(() => parse({ tags: [] })).toThrow('at least 1 items')
  })

  it('throws on an array item outside the item enum', () => {
    const parse = strictParser(
      {
        type: 'object',
        properties: { levels: { type: 'array', items: { enum: ['low', 'high'] } } },
        required: ['levels'],
      },
      'Doc',
    )

    expect(() => parse({ levels: ['low', 'nope'] })).toThrow("[Doc] field 'levels' items must be one of")
    expect(parse({ levels: ['low', 'high'] })).toEqual({ levels: ['low', 'high'] })
  })

  it('enforces scalar item types for a root-level array schema', () => {
    const assertion = generateScalarStrictAssertion({ type: 'array', items: { type: 'number' } }, 'Nums')

    expect(assertion).toContain('expected array')
    expect(assertion).toContain('typeof _it === "number"')
  })

  it('throws when a required union property matches no variant', () => {
    const parse = strictParser(
      {
        type: 'object',
        properties: {
          figure: {
            oneOf: [
              {
                type: 'object',
                properties: { kind: { const: 'circle' }, r: { type: 'number' } },
                required: ['kind', 'r'],
              },
              {
                type: 'object',
                properties: { kind: { const: 'rect' }, w: { type: 'number' } },
                required: ['kind', 'w'],
              },
            ],
          },
        },
        required: ['figure'],
      },
      'Shape',
    )

    expect(parse({ figure: { kind: 'circle', r: 1 } })).toEqual({ figure: { kind: 'circle', r: 1 } })
    expect(parse({ figure: { kind: 'rect', w: 2 } })).toEqual({ figure: { kind: 'rect', w: 2 } })
    expect(() => parse({ figure: { kind: 'bogus' } })).toThrow(
      "[Shape] field 'figure' does not match any allowed variant",
    )
    expect(() => parse({ figure: 'not-an-object' })).toThrow('does not match any allowed variant')
  })

  it('skips an absent optional union property but rejects a present mismatch', () => {
    const parse = strictParser(
      {
        type: 'object',
        properties: { extra: { anyOf: [{ type: 'string' }, { type: 'number' }] } },
      },
      'Doc',
    )

    expect(parse({})).toEqual({})
    expect(parse({ extra: 'ok' })).toEqual({ extra: 'ok' })
    expect(() => parse({ extra: true })).toThrow("[Doc] field 'extra' does not match any allowed variant")
  })

  it('leaves a union property unenforced when a branch cannot be checked safely', () => {
    // The allOf branch has no false-sound membership check, so strict mode
    // must keep the historical pass-through instead of guessing.
    const parse = strictParser(
      {
        type: 'object',
        properties: { x: { oneOf: [{ type: 'string' }, { allOf: [{ type: 'object' }] }] } },
        required: ['x'],
      },
      'Doc',
    )

    expect(parse({ x: true })).toEqual({ x: true })
  })

  it('skips union enforcement under stripUnknown', () => {
    const lines = generateObjectStrictAssertion(
      {
        type: 'object',
        properties: { v: { oneOf: [{ type: 'string' }, { type: 'number' }] } },
        required: ['v'],
      },
      'T',
      { stripUnknown: true },
    )

    expect(lines.join('\n')).not.toContain('does not match any allowed variant')
  })
})

describe('generate-strict-assertion tuple prefixItems', () => {
  it('asserts each tuple position and caps length under items:false', () => {
    const lines = generateObjectStrictAssertion(
      {
        type: 'object',
        properties: { pair: { type: 'array', prefixItems: [{ type: 'string' }, { type: 'number' }], items: false } },
        required: ['pair'],
      },
      'Doc',
    ).join('\n')

    expect(lines).toContain("field 'pair'[0] expected string")
    expect(lines).toContain("field 'pair'[1] expected number")
    expect(lines).toContain("field 'pair' must NOT have more than 2 items")
    // Each position check is length-guarded — a shorter array must not throw.
    expect(lines).toContain('input.pair.length > 0')
    expect(lines).toContain('input.pair.length > 1')
  })

  it('does not emit a length cap without items:false', () => {
    const lines = generateObjectStrictAssertion(
      {
        type: 'object',
        properties: { pair: { type: 'array', prefixItems: [{ type: 'string' }] } },
        required: ['pair'],
      },
      'Doc',
    ).join('\n')

    expect(lines).toContain("field 'pair'[0] expected string")
    expect(lines).not.toContain('must NOT have more than')
  })

  it('asserts a root-level tuple', () => {
    const line = generateScalarStrictAssertion(
      { type: 'array', prefixItems: [{ type: 'string' }, { type: 'integer' }], items: false },
      'Pair',
    )

    expect(line).toContain('[Pair][0] expected string')
    expect(line).toContain('[Pair][1] expected number')
    expect(line).toContain('[Pair] must NOT have more than 2 items')
  })

  it('resolves $ref tuple positions against the root schema', () => {
    const rootSchema = {
      $defs: { Tag: { type: 'string', enum: ['a', 'b'] } },
      type: 'object',
      properties: { entry: { type: 'array', prefixItems: [{ $ref: '#/$defs/Tag' }], items: false } },
      required: ['entry'],
    }
    const lines = generateObjectStrictAssertion(rootSchema as never, 'Root', { rootSchema }).join('\n')

    expect(lines).toContain("field 'entry'[0] must be one of:")
  })
})
