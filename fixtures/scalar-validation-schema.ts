/**
 * OpenAPI 3.1 schema built with @scalar/validation.
 * Mirrors the core structure from @scalar/workspace-store's v3.1 openapi schema,
 * without any Scalar-specific extensions.
 */
import {
  any,
  array,
  boolean,
  lazy,
  literal,
  number,
  object,
  optional,
  record,
  type Schema,
  string,
  union,
} from '@scalar/validation'

const contact = object({
  name: optional(string()),
  url: optional(string()),
  email: optional(string()),
})

const license = object({
  name: optional(string()),
  identifier: optional(string()),
  url: optional(string()),
})

const info = object({
  title: string(),
  version: string(),
  summary: optional(string()),
  description: optional(string()),
  termsOfService: optional(string()),
  contact: optional(contact),
  license: optional(license),
})

const serverVariable = object({
  enum: optional(array(string())),
  default: optional(string()),
  description: optional(string()),
})

const server = object({
  url: string(),
  description: optional(string()),
  variables: optional(record(string(), serverVariable)),
})

const externalDocs = object({
  url: string(),
  description: optional(string()),
})

const tag = object({
  name: string(),
  description: optional(string()),
  externalDocs: optional(externalDocs),
})

const securityRequirement = record(string(), array(string()))

const xml = object({
  name: optional(string()),
  namespace: optional(string()),
  prefix: optional(string()),
  attribute: optional(boolean()),
  wrapped: optional(boolean()),
})

const discriminatorObject = object({
  propertyName: string(),
  mapping: optional(record(string(), string())),
})

// Core schema properties shared across all schema variants
const coreSchemaProperties = {
  title: optional(string()),
  description: optional(string()),
  default: optional(any()),
  enum: optional(array(any())),
  const: optional(any()),
  contentMediaType: optional(string()),
  contentEncoding: optional(string()),
  contentSchema: optional(lazy((): Schema => schema)),
  deprecated: optional(boolean()),
  discriminator: optional(discriminatorObject),
  readOnly: optional(boolean()),
  writeOnly: optional(boolean()),
  xml: optional(xml),
  externalDocs: optional(externalDocs),
  example: optional(any()),
  examples: optional(array(any())),
  allOf: optional(array(lazy((): Schema => schema))),
  oneOf: optional(array(lazy((): Schema => schema))),
  anyOf: optional(array(lazy((): Schema => schema))),
  not: optional(lazy((): Schema => schema)),
} as const

const numericSchema: Schema = object({
  ...coreSchemaProperties,
  type: union([literal('number'), literal('integer')]),
  format: optional(string()),
  multipleOf: optional(number()),
  maximum: optional(number()),
  exclusiveMaximum: optional(number()),
  minimum: optional(number()),
  exclusiveMinimum: optional(number()),
})

const stringSchema: Schema = object({
  ...coreSchemaProperties,
  type: literal('string'),
  format: optional(string()),
  maxLength: optional(number()),
  minLength: optional(number()),
  pattern: optional(string()),
})

const objectSchema: Schema = object({
  ...coreSchemaProperties,
  type: literal('object'),
  maxProperties: optional(number()),
  minProperties: optional(number()),
  properties: optional(
    record(
      string(),
      lazy((): Schema => schema),
    ),
  ),
  required: optional(array(string())),
  additionalProperties: optional(union([boolean(), lazy((): Schema => schema)])),
  patternProperties: optional(
    record(
      string(),
      lazy((): Schema => schema),
    ),
  ),
  propertyNames: optional(lazy((): Schema => schema)),
})

const arraySchema: Schema = object({
  ...coreSchemaProperties,
  type: literal('array'),
  maxItems: optional(number()),
  minItems: optional(number()),
  uniqueItems: optional(boolean()),
  items: optional(lazy((): Schema => schema)),
  prefixItems: optional(array(lazy((): Schema => schema))),
})

const schemaTypeMulti = union([
  literal('null'),
  literal('boolean'),
  literal('string'),
  literal('number'),
  literal('integer'),
  literal('object'),
  literal('array'),
])

const otherTypeSchema: Schema = object({
  ...coreSchemaProperties,
  type: union([literal('null'), literal('boolean'), array(schemaTypeMulti)]),
})

const schema: Schema = union([otherTypeSchema, numericSchema, stringSchema, objectSchema, arraySchema])

const example = object({
  summary: optional(string()),
  description: optional(string()),
  value: optional(any()),
  externalValue: optional(string()),
})

const headerWithSchema: Schema = object({
  description: optional(string()),
  required: optional(boolean()),
  deprecated: optional(boolean()),
  style: optional(string()),
  explode: optional(boolean()),
  schema: optional(lazy((): Schema => schema)),
  example: optional(any()),
  examples: optional(record(string(), example)),
})

const headerWithContent: Schema = object({
  description: optional(string()),
  required: optional(boolean()),
  deprecated: optional(boolean()),
  content: optional(
    record(
      string(),
      lazy((): Schema => mediaType),
    ),
  ),
})

const header: Schema = union([headerWithSchema, headerWithContent])

const encoding: Schema = object({
  contentType: optional(string()),
  headers: optional(record(string(), header)),
})

const mediaType: Schema = object({
  schema: optional(lazy((): Schema => schema)),
  example: optional(any()),
  examples: optional(record(string(), example)),
  encoding: optional(record(string(), encoding)),
})

const parameterWithSchema: Schema = object({
  name: string(),
  in: union([literal('query'), literal('header'), literal('path'), literal('cookie')]),
  description: optional(string()),
  required: optional(boolean()),
  deprecated: optional(boolean()),
  allowEmptyValue: optional(boolean()),
  allowReserved: optional(boolean()),
  style: optional(string()),
  explode: optional(boolean()),
  schema: optional(lazy((): Schema => schema)),
  example: optional(any()),
  examples: optional(record(string(), example)),
})

const parameterWithContent: Schema = object({
  name: string(),
  in: union([literal('query'), literal('header'), literal('path'), literal('cookie')]),
  description: optional(string()),
  required: optional(boolean()),
  deprecated: optional(boolean()),
  allowEmptyValue: optional(boolean()),
  allowReserved: optional(boolean()),
  content: optional(
    record(
      string(),
      lazy((): Schema => mediaType),
    ),
  ),
})

const parameter: Schema = union([parameterWithSchema, parameterWithContent])

const requestBody: Schema = object({
  description: optional(string()),
  content: record(
    string(),
    lazy((): Schema => mediaType),
  ),
  required: optional(boolean()),
})

const link = object({
  operationRef: optional(string()),
  operationId: optional(string()),
  parameters: optional(record(string(), any())),
  requestBody: optional(any()),
  description: optional(string()),
  server: optional(server),
})

const response: Schema = object({
  description: string(),
  headers: optional(record(string(), header)),
  content: optional(
    record(
      string(),
      lazy((): Schema => mediaType),
    ),
  ),
  links: optional(record(string(), link)),
})

const responsesObject: Schema = record(
  string(),
  lazy((): Schema => response),
)

const callback: Schema = record(
  string(),
  lazy((): Schema => pathItem),
)

const oauthFlowImplicit = object({
  authorizationUrl: string(),
  refreshUrl: optional(string()),
  scopes: record(string(), string()),
})

const oauthFlowPassword = object({
  tokenUrl: string(),
  refreshUrl: optional(string()),
  scopes: record(string(), string()),
})

const oauthFlowClientCredentials = object({
  tokenUrl: string(),
  refreshUrl: optional(string()),
  scopes: record(string(), string()),
})

const oauthFlowAuthorizationCode = object({
  authorizationUrl: string(),
  tokenUrl: string(),
  refreshUrl: optional(string()),
  scopes: record(string(), string()),
})

const oauth2Flows = object({
  implicit: optional(oauthFlowImplicit),
  password: optional(oauthFlowPassword),
  clientCredentials: optional(oauthFlowClientCredentials),
  authorizationCode: optional(oauthFlowAuthorizationCode),
})

const securityScheme = union([
  object({
    type: literal('apiKey'),
    name: string(),
    in: union([literal('query'), literal('header'), literal('cookie')]),
    description: optional(string()),
  }),
  object({
    type: literal('http'),
    scheme: union([literal('basic'), literal('bearer')]),
    bearerFormat: optional(string()),
    description: optional(string()),
  }),
  object({
    type: literal('oauth2'),
    flows: oauth2Flows,
    description: optional(string()),
  }),
  object({
    type: literal('openIdConnect'),
    openIdConnectUrl: string(),
    description: optional(string()),
  }),
])

const operation: Schema = object({
  tags: optional(array(string())),
  summary: optional(string()),
  description: optional(string()),
  externalDocs: optional(externalDocs),
  operationId: optional(string()),
  parameters: optional(array(lazy((): Schema => parameter))),
  requestBody: optional(lazy((): Schema => requestBody)),
  responses: optional(lazy((): Schema => responsesObject)),
  deprecated: optional(boolean()),
  security: optional(array(securityRequirement)),
  servers: optional(array(server)),
  callbacks: optional(
    record(
      string(),
      lazy((): Schema => callback),
    ),
  ),
})

const pathItem: Schema = object({
  $ref: optional(string()),
  summary: optional(string()),
  description: optional(string()),
  get: optional(lazy((): Schema => operation)),
  put: optional(lazy((): Schema => operation)),
  post: optional(lazy((): Schema => operation)),
  delete: optional(lazy((): Schema => operation)),
  patch: optional(lazy((): Schema => operation)),
  connect: optional(lazy((): Schema => operation)),
  options: optional(lazy((): Schema => operation)),
  head: optional(lazy((): Schema => operation)),
  trace: optional(lazy((): Schema => operation)),
  servers: optional(array(server)),
  parameters: optional(array(lazy((): Schema => parameter))),
})

const components: Schema = object({
  schemas: optional(
    record(
      string(),
      lazy((): Schema => schema),
    ),
  ),
  responses: optional(
    record(
      string(),
      lazy((): Schema => response),
    ),
  ),
  parameters: optional(
    record(
      string(),
      lazy((): Schema => parameter),
    ),
  ),
  examples: optional(record(string(), example)),
  requestBodies: optional(
    record(
      string(),
      lazy((): Schema => requestBody),
    ),
  ),
  headers: optional(record(string(), header)),
  securitySchemes: optional(record(string(), securityScheme)),
  links: optional(record(string(), link)),
  callbacks: optional(
    record(
      string(),
      lazy((): Schema => callback),
    ),
  ),
  pathItems: optional(
    record(
      string(),
      lazy((): Schema => pathItem),
    ),
  ),
})

export const openApiDocumentSchema: Schema = object({
  openapi: string(),
  info,
  jsonSchemaDialect: optional(string()),
  servers: optional(array(server)),
  paths: optional(record(string(), pathItem)),
  webhooks: optional(record(string(), pathItem)),
  components: optional(components),
  security: optional(array(securityRequirement)),
  tags: optional(array(tag)),
  externalDocs: optional(externalDocs),
})
