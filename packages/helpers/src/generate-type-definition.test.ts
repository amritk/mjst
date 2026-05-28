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

    const result = generateTypeDefinition(schema, 'GenericObject')

    expect(result).toStrictEqual('export type GenericObject = {\n' + '  metadata?: object;\n' + '};')
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

    const result = generateTypeDefinition(schema, 'EmptyObject')

    expect(result).toStrictEqual('export type EmptyObject = {\n' + '\n' + '};')
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

    const result = generateTypeDefinition(info, 'InfoObject')

    expect(result).toStrictEqual(
      '/**\n' +
        '* InfoObject\n' +
        '*\n' +
        '* https://spec.openapis.org/oas/v3.1#info-object\n' +
        '*/\n' +
        'export type InfoObject = {\n' +
        '  title: string;\n' +
        '  summary?: string;\n' +
        '  contact?: ContactObject;\n' +
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

    const result = generateTypeDefinition(components, 'ComponentsObject')

    expect(result).toStrictEqual(
      'export type ComponentsObject = {\n' +
        '  responses?: Record<string, ResponseObject>;\n' +
        '  parameters?: Record<string, ParameterObject>;\n' +
        '  pathItems?: Record<string, PathItemObject>;\n' +
        '};',
    )
  })

  it('generates type for object with paths property as Record<string, PathItemObject>', () => {
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
        '  info: InfoObject;\n' +
        '  paths?: Record<string, PathItemObject>;\n' +
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
        '  info: InfoObject;\n' +
        '  jsonSchemaDialect?: string;\n' +
        '  servers?: ServerObject[];\n' +
        '  paths?: Record<string, PathItemObject>;\n' +
        '  webhooks?: Record<string, PathItemObject>;\n' +
        '  components?: ComponentsObject;\n' +
        '};',
    )
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

    const result = generateTypeDefinition(paths, 'PathsObject')

    expect(result).toStrictEqual(
      '/**\n' +
        '* PathsObject\n' +
        '*\n' +
        '* https://spec.openapis.org/oas/v3.1#paths-object\n' +
        '*/\n' +
        'export type PathsObject = Record<string, PathItemObject>;',
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
    const result = generateTypeDefinition(schema, 'InfoExtensionsObject')
    expect(result).toContain("'x-linkedin'?: string;")
    expect(result).toContain('name?: string;')
  })

  it('generates type from conditional if/then object fragments', () => {
    const schema: JSONSchema = {
      if: {
        properties: {
          type: {
            const: 'http',
          },
        },
      },
      then: {
        properties: {
          scheme: {
            type: 'string',
          },
        },
        required: ['scheme'],
      },
    }

    const result = generateTypeDefinition(schema, 'TypeHttpObject')

    expect(result).toStrictEqual(
      'export type TypeHttpObject = {\n' + '  type: "http";\n' + '  scheme: string;\n' + '};',
    )
  })

  it('generates required property from then properties without explicit required', () => {
    const schema: JSONSchema = {
      if: {
        properties: {
          type: {
            const: 'http',
          },
        },
      },
      then: {
        properties: {
          bearerFormat: {
            type: 'string',
          },
        },
      },
    }

    const result = generateTypeDefinition(schema, 'TypeHttpObject')

    expect(result).toStrictEqual(
      'export type TypeHttpObject = {\n' + '  type: "http";\n' + '  bearerFormat: string;\n' + '};',
    )
  })

  it('generates required discriminator for conditional type-http schema with $comment JSDoc', () => {
    const schema: JSONSchema = {
      $comment: 'https://spec.openapis.org/oas/v3.1#security-scheme-object',
      if: {
        properties: {
          type: {
            const: 'http',
          },
          scheme: {
            type: 'string',
            pattern: '^[Bb][Ee][Aa][Rr][Ee][Rr]$',
          },
        },
        required: ['type', 'scheme'],
      },
      then: {
        properties: {
          bearerFormat: {
            type: 'string',
          },
        },
      },
    }

    const result = generateTypeDefinition(schema, 'TypeHttpObject')

    expect(result).toContain('* TypeHttpObject')
    expect(result).toContain('* https://spec.openapis.org/oas/v3.1#security-scheme-object')
    expect(result).toContain('type: "http";')
    expect(result).toContain('scheme: string;')
    expect(result).toContain('bearerFormat: string;')
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

    const result = generateTypeDefinition(securityScheme, 'SecuritySchemeObject')

    expect(result).toStrictEqual(
      'export type SecuritySchemeObject = {\n' +
        '  type: "apiKey" | "http" | "oauth2";\n' +
        '  description?: string;\n' +
        '} & TypeApikeyObject & TypeHttpObject & TypeOauth2Object;',
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

    const result = generateTypeDefinition(securityScheme, 'SecuritySchemeObject')

    expect(result).toContain('* SecuritySchemeObject')
    expect(result).toContain('* https://spec.openapis.org/oas/v3.1#security-scheme-object')
    expect(result).toContain('type: "apiKey" | "http" | "oauth2";')
    expect(result).toContain('} & TypeApikeyObject & TypeHttpObject;')
  })

  // A top-level allOf combining a $ref with an inline object should still surface
  // the descriptions on the inline properties (including description-bearing $ref
  // properties) as JSDoc comments, just like non-allOf object properties do.
  it('emits JSDoc descriptions for properties inside allOf sub-schemas', () => {
    const schema: JSONSchema = {
      allOf: [
        { $ref: '#/$defs/baseTargetConfig' },
        {
          type: 'object',
          additionalProperties: false,
          properties: {
            packageName: { type: 'string', description: 'Import/package name for TypeScript and Node packages.' },
            packageManager: {
              type: 'string',
              description: 'TypeScript package manager preference for generated package metadata.',
            },
            publish: { $ref: '#/$defs/npmPublishConfig', description: 'npm publishing configuration.' },
          },
          required: ['publish'],
        },
      ],
    }

    const result = generateTypeDefinition(schema, 'TypeScriptTargetConfigObject')

    expect(result).toContain('/** Import/package name for TypeScript and Node packages. */')
    expect(result).toContain('/** TypeScript package manager preference for generated package metadata. */')
    expect(result).toContain('/** npm publishing configuration. */')
    expect(result).toContain('packageName?: string')
    expect(result).toContain('packageManager?: string')
    expect(result).toContain('publish: NpmPublishConfigObject')
    expect(result).toContain('BaseTargetConfigObject')
  })

  it('generates record type for patternProperties-only schema without explicit type', () => {
    const schema: JSONSchema = {
      patternProperties: {
        '^x-': true,
      },
    }

    const result = generateTypeDefinition(schema, 'SpecificationExtensionsObject')

    expect(result).toStrictEqual('export type SpecificationExtensionsObject = Record<`x-${string}`, unknown>;')
  })

  it('generates Record<string, never> for patternProperties-only schema with false boolean value', () => {
    // The false boolean schema means no values are allowed for matching keys,
    // which maps to the never type in TypeScript.
    const schema: JSONSchema = {
      patternProperties: {
        '^x-': false,
      },
    }

    const result = generateTypeDefinition(schema, 'RestrictedObject')

    expect(result).toStrictEqual('export type RestrictedObject = Record<`x-${string}`, never>;')
  })

  it('generates Schema type for property with $dynamicRef pointing to #meta', () => {
    // $dynamicRef: '#meta' is a JSON Schema 2020-12 pattern used for recursive
    // schema definitions that refer to the root Schema type itself.
    const schema: JSONSchema.Object = {
      type: 'object',
      properties: {
        schema: { $dynamicRef: '#meta' },
      },
    }

    const result = generateTypeDefinition(schema, 'SchemaContainer')

    expect(result).toContain('schema?: Schema')
  })

  it('generates type name from non-meta $dynamicRef', () => {
    // A $dynamicRef other than '#meta' is converted via refToName like a $ref.
    const schema: JSONSchema.Object = {
      type: 'object',
      properties: {
        content: { $dynamicRef: '#/$defs/schema' },
      },
    }

    const result = generateTypeDefinition(schema, 'ContentContainer')

    expect(result).toContain('content?: SchemaObject')
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

    const result = generateTypeDefinition(schema, 'CallbackObject')

    expect(result).toContain('/**')
    expect(result).toContain('* CallbackObject')
    expect(result).toContain('* https://spec.openapis.org/oas/v3.1#callback-object')
    expect(result).toContain('[key: string]: PathItemObject')
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

    expect(result).toBe('export type ThemeColor = "red" | "green" | "blue" | "yellow" | "purple";')
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

    expect(result).toBe('export type Parameters = (ParameterObject | ReferenceObject)[];')
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
    expect(result).toContain('export type Contacts = ServerObject[];')
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
    expect(result).toContain('export type Parameters = ParameterObject[];')
  })

  it('generates unknown for external $ref', () => {
    // External refs (e.g. from draft-04 schemas) cannot be resolved locally — treated as unknown.
    const schema: JSONSchema = {
      $ref: 'http://json-schema.org/draft-04/schema#/properties/maximum',
    }

    const result = generateTypeDefinition(schema, 'MaximumObject')

    expect(result).toBe('export type MaximumObject = unknown;')
  })

  it('does not emit a trailing blank line in JSDoc when there is no @see link', () => {
    const schema: JSONSchema = {
      $comment: 'A plain-text description with no URL.',
      type: 'object',
      properties: {
        value: { type: 'string' },
      },
    }

    const result = generateTypeDefinition(schema, 'PlainCommentObject')

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
})
