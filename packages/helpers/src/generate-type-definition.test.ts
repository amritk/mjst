import type { JSONSchema } from 'json-schema-typed/draft-2020-12'
import { describe, expect, it } from 'vitest'

import { generateTypeDefinition } from './generate-type-definition'

describe('generateTypeDefinition', () => {
  it('generates type for deeply nested objects', () => {
    const schema = {
      type: 'object',
      properties: {
        user: {
          type: 'object',
          properties: {
            profile: {
              type: 'object',
              properties: {
                address: {
                  type: 'object',
                  properties: {
                    street: { type: 'string' },
                    city: { type: 'string' },
                    zipCode: { type: 'string' },
                  },
                  required: ['street', 'city'],
                },
              },
            },
          },
        },
      },
    }

    const result = generateTypeDefinition(schema, 'DeeplyNested')

    expect(result).toStrictEqual(
      'export type DeeplyNested = {\n' +
        '  user?: { profile?: { address?: { street: string; city: string; zipCode?: string } } };\n' +
        '};',
    )
  })

  it('generates type for array of nested objects', () => {
    const schema = {
      type: 'object',
      properties: {
        users: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'number' },
              name: { type: 'string' },
              email: { type: 'string' },
            },
            required: ['id', 'name'],
          },
        },
      },
      required: ['users'],
    }

    const result = generateTypeDefinition(schema, 'UserList')

    expect(result).toStrictEqual(
      'export type UserList = {\n' + '  users: { id: number; name: string; email?: string }[];\n' + '};',
    )
  })

  it('generates type for nested arrays', () => {
    const schema = {
      type: 'object',
      properties: {
        matrix: {
          type: 'array',
          items: {
            type: 'array',
            items: {
              type: 'number',
            },
          },
        },
      },
    }

    const result = generateTypeDefinition(schema, 'Matrix')

    expect(result).toStrictEqual('export type Matrix = {\n' + '  matrix?: number[][];\n' + '};')
  })

  it('generates type for mixed required and optional fields', () => {
    const schema = {
      type: 'object',
      properties: {
        id: { type: 'string' },
        name: { type: 'string' },
        email: { type: 'string' },
        age: { type: 'number' },
        active: { type: 'boolean' },
        tags: { type: 'array', items: { type: 'string' } },
      },
      required: ['id', 'name', 'email'],
    }

    const result = generateTypeDefinition(schema, 'MixedFields')

    expect(result).toStrictEqual(
      'export type MixedFields = {\n' +
        '  id: string;\n' +
        '  name: string;\n' +
        '  email: string;\n' +
        '  age?: number;\n' +
        '  active?: boolean;\n' +
        '  tags?: string[];\n' +
        '};',
    )
  })

  it('generates type for object with all primitive types', () => {
    const schema = {
      type: 'object',
      properties: {
        stringField: { type: 'string' },
        numberField: { type: 'number' },
        integerField: { type: 'integer' },
        booleanField: { type: 'boolean' },
      },
      required: ['stringField', 'numberField', 'integerField', 'booleanField'],
    }

    const result = generateTypeDefinition(schema, 'AllPrimitives')

    expect(result).toStrictEqual(
      'export type AllPrimitives = {\n' +
        '  stringField: string;\n' +
        '  numberField: number;\n' +
        '  integerField: number;\n' +
        '  booleanField: boolean;\n' +
        '};',
    )
  })

  it('generates type for array without items definition', () => {
    const schema = {
      type: 'object',
      properties: {
        data: {
          type: 'array',
        },
      },
    }

    const result = generateTypeDefinition(schema, 'UnknownArray')

    expect(result).toStrictEqual('export type UnknownArray = {\n' + '  data?: unknown[];\n' + '};')
  })

  it('generates type for object without properties', () => {
    const schema = {
      type: 'object',
      properties: {
        metadata: {
          type: 'object',
        },
      },
    }

    const result = generateTypeDefinition(schema, 'Generic')

    expect(result).toStrictEqual('export type Generic = {\n' + '  metadata?: object;\n' + '};')
  })

  it('generates type for complex nested structure with arrays and objects', () => {
    const schema = {
      type: 'object',
      properties: {
        company: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            departments: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  name: { type: 'string' },
                  employees: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        id: { type: 'number' },
                        name: { type: 'string' },
                      },
                      required: ['id'],
                    },
                  },
                },
                required: ['name'],
              },
            },
          },
          required: ['name'],
        },
      },
      required: ['company'],
    }

    const result = generateTypeDefinition(schema, 'Company')

    expect(result).toStrictEqual(
      'export type Company = {\n' +
        '  company: { name: string; departments?: { name: string; employees?: { id: number; name?: string }[] }[] };\n' +
        '};',
    )
  })

  it('generates type for empty object schema', () => {
    const schema = {
      type: 'object',
      properties: {},
    }

    const result = generateTypeDefinition(schema, 'Empty')

    expect(result).toStrictEqual('export type Empty = {};')
  })

  it('generates type for object with no type specified', () => {
    const schema = {
      properties: {
        field: { type: 'string' },
      },
    }

    const result = generateTypeDefinition(schema, 'NoType')

    expect(result).toStrictEqual('export type NoType = {\n' + '  field?: string;\n' + '};')
  })

  it('generates type for boolean schema true (any value valid)', () => {
    const schema = true

    const result = generateTypeDefinition(schema, 'BooleanSchema')

    expect(result).toStrictEqual('export type BooleanSchema = unknown;')
  })

  it('generates type for boolean schema false (no value valid)', () => {
    const schema = false

    const result = generateTypeDefinition(schema, 'NeverSchema')

    expect(result).toStrictEqual('export type NeverSchema = never;')
  })

  it('generates type for array of arrays of objects', () => {
    const schema = {
      type: 'object',
      properties: {
        grid: {
          type: 'array',
          items: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                x: { type: 'number' },
                y: { type: 'number' },
                value: { type: 'string' },
              },
              required: ['x', 'y'],
            },
          },
        },
      },
    }

    const result = generateTypeDefinition(schema, 'Grid')

    expect(result).toStrictEqual(
      'export type Grid = {\n' + '  grid?: { x: number; y: number; value?: string }[][];\n' + '};',
    )
  })

  it('generates type for object with all fields required', () => {
    const schema = {
      type: 'object',
      properties: {
        id: { type: 'string' },
        name: { type: 'string' },
        email: { type: 'string' },
        age: { type: 'number' },
      },
      required: ['id', 'name', 'email', 'age'],
    }

    const result = generateTypeDefinition(schema, 'AllRequired')

    expect(result).toStrictEqual(
      'export type AllRequired = {\n' +
        '  id: string;\n' +
        '  name: string;\n' +
        '  email: string;\n' +
        '  age: number;\n' +
        '};',
    )
  })

  it('generates type for object with no fields required', () => {
    const schema = {
      type: 'object',
      properties: {
        id: { type: 'string' },
        name: { type: 'string' },
        email: { type: 'string' },
      },
    }

    const result = generateTypeDefinition(schema, 'AllOptional')

    expect(result).toStrictEqual(
      'export type AllOptional = {\n' + '  id?: string;\n' + '  name?: string;\n' + '  email?: string;\n' + '};',
    )
  })

  it('generates type for complex API response structure', () => {
    const schema = {
      type: 'object',
      properties: {
        status: { type: 'string' },
        data: {
          type: 'object',
          properties: {
            users: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'number' },
                  username: { type: 'string' },
                  profile: {
                    type: 'object',
                    properties: {
                      avatar: { type: 'string' },
                      bio: { type: 'string' },
                    },
                  },
                },
                required: ['id', 'username'],
              },
            },
            pagination: {
              type: 'object',
              properties: {
                page: { type: 'number' },
                perPage: { type: 'number' },
                total: { type: 'number' },
              },
              required: ['page', 'perPage', 'total'],
            },
          },
          required: ['users'],
        },
        error: {
          type: 'object',
          properties: {
            code: { type: 'string' },
            message: { type: 'string' },
          },
        },
      },
      required: ['status'],
    }

    const result = generateTypeDefinition(schema, 'APIResponse')

    expect(result).toStrictEqual(
      'export type APIResponse = {\n' +
        '  status: string;\n' +
        '  data?: { users: { id: number; username: string; profile?: { avatar?: string; bio?: string } }[]; pagination?: { page: number; perPage: number; total: number } };\n' +
        '  error?: { code?: string; message?: string };\n' +
        '};',
    )
  })

  it('generates type for array of different primitive types', () => {
    const schema = {
      type: 'object',
      properties: {
        strings: {
          type: 'array',
          items: { type: 'string' },
        },
        numbers: {
          type: 'array',
          items: { type: 'number' },
        },
        booleans: {
          type: 'array',
          items: { type: 'boolean' },
        },
      },
    }

    const result = generateTypeDefinition(schema, 'ArrayTypes')

    expect(result).toStrictEqual(
      'export type ArrayTypes = {\n' +
        '  strings?: string[];\n' +
        '  numbers?: number[];\n' +
        '  booleans?: boolean[];\n' +
        '};',
    )
  })

  it('generates type for recursive-like structure', () => {
    const schema = {
      type: 'object',
      properties: {
        id: { type: 'string' },
        children: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              children: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    id: { type: 'string' },
                  },
                  required: ['id'],
                },
              },
            },
            required: ['id'],
          },
        },
      },
      required: ['id'],
    }

    const result = generateTypeDefinition(schema, 'TreeNode')

    expect(result).toStrictEqual(
      'export type TreeNode = {\n' +
        '  id: string;\n' +
        '  children?: { id: string; children?: { id: string }[] }[];\n' +
        '};',
    )
  })

  it('generates type for schema with mixed nested structures', () => {
    const schema = {
      type: 'object',
      properties: {
        config: {
          type: 'object',
          properties: {
            settings: {
              type: 'object',
              properties: {
                enabled: { type: 'boolean' },
                options: {
                  type: 'array',
                  items: { type: 'string' },
                },
              },
              required: ['enabled'],
            },
            metadata: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  key: { type: 'string' },
                  value: { type: 'string' },
                },
                required: ['key', 'value'],
              },
            },
          },
        },
      },
    }

    const result = generateTypeDefinition(schema, 'Configuration')

    expect(result).toStrictEqual(
      'export type Configuration = {\n' +
        '  config?: { settings?: { enabled: boolean; options?: string[] }; metadata?: { key: string; value: string }[] };\n' +
        '};',
    )
  })

  it('generates type for schema with property without type', () => {
    const schema = {
      type: 'object',
      properties: {
        name: { type: 'string' },
        unknownField: {},
        age: { type: 'number' },
      },
      required: ['name'],
    }

    const result = generateTypeDefinition(schema, 'UnknownField')

    expect(result).toStrictEqual(
      'export type UnknownField = {\n' +
        '  name: string;\n' +
        '  unknownField?: unknown;\n' +
        '  age?: number;\n' +
        '};',
    )
  })

  it('generates type for deeply nested array structures with mixed types', () => {
    const schema: JSONSchema.Object = {
      type: 'object',
      properties: {
        data: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              tags: {
                type: 'array',
                items: { type: 'string' },
              },
              metadata: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    key: { type: 'string' },
                    values: {
                      type: 'array',
                      items: { type: 'number' },
                    },
                  },
                  required: ['key'],
                },
              },
            },
            required: ['id'],
          },
        },
      },
      required: ['data'],
    }

    const result = generateTypeDefinition(schema, 'ComplexNestedArrays')

    expect(result).toStrictEqual(
      'export type ComplexNestedArrays = {\n' +
        '  data: { id: string; tags?: string[]; metadata?: { key: string; values?: number[] }[] }[];\n' +
        '};',
    )
  })

  it('generates type for info-like object schema with URL $comment as JSDoc description', () => {
    const info: JSONSchema.Object = {
      $comment: 'https://spec.openapis.org/oas/v3.1#info-object',
      type: 'object',
      properties: {
        title: { type: 'string' },
        summary: { type: 'string' },
        contact: { $ref: '#/$defs/contact' },
        version: { type: 'string' },
      },
      required: ['title', 'version'],
    }

    const result = generateTypeDefinition(info, 'Info')

    expect(result).toStrictEqual(
      '/**\n' +
        '* Info\n' +
        '*\n' +
        '* https://spec.openapis.org/oas/v3.1#info-object\n' +
        '*/\n' +
        'export type Info = {\n' +
        '  title: string;\n' +
        '  summary?: string;\n' +
        '  contact?: Contact;\n' +
        '  version: string;\n' +
        '};',
    )
  })

  it('generates type for object with additionalProperties refs as Record type', () => {
    const components: JSONSchema.Object = {
      type: 'object',
      properties: {
        responses: {
          type: 'object',
          additionalProperties: { $ref: '#/$defs/response' },
        },
        parameters: {
          type: 'object',
          additionalProperties: { $ref: '#/$defs/parameter' },
        },
        pathItems: {
          type: 'object',
          additionalProperties: { $ref: '#/$defs/path-item' },
        },
      },
    }

    const result = generateTypeDefinition(components, 'Components')

    expect(result).toStrictEqual(
      'export type Components = {\n' +
        '  responses?: Record<string, Response>;\n' +
        '  parameters?: Record<string, Parameter>;\n' +
        '  pathItems?: Record<string, PathItem>;\n' +
        '};',
    )
  })

  it('generates type for object with paths property as Record<string, PathItem>', () => {
    const document: JSONSchema.Object = {
      $comment: 'https://spec.openapis.org/oas/v3.1#openapi-object',
      type: 'object',
      properties: {
        openapi: { type: 'string' },
        info: { $ref: '#/$defs/info' },
        paths: {
          type: 'object',
          additionalProperties: { $ref: '#/$defs/path-item' },
        },
      },
      required: ['openapi', 'info'],
    }

    const result = generateTypeDefinition(document, 'Document')

    expect(result).toStrictEqual(
      '/**\n' +
        '* Document\n' +
        '*\n' +
        '* https://spec.openapis.org/oas/v3.1#openapi-object\n' +
        '*/\n' +
        'export type Document = {\n' +
        '  openapi: string;\n' +
        '  info: Info;\n' +
        '  paths?: Record<string, PathItem>;\n' +
        '};',
    )
  })

  it('generates type for Document with paths and webhooks as Record types', () => {
    const document: JSONSchema.Object = {
      $comment: 'https://spec.openapis.org/oas/v3.1#openapi-object',
      type: 'object',
      properties: {
        openapi: {
          type: 'string',
        },
        info: {
          $ref: '#/$defs/info',
        },
        jsonSchemaDialect: {
          type: 'string',
        },
        servers: {
          type: 'array',
          items: {
            $ref: '#/$defs/server',
          },
        },
        paths: {
          type: 'object',
          additionalProperties: {
            $ref: '#/$defs/path-item',
          },
        },
        webhooks: {
          type: 'object',
          additionalProperties: {
            $ref: '#/$defs/path-item',
          },
        },
        components: {
          $ref: '#/$defs/components',
        },
      },
      required: ['openapi', 'info'],
    }

    const result = generateTypeDefinition(document, 'Document')

    expect(result).toStrictEqual(
      '/**\n' +
        '* Document\n' +
        '*\n' +
        '* https://spec.openapis.org/oas/v3.1#openapi-object\n' +
        '*/\n' +
        'export type Document = {\n' +
        '  openapi: string;\n' +
        '  info: Info;\n' +
        '  jsonSchemaDialect?: string;\n' +
        '  servers?: Server[];\n' +
        '  paths?: Record<string, PathItem>;\n' +
        '  webhooks?: Record<string, PathItem>;\n' +
        '  components?: Components;\n' +
        '};',
    )
  })

  it('unions the value types of multiple patternProperties', () => {
    const schema: JSONSchema.Object = {
      type: 'object',
      patternProperties: {
        '^a': { type: 'string' },
        '^b': { type: 'number' },
      },
    }
    const result = generateTypeDefinition(schema, 'Multi')
    expect(result).toContain('Record<string, string | number>')
  })

  it('generates type for object with patternProperties as Record type', () => {
    const paths: JSONSchema.Object = {
      $comment: 'https://spec.openapis.org/oas/v3.1#paths-object',
      type: 'object',
      patternProperties: {
        '^/': {
          $ref: '#/$defs/path-item',
        },
      },
    }

    const result = generateTypeDefinition(paths, 'Paths')

    expect(result).toStrictEqual(
      '/**\n' +
        '* Paths\n' +
        '*\n' +
        '* https://spec.openapis.org/oas/v3.1#paths-object\n' +
        '*/\n' +
        'export type Paths = Record<string, PathItem>;',
    )
  })

  it('quotes hyphenated property names in type definitions', () => {
    const schema = {
      type: 'object' as const,
      properties: {
        'x-linkedin': { type: 'string' as const },
        name: { type: 'string' as const },
      },
    }
    const result = generateTypeDefinition(schema, 'InfoExtensions')
    expect(result).toContain('"x-linkedin"?: string;')
    expect(result).toContain('name?: string;')
  })

  // An `if` is a test, never a requirement, and its `then` binds only the
  // instances that pass it. With no `else` and no way to spell "fails the
  // test", the instances that fail it are unconstrained — so the conditional
  // says nothing about the type, and the sound rendering is to leave it out.
  // Folding both halves in as required properties (what this used to do)
  // rejected the `{}` and `{ type: "apiKey" }` the schema accepts.
  it('drops a bare if/then whose unmatched side cannot be spelled', () => {
    const schema: JSONSchema = {
      if: { properties: { type: { const: 'http' } } },
      then: { properties: { scheme: { type: 'string' } }, required: ['scheme'] },
    }

    expect(generateTypeDefinition(schema, 'TypeHttp')).toBe('export type TypeHttp = {};')
  })

  it('keeps the JSDoc of a conditional it drops', () => {
    const schema: JSONSchema = {
      $comment: 'https://spec.openapis.org/oas/v3.1#security-scheme-object',
      if: {
        properties: { type: { const: 'http' }, scheme: { type: 'string', pattern: '^[Bb][Ee][Aa][Rr][Ee][Rr]$' } },
        required: ['type', 'scheme'],
      },
      then: { properties: { bearerFormat: { type: 'string' } } },
    }

    const result = generateTypeDefinition(schema, 'TypeHttp')

    expect(result).toContain('* TypeHttp')
    expect(result).toContain('* https://spec.openapis.org/oas/v3.1#security-scheme-object')
    expect(result).toContain('export type TypeHttp = {};')
    expect(result).not.toContain('bearerFormat')
  })

  // The test reads a property the schema declares as a boolean, so the
  // instances that fail it *can* be named: `a` absent, or `a: false`. The
  // conditional then lowers to a union the type checker can narrow on.
  it('lowers a bare if/then to a union when the tested property has a finite domain', () => {
    const schema: JSONSchema = {
      type: 'object',
      properties: { a: { type: 'boolean' }, b: { type: 'boolean' } },
      if: { properties: { a: { const: true } }, required: ['a'] },
      then: { properties: { b: { const: true } }, required: ['b'] },
    }

    expect(generateTypeDefinition(schema, 'Cond')).toBe(
      'export type Cond = {\n  a?: boolean;\n  b?: boolean;\n} & ({ a: true; b: true } | { a?: false });',
    )
  })

  // `else` is what the instances failing the test must satisfy, so it joins
  // the unmatched branch rather than being merged in next to `then`.
  it('lowers a bare if/then/else to a union of the two branches', () => {
    const schema: JSONSchema = {
      type: 'object',
      properties: { a: { type: 'boolean' }, b: { type: 'boolean' }, c: { type: 'string' } },
      if: { properties: { a: { const: true } }, required: ['a'] },
      then: { properties: { b: { const: true } }, required: ['b'] },
      else: { properties: { c: { type: 'string' } }, required: ['c'] },
    }

    expect(generateTypeDefinition(schema, 'Bare')).toBe(
      'export type Bare = {\n  a?: boolean;\n  b?: boolean;\n  c?: string;\n} & ' +
        '({ a: true; b: true } | ({ a?: false } & { c: string }));',
    )
  })

  // An `else` that only requires a key is folded the way `if` and `then` are —
  // rendered generically, a presence-only fragment said nothing at all.
  it('folds a presence-only else into the unmatched branch', () => {
    const schema: JSONSchema = {
      type: 'object',
      properties: { a: { type: 'boolean' }, c: { type: 'string' } },
      if: { properties: { a: { const: true } }, required: ['a'] },
      then: { required: ['c'] },
      else: { required: ['c'] },
    }

    expect(generateTypeDefinition(schema, 'Both')).toBe(
      'export type Both = {\n  a?: boolean;\n  c?: string;\n} & ({ a: true; c: unknown } | ({ a?: false } & { c: unknown }));',
    )
  })

  // With an `else`, the unmatched branch is spelled by the `else` alone when the
  // test cannot be negated — an over-approximation, never a rejection.
  it('uses else as the unmatched branch when the test cannot be negated', () => {
    const schema: JSONSchema = {
      type: 'object',
      properties: { kind: { type: 'string' } },
      if: { properties: { kind: { const: 'a' } }, required: ['kind'] },
      then: { properties: { a: { type: 'number' } }, required: ['a'] },
      else: { properties: { b: { type: 'number' } }, required: ['b'] },
    }

    expect(generateTypeDefinition(schema, 'Either')).toBe(
      'export type Either = {\n  kind?: string;\n} & ({ kind: "a"; a: number } | { b: number });',
    )
  })

  // The downstream shape: the conditional as an inline `allOf` member beside the
  // property block it tests. Rendered alone the member sees no property types,
  // so the composing schema's block is what its negation reads.
  it('lowers an allOf-wrapped if/then against the composing property block', () => {
    const schema: JSONSchema = {
      type: 'object',
      allOf: [
        {
          if: { properties: { binaryResponseApi: { const: true } }, required: ['binaryResponseApi'] },
          then: { properties: { responseApi: { const: true } }, required: ['responseApi'] },
        },
      ],
      properties: { responseApi: { type: 'boolean' }, binaryResponseApi: { type: 'boolean' } },
      additionalProperties: false,
    }

    expect(generateTypeDefinition(schema, 'PythonBackCompatOptions', { readonly: true })).toBe(
      'export type PythonBackCompatOptions = {\n' +
        '  readonly responseApi?: boolean;\n' +
        '  readonly binaryResponseApi?: boolean;\n' +
        '} & ({ readonly binaryResponseApi: true; readonly responseApi: true } | { readonly binaryResponseApi?: false });',
    )
  })

  // The same member with nothing to negate against reverts to the sound
  // rendering: the conditional is dropped and the property block stands alone.
  it('drops an allOf-wrapped if/then the composing block cannot negate', () => {
    const schema: JSONSchema = {
      type: 'object',
      properties: { mode: { type: 'string' }, level: { type: 'number' } },
      allOf: [{ if: { properties: { mode: { const: 'strict' } }, required: ['mode'] }, then: { required: ['level'] } }],
    }

    expect(generateTypeDefinition(schema, 'Options')).toBe(
      'export type Options = {\n  mode?: string;\n  level?: number;\n};',
    )
  })

  // OpenAPI's security scheme: the per-type rules are `$ref`s to conditional
  // definitions, each testing the `type` the composing schema enumerates. The
  // definition's own file cannot see that enumeration and drops its
  // conditional; here the reference is read through, so the composed type
  // narrows on `type` the way the schema does.
  it('lowers an allOf $ref to a conditional against the composing property block', () => {
    const rootSchema = {
      $defs: {
        'type-http': {
          if: { properties: { type: { const: 'http' } }, required: ['type'] },
          then: { properties: { scheme: { type: 'string' } }, required: ['scheme'] },
        },
        'type-apikey': {
          if: { properties: { type: { const: 'apiKey' } }, required: ['type'] },
          then: { properties: { name: { type: 'string' } }, required: ['name'] },
        },
      },
    }
    const schema: JSONSchema = {
      type: 'object',
      properties: { type: { enum: ['apiKey', 'http', 'mutualTLS'] }, description: { type: 'string' } },
      required: ['type'],
      allOf: [{ $ref: '#/$defs/type-http' }, { $ref: '#/$defs/type-apikey' }],
    }

    expect(generateTypeDefinition(schema, 'SecurityScheme', { rootSchema })).toBe(
      'export type SecurityScheme = {\n  type: "apiKey" | "http" | "mutualTLS";\n  description?: string;\n} & ' +
        'TypeHttp & ({ type: "http"; scheme: string } | { type?: "apiKey" | "mutualTLS" }) & ' +
        'TypeApikey & ({ type: "apiKey"; name: string } | { type?: "http" | "mutualTLS" });',
    )
  })

  // Without the root document the reference cannot be read, and the member is
  // the type name alone — what every `$ref` member has always been.
  it('leaves an allOf $ref alone without a root schema to resolve it in', () => {
    const schema: JSONSchema = {
      type: 'object',
      properties: { type: { enum: ['apiKey', 'http'] } },
      allOf: [{ $ref: '#/$defs/type-http' }],
    }

    expect(generateTypeDefinition(schema, 'SecurityScheme')).toBe(
      'export type SecurityScheme = {\n  type?: "apiKey" | "http";\n} & TypeHttp;',
    )
  })

  it('intersects a then $ref onto the matched branch only', () => {
    const schema: JSONSchema = {
      type: 'object',
      properties: { kind: { enum: ['a', 'b'] } },
      if: { properties: { kind: { const: 'a' } }, required: ['kind'] },
      then: { $ref: '#/$defs/extra' },
    }

    expect(generateTypeDefinition(schema, 'ThenRef')).toBe(
      'export type ThenRef = {\n  kind?: "a" | "b";\n} & (({ kind: "a" } & Extra) | { kind?: "b" });',
    )
  })

  it('lowers a conditional on a nested property inline', () => {
    const schema: JSONSchema = {
      type: 'object',
      properties: {
        inner: {
          type: 'object',
          properties: { a: { type: 'boolean' }, b: { type: 'string' } },
          if: { properties: { a: { const: true } }, required: ['a'] },
          then: { required: ['b'] },
        },
      },
    }

    expect(generateTypeDefinition(schema, 'Nested')).toBe(
      'export type Nested = {\n  inner?: { a?: boolean; b?: string } & ({ a: true; b: unknown } | { a?: false });\n};',
    )
  })

  // A test without `required` passes on an absent key as well, so only a
  // present, rejected value fails it: `{ a: false }`, not `{ a?: false }`.
  it('requires the rejected value when the test does not require the key', () => {
    const schema: JSONSchema = {
      type: 'object',
      properties: { a: { type: 'boolean' }, b: { type: 'boolean' } },
      if: { properties: { a: { const: true } } },
      then: { required: ['b'] },
    }

    expect(generateTypeDefinition(schema, 'Loose')).toBe(
      'export type Loose = {\n  a?: boolean;\n  b?: boolean;\n} & ({ a?: true; b: unknown } | { a: false });',
    )
  })

  // A test that only requires keys fails when one of them is absent, whatever
  // the property types are — no domain needed.
  it('negates a presence-only test as absence', () => {
    const schema: JSONSchema = {
      type: 'object',
      properties: { a: { type: 'string' }, b: { type: 'string' } },
      if: { required: ['a'] },
      then: { required: ['b'] },
    }

    expect(generateTypeDefinition(schema, 'Presence')).toBe(
      'export type Presence = {\n  a?: string;\n  b?: string;\n} & ({ a: unknown; b: unknown } | { a?: never });',
    )
  })

  it('takes the decided branch of a boolean if', () => {
    const always: JSONSchema = { type: 'object', if: true, then: { properties: { a: { type: 'string' } } } }
    const never: JSONSchema = {
      type: 'object',
      if: false,
      then: { properties: { a: { type: 'string' } } },
      else: { properties: { b: { type: 'number' } } },
    }

    expect(generateTypeDefinition(always, 'Always')).toBe('export type Always = { a?: string };')
    expect(generateTypeDefinition(never, 'Never')).toBe('export type Never = { b?: number };')
  })

  it('generates intersection type for schema with allOf $ref entries', () => {
    const securityScheme: JSONSchema.Object = {
      type: 'object',
      properties: {
        type: {
          enum: ['apiKey', 'http', 'oauth2'],
        },
        description: {
          type: 'string',
        },
      },
      required: ['type'],
      allOf: [{ $ref: '#/$defs/type-apikey' }, { $ref: '#/$defs/type-http' }, { $ref: '#/$defs/type-oauth2' }],
    }

    const result = generateTypeDefinition(securityScheme, 'SecurityScheme')

    expect(result).toStrictEqual(
      'export type SecurityScheme = {\n' +
        '  type: "apiKey" | "http" | "oauth2";\n' +
        '  description?: string;\n' +
        '} & TypeApikey & TypeHttp & TypeOauth2;',
    )
  })

  it('generates JSDoc from $comment URL for schema with allOf intersections', () => {
    const securityScheme: JSONSchema.Object = {
      $comment: 'https://spec.openapis.org/oas/v3.1#security-scheme-object',
      type: 'object',
      properties: {
        type: {
          enum: ['apiKey', 'http', 'oauth2'],
        },
      },
      required: ['type'],
      allOf: [{ $ref: '#/$defs/type-apikey' }, { $ref: '#/$defs/type-http' }],
    }

    const result = generateTypeDefinition(securityScheme, 'SecurityScheme')

    expect(result).toContain('* SecurityScheme')
    expect(result).toContain('* https://spec.openapis.org/oas/v3.1#security-scheme-object')
    expect(result).toContain('type: "apiKey" | "http" | "oauth2";')
    expect(result).toContain('} & TypeApikey & TypeHttp;')
  })

  it('preserves property descriptions as JSDoc comments when allOf contains an inline object schema', () => {
    const schema: JSONSchema = {
      allOf: [
        { $ref: '#/$defs/baseTargetConfig' },
        {
          type: 'object',
          additionalProperties: false,
          properties: {
            packageName: {
              type: 'string',
              description: 'Import/package name for TypeScript and Node packages.',
            },
            packageManager: {
              type: 'string',
              description: 'TypeScript package manager preference for generated package metadata.',
            },
            publish: {
              $ref: '#/$defs/npmPublishConfig',
              description: 'npm publishing configuration.',
            },
          },
          required: ['publish'],
        },
      ],
    }

    const result = generateTypeDefinition(schema, 'TypeScriptTargetConfig')

    expect(result).toContain('/** Import/package name for TypeScript and Node packages. */')
    expect(result).toContain('/** TypeScript package manager preference for generated package metadata. */')
    expect(result).toContain('/** npm publishing configuration. */')
  })

  it('generates record type for patternProperties-only schema without explicit type', () => {
    const schema: JSONSchema = {
      patternProperties: {
        '^x-': true,
      },
    }

    const result = generateTypeDefinition(schema, 'SpecificationExtensions')

    expect(result).toStrictEqual('export type SpecificationExtensions = Record<`x-${string}`, unknown>;')
  })

  it('generates Record<string, never> for patternProperties-only schema with false boolean value', () => {
    // The false boolean schema means no values are allowed for matching keys,
    // which maps to the never type in TypeScript.
    const schema: JSONSchema = {
      patternProperties: {
        '^x-': false,
      },
    }

    const result = generateTypeDefinition(schema, 'Restricted')

    expect(result).toStrictEqual('export type Restricted = Record<`x-${string}`, never>;')
  })

  // In the real pipeline `resolveDynamicRefs` rewrites every `$dynamicRef` to a
  // concrete `$ref` (and fails the build for any it cannot bind) before a schema
  // reaches this function. One that survives names no generated file, so the
  // only honest type is `unknown`. Naming the type after the anchor instead is
  // what turned a root `$dynamicAnchor: "node"` into a reference to the DOM's
  // `Node` interface: never generated, never imported, and compiling cleanly.
  it('types an unbound $dynamicRef as unknown rather than naming a type nobody exports', () => {
    const schema: JSONSchema.Object = {
      type: 'object',
      properties: {
        schema: { $dynamicRef: '#meta' },
        node: { $dynamicRef: '#node' },
      },
    }

    const result = generateTypeDefinition(schema, 'SchemaContainer')

    expect(result).toContain('schema?: unknown')
    expect(result).toContain('node?: unknown')
  })

  it('types a pointer-form $dynamicRef as unknown too', () => {
    const schema: JSONSchema.Object = {
      type: 'object',
      properties: {
        content: { $dynamicRef: '#/$defs/schema' },
      },
    }

    const result = generateTypeDefinition(schema, 'ContentContainer')

    expect(result).toContain('content?: unknown')
  })

  it('generates union type for schema with array of types', () => {
    // JSON Schema allows `type` to be an array of strings to express a union type.
    const schema: JSONSchema.Object = {
      type: 'object',
      properties: {
        value: { type: ['string', 'null'] },
      },
    }

    const result = generateTypeDefinition(schema, 'NullableStringContainer')

    expect(result).toContain('value?: string | null')
  })

  it('generates correct union for all supported types in type array', () => {
    const schema: JSONSchema.Object = {
      type: 'object',
      properties: {
        anything: { type: ['string', 'number', 'boolean', 'null', 'array', 'object'] },
      },
    }

    const result = generateTypeDefinition(schema, 'AnyTypeContainer')

    expect(result).toContain('string | number | boolean | null | unknown[] | Record<string, unknown>')
  })

  it('infers Record<string, unknown> type for no-type property with boolean true additionalProperties', () => {
    // A schema with additionalProperties: true and no explicit type is treated
    // as an open record allowing any values.
    const schema: JSONSchema.Object = {
      type: 'object',
      properties: {
        extensions: { additionalProperties: true },
      },
    }

    const result = generateTypeDefinition(schema, 'Container')

    expect(result).toContain('extensions?: Record<string, unknown>')
  })

  it('infers Record<string, never> type for no-type property with boolean false additionalProperties', () => {
    // A schema with additionalProperties: false and no explicit type means
    // no values are allowed, which maps to the never type.
    const schema: JSONSchema.Object = {
      type: 'object',
      properties: {
        locked: { additionalProperties: false },
      },
    }

    const result = generateTypeDefinition(schema, 'Container')

    expect(result).toContain('locked?: Record<string, never>')
  })

  it('infers Record<`x-${string}`, unknown> for no-type property with ^x- patternProperties', () => {
    // The ^x- pattern is a common JSON Schema convention for vendor extensions that
    // maps naturally to the TypeScript template literal `x-${string}`.
    const schema: JSONSchema.Object = {
      type: 'object',
      properties: {
        extensions: { patternProperties: { '^x-': true } },
      },
    }

    const result = generateTypeDefinition(schema, 'Container')

    expect(result).toContain('extensions?: Record<`x-${string}`, unknown>')
  })

  it('infers string type for no-type property whose default is a string', () => {
    // When a property has no explicit type but has a string default, we infer
    // the type as string so the generated TypeScript stays as specific as possible.
    const schema: JSONSchema.Object = {
      type: 'object',
      properties: {
        format: { default: 'json' },
      },
    }

    const result = generateTypeDefinition(schema, 'Config')

    expect(result).toContain('format?: string')
  })

  it('infers number type for no-type property whose default is a number', () => {
    const schema: JSONSchema.Object = {
      type: 'object',
      properties: {
        timeout: { default: 30 },
      },
    }

    const result = generateTypeDefinition(schema, 'Config')

    expect(result).toContain('timeout?: number')
  })

  it('infers boolean type for no-type property whose default is a boolean', () => {
    const schema: JSONSchema.Object = {
      type: 'object',
      properties: {
        enabled: { default: true },
      },
    }

    const result = generateTypeDefinition(schema, 'Config')

    expect(result).toContain('enabled?: boolean')
  })

  it('generates type with JSDoc for additionalProperties-only schema when documentation is found', () => {
    // This tests the documentation block (lines 431–438) inside the additionalProperties-only
    // path — a code path that is only reached when the schema has no fixed properties but
    // does have additionalProperties, and a matching documentation section exists.
    const schema: JSONSchema.Object = {
      $comment: 'https://spec.openapis.org/oas/v3.1#callback-object',
      type: 'object',
      additionalProperties: {
        $ref: '#/$defs/path-item',
      },
    }

    const result = generateTypeDefinition(schema, 'Callback')

    expect(result).toContain('/**')
    expect(result).toContain('* Callback')
    expect(result).toContain('* https://spec.openapis.org/oas/v3.1#callback-object')
    expect(result).toContain('[key: string]: PathItem')
  })

  it('generates type for product schema with required, optional, and array fields', () => {
    const schema: JSONSchema = {
      description: 'A product available for purchase in the catalog.',
      type: 'object',
      properties: {
        id: { description: 'Unique product identifier (UUID).', type: 'string' },
        name: { description: 'Display name shown to customers.', type: 'string' },
        price: { description: 'Unit price in USD cents (must be non-negative).', type: 'number', minimum: 0 },
        inStock: { description: 'Whether the product is currently available for purchase.', type: 'boolean' },
        tags: {
          description: 'Searchable labels associated with the product.',
          type: 'array',
          items: { type: 'string' },
        },
      },
      required: ['id', 'name', 'price'],
    }

    const result = generateTypeDefinition(schema, 'Product')

    expect(result).toBe(
      '/**\n' +
        '* Product\n' +
        '*\n' +
        '* A product available for purchase in the catalog.\n' +
        '*/\n' +
        'export type Product = {\n' +
        '  /** Unique product identifier (UUID). */\n' +
        '  id: string;\n' +
        '  /** Display name shown to customers. */\n' +
        '  name: string;\n' +
        '  /** Unit price in USD cents (must be non-negative). */\n' +
        '  price: number;\n' +
        '  /** Whether the product is currently available for purchase. */\n' +
        '  inStock?: boolean;\n' +
        '  /** Searchable labels associated with the product. */\n' +
        '  tags?: string[];\n' +
        '};',
    )
  })

  it('generates type for string enum schema', () => {
    const schema: JSONSchema = {
      description: 'One of the supported theme colors.',
      type: 'string',
      enum: ['red', 'green', 'blue', 'yellow', 'purple'],
    }

    const result = generateTypeDefinition(schema, 'ThemeColor')

    expect(result).toBe(
      '/**\n' +
        '* ThemeColor\n' +
        '*\n' +
        '* One of the supported theme colors.\n' +
        '*/\n' +
        'export type ThemeColor = "red" | "green" | "blue" | "yellow" | "purple";',
    )
  })

  it('generates type for geo coordinate with min/max constraints on required number fields', () => {
    const schema: JSONSchema = {
      description: 'A geographic coordinate pair.',
      type: 'object',
      properties: {
        latitude: { description: 'Degrees latitude, from -90 to 90.', type: 'number', minimum: -90, maximum: 90 },
        longitude: { description: 'Degrees longitude, from -180 to 180.', type: 'number', minimum: -180, maximum: 180 },
        altitude: { description: 'Elevation in metres above sea level.', type: 'number' },
        label: { description: 'Human-readable name for this location.', type: 'string' },
      },
      required: ['latitude', 'longitude'],
    }

    const result = generateTypeDefinition(schema, 'GeoCoordinate')

    expect(result).toBe(
      '/**\n' +
        '* GeoCoordinate\n' +
        '*\n' +
        '* A geographic coordinate pair.\n' +
        '*/\n' +
        'export type GeoCoordinate = {\n' +
        '  /** Degrees latitude, from -90 to 90. */\n' +
        '  latitude: number;\n' +
        '  /** Degrees longitude, from -180 to 180. */\n' +
        '  longitude: number;\n' +
        '  /** Elevation in metres above sea level. */\n' +
        '  altitude?: number;\n' +
        '  /** Human-readable name for this location. */\n' +
        '  label?: string;\n' +
        '};',
    )
  })

  it('wraps union item types in parentheses for root-level array schema', () => {
    const schema: JSONSchema = {
      type: 'array',
      items: { anyOf: [{ $ref: '#/$defs/parameter' }, { $ref: '#/$defs/reference' }] },
    }

    const result = generateTypeDefinition(schema, 'Parameters')

    expect(result).toBe('export type Parameters = (Parameter | Reference)[];')
  })

  it('emits JSDoc for non-object schemas with a $comment URL', () => {
    const schema: JSONSchema = {
      $comment: 'https://spec.openapis.org/oas/v3.1#contact-object',
      type: 'array',
      items: { $ref: '#/$defs/server' },
    }

    const result = generateTypeDefinition(schema, 'Contacts')

    expect(result).toContain('/**')
    expect(result).toContain('* https://spec.openapis.org/oas/v3.1#contact-object')
    expect(result).toContain('export type Contacts = Server[];')
  })

  it('emits JSDoc for non-object schemas with a plain-text $comment', () => {
    const schema: JSONSchema = {
      $comment: 'A list of parameters applicable to the operation.',
      type: 'array',
      items: { $ref: '#/$defs/parameter' },
    }

    const result = generateTypeDefinition(schema, 'Parameters')

    expect(result).toContain('/**')
    expect(result).toContain('A list of parameters applicable to the operation.')
    expect(result).toContain('export type Parameters = Parameter[];')
  })

  it('generates unknown for external $ref', () => {
    // External refs (e.g. from draft-04 schemas) cannot be resolved locally — treated as unknown.
    const schema: JSONSchema = {
      $ref: 'http://json-schema.org/draft-04/schema#/properties/maximum',
    }

    const result = generateTypeDefinition(schema, 'Maximum')

    expect(result).toBe('export type Maximum = unknown;')
  })

  it('does not emit a trailing blank line in JSDoc when there is no @see link', () => {
    const schema: JSONSchema = {
      $comment: 'A plain-text description with no URL.',
      type: 'object',
      properties: {
        value: { type: 'string' },
      },
    }

    const result = generateTypeDefinition(schema, 'PlainComment')

    expect(result).toMatch(/\* A plain-text description with no URL\.\n\*\//)
    expect(result).not.toContain('* \n*/')
  })

  it('emits the class name for an x-mjst instanceOf property', () => {
    const schema: JSONSchema = {
      type: 'object',
      properties: { createdAt: { 'x-mjst': { instanceOf: 'Date' } } },
      required: ['createdAt'],
    }

    expect(generateTypeDefinition(schema, 'Event')).toContain('createdAt: Date;')
  })

  it('emits the class name for a top-level x-mjst instanceOf schema', () => {
    const schema: JSONSchema = { 'x-mjst': { instanceOf: 'Date' } }

    expect(generateTypeDefinition(schema, 'When')).toBe('export type When = Date;')
  })

  it('ignores an x-mjst instanceOf that is not a safe identifier', () => {
    const schema: JSONSchema = { 'x-mjst': { instanceOf: 'Date; doEvil()' } }

    expect(generateTypeDefinition(schema, 'When')).not.toContain('doEvil')
  })

  it('emits a primitive type for an x-mjst bigint property', () => {
    const schema: JSONSchema = {
      type: 'object',
      properties: { balance: { 'x-mjst': { primitive: 'bigint' } } },
      required: ['balance'],
    }

    expect(generateTypeDefinition(schema, 'Account')).toContain('balance: bigint;')
  })

  it('emits a primitive type for a top-level x-mjst bigint schema', () => {
    expect(generateTypeDefinition({ 'x-mjst': { primitive: 'bigint' } }, 'Big')).toBe('export type Big = bigint;')
  })

  it('wraps a branded property in a nominal intersection', () => {
    const schema: JSONSchema = {
      type: 'object',
      properties: { id: { type: 'string', 'x-mjst': { brand: 'UserId' } } },
      required: ['id'],
    }

    expect(generateTypeDefinition(schema, 'User')).toContain("id: (string & { readonly __brand: 'UserId' });")
  })

  it('brands a top-level schema and combines with instanceOf', () => {
    expect(generateTypeDefinition({ type: 'string', 'x-mjst': { brand: 'Email' } }, 'Email')).toBe(
      "export type Email = (string & { readonly __brand: 'Email' });",
    )
    expect(generateTypeDefinition({ 'x-mjst': { instanceOf: 'Date', brand: 'Timestamp' } }, 'Ts')).toBe(
      "export type Ts = (Date & { readonly __brand: 'Timestamp' });",
    )
  })

  it('ignores an x-mjst brand that is not safe to embed', () => {
    const schema: JSONSchema = { type: 'string', 'x-mjst': { brand: "x'; doEvil()" } }

    const result = generateTypeDefinition(schema, 'Bad')
    expect(result).not.toContain('doEvil')
    expect(result).toBe('export type Bad = string;')
  })

  describe('multiline descriptions', () => {
    it('prefixes every line of a multiline top-level description with an asterisk', () => {
      const schema: JSONSchema = {
        description:
          'Human-readable SDK/product name used for generated package metadata and client naming.\n\nThis becomes the default basis for the generated client class name and surfaces in README titles and package descriptions. It is descriptive text, not an import identifier, so spaces and capitalization are fine.',
        type: 'string',
      }

      const result = generateTypeDefinition(schema, 'SdkName')

      expect(result).toBe(
        '/**\n' +
          '* SdkName\n' +
          '*\n' +
          '* Human-readable SDK/product name used for generated package metadata and client naming.\n' +
          '*\n' +
          '* This becomes the default basis for the generated client class name and surfaces in README titles and package descriptions. It is descriptive text, not an import identifier, so spaces and capitalization are fine.\n' +
          '*/\n' +
          'export type SdkName = string;',
      )
    })

    it('emits a multiline inline property description as an asterisk-prefixed block', () => {
      const schema: JSONSchema = {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description:
              'Human-readable SDK/product name used for generated package metadata and client naming.\n\nThis becomes the default basis for the generated client class name and surfaces in README titles and package descriptions. It is descriptive text, not an import identifier, so spaces and capitalization are fine.',
          },
        },
        required: ['name'],
      }

      const result = generateTypeDefinition(schema, 'ScalarSdkConfig')

      expect(result).toBe(
        'export type ScalarSdkConfig = {\n' +
          '  /**\n' +
          '   * Human-readable SDK/product name used for generated package metadata and client naming.\n' +
          '   *\n' +
          '   * This becomes the default basis for the generated client class name and surfaces in README titles and package descriptions. It is descriptive text, not an import identifier, so spaces and capitalization are fine.\n' +
          '   */\n' +
          '  name: string;\n' +
          '};',
      )
    })

    it('keeps single-line property descriptions on one line', () => {
      const schema: JSONSchema = {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Human-readable SDK name.' },
        },
        required: ['name'],
      }

      const result = generateTypeDefinition(schema, 'ScalarSdkConfig')

      expect(result).toContain('  /** Human-readable SDK name. */\n')
    })
  })

  describe('readonly option', () => {
    it('marks every property as readonly, deeply', () => {
      const schema: JSONSchema = {
        type: 'object',
        properties: {
          id: { type: 'string' },
          tags: { type: 'array', items: { type: 'string' } },
          nested: {
            type: 'object',
            properties: { value: { type: 'number' } },
          },
        },
        required: ['id'],
      }

      const result = generateTypeDefinition(schema, 'Doc', { readonly: true })

      expect(result).toContain('readonly id: string;')
      expect(result).toContain('readonly tags?: readonly string[];')
      expect(result).toContain('readonly nested?: { readonly value?: number }')
    })

    it('wraps record types in Readonly', () => {
      const schema: JSONSchema = {
        type: 'object',
        additionalProperties: { type: 'number' },
      }

      expect(generateTypeDefinition(schema, 'Map', { readonly: true })).toContain('readonly [key: string]: number;')
    })

    it('leaves output unchanged when readonly is not set', () => {
      const schema: JSONSchema = {
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id'],
      }

      const result = generateTypeDefinition(schema, 'Doc')
      expect(result).not.toContain('readonly')
      expect(result).toContain('id: string;')
    })
  })

  describe('typeSuffix', () => {
    const schema: JSONSchema = {
      type: 'object',
      properties: {
        contact: { $ref: '#/$defs/contact' },
      },
      required: ['contact'],
    }

    it('appends the suffix to ref-derived type names', () => {
      const result = generateTypeDefinition(schema, 'Document', { typeSuffix: 'Object' })
      expect(result).toContain('contact: ContactObject;')
    })

    it('emits no suffix by default', () => {
      const result = generateTypeDefinition(schema, 'Document')
      expect(result).toContain('contact: Contact;')
      expect(result).not.toContain('ContactObject')
    })
  })
  describe('nullable (OpenAPI 3.0)', () => {
    it('widens a nullable scalar property with null', () => {
      const schema: JSONSchema = {
        type: 'object',
        properties: { name: { type: 'string', nullable: true } },
        required: ['name'],
      } as JSONSchema

      expect(generateTypeDefinition(schema, 'Doc')).toContain('name: string | null;')
    })

    it('widens a nullable object schema without losing its properties', () => {
      const schema: JSONSchema = {
        type: 'object',
        nullable: true,
        properties: { a: { type: 'string' } },
        required: ['a'],
      } as JSONSchema

      expect(generateTypeDefinition(schema, 'Doc')).toBe('export type Doc = {\n  a: string;\n} | null;')
    })

    it('does not double up when null is already declared', () => {
      const schema: JSONSchema = { type: ['string', 'null'], nullable: true } as JSONSchema

      expect(generateTypeDefinition(schema, 'Doc')).toBe('export type Doc = string | null;')
    })
  })

  describe('array-form type', () => {
    it('keeps the properties of a nullable object', () => {
      const schema: JSONSchema = {
        type: ['object', 'null'],
        properties: { a: { type: 'string' } },
        required: ['a'],
      } as JSONSchema

      expect(generateTypeDefinition(schema, 'Doc')).toBe('export type Doc = { a: string } | null;')
    })

    it('keeps the item type of a nullable array', () => {
      const schema: JSONSchema = {
        type: 'object',
        properties: { a: { type: ['array', 'null'], items: { type: 'string' } } },
      } as JSONSchema

      expect(generateTypeDefinition(schema, 'Doc')).toContain('a?: string[] | null;')
    })

    it('deduplicates repeated members', () => {
      const schema: JSONSchema = { type: ['string', 'number', 'string'] } as JSONSchema

      expect(generateTypeDefinition(schema, 'Doc')).toBe('export type Doc = string | number;')
    })

    it('applies readonly to the array member', () => {
      const schema: JSONSchema = { type: ['array', 'null'], items: { type: 'string' } } as JSONSchema

      expect(generateTypeDefinition(schema, 'Doc', { readonly: true })).toBe(
        'export type Doc = readonly string[] | null;',
      )
    })
  })

  describe('tuples', () => {
    it('emits a fixed tuple for prefixItems with items: false', () => {
      const schema: JSONSchema = {
        type: 'array',
        prefixItems: [{ type: 'string' }, { type: 'number' }],
        items: false,
      } as JSONSchema

      expect(generateTypeDefinition(schema, 'Doc')).toBe('export type Doc = [string?, number?];')
    })

    it('requires the positions minItems reaches and types the rest from items', () => {
      const schema: JSONSchema = {
        type: 'array',
        prefixItems: [{ type: 'string' }, { type: 'number' }],
        minItems: 1,
        items: { type: 'boolean' },
      } as JSONSchema

      expect(generateTypeDefinition(schema, 'Doc')).toBe('export type Doc = [string, number?, ...boolean[]];')
    })

    it('reads the draft-07 array form of items as a tuple', () => {
      const schema: JSONSchema = {
        type: 'array',
        items: [{ type: 'string' }, { type: 'number' }],
        additionalItems: false,
      } as JSONSchema

      expect(generateTypeDefinition(schema, 'Doc')).toBe('export type Doc = [string?, number?];')
    })

    it('marks a readonly tuple readonly', () => {
      const schema: JSONSchema = { type: 'array', prefixItems: [{ type: 'string' }], items: false } as JSONSchema

      expect(generateTypeDefinition(schema, 'Doc', { readonly: true })).toBe('export type Doc = readonly [string?];')
    })
  })

  describe('open-ended keys alongside declared properties', () => {
    it('emits an index signature widened to cover the declared properties', () => {
      const schema: JSONSchema = {
        type: 'object',
        properties: { a: { type: 'string' } },
        additionalProperties: { type: 'number' },
      }

      expect(generateTypeDefinition(schema, 'Doc')).toBe(
        'export type Doc = {\n  a?: string;\n  [key: string]: number | string | undefined;\n};',
      )
    })

    it('keeps a template-literal key for the sole x- pattern, which needs no widening', () => {
      const schema: JSONSchema = {
        type: 'object',
        properties: { a: { type: 'string' } },
        patternProperties: { '^x-': { type: 'number' } },
      }

      expect(generateTypeDefinition(schema, 'Doc')).toContain('[key: `x-${string}`]: number;')
    })

    it('does not emit an index signature for additionalProperties: true', () => {
      const schema: JSONSchema = {
        type: 'object',
        properties: { a: { type: 'string' } },
        additionalProperties: true,
      }

      expect(generateTypeDefinition(schema, 'Doc')).not.toContain('[key: string]')
    })
  })

  describe('composition alongside a declared shape', () => {
    it('intersects an inline allOf member instead of dropping it', () => {
      const schema: JSONSchema = {
        type: 'object',
        properties: { a: { type: 'string' } },
        allOf: [{ type: 'object', properties: { b: { type: 'number' } }, required: ['b'] }],
      }

      expect(generateTypeDefinition(schema, 'Doc')).toBe('export type Doc = {\n  a?: string;\n} & { b: number };')
    })

    it('keeps the properties of a nested schema that also declares oneOf', () => {
      const schema: JSONSchema = {
        type: 'object',
        properties: {
          outer: {
            type: 'object',
            properties: { a: { type: 'string' } },
            oneOf: [{ required: ['a'] }],
          },
        },
      }

      expect(generateTypeDefinition(schema, 'Doc')).toContain('outer?: { a?: string };')
    })

    it('intersects a sibling union onto the declared properties', () => {
      const schema: JSONSchema = {
        type: 'object',
        properties: { a: { type: 'string' } },
        anyOf: [{ type: 'object', properties: { b: { type: 'number' } }, required: ['b'] }],
      }

      expect(generateTypeDefinition(schema, 'Doc')).toContain('} & { b: number };')
    })

    it('drops unknown members rather than emitting `& unknown`', () => {
      const schema: JSONSchema = {
        type: 'object',
        properties: { a: { type: 'string' } },
        oneOf: [{ required: ['a'] }, { required: ['b'] }],
      }

      expect(generateTypeDefinition(schema, 'Doc')).toBe('export type Doc = {\n  a?: string;\n};')
    })
  })

  describe('JSDoc escaping', () => {
    it('escapes a comment terminator in a property description', () => {
      const schema: JSONSchema = {
        type: 'object',
        properties: { include: { type: 'string', description: 'Glob such as **/*.ts to match' } },
      }

      const result = generateTypeDefinition(schema, 'Doc')
      expect(result).toContain('/** Glob such as **\\/*.ts to match */')
      expect(result).not.toContain('*/*.ts')
    })

    it('escapes a comment terminator in a top-level description', () => {
      const schema: JSONSchema = { type: 'string', description: 'Matches **/*.ts' }

      expect(generateTypeDefinition(schema, 'Doc')).toContain('Matches **\\/*.ts')
    })

    it('escapes a comment terminator in a multi-line description', () => {
      const schema: JSONSchema = {
        type: 'object',
        properties: { a: { type: 'string', description: 'one\n*/ two' } },
      }

      expect(generateTypeDefinition(schema, 'Doc')).not.toMatch(/\*\/ two/)
    })
  })

  describe('URI $ref', () => {
    it('names a URI ref that resolves inside the root document', () => {
      const rootSchema = {
        $defs: { 'http://asyncapi.com/definitions/3.1.0/channel.json': { type: 'object' } },
      }
      const schema: JSONSchema = {
        type: 'object',
        properties: { channel: { $ref: 'http://asyncapi.com/definitions/3.1.0/channel.json' } },
      }

      expect(generateTypeDefinition(schema, 'Doc', { rootSchema })).toContain('channel?: Channel;')
    })

    it('leaves an unresolvable URI ref as unknown', () => {
      const schema: JSONSchema = {
        type: 'object',
        properties: { channel: { $ref: 'http://asyncapi.com/definitions/3.1.0/channel.json' } },
      }

      expect(generateTypeDefinition(schema, 'Doc', { rootSchema: {} })).toContain('channel?: unknown;')
    })
  })

  it('names the nesting limit instead of overflowing the stack', () => {
    let node: unknown = { type: 'string' }
    for (let i = 0; i < 500; i++) node = { type: 'object', properties: { a: node } }

    expect(() => generateTypeDefinition(node as never, 'Deep')).toThrow(
      /Schema nesting exceeds 400 levels while running generateTypeDefinition/,
    )
  })

  // Keywords used to be read straight off the schema, so a polluted
  // `Object.prototype` made every node in the document report keywords its
  // author never wrote — and an inherited `if`/`then` pair recursed forever.
  it('ignores schema keywords inherited from Object.prototype', () => {
    const polluted = Object.prototype as Record<string, unknown>
    const planted = ['additionalProperties', 'patternProperties', 'properties', 'items', 'enum', 'nullable']
    try {
      polluted['additionalProperties'] = { type: 'number' }
      polluted['patternProperties'] = { '^a': { type: 'number' } }
      polluted['properties'] = { ghost: { type: 'number' } }
      polluted['items'] = { type: 'number' }
      polluted['enum'] = ['ghost']
      polluted['nullable'] = true
      polluted['if'] = { properties: { a: { type: 'string' } } }
      polluted['then'] = { properties: { b: { type: 'string' } } }

      expect(generateTypeDefinition({ type: 'string' }, 'X')).toBe('export type X = string;')
      expect(generateTypeDefinition({ type: 'array' }, 'X')).toBe('export type X = unknown[];')
    } finally {
      for (const key of [...planted, 'if', 'then']) delete polluted[key]
    }
  })
})
