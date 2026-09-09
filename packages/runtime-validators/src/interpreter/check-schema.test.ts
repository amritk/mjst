import { describe, expect, it } from 'vitest'
import { checkSchema, isSchemaError } from '@/interpreter/check-schema'
import { metaschema } from '@/metaschema/index'
import { validate } from '@/validate'
import { validateGuard } from '@/validate-guard'

/** The keywords of the first issue found in `schema`, for terse assertions. */
const keywords = (schema: unknown): string[] => checkSchema(schema).map((issue) => issue.keyword)

describe('check-schema', () => {
  it('reports a keyword carrying the wrong kind of value', () => {
    // The costliest silence: none of these is an assertion, so each schema
    // enforces nothing at all where its author expected a constraint.
    expect(keywords({ type: 'object', required: 'name' })).toEqual(['required'])
    expect(keywords({ type: 'object', properties: 'nope' })).toEqual(['properties'])
    expect(keywords({ type: 'string', minLength: '5' })).toEqual(['minLength'])
    expect(keywords({ enum: 'abc' })).toEqual(['enum'])
    expect(keywords({ allOf: {} })).toEqual(['allOf'])
    expect(keywords({ $ref: 5 })).toEqual(['$ref'])
    expect(keywords({ type: 'object', required: [1, 2] })).toEqual(['required'])
  })

  it('reports a keyword nobody recognizes', () => {
    expect(keywords({ type: 'string', maxlength: 5 })).toEqual(['maxlength'])
    expect(keywords({ type: 'object', requred: ['a'] })).toEqual(['requred'])
    expect(keywords({ type: 'array', contains: {}, mincontains: 2 })).toEqual(['mincontains'])
  })

  it('leaves an x- extension alone', () => {
    // Flagging these would make the check unusable on an OpenAPI document, and
    // `x-` is exactly the convention for "this one is mine".
    expect(checkSchema({ type: 'string', 'x-mjst': { brand: 'UserId' } })).toEqual([])
  })

  it('reports a value that makes its keyword meaningless', () => {
    expect(keywords({ enum: [] })).toEqual(['enum'])
    expect(keywords({ type: 'number', multipleOf: 0 })).toEqual(['multipleOf'])
    expect(keywords({ type: 'number', multipleOf: -2 })).toEqual(['multipleOf'])
    expect(keywords({ type: 'string', minLength: -5 })).toEqual(['minLength'])
    expect(keywords({ type: 'string', minLength: 1.5 })).toEqual(['minLength'])
  })

  it('reports a type name that is not a JSON Schema type', () => {
    // The interpreter throws on this when the keyword is consulted; saying so
    // when the schema is written is better than saying so mid-request.
    expect(keywords({ type: 'strng' })).toEqual(['type'])
    expect(keywords({ type: ['string', 'nmber'] })).toEqual(['type'])
  })

  it('reports a constraint the node type has already ruled out', () => {
    // Either the `type` or the keyword is wrong; the schema as written runs the
    // bound against nothing.
    expect(keywords({ type: 'string', minimum: 3 })).toEqual(['minimum'])
    expect(keywords({ type: 'object', maxItems: 3 })).toEqual(['maxItems'])
    // A union that admits the family is fine, and so is declaring no type at all.
    expect(checkSchema({ type: ['string', 'number'], minimum: 3 })).toEqual([])
    expect(checkSchema({ minimum: 3 })).toEqual([])
    // `integer` is a number for this purpose.
    expect(checkSchema({ type: 'integer', minimum: 3 })).toEqual([])
  })

  it('reports a format nobody defines', () => {
    expect(keywords({ type: 'string', format: 'not-a-format' })).toEqual(['format'])
    // A built-in name is fine whether or not this schema will be validated with
    // formats enabled — naming one is a legitimate annotation.
    expect(checkSchema({ type: 'string', format: 'uuid' })).toEqual([])
    expect(checkSchema({ type: 'string', format: 'phone' }, { extraFormats: ['phone'] })).toEqual([])
  })

  it('accepts the spellings the interpreter genuinely supports', () => {
    // Each of these would be a false positive that made the check unusable.
    expect(checkSchema({ type: 'number', maximum: 5, exclusiveMaximum: true })).toEqual([]) // draft-04
    expect(checkSchema({ type: 'array', items: [{ type: 'string' }], additionalItems: false })).toEqual([]) // draft-07
    expect(checkSchema({ type: 'object', dependencies: { a: ['b'] } })).toEqual([]) // draft-07
    expect(checkSchema({ type: 'string', nullable: true })).toEqual([]) // OpenAPI 3.0
    expect(checkSchema({ $recursiveAnchor: true, $recursiveRef: '#' })).toEqual([]) // 2019-09
    expect(checkSchema(true)).toEqual([])
    expect(checkSchema({ type: 'object', properties: { a: true, b: false } })).toEqual([])
  })

  it('reports a keyword its own siblings make inert', () => {
    // `additionalItems` is draft-07's tail keyword and needs an array-form
    // `items` to be the tail of. Alongside `prefixItems` it is a half-ported
    // schema, where the 2020-12 tail keyword is `items`.
    expect(keywords({ type: 'array', additionalItems: { type: 'string' } })).toEqual(['additionalItems'])
    expect(keywords({ type: 'array', additionalItems: false, prefixItems: [{}] })).toEqual(['additionalItems'])
    // With an array-form `items` it is the ordinary draft-07 tuple spelling.
    expect(checkSchema({ type: 'array', items: [{ type: 'string' }], additionalItems: false })).toEqual([])
  })

  it('reports a closed object that requires a property it does not declare', () => {
    expect(keywords({ type: 'object', properties: { a: {} }, required: ['b'], additionalProperties: false })).toEqual([
      'required',
    ])
    // Open objects and `patternProperties` both leave a way for `b` to arrive.
    expect(checkSchema({ type: 'object', properties: { a: {} }, required: ['b'] })).toEqual([])
    expect(
      checkSchema({
        type: 'object',
        properties: { a: {} },
        patternProperties: { '^b': {} },
        required: ['b'],
        additionalProperties: false,
      }),
    ).toEqual([])
  })

  it('walks into every subschema', () => {
    expect(checkSchema({ $defs: { a: { type: 'string', maxLenght: 3 } } })[0]?.path).toBe('/$defs/a/maxLenght')
    expect(checkSchema({ properties: { a: { patern: 'x' } } })[0]?.path).toBe('/properties/a/patern')
    expect(checkSchema({ allOf: [{}, { requred: [] }] })[0]?.path).toBe('/allOf/1/requred')
    expect(checkSchema({ items: { contains: { minLenght: 1 } } })[0]?.path).toBe('/items/contains/minLenght')
  })

  it('does not read instance data as if it were a schema', () => {
    // Inside `enum`, `const`, `default` and `examples` a key called `properties`
    // is a property name, not a keyword — the same rule the pattern screen and
    // the `$id` registry follow.
    expect(checkSchema({ enum: [{ properties: 'not a keyword', maxlength: 1 }] })).toEqual([])
    expect(checkSchema({ const: { requred: ['a'] } })).toEqual([])
    expect(checkSchema({ default: { maxlength: 5 } })).toEqual([])
    // A definition or property genuinely *named* `default` is ordinary, and its
    // subtree is a schema.
    expect(checkSchema({ properties: { default: { maxlength: 5 } } })[0]?.path).toBe('/properties/default/maxlength')
  })

  it('escapes a property name in the reported pointer', () => {
    expect(checkSchema({ properties: { 'a/b': { maxlength: 1 } } })[0]?.path).toBe('/properties/a~1b/maxlength')
  })

  it('says nothing about a schema that says what it means', () => {
    const schema = {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      $id: 'https://example.com/user',
      title: 'User',
      description: 'A person',
      type: 'object',
      properties: {
        id: { type: 'integer', minimum: 1, format: 'int32' },
        name: { type: 'string', minLength: 1, maxLength: 100 },
        tags: { type: 'array', items: { type: 'string' }, uniqueItems: true, maxItems: 10 },
        kind: { enum: ['a', 'b'] },
      },
      required: ['id', 'name'],
      additionalProperties: false,
      $defs: { unused: { type: 'null' } },
    }

    expect(checkSchema(schema)).toEqual([])
  })

  it('reports nothing for the dialect metaschema itself', () => {
    // The strongest false-positive test available: the specification's own eight
    // documents, which use every core keyword exactly as it is meant to be used.
    // Anything this check flags in them is a bug in the check.
    const documents = Object.entries(metaschema)
    expect(documents.length).toBe(8)

    for (const [uri, document] of documents) {
      expect(checkSchema(document), uri).toEqual([])
    }
  })

  it('refuses to build a validator under strict, and builds one without it', () => {
    const schema = { type: 'object', requred: ['a'] }

    expect(() => validate(schema, { strict: true })).toThrow(/Unknown keyword "requred"/)
    expect(() => validateGuard(schema, { strict: true })).toThrow(/Unknown keyword "requred"/)
    // The permissive reading is the specification's, so it stays the default.
    expect(validate(schema)({})).toBe(true)
  })

  it('throws a recognizable error carrying the findings', () => {
    try {
      validate({ type: 'string', minLength: '5', maxlength: 3 }, { strict: true })
      expect.unreachable('strict should have refused this schema')
    } catch (error) {
      expect(isSchemaError(error)).toBe(true)
      expect(error).toBeInstanceOf(Error)
      expect((error as { issues: { keyword: string }[] }).issues.map((issue) => issue.keyword)).toEqual([
        'minLength',
        'maxlength',
      ])
    }
  })

  it('keys the validator cache on strict, so one setting never answers for the other', () => {
    // Same schema, and the answer is a refusal under one setting and a validator
    // under the other — a shared entry would make whichever ran first win.
    const schema = { type: 'string', maxlength: 3 }
    expect(validate(schema)('anything')).toBe(true)
    expect(() => validate(schema, { strict: true })).toThrow()
    expect(validate(schema)('anything')).toBe(true)
  })
})
