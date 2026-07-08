// A structural meta-schema for OpenAPI 3.1 documents.
//
// OpenAPI 3.1 realigned the Schema Object with JSON Schema 2020-12, a full
// dialect (boolean schemas, `$dynamicRef`, `prefixItems`, `type` arrays,
// `const`, `$defs`, `if`/`then`/`else`, …). Validating Schema Objects against
// that dialect needs a 2020-12 engine, and the operation/media internals gained
// enough freedom that re-using the strict 3.0 definitions false-positives on
// real-world 3.1 specs. So this schema validates the **document envelope**
// strictly — the root, Info/Contact/License, Servers, the Paths *structure*,
// Components *groups*, Tags and Security — while keeping operation bodies and
// Schema Objects permissive (an object). That mirrors the official 3.1
// meta-schema delegating Schema Objects to the JSON Schema dialect.
//
// The small, stable leaf objects are reused verbatim from the (tested) 3.0
// meta-schema; the envelope and the objects 3.1 changed are defined here.
import { oas3Schema } from './oas3'

type SchemaObject = Record<string, unknown>

const base = (oas3Schema as { definitions: Record<string, SchemaObject> }).definitions

const HTTP_METHODS = '^(get|put|post|delete|options|head|patch|trace)$'

/**
 * Structural schema for OpenAPI 3.1 documents. Strict on the envelope, permissive
 * on operation bodies and Schema Objects (see file header).
 */
export const oas31Schema: object = {
  description: 'Structural validation of OpenAPI 3.1 documents.',
  type: 'object',
  required: ['openapi', 'info'],
  // A 3.1 document needs at least one of paths / webhooks / components.
  anyOf: [{ required: ['paths'] }, { required: ['webhooks'] }, { required: ['components'] }],
  additionalProperties: false,
  patternProperties: { '^x-': {} },
  properties: {
    openapi: { type: 'string', pattern: '^3\\.1\\.\\d+(-.+)?$' },
    info: { $ref: '#/definitions/Info' },
    jsonSchemaDialect: { type: 'string', format: 'uri-reference' },
    externalDocs: { $ref: '#/definitions/ExternalDocumentation' },
    servers: { type: 'array', items: { $ref: '#/definitions/Server' } },
    security: { type: 'array', items: { $ref: '#/definitions/SecurityRequirement' } },
    tags: { type: 'array', items: { $ref: '#/definitions/Tag' }, uniqueItems: true },
    paths: { $ref: '#/definitions/Paths' },
    webhooks: {
      type: 'object',
      additionalProperties: { $ref: '#/definitions/PathItem' },
    },
    components: { $ref: '#/definitions/Components' },
  },
  definitions: {
    // Reused verbatim from the 3.0 meta-schema (stable, no Schema-Object refs).
    Contact: base['Contact'],
    Server: base['Server'],
    ServerVariable: base['ServerVariable'],
    ExternalDocumentation: base['ExternalDocumentation'],
    SecurityRequirement: base['SecurityRequirement'],
    Tag: base['Tag'],

    // Info gains an optional `summary` in 3.1.
    Info: {
      type: 'object',
      required: ['title', 'version'],
      additionalProperties: false,
      patternProperties: { '^x-': {} },
      properties: {
        title: { type: 'string' },
        summary: { type: 'string' },
        description: { type: 'string' },
        termsOfService: { type: 'string', format: 'uri-reference' },
        contact: { $ref: '#/definitions/Contact' },
        license: { $ref: '#/definitions/License' },
        version: { type: 'string' },
      },
    },
    // License gains `identifier` (SPDX); the url/identifier exclusivity is
    // enforced by the `oas3_1-license-identifier` rule, so here we only allow it.
    License: {
      type: 'object',
      required: ['name'],
      additionalProperties: false,
      patternProperties: { '^x-': {} },
      properties: {
        name: { type: 'string' },
        identifier: { type: 'string' },
        url: { type: 'string', format: 'uri-reference' },
      },
    },

    // Paths: only `/`-prefixed keys (path templates) and extensions.
    Paths: {
      type: 'object',
      additionalProperties: false,
      patternProperties: {
        '^\\/': { $ref: '#/definitions/PathItem' },
        '^x-': {},
      },
    },
    // Path Item: known fixed fields + HTTP methods. Operation bodies are
    // validated permissively (just "an object").
    PathItem: {
      type: 'object',
      additionalProperties: false,
      patternProperties: {
        [HTTP_METHODS]: { type: 'object' },
        '^x-': {},
      },
      properties: {
        $ref: { type: 'string' },
        summary: { type: 'string' },
        description: { type: 'string' },
        servers: { type: 'array', items: { $ref: '#/definitions/Server' } },
        parameters: { type: 'array' },
      },
    },

    // Components: only the known reusable groups (each an object); entries are
    // validated permissively here (their internals are checked by other rules).
    Components: {
      type: 'object',
      additionalProperties: false,
      patternProperties: { '^x-': {} },
      properties: {
        schemas: { type: 'object' },
        responses: { type: 'object' },
        parameters: { type: 'object' },
        examples: { type: 'object' },
        requestBodies: { type: 'object' },
        headers: { type: 'object' },
        securitySchemes: { type: 'object' },
        links: { type: 'object' },
        callbacks: { type: 'object' },
        pathItems: { type: 'object' },
      },
    },
  },
}
