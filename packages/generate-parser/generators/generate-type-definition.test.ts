import { readFile } from 'node:fs/promises'
import type { JSONSchema } from 'json-schema-typed/draft-2020-12'
import { describe, expect, it } from 'vitest'
import { generateTypeDefinition } from './generate-type-definition'

const markdownDocumentation = await readFile(new URL('../../fixtures/3.1.0.md', import.meta.url), 'utf-8')

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

  it('generates type for boolean schema', () => {
    const schema = true

    const result = generateTypeDefinition(schema, 'BooleanSchema')

    expect(result).toStrictEqual('export type BooleanSchema = boolean;')
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

  it('generates type for schema with all fields required', () => {
    const info: JSONSchema.Object = {
      $comment: 'https://spec.openapis.org/oas/v3.1#info-object',
      type: 'object',
      properties: {
        title: {
          type: 'string',
        },
        summary: {
          type: 'string',
        },
        description: {
          type: 'string',
        },
        termsOfService: {
          type: 'string',
          format: 'uri-reference',
        },
        contact: {
          $ref: '#/$defs/contact',
        },
        license: {
          $ref: '#/$defs/license',
        },
        version: {
          type: 'string',
        },
      },
      required: ['title', 'version'],
      $ref: '#/$defs/specification-extensions',
      unevaluatedProperties: false,
    }

    const result = generateTypeDefinition(info, 'InfoObject', markdownDocumentation)

    expect(result).toStrictEqual(
      `/**
* Info object
*
* The object provides metadata about the API. The metadata MAY be used by the clients if needed, and MAY be presented in editing or documentation generation tools for convenience.
* 
* @see {@link https://spec.openapis.org/oas/v3.1#info-object}
*/
export type InfoObject = {
  /** **REQUIRED**. The title of the API. */
  title: string;
  /** A short summary of the API. */
  summary?: string;
  /** A description of the API. [CommonMark syntax](https://spec.commonmark.org/) MAY be used for rich text representation. */
  description?: string;
  /** A URL to the Terms of Service for the API. This MUST be in the form of a URL. */
  termsOfService?: string;
  /** The contact information for the exposed API. */
  contact?: ContactObject;
  /** The license information for the exposed API. */
  license?: LicenseObject;
  /** **REQUIRED**. The version of the OpenAPI document (which is distinct from the [OpenAPI Specification version](https://spec.openapis.org/oas/v3.1#oasVersion) or the API implementation version). */
  version: string;
} & ` + 'Record<`x-${string}`, unknown>;',
    )
  })

  it('generates type for the components object', () => {
    const components: JSONSchema.Object = {
      $comment: 'https://spec.openapis.org/oas/v3.1#components-object',
      type: 'object',
      properties: {
        responses: {
          type: 'object',
          additionalProperties: {
            $ref: '#/$defs/response-or-reference',
          },
        },
        parameters: {
          type: 'object',
          additionalProperties: {
            $ref: '#/$defs/parameter-or-reference',
          },
        },
        examples: {
          type: 'object',
          additionalProperties: {
            $ref: '#/$defs/example-or-reference',
          },
        },
        requestBodies: {
          type: 'object',
          additionalProperties: {
            $ref: '#/$defs/request-body-or-reference',
          },
        },
        headers: {
          type: 'object',
          additionalProperties: {
            $ref: '#/$defs/header-or-reference',
          },
        },
        securitySchemes: {
          type: 'object',
          additionalProperties: {
            $ref: '#/$defs/security-scheme-or-reference',
          },
        },
        links: {
          type: 'object',
          additionalProperties: {
            $ref: '#/$defs/link-or-reference',
          },
        },
        callbacks: {
          type: 'object',
          additionalProperties: {
            $ref: '#/$defs/callbacks-or-reference',
          },
        },
        pathItems: {
          type: 'object',
          additionalProperties: {
            $ref: '#/$defs/path-item',
          },
        },
      },
    }

    const result = generateTypeDefinition(components, 'ComponentsObject', markdownDocumentation)

    expect(result).toStrictEqual(
      `/**
* Components object
*
* Holds a set of reusable objects for different aspects of the OAS. All objects defined within the components object will have no effect on the API unless they are explicitly referenced from properties outside the components object.
* 
* @see {@link https://spec.openapis.org/oas/v3.1#components-object}
*/
export type ComponentsObject = {
  /** An object to hold reusable [Response Objects](https://spec.openapis.org/oas/v3.1#response-object). */
  responses?: Record<string, ResponseObject | ReferenceObject>;
  /** An object to hold reusable [Parameter Objects](https://spec.openapis.org/oas/v3.1#parameter-object). */
  parameters?: Record<string, ParameterObject | ReferenceObject>;
  /** An object to hold reusable [Example Objects](https://spec.openapis.org/oas/v3.1#example-object). */
  examples?: Record<string, ExampleObject | ReferenceObject>;
  /** An object to hold reusable [Request Body Objects](https://spec.openapis.org/oas/v3.1#request-body-object). */
  requestBodies?: Record<string, RequestBodyObject | ReferenceObject>;
  /** An object to hold reusable [Header Objects](https://spec.openapis.org/oas/v3.1#header-object). */
  headers?: Record<string, HeaderObject | ReferenceObject>;
  /** An object to hold reusable [Security Scheme Objects](https://spec.openapis.org/oas/v3.1#security-scheme-object). */
  securitySchemes?: Record<string, SecuritySchemeObject | ReferenceObject>;
  /** An object to hold reusable [Link Objects](https://spec.openapis.org/oas/v3.1#link-object). */
  links?: Record<string, LinkObject | ReferenceObject>;
  /** An object to hold reusable [Callback Objects](https://spec.openapis.org/oas/v3.1#callback-object). */
  callbacks?: Record<string, CallbacksObject | ReferenceObject>;
  /** An object to hold reusable [Path Item Object](https://spec.openapis.org/oas/v3.1#path-item-object). */
  pathItems?: Record<string, PathItemObject>;
};`,
    )
  })

  it('generates type for object with paths property as Record<string, PathItemObject>', () => {
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
        paths: {
          type: 'object',
          additionalProperties: {
            $ref: '#/$defs/path-item',
          },
        },
      },
      required: ['openapi', 'info'],
    }

    const result = generateTypeDefinition(document, 'Document', markdownDocumentation)

    expect(result).toStrictEqual(
      `/**
* Openapi object
*
* This is the root object of the [OpenAPI document](#openapi-document).
* 
* @see {@link https://spec.openapis.org/oas/v3.1#openapi-object}
*/
export type Document = {
  /** **REQUIRED**. This string MUST be the [version number](https://spec.openapis.org/oas/v3.1#versions) of the OpenAPI Specification that the OpenAPI document uses. The \`openapi\` field SHOULD be used by tooling to interpret the OpenAPI document. This is *not* related to the API [\`info.version\`](https://spec.openapis.org/oas/v3.1#infoVersion) string. */
  openapi: string;
  /** **REQUIRED**. Provides metadata about the API. The metadata MAY be used by tooling as required. */
  info: InfoObject;
  /** The available paths and operations for the API. */
  paths?: Record<string, PathItemObject>;
};`,
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

    const result = generateTypeDefinition(document, 'Document', markdownDocumentation)

    expect(result).toStrictEqual(
      `/**
* Openapi object
*
* This is the root object of the [OpenAPI document](#openapi-document).
* 
* @see {@link https://spec.openapis.org/oas/v3.1#openapi-object}
*/
export type Document = {
  /** **REQUIRED**. This string MUST be the [version number](https://spec.openapis.org/oas/v3.1#versions) of the OpenAPI Specification that the OpenAPI document uses. The \`openapi\` field SHOULD be used by tooling to interpret the OpenAPI document. This is *not* related to the API [\`info.version\`](https://spec.openapis.org/oas/v3.1#infoVersion) string. */
  openapi: string;
  /** **REQUIRED**. Provides metadata about the API. The metadata MAY be used by tooling as required. */
  info: InfoObject;
  /** The default value for the \`$schema\` keyword within [Schema Objects](https://spec.openapis.org/oas/v3.1#schema-object) contained within this OAS document. This MUST be in the form of a URI. */
  jsonSchemaDialect?: string;
  /** An array of Server Objects, which provide connectivity information to a target server. If the \`servers\` property is not provided, or is an empty array, the default value would be a [Server Object](https://spec.openapis.org/oas/v3.1#server-object) with a [url](https://spec.openapis.org/oas/v3.1#serverUrl) value of \`/\`. */
  servers?: ServerObject[];
  /** The available paths and operations for the API. */
  paths?: Record<string, PathItemObject>;
  /** The incoming webhooks that MAY be received as part of this API and that the API consumer MAY choose to implement. Closely related to the \`callbacks\` feature, this section describes requests initiated other than by an API call, for example by an out of band registration. The key name is a unique string to refer to each webhook, while the (optionally referenced) Path Item Object describes a request that may be initiated by the API provider and the expected responses. An [example](../examples/v3.1/webhook-example.yaml) is available. */
  webhooks?: Record<string, PathItemObject>;
  /** An element to hold various schemas for the document. */
  components?: ComponentsObject;
};`,
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

    const result = generateTypeDefinition(paths, 'PathsObject', markdownDocumentation)

    expect(result).toStrictEqual(
      `/**
* Paths object
*
* Holds the relative paths to the individual endpoints and their operations. The path is appended to the URL from the [\`Server Object\`](#server-object) in order to construct the full URL.  The Paths MAY be empty, due to [Access Control List (ACL) constraints](#security-filtering).
* 
* @see {@link https://spec.openapis.org/oas/v3.1#paths-object}
*/
export type PathsObject = Record<string, PathItemObject>;`,
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

  it('generates required discriminator and comments for conditional type-http schema', () => {
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

    const result = generateTypeDefinition(schema, 'TypeHttpObject', markdownDocumentation)

    expect(result).toContain('/** **REQUIRED**. The type of the security scheme.')
    expect(result).toContain('type: "http";')
    expect(result).toContain('/** **REQUIRED**. The name of the HTTP Authorization scheme to be used')
    expect(result).toContain('scheme: string;')
    expect(result).toContain('/** A hint to the client to identify how the bearer token is formatted.')
    expect(result).toContain('bearerFormat: string;')
  })

  it('generates union type for security-scheme subtype refs', () => {
    const securityScheme: JSONSchema.Object = {
      $comment: 'https://spec.openapis.org/oas/v3.1#security-scheme-object',
      type: 'object',
      properties: {
        type: {
          enum: ['apiKey', 'http', 'mutualTLS', 'oauth2', 'openIdConnect'],
        },
        description: {
          type: 'string',
        },
      },
      required: ['type'],
      allOf: [
        { $ref: '#/$defs/specification-extensions' },
        { $ref: '#/$defs/security-scheme/$defs/type-apikey' },
        { $ref: '#/$defs/security-scheme/$defs/type-http' },
        { $ref: '#/$defs/security-scheme/$defs/type-http-bearer' },
        { $ref: '#/$defs/security-scheme/$defs/type-oauth2' },
        { $ref: '#/$defs/security-scheme/$defs/type-oidc' },
      ],
    }

    const result = generateTypeDefinition(securityScheme, 'SecuritySchemeObject')

    expect(result).toStrictEqual(
      'export type SecuritySchemeObject = TypeApikeyObject | TypeHttpObject | TypeHttpBearerObject | TypeOauth2Object | TypeOidcObject;',
    )
  })

  it('uses security-scheme documentation heading with subtype union type', () => {
    const securityScheme: JSONSchema.Object = {
      $comment: 'https://spec.openapis.org/oas/v3.1#security-scheme-object',
      type: 'object',
      properties: {
        type: {
          enum: ['apiKey', 'http', 'mutualTLS', 'oauth2', 'openIdConnect'],
        },
        description: {
          type: 'string',
        },
      },
      required: ['type'],
      allOf: [
        { $ref: '#/$defs/specification-extensions' },
        { $ref: '#/$defs/security-scheme/$defs/type-apikey' },
        { $ref: '#/$defs/security-scheme/$defs/type-http' },
        { $ref: '#/$defs/security-scheme/$defs/type-http-bearer' },
        { $ref: '#/$defs/security-scheme/$defs/type-oauth2' },
        { $ref: '#/$defs/security-scheme/$defs/type-oidc' },
      ],
    }

    const result = generateTypeDefinition(securityScheme, 'SecuritySchemeObject', markdownDocumentation)
    expect(result).toEqual(
      `/**
* Security Scheme object
*
* Defines a security scheme that can be used by the operations.  Supported schemes are HTTP authentication, an API key (either as a header, a cookie parameter or as a query parameter), mutual TLS (use of a client certificate), OAuth2's common flows (implicit, password, client credentials and authorization code) as defined in [RFC6749](https://tools.ietf.org/html/rfc6749), and [OpenID Connect Discovery](https://tools.ietf.org/html/draft-ietf-oauth-discovery-06). Please note that as of 2020, the implicit flow is about to be deprecated by [OAuth 2.0 Security Best Current Practice](https://tools.ietf.org/html/draft-ietf-oauth-security-topics). Recommended for most use case is Authorization Code Grant flow with PKCE.
* 
* @see {@link https://spec.openapis.org/oas/v3.1#security-scheme-object}
*/
export type SecuritySchemeObject = TypeApikeyObject | TypeHttpObject | TypeHttpBearerObject | TypeOauth2Object | TypeOidcObject;`,
    )
  })

  it('generates record type for patternProperties-only schema without explicit type', () => {
    const schema: JSONSchema = {
      patternProperties: {
        '^x-': true,
      },
    }

    const result = generateTypeDefinition(schema, 'SpecificationExtensionsObject')

    expect(result).toStrictEqual('export type SpecificationExtensionsObject = Record<string, unknown>;')
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

    expect(result).toStrictEqual('export type RestrictedObject = Record<string, never>;')
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

  it('infers Record<string, unknown> for no-type property with boolean true patternProperties value', () => {
    // A patternProperties value of true (boolean) means matching keys can hold any value.
    const schema: JSONSchema.Object = {
      type: 'object',
      properties: {
        extensions: { patternProperties: { '^x-': true } },
      },
    }

    const result = generateTypeDefinition(schema, 'Container')

    expect(result).toContain('extensions?: Record<string, unknown>')
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

    const result = generateTypeDefinition(schema, 'CallbackObject', markdownDocumentation)

    expect(result).toContain('/**')
    expect(result).toContain('* Callback object')
    expect(result).toContain('* @see')
    expect(result).toContain('[key: string]: PathItemObject')
  })
})
