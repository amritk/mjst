import type { JSONSchema } from 'json-schema-typed/draft-2020-12'
import { describe, expect, it } from 'vitest'

import {
  canEnforceUnion,
  generateInlineObjectCheck,
  generatePropertyTypeCheck,
  generateUnionCheck,
  getUnionBranches,
  shapeValidatorName,
} from './generate-type-checks'

describe('generate-type-checks', () => {
  it('derives the shape validator name from the type name', () => {
    expect(shapeValidatorName('Contact')).toBe('validateContactShape')
  })

  it('checks enum properties by membership instead of bailing to null', () => {
    // The `=> false` stub this used to force is why validate{T}Shape rejected
    // valid input whenever a nested object carried an enum (e.g. axiom.kind).
    const check = generatePropertyTypeCheck('_kind', { enum: ['assume', 'derive'] }, true, '')
    expect(check).toBe('(_kind === "assume" || _kind === "derive")')
  })

  it('returns null for an empty enum', () => {
    expect(generatePropertyTypeCheck('_x', { enum: [] } as JSONSchema, true, '')).toBeNull()
  })

  it('checks $ref properties via the imported shape validator', () => {
    expect(generatePropertyTypeCheck('_owner', { $ref: '#/$defs/person' }, true, '')).toBe(
      'validatePersonShape(_owner)',
    )
  })

  it('parenthesizes a multi-branch union so callers can conjoin it', () => {
    // Without the outer parens the fast-path guard `a || b && c` bound the
    // wrong way and returned inputs with a missing required property.
    const check = generatePropertyTypeCheck('_name', { anyOf: [{ type: 'string' }, { type: 'number' }] }, true, '')
    expect(check).toBe('((typeof _name === "string") || (typeof _name === "number"))')
  })

  it('builds inline object branch checks with const tags and required properties', () => {
    const branch: JSONSchema = {
      type: 'object',
      properties: { kind: { const: 'circle' }, r: { type: 'number' } },
      required: ['kind', 'r'],
    }
    const check = generateInlineObjectCheck('_figure', branch, true, '')
    expect(check).toBe('isObject(_figure) && _figure.kind === "circle" && typeof _figure.r === "number"')
  })

  it('guards optional properties of an inline object with an undefined escape', () => {
    const branch: JSONSchema = { type: 'object', properties: { name: { type: 'string' } } }
    expect(generateInlineObjectCheck('_v', branch, true, '')).toBe(
      'isObject(_v) && (_v.name === undefined || typeof _v.name === "string")',
    )
  })

  it('rejects extra keys in an inline object branch with additionalProperties false', () => {
    const branch: JSONSchema = {
      type: 'object',
      properties: { kind: { const: 'a' } },
      required: ['kind'],
      additionalProperties: false,
    }
    expect(generateInlineObjectCheck('_v', branch, true, '')).toContain(
      'Object.keys(_v).every((_k) => ["kind"].includes(_k))',
    )
  })

  it('returns null for an inline object branch with record semantics', () => {
    // additionalProperties-as-schema would leave the record values unchecked,
    // so a `true` result could not be trusted by fast paths.
    const branch: JSONSchema = {
      type: 'object',
      properties: { kind: { const: 'a' } },
      additionalProperties: { type: 'string' },
    }
    expect(generateInlineObjectCheck('_v', branch, true, '')).toBeNull()
  })

  it('builds a union membership check mixing inline branches and refs', () => {
    const branches: JSONSchema[] = [
      {
        type: 'object',
        properties: { kind: { const: 'lit' }, value: { type: 'number' } },
        required: ['kind', 'value'],
      },
      { $ref: '#/$defs/expr' },
    ]
    expect(generateUnionCheck('input', branches, true, '')).toBe(
      '((isObject(input) && input.kind === "lit" && typeof input.value === "number") || (validateExprShape(input)))',
    )
  })

  it('returns null when any union branch cannot be checked', () => {
    const branches: JSONSchema[] = [{ type: 'string' }, { allOf: [{ type: 'object' }] }]
    expect(generateUnionCheck('input', branches, true, '')).toBeNull()
  })

  it('extracts oneOf/anyOf branches and rejects mixed composition', () => {
    expect(getUnionBranches({ oneOf: [{ type: 'string' }] })).toHaveLength(1)
    expect(getUnionBranches({ anyOf: [{ type: 'string' }] })).toHaveLength(1)
    expect(getUnionBranches({ oneOf: [{ type: 'string' }], allOf: [{}] })).toBeNull()
    expect(getUnionBranches({ type: 'object' })).toBeNull()
  })

  it('approves strict enforcement for a recursive union reachable through $refs', () => {
    // The spec-plan `expr` shape: branches reference the union itself. The
    // cycle must be assumed sound, not rejected or looped on.
    const rootSchema = {
      $defs: {
        expr: {
          oneOf: [
            { type: 'object', properties: { kind: { const: 'lit' }, value: { type: 'number' } }, required: ['kind'] },
            {
              type: 'object',
              properties: { kind: { const: 'add' }, left: { $ref: '#/$defs/expr' }, right: { $ref: '#/$defs/expr' } },
              required: ['kind', 'left', 'right'],
            },
          ],
        },
      },
    }
    const branches = (rootSchema.$defs.expr as { oneOf: JSONSchema[] }).oneOf
    expect(canEnforceUnion(branches, rootSchema)).toBe(true)
  })

  it('refuses strict enforcement when a ref target would have a stub validator', () => {
    // `blob` uses patternProperties, so its generated validate{Blob}Shape is
    // the conservative `=> false` stub — throwing on it would reject valid
    // input. The union must stay unenforced.
    const rootSchema = {
      $defs: {
        blob: { type: 'object', properties: { a: { type: 'string' } }, patternProperties: { '^x-': {} } },
      },
    }
    const branches: JSONSchema[] = [{ $ref: '#/$defs/blob' }, { type: 'string' }]
    expect(canEnforceUnion(branches, rootSchema)).toBe(false)
  })

  it('refuses strict enforcement without a root schema to resolve refs against', () => {
    expect(canEnforceUnion([{ $ref: '#/$defs/x' }], undefined)).toBe(false)
  })

  it('trusts a ref target whose array items are provably checkable inline objects', () => {
    // `plan.steps` items carry an enum — the emitted validatePlanShape walks
    // every element through a real private item predicate, so the union may
    // enforce membership strictly.
    const rootSchema = {
      $defs: {
        plan: {
          type: 'object',
          properties: {
            steps: {
              type: 'array',
              items: { type: 'object', properties: { kind: { enum: ['a', 'b'] } }, required: ['kind'] },
            },
          },
          required: ['steps'],
        },
      },
    }
    const branches: JSONSchema[] = [{ $ref: '#/$defs/plan' }, { type: 'string' }]
    expect(canEnforceUnion(branches, rootSchema)).toBe(true)
  })

  it('stays sound when array items carry a bare then/else keyword', () => {
    // generateShapeValidator stubs any schema with then/else; such items are
    // excluded from the inline machinery, so the branch validator keeps a
    // shallow (real) array check and strict enforcement remains safe.
    const rootSchema = {
      $defs: {
        plan: {
          type: 'object',
          properties: {
            list: {
              type: 'array',
              items: { type: 'object', properties: { x: { type: 'string' } }, then: { required: ['x'] } },
            },
          },
          required: ['list'],
        },
      },
    }
    const branches: JSONSchema[] = [{ $ref: '#/$defs/plan' }, { type: 'string' }]
    expect(canEnforceUnion(branches, rootSchema)).toBe(true)
  })

  it('refuses strict enforcement when an array-item sub-predicate would be a stub', () => {
    // The item schema carries an `allOf` property, so its private shape
    // predicate is the `=> false` stub; validatePlanShape then returns false on
    // *valid* input, and throwing on that would reject valid values.
    const rootSchema = {
      $defs: {
        plan: {
          type: 'object',
          properties: {
            steps: {
              type: 'array',
              items: {
                type: 'object',
                properties: { weird: { allOf: [{ type: 'string' }] } },
                required: ['weird'],
              },
            },
          },
          required: ['steps'],
        },
      },
    }
    const branches: JSONSchema[] = [{ $ref: '#/$defs/plan' }, { type: 'string' }]
    expect(canEnforceUnion(branches, rootSchema)).toBe(false)
  })

  it('refuses strict enforcement when an inline object property hides a stub sub-predicate', () => {
    // Deep mirror of generateShapeValidator: a nested inline object's private
    // predicate is built from its own properties, so an uncheckable one (allOf)
    // stubs it and poisons every validator built on top of it.
    const rootSchema = {
      $defs: {
        plan: {
          type: 'object',
          properties: {
            meta: {
              type: 'object',
              properties: { weird: { allOf: [{ type: 'string' }] } },
              required: ['weird'],
            },
          },
          required: ['meta'],
        },
      },
    }
    const branches: JSONSchema[] = [{ $ref: '#/$defs/plan' }, { type: 'string' }]
    expect(canEnforceUnion(branches, rootSchema)).toBe(false)
  })

  it('approves strict enforcement for inline-only branches without a root schema', () => {
    const branches: JSONSchema[] = [{ type: 'string' }, { type: 'number' }]
    expect(canEnforceUnion(branches, undefined)).toBe(true)
  })
})
