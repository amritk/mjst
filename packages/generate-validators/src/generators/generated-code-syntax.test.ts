import type { JSONSchema } from 'json-schema-typed/draft-2020-12'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

import { generateBooleanGuard, generateValidatorFunction } from './generate-validator-function'

/**
 * Guards every codegen path against emitting TypeScript that does not parse.
 * The generators build source text by string concatenation, so a structural bug
 * (an unbalanced expression, a broken accessor for a quoted key, a split regex
 * literal) surfaces only as a *syntax* error in the output — which substring
 * assertions can miss. We feed representative output through the TypeScript
 * parser and assert it reports ZERO syntactic diagnostics.
 *
 * `transpileModule` is a syntax-only pass (no type checking, no module
 * resolution), so undefined references like `validateFoo` or `isObject` are fine
 * — only genuine parse errors surface.
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

describe('generated-code-syntax', () => {
  it('emits a parseable validator for a discriminated-union property (oneOf)', () => {
    const schema: JSONSchema = {
      type: 'object',
      properties: {
        pet: {
          oneOf: [
            { type: 'object', properties: { kind: { const: 'dog' }, bark: { type: 'boolean' } }, required: ['kind'] },
            { type: 'object', properties: { kind: { const: 'cat' }, meow: { type: 'boolean' } }, required: ['kind'] },
          ],
        },
      },
    }
    expect(syntaxErrors(generateValidatorFunction(schema, 'Owner'))).toEqual([])
  })

  it('emits a parseable validator for patternProperties with $ref values', () => {
    const schema: JSONSchema = {
      type: 'object',
      properties: { default: { $ref: '#/$defs/response' } },
      patternProperties: { '^[1-5](?:[0-9]{2}|XX)$': { $ref: '#/$defs/response' } },
      additionalProperties: false,
    }
    expect(syntaxErrors(generateValidatorFunction(schema, 'Responses'))).toEqual([])
  })

  it('emits a parseable validator for quotes-in-keys and hyphenated keys', () => {
    const schema: JSONSchema = {
      type: 'object',
      properties: {
        'weird"key': { type: 'string', pattern: '^a/b$' },
        'x-linkedin': { type: 'string' },
        "it's": { type: 'number', minimum: 0 },
      },
      required: ['weird"key'],
    }
    expect(syntaxErrors(generateValidatorFunction(schema, 'Quoted'))).toEqual([])
  })

  it('emits a parseable validator for multi-type (nullable) properties and root', () => {
    const propSchema: JSONSchema = {
      type: 'object',
      properties: { nickname: { type: ['string', 'null'] }, count: { type: ['integer', 'null'] } },
      required: ['nickname'],
    }
    expect(syntaxErrors(generateValidatorFunction(propSchema, 'Multi'))).toEqual([])

    const rootSchema: JSONSchema = { type: ['string', 'number', 'null'] }
    expect(syntaxErrors(generateValidatorFunction(rootSchema, 'RootMulti'))).toEqual([])
  })

  it('emits a parseable root scalar validator with number and array constraints', () => {
    expect(syntaxErrors(generateValidatorFunction({ type: 'number', minimum: 5, multipleOf: 3 }, 'N'))).toEqual([])
    expect(
      syntaxErrors(generateValidatorFunction({ type: 'array', items: { type: 'string' }, minItems: 2 }, 'A')),
    ).toEqual([])
  })

  it('emits a parseable boolean guard for a mixed object schema', () => {
    const schema: JSONSchema = {
      type: 'object',
      properties: {
        'x-tag': { type: ['string', 'null'] },
        age: { type: 'integer', minimum: 0, multipleOf: 1 },
        tags: { type: 'array', items: { type: 'string' } },
      },
      required: ['age'],
    }
    expect(syntaxErrors(generateBooleanGuard(schema, 'Mixed'))).toEqual([])
  })
})
