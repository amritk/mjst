import type { JSONSchema } from 'json-schema-typed/draft-2020-12'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

import { generateParserFunction } from './generate-parser-function'
import { generateValidationExpression } from './generate-validation-expression'

/**
 * Guards every codegen path against emitting TypeScript that does not parse.
 * The generators produce source text by string concatenation, so a structural
 * bug (an unbalanced ternary, a broken accessor for a quoted key, a split regex
 * literal) shows up only as a *syntax* error in the output — which unit tests
 * asserting on substrings can miss. We feed representative output through the
 * TypeScript parser and assert it reports ZERO syntactic diagnostics.
 *
 * `transpileModule` performs a syntax-only pass (no type checking, no module
 * resolution), so undefined helper references like `isObject` or `parseFoo` are
 * fine — only genuine parse errors surface.
 */
const syntaxErrors = (code: string): string[] => {
  const result = ts.transpileModule(code, {
    reportDiagnostics: true,
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ESNext },
  })
  return (result.diagnostics ?? [])
    .filter((d) => d.category === ts.DiagnosticCategory.Error)
    .map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n'))
}

/** Wraps a bare parser expression in a statement so it can be parsed standalone. */
const asStatement = (expr: string): string => `const _result: unknown = (${expr});\n`

describe('generated-code-syntax', () => {
  it('emits a parseable nested ternary for a discriminated union (>= 2 branches)', () => {
    // R1: the old folding produced `c1 ? v : d1 : c0 ? v : d0`, a parse error.
    const schema: JSONSchema = {
      oneOf: [
        { type: 'object', properties: { kind: { const: 'dog' }, bark: { type: 'boolean' } } },
        { type: 'object', properties: { kind: { const: 'cat' }, meow: { type: 'boolean' } } },
        { type: 'object', properties: { kind: { const: 'bird' }, tweet: { type: 'boolean' } } },
      ],
    }
    const expr = generateValidationExpression('pet', schema, '{}', true)
    expect(syntaxErrors(asStatement(expr))).toEqual([])
  })

  it('emits a parseable discriminated union with a non-identifier discriminator key', () => {
    // R1: `${accessor}?.${key}` breaks for a key like `x-type`; safeAccessor fixes it.
    const schema: JSONSchema = {
      oneOf: [
        { type: 'object', properties: { 'x-type': { const: 'a' } } },
        { type: 'object', properties: { 'x-type': { const: 'b' } } },
      ],
    }
    const expr = generateValidationExpression('node', schema, '{}', true)
    expect(syntaxErrors(asStatement(expr))).toEqual([])
  })

  it('emits a parseable parser for patternProperties with $ref values', () => {
    const schema: JSONSchema = {
      type: 'object',
      properties: { default: { $ref: '#/$defs/response' } },
      patternProperties: { '^[1-5](?:[0-9]{2}|XX)$': { $ref: '#/$defs/response' } },
    }
    const code = generateParserFunction(schema, 'Responses', { useRefImports: true })
    expect(syntaxErrors(code)).toEqual([])
  })

  it('emits a parseable parser for quotes-in-keys and hyphenated keys', () => {
    const schema: JSONSchema = {
      type: 'object',
      properties: {
        'weird"key': { type: 'string' },
        'x-linkedin': { type: 'string' },
        "it's": { type: 'number' },
      },
      required: ['weird"key'],
    }
    const code = generateParserFunction(schema, 'Quoted')
    expect(syntaxErrors(code)).toEqual([])
  })

  it('emits a parseable parser for a multi-type (nullable) property', () => {
    const schema: JSONSchema = {
      type: 'object',
      properties: { nickname: { type: ['string', 'null'] }, count: { type: ['integer', 'null'] } },
      required: ['nickname'],
    }
    const code = generateParserFunction(schema, 'Multi')
    expect(syntaxErrors(code)).toEqual([])
  })

  it('emits a parseable parser combining all of the above', () => {
    const schema: JSONSchema = {
      type: 'object',
      properties: {
        'x-kind': { type: ['string', 'null'] },
        pet: {
          oneOf: [
            { type: 'object', properties: { kind: { const: 'dog' } } },
            { type: 'object', properties: { kind: { const: 'cat' } } },
          ],
        },
        code: { type: 'string', pattern: '^[A-Z]{2}/\\d+$' },
      },
      patternProperties: { '^ext-': { type: 'string' } },
    }
    const code = generateParserFunction(schema, 'Everything')
    expect(syntaxErrors(code)).toEqual([])
  })
})
