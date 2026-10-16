import type { JSONSchema } from 'json-schema-typed/draft-2020-12'

/**
 * An OpenAPI 3.1 document schema written the way a coercer for bundled documents
 * writes one, and the shape the single-pass repair walk was built for:
 *
 *  - every union is an `if`/`then`/`else` — a Reference-Object-or-T position asks
 *    `if: { type: object, required: [$ref] }`, a disjoint-kind union asks
 *    `if: { type }`, and an object union is an `allOf` of `if`/`then` on a
 *    discriminator `enum`;
 *  - objects are open (`additionalProperties` absent) or maps;
 *  - the Reference schema opts into instance `$ref` following with
 *    `"x-repair": "ref"`, and a few positions are removed rather than defaulted
 *    with `"x-repair": "drop"`.
 *
 * Shared by the walk's tests and `scripts/bench-repair-walk.ts`, so the numbers
 * the benchmark prints are for the schema the tests pin. The `.test-utils.ts`
 * suffix keeps it out of the published build.
 */
const ref = (name: string): JSONSchema => ({ $ref: `#/$defs/${name}` })

/** A schema carrying the `x-repair` annotation, which the draft's types do not list. */
const marked = (marker: 'ref' | 'drop', schema: Record<string, unknown>): JSONSchema =>
  ({ 'x-repair': marker, ...schema }) as JSONSchema

/** A Reference-Object-or-T position. */
const orRef = (name: string): JSONSchema => ({
  if: { type: 'object', required: ['$ref'] },
  then: ref('Reference'),
  else: ref(name),
})

const map = (value: JSONSchema): JSONSchema => ({ type: 'object', additionalProperties: value })
const list = (value: JSONSchema): JSONSchema => ({ type: 'array', items: value })
const text: JSONSchema = { type: 'string' }
const flag: JSONSchema = { type: 'boolean' }

const methods = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'] as const

export const OPENAPI_COERCER_SCHEMA: JSONSchema = {
  $defs: {
    Reference: marked('ref', {
      type: 'object',
      required: ['$ref'],
      properties: { $ref: text, summary: text, description: text },
    }),
    Info: {
      type: 'object',
      required: ['title', 'version'],
      properties: {
        title: text,
        summary: text,
        description: text,
        termsOfService: text,
        contact: ref('Contact'),
        license: ref('License'),
        version: { type: 'string', default: '1.0.0' },
      },
    },
    Contact: { type: 'object', properties: { name: text, url: text, email: text } },
    License: { type: 'object', required: ['name'], properties: { name: text, identifier: text, url: text } },
    Server: {
      type: 'object',
      required: ['url'],
      properties: { url: text, description: text, variables: map(ref('ServerVariable')) },
    },
    ServerVariable: {
      type: 'object',
      required: ['default'],
      properties: { enum: list(text), default: text, description: text },
    },
    ExternalDocs: marked('drop', {
      type: 'object',
      required: ['url'],
      properties: { description: text, url: text },
    }),
    Tag: {
      type: 'object',
      required: ['name'],
      properties: { name: text, description: text, externalDocs: ref('ExternalDocs') },
    },
    PathItem: {
      type: 'object',
      properties: {
        $ref: text,
        summary: text,
        description: text,
        ...Object.fromEntries(methods.map((method) => [method, ref('Operation')])),
        servers: list(ref('Server')),
        parameters: list(orRef('Parameter')),
      },
    },
    Operation: {
      type: 'object',
      properties: {
        tags: list(text),
        summary: text,
        description: text,
        externalDocs: ref('ExternalDocs'),
        operationId: text,
        parameters: list(orRef('Parameter')),
        requestBody: orRef('RequestBody'),
        responses: map(orRef('Response')),
        callbacks: map(orRef('Callback')),
        deprecated: flag,
        security: list(ref('SecurityRequirement')),
        servers: list(ref('Server')),
      },
    },
    Parameter: {
      type: 'object',
      required: ['name', 'in'],
      properties: {
        name: text,
        in: { enum: ['query', 'header', 'path', 'cookie'] },
        description: text,
        required: flag,
        deprecated: flag,
        allowEmptyValue: marked('drop', { type: 'boolean' }),
        style: text,
        explode: flag,
        allowReserved: flag,
        schema: orRef('Schema'),
        examples: map(orRef('Example')),
        content: map(ref('MediaType')),
      },
      allOf: [
        {
          if: { properties: { in: { const: 'path' } }, required: ['in'] },
          then: { properties: { required: { const: true } }, required: ['required'] },
        },
      ],
    },
    Header: {
      type: 'object',
      properties: {
        description: text,
        required: flag,
        deprecated: flag,
        style: text,
        explode: flag,
        schema: orRef('Schema'),
        examples: map(orRef('Example')),
        content: map(ref('MediaType')),
      },
    },
    RequestBody: {
      type: 'object',
      required: ['content'],
      properties: { description: text, content: map(ref('MediaType')), required: flag },
    },
    MediaType: {
      type: 'object',
      properties: {
        schema: orRef('Schema'),
        examples: map(orRef('Example')),
        encoding: map(ref('Encoding')),
      },
    },
    Encoding: {
      type: 'object',
      properties: {
        contentType: text,
        headers: map(orRef('Header')),
        style: text,
        explode: flag,
        allowReserved: flag,
      },
    },
    Response: {
      type: 'object',
      required: ['description'],
      properties: {
        description: text,
        headers: map(orRef('Header')),
        content: map(ref('MediaType')),
        links: map(orRef('Link')),
      },
    },
    Callback: map(ref('PathItem')),
    Example: { type: 'object', properties: { summary: text, description: text, externalValue: text } },
    Link: {
      type: 'object',
      properties: { operationRef: text, operationId: text, description: text, server: ref('Server') },
    },
    OAuthFlow: {
      type: 'object',
      required: ['scopes'],
      properties: { authorizationUrl: text, tokenUrl: text, refreshUrl: text, scopes: map(text) },
    },
    SecurityScheme: {
      type: 'object',
      required: ['type'],
      properties: {
        type: { enum: ['apiKey', 'http', 'mutualTLS', 'oauth2', 'openIdConnect'] },
        description: text,
      },
      allOf: [
        {
          if: { properties: { type: { const: 'apiKey' } }, required: ['type'] },
          then: {
            required: ['name', 'in'],
            properties: { name: text, in: { enum: ['query', 'header', 'cookie'] } },
          },
        },
        {
          if: { properties: { type: { const: 'http' } }, required: ['type'] },
          then: { required: ['scheme'], properties: { scheme: text, bearerFormat: text } },
        },
        {
          if: { properties: { type: { const: 'oauth2' } }, required: ['type'] },
          then: {
            required: ['flows'],
            properties: {
              flows: {
                type: 'object',
                properties: {
                  implicit: ref('OAuthFlow'),
                  password: ref('OAuthFlow'),
                  clientCredentials: ref('OAuthFlow'),
                  authorizationCode: ref('OAuthFlow'),
                },
              },
            },
          },
        },
        {
          if: { properties: { type: { const: 'openIdConnect' } }, required: ['type'] },
          then: { required: ['openIdConnectUrl'], properties: { openIdConnectUrl: text } },
        },
      ],
    },
    SecurityRequirement: map(list(text)),
    Discriminator: {
      type: 'object',
      required: ['propertyName'],
      properties: { propertyName: text, mapping: map(text) },
    },
    Schema: {
      // A JSON Schema is an object or a boolean: a disjoint-kind union.
      if: { type: 'boolean' },
      else: {
        type: 'object',
        properties: {
          title: text,
          description: text,
          format: text,
          pattern: text,
          type: {
            if: { type: 'array' },
            then: list(text),
            else: text,
          },
          properties: map(orRef('Schema')),
          additionalProperties: orRef('Schema'),
          patternProperties: map(orRef('Schema')),
          items: orRef('Schema'),
          prefixItems: list(orRef('Schema')),
          allOf: list(orRef('Schema')),
          anyOf: list(orRef('Schema')),
          oneOf: list(orRef('Schema')),
          not: orRef('Schema'),
          required: list(text),
          enum: { type: 'array' },
          nullable: flag,
          readOnly: flag,
          writeOnly: flag,
          deprecated: flag,
          discriminator: ref('Discriminator'),
          externalDocs: ref('ExternalDocs'),
          minimum: { type: 'number' },
          maximum: { type: 'number' },
          minLength: { type: 'integer' },
          maxLength: { type: 'integer' },
          minItems: { type: 'integer' },
          maxItems: { type: 'integer' },
          uniqueItems: flag,
        },
      },
    },
    Components: {
      type: 'object',
      properties: {
        schemas: map(orRef('Schema')),
        responses: map(orRef('Response')),
        parameters: map(orRef('Parameter')),
        examples: map(orRef('Example')),
        requestBodies: map(orRef('RequestBody')),
        headers: map(orRef('Header')),
        securitySchemes: map(orRef('SecurityScheme')),
        links: map(orRef('Link')),
        callbacks: map(orRef('Callback')),
        pathItems: map(orRef('PathItem')),
      },
    },
  },
  type: 'object',
  required: ['openapi', 'info'],
  properties: {
    openapi: { type: 'string', default: '3.1.0' },
    info: ref('Info'),
    jsonSchemaDialect: text,
    servers: list(ref('Server')),
    paths: map(ref('PathItem')),
    webhooks: map(orRef('PathItem')),
    components: ref('Components'),
    security: list(ref('SecurityRequirement')),
    tags: list(ref('Tag')),
    externalDocs: ref('ExternalDocs'),
  },
}
