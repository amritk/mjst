import { describe, expect, it } from 'vitest'

import { lint } from '../../../core'
import { createOpenApiRuleset, oas } from '../index'

// Per-rule coverage for the OpenAPI-specific functions. Each function is driven
// end to end through the built ruleset (rather than called in isolation) so the
// `given`/`field` wiring is exercised alongside the function body. The whole
// preset is enabled (`[[oas, 'all']]`) so `recommended: false` rules run too, and
// every document is minimal enough that only the rule under test is in play. We
// assert the presence or absence of a specific finding code, never the full set,
// so unrelated findings from the strict preset do not make the tests brittle.
const allRules = createOpenApiRuleset({ extends: [[oas, 'all']] })

const codesFor = async (doc: unknown): Promise<Set<string | number>> =>
  new Set((await lint(JSON.stringify(doc), { ruleset: allRules })).map((finding) => finding.code))

const has = async (doc: unknown, code: string): Promise<boolean> => (await codesFor(doc)).has(code)

// A minimal-but-valid OpenAPI 3.0 document other tests can extend.
const base3 = (): Record<string, unknown> => ({
  openapi: '3.0.0',
  info: { title: 'T', version: '1.0.0', contact: { name: 'x' }, description: 'd' },
  servers: [{ url: 'https://api.example.test' }],
  paths: {},
})

describe('oas-functions', () => {
  // refSiblings ------------------------------------------------------------
  it('refSiblings flags a sibling next to $ref, and passes a lone $ref', async () => {
    const doc = { ...base3(), components: { schemas: { A: { $ref: '#/x', description: 'sib' } } } }
    expect(await has(doc, 'no-$ref-siblings')).toBe(true)
    const ok = { ...base3(), components: { schemas: { A: { $ref: '#/x' } } } }
    expect(await has(ok, 'no-$ref-siblings')).toBe(false)
  })

  // oasOpSuccessResponse ---------------------------------------------------
  it('oasOpSuccessResponse requires a 2xx/3xx response and no longer counts default', async () => {
    const only4xx = { ...base3(), paths: { '/a': { get: { responses: { '400': { description: 'bad' } } } } } }
    expect(await has(only4xx, 'operation-success-response')).toBe(true)
    // `default` alone does not prove a success response exists (Spectral parity).
    const onlyDefault = { ...base3(), paths: { '/a': { get: { responses: { default: { description: 'd' } } } } } }
    expect(await has(onlyDefault, 'operation-success-response')).toBe(true)
    const ok = { ...base3(), paths: { '/a': { get: { responses: { '200': { description: 'ok' } } } } } }
    expect(await has(ok, 'operation-success-response')).toBe(false)
  })

  it('oasOpSuccessResponse accepts 2XX/3XX wildcard status codes', async () => {
    const wildcard = { ...base3(), paths: { '/a': { get: { responses: { '2XX': { description: 'ok' } } } } } }
    expect(await has(wildcard, 'operation-success-response')).toBe(false)
  })

  // oasTagDefined ----------------------------------------------------------
  it('oasTagDefined flags an operation tag missing from the global tags', async () => {
    const doc = {
      ...base3(),
      tags: [{ name: 'known' }],
      paths: { '/a': { get: { tags: ['unknown'], responses: { '200': { description: 'ok' } } } } },
    }
    expect(await has(doc, 'operation-tag-defined')).toBe(true)
    const ok = {
      ...base3(),
      tags: [{ name: 'known' }],
      paths: { '/a': { get: { tags: ['known'], responses: { '200': { description: 'ok' } } } } },
    }
    expect(await has(ok, 'operation-tag-defined')).toBe(false)
  })

  // oasOpIdUnique ----------------------------------------------------------
  it('oasOpIdUnique flags duplicate operationIds and ignores non-operation keys', async () => {
    const dup = {
      ...base3(),
      paths: {
        '/a': { get: { operationId: 'dup', responses: { '200': { description: 'ok' } } } },
        '/b': { get: { operationId: 'dup', responses: { '200': { description: 'ok' } } } },
      },
    }
    expect(await has(dup, 'operation-operationId-unique')).toBe(true)
    // An x- extension object carrying an operationId-like key must not be treated
    // as an operation (it would otherwise create a phantom duplicate).
    const ext = {
      ...base3(),
      paths: {
        '/a': {
          get: { operationId: 'real', responses: { '200': { description: 'ok' } } },
          'x-thing': { operationId: 'real' },
        },
      },
    }
    expect(await has(ext, 'operation-operationId-unique')).toBe(false)
  })

  // oasPathParam -----------------------------------------------------------
  it('oasPathParam flags an undeclared template parameter', async () => {
    const doc = { ...base3(), paths: { '/a/{id}': { get: { responses: { '200': { description: 'ok' } } } } } }
    expect(await has(doc, 'path-params')).toBe(true)
  })

  it('oasPathParam accepts a declared, required path parameter', async () => {
    const doc = {
      ...base3(),
      paths: {
        '/a/{id}': {
          get: {
            parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
            responses: { '200': { description: 'ok' } },
          },
        },
      },
    }
    expect(await has(doc, 'path-params')).toBe(false)
  })

  it('oasPathParam flags a path parameter missing required:true (Spectral check c)', async () => {
    const doc = {
      ...base3(),
      paths: {
        '/a/{id}': {
          get: {
            parameters: [{ name: 'id', in: 'path', schema: { type: 'string' } }],
            responses: { '200': { description: 'ok' } },
          },
        },
      },
    }
    expect(await has(doc, 'path-params')).toBe(true)
  })

  it('oasPathParam flags an in:path definition not used in the template (check b)', async () => {
    const doc = {
      ...base3(),
      paths: {
        '/a': {
          get: {
            parameters: [{ name: 'ghost', in: 'path', required: true, schema: { type: 'string' } }],
            responses: { '200': { description: 'ok' } },
          },
        },
      },
    }
    expect(await has(doc, 'path-params')).toBe(true)
  })

  it('oasPathParam flags a duplicated definition of the same path parameter (check e)', async () => {
    const doc = {
      ...base3(),
      paths: {
        '/a/{id}': {
          get: {
            parameters: [
              { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
              { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
            ],
            responses: { '200': { description: 'ok' } },
          },
        },
      },
    }
    expect(await has(doc, 'path-params')).toBe(true)
  })

  it('oasPathParam flags a repeated template in the path key (check d)', async () => {
    const doc = {
      ...base3(),
      paths: {
        '/a/{id}/{id}': {
          get: {
            parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
            responses: { '200': { description: 'ok' } },
          },
        },
      },
    }
    expect(await has(doc, 'path-params')).toBe(true)
  })

  it('oasPathParam does not false-positive across operations (per-operation evaluation)', async () => {
    // Only `get` declares the param; `delete` does not — Spectral flags `delete`
    // for the missing definition. The old union-of-all-operations logic missed it.
    const doc = {
      ...base3(),
      paths: {
        '/a/{id}': {
          get: {
            parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
            responses: { '200': { description: 'ok' } },
          },
          delete: { responses: { '200': { description: 'ok' } } },
        },
      },
    }
    expect(await has(doc, 'path-params')).toBe(true)
  })

  // oasOpParams ------------------------------------------------------------
  it('oasOpParams flags duplicate name+in parameters', async () => {
    const doc = {
      ...base3(),
      paths: {
        '/a': {
          get: {
            parameters: [
              { name: 'q', in: 'query', schema: { type: 'string' } },
              { name: 'q', in: 'query', schema: { type: 'string' } },
            ],
            responses: { '200': { description: 'ok' } },
          },
        },
      },
    }
    expect(await has(doc, 'operation-parameters')).toBe(true)
  })

  it('oasOpParams flags multiple in:body parameters even with different names (OAS2)', async () => {
    const doc = {
      swagger: '2.0',
      info: { title: 'T', version: '1', contact: { name: 'x' }, description: 'd' },
      host: 'api.test',
      schemes: ['https'],
      paths: {
        '/a': {
          get: {
            parameters: [
              { name: 'a', in: 'body', schema: { type: 'object' } },
              { name: 'b', in: 'body', schema: { type: 'object' } },
            ],
            responses: { '200': { description: 'ok' } },
          },
        },
      },
    }
    expect(await has(doc, 'operation-parameters')).toBe(true)
  })

  // oasTagsUnique ----------------------------------------------------------
  it('oasTagsUnique flags duplicate global tag names', async () => {
    const doc = { ...base3(), tags: [{ name: 'dup' }, { name: 'dup' }] }
    expect(await has(doc, 'openapi-tags-uniqueness')).toBe(true)
    const ok = { ...base3(), tags: [{ name: 'a' }, { name: 'b' }] }
    expect(await has(ok, 'openapi-tags-uniqueness')).toBe(false)
  })

  // oasOpSecurityDefined ---------------------------------------------------
  it('oasOpSecurityDefined flags an operation security scheme that is not defined', async () => {
    const doc = {
      ...base3(),
      paths: { '/a': { get: { security: [{ missing: [] }], responses: { '200': { description: 'ok' } } } } },
    }
    expect(await has(doc, 'oas3-operation-security-defined')).toBe(true)
    const ok = {
      ...base3(),
      components: { securitySchemes: { key: { type: 'apiKey', name: 'k', in: 'header' } } },
      paths: { '/a': { get: { security: [{ key: [] }], responses: { '200': { description: 'ok' } } } } },
    }
    expect(await has(ok, 'oas3-operation-security-defined')).toBe(false)
  })

  // oasOpFormDataConsumeCheck ---------------------------------------------
  it('oasOpFormDataConsumeCheck flags a formData op without a form consume type', async () => {
    const doc = {
      swagger: '2.0',
      info: { title: 'T', version: '1', contact: { name: 'x' }, description: 'd' },
      host: 'api.test',
      schemes: ['https'],
      paths: {
        '/a': {
          post: {
            consumes: ['application/json'],
            parameters: [{ name: 'f', in: 'formData', type: 'string' }],
            responses: { '200': { description: 'ok' } },
          },
        },
      },
    }
    expect(await has(doc, 'oas2-operation-formData-consume-check')).toBe(true)
  })

  // oasDiscriminator -------------------------------------------------------
  it('oasDiscriminator flags a discriminator that is not a required property', async () => {
    const doc = {
      swagger: '2.0',
      info: { title: 'T', version: '1', contact: { name: 'x' }, description: 'd' },
      host: 'api.test',
      schemes: ['https'],
      paths: {},
      definitions: { Pet: { type: 'object', discriminator: 'petType', properties: { petType: { type: 'string' } } } },
    }
    expect(await has(doc, 'oas2-discriminator')).toBe(true)
    const ok = {
      swagger: '2.0',
      info: { title: 'T', version: '1', contact: { name: 'x' }, description: 'd' },
      host: 'api.test',
      schemes: ['https'],
      paths: {},
      definitions: {
        Pet: {
          type: 'object',
          discriminator: 'petType',
          required: ['petType'],
          properties: { petType: { type: 'string' } },
        },
      },
    }
    expect(await has(ok, 'oas2-discriminator')).toBe(false)
  })

  // oasServerVariables -----------------------------------------------------
  it('oasServerVariables flags undefined, unused, missing-default, bad-default, and empty-enum variables', async () => {
    const undefinedVar = { ...base3(), servers: [{ url: 'https://{region}.api.test' }] }
    expect(await has(undefinedVar, 'oas3-server-variables')).toBe(true)

    const unusedVar = {
      ...base3(),
      servers: [{ url: 'https://api.test', variables: { region: { default: 'us' } } }],
    }
    expect(await has(unusedVar, 'oas3-server-variables')).toBe(true)

    const missingDefault = {
      ...base3(),
      servers: [{ url: 'https://{region}.api.test', variables: { region: { enum: ['us'] } } }],
    }
    expect(await has(missingDefault, 'oas3-server-variables')).toBe(true)

    const badDefault = {
      ...base3(),
      servers: [{ url: 'https://{region}.api.test', variables: { region: { default: 'eu', enum: ['us'] } } }],
    }
    expect(await has(badDefault, 'oas3-server-variables')).toBe(true)

    const emptyEnum = {
      ...base3(),
      servers: [{ url: 'https://{region}.api.test', variables: { region: { default: 'us', enum: [] } } }],
    }
    expect(await has(emptyEnum, 'oas3-server-variables')).toBe(true)

    const ok = {
      ...base3(),
      servers: [{ url: 'https://{region}.api.test', variables: { region: { default: 'us', enum: ['us', 'eu'] } } }],
    }
    expect(await has(ok, 'oas3-server-variables')).toBe(false)
  })

  // oasSchemaExample -------------------------------------------------------
  it('oasSchemaExample flags an example that violates its schema, and passes a valid one', async () => {
    const bad = {
      ...base3(),
      components: { schemas: { A: { type: 'string', example: 123 } } },
    }
    expect(await has(bad, 'oas3-valid-schema-example')).toBe(true)
    const ok = {
      ...base3(),
      components: { schemas: { A: { type: 'string', example: 'hi' } } },
    }
    expect(await has(ok, 'oas3-valid-schema-example')).toBe(false)
  })

  it('oasSchemaExample also validates default (M2)', async () => {
    const bad = { ...base3(), components: { schemas: { A: { type: 'integer', default: 'nope' } } } }
    expect(await has(bad, 'oas3-valid-schema-example')).toBe(true)
  })

  it('oasSchemaExample asserts string formats (M3)', async () => {
    const bad = {
      ...base3(),
      components: { schemas: { A: { type: 'string', format: 'email', example: 'not-email' } } },
    }
    expect(await has(bad, 'oas3-valid-schema-example')).toBe(true)
  })

  it('oasSchemaExample does not treat a property named "example" as a schema example', async () => {
    // The property is literally named `example`; matching a `properties` map as a
    // schema would wrongly validate it. There is no schema violation here.
    const doc = {
      ...base3(),
      components: { schemas: { A: { type: 'object', properties: { example: { type: 'string' } } } } },
    }
    expect(await has(doc, 'oas3-valid-schema-example')).toBe(false)
  })

  // oasMediaExample --------------------------------------------------------
  it('oasMediaExample flags an invalid OAS3 media example', async () => {
    const bad = {
      ...base3(),
      paths: {
        '/a': {
          get: {
            responses: {
              '200': { description: 'ok', content: { 'application/json': { schema: { type: 'string' }, example: 5 } } },
            },
          },
        },
      },
    }
    expect(await has(bad, 'oas3-valid-media-example')).toBe(true)
  })

  it('oasMediaExample validates OAS2 mime-map response examples (H2)', async () => {
    // In OAS2 the response `examples` is a mime-type → value map; the 3.x logic
    // validated nothing here, so this is the regression H2 fixes.
    const bad = {
      swagger: '2.0',
      info: { title: 'T', version: '1', contact: { name: 'x' }, description: 'd' },
      host: 'api.test',
      schemes: ['https'],
      paths: {
        '/a': {
          get: {
            responses: {
              '200': { description: 'ok', schema: { type: 'string' }, examples: { 'application/json': 42 } },
            },
          },
        },
      },
    }
    expect(await has(bad, 'oas2-valid-media-example')).toBe(true)
    const ok = {
      swagger: '2.0',
      info: { title: 'T', version: '1', contact: { name: 'x' }, description: 'd' },
      host: 'api.test',
      schemes: ['https'],
      paths: {
        '/a': {
          get: {
            responses: {
              '200': { description: 'ok', schema: { type: 'string' }, examples: { 'application/json': 'hi' } },
            },
          },
        },
      },
    }
    expect(await has(ok, 'oas2-valid-media-example')).toBe(false)
  })

  // oasUnusedComponent -----------------------------------------------------
  it('oasUnusedComponent flags an unreferenced component and passes a referenced one', async () => {
    const unused = { ...base3(), components: { schemas: { Ghost: { type: 'string' } } } }
    expect(await has(unused, 'oas3-unused-component')).toBe(true)
    const used = {
      ...base3(),
      paths: {
        '/a': {
          get: {
            responses: {
              '200': {
                description: 'ok',
                content: { 'application/json': { schema: { $ref: '#/components/schemas/Used' } } },
              },
            },
          },
        },
      },
      components: { schemas: { Used: { type: 'string' } } },
    }
    expect(await has(used, 'oas3-unused-component')).toBe(false)
  })

  it('oasUnusedComponent treats an interior $ref as using the component (M10 prefix match)', async () => {
    const doc = {
      ...base3(),
      paths: {
        '/a': {
          get: {
            responses: {
              '200': {
                description: 'ok',
                content: { 'application/json': { schema: { $ref: '#/components/schemas/Pet/properties/id' } } },
              },
            },
          },
        },
      },
      components: { schemas: { Pet: { type: 'object', properties: { id: { type: 'string' } } } } },
    }
    expect(await has(doc, 'oas3-unused-component')).toBe(false)
  })

  it('oasUnusedComponent covers the 3.1 pathItems group (M10)', async () => {
    const doc = {
      openapi: '3.1.0',
      info: { title: 'T', version: '1.0.0', contact: { name: 'x' }, description: 'd' },
      servers: [{ url: 'https://api.example.test' }],
      paths: {},
      components: { pathItems: { Ghost: { get: { responses: { '200': { description: 'ok' } } } } } },
    }
    expect(await has(doc, 'oas3-unused-component')).toBe(true)
  })

  // oasMutuallyExclusive ---------------------------------------------------
  it('oasMutuallyExclusive flags a license with both identifier and url (3.1)', async () => {
    const doc = {
      openapi: '3.1.0',
      info: {
        title: 'T',
        version: '1.0.0',
        contact: { name: 'x' },
        description: 'd',
        license: { name: 'MIT', identifier: 'MIT', url: 'https://x.test' },
      },
      servers: [{ url: 'https://api.example.test' }],
      paths: {},
    }
    expect(await has(doc, 'oas3_1-license-identifier')).toBe(true)
  })

  // oasSchema --------------------------------------------------------------
  it('oasSchema flags a structurally invalid document', async () => {
    // `openapi` must be a string; a number fails the structural meta-schema.
    const doc = { openapi: 3, info: { title: 'T', version: '1.0.0' }, paths: {} }
    // Detected as oas3 by the version prefix check only when a string; a numeric
    // version is not a recognized format, so instead use a clearly-broken 3.0 doc.
    const broken = { openapi: '3.0.0', info: { title: 'T' }, paths: {} }
    expect(await has(broken, 'oas3-schema')).toBe(true)
    void doc
  })

  // oasAdditionalOperations ------------------------------------------------
  it('oasAdditionalOperations flags a standard method inside additionalOperations (3.2)', async () => {
    const doc = {
      openapi: '3.2.0',
      info: { title: 'T', version: '1.0.0', contact: { name: 'x' }, description: 'd' },
      servers: [{ url: 'https://api.example.test' }],
      paths: { '/a': { additionalOperations: { POST: { responses: { '200': { description: 'ok' } } } } } },
    }
    expect(await has(doc, 'oas3_2-additional-operations-standard-method')).toBe(true)
  })

  // oasServerNameUnique ----------------------------------------------------
  it('oasServerNameUnique flags duplicate server names (3.2)', async () => {
    const doc = {
      openapi: '3.2.0',
      info: { title: 'T', version: '1.0.0', contact: { name: 'x' }, description: 'd' },
      servers: [
        { url: 'https://a.test', name: 'main' },
        { url: 'https://b.test', name: 'main' },
      ],
      paths: {},
    }
    expect(await has(doc, 'oas3_2-server-name-unique')).toBe(true)
  })

  // oasTagParentDefined ----------------------------------------------------
  it('oasTagParentDefined flags an undefined parent and a parent cycle (3.2)', async () => {
    const undefinedParent = {
      openapi: '3.2.0',
      info: { title: 'T', version: '1.0.0', contact: { name: 'x' }, description: 'd' },
      servers: [{ url: 'https://api.example.test' }],
      paths: {},
      tags: [{ name: 'child', parent: 'ghost' }],
    }
    expect(await has(undefinedParent, 'oas3_2-tag-parent-defined')).toBe(true)

    const cycle = {
      openapi: '3.2.0',
      info: { title: 'T', version: '1.0.0', contact: { name: 'x' }, description: 'd' },
      servers: [{ url: 'https://api.example.test' }],
      paths: {},
      tags: [
        { name: 'a', parent: 'b' },
        { name: 'b', parent: 'a' },
      ],
    }
    expect(await has(cycle, 'oas3_2-tag-parent-defined')).toBe(true)

    const ok = {
      openapi: '3.2.0',
      info: { title: 'T', version: '1.0.0', contact: { name: 'x' }, description: 'd' },
      servers: [{ url: 'https://api.example.test' }],
      paths: {},
      tags: [{ name: 'parent' }, { name: 'child', parent: 'parent' }],
    }
    expect(await has(ok, 'oas3_2-tag-parent-defined')).toBe(false)
  })

  // oasSchemaExampleDeprecated ---------------------------------------------
  it('oasSchemaExampleDeprecated flags a schema singular example in 3.1', async () => {
    const doc = {
      openapi: '3.1.0',
      info: { title: 'T', version: '1.0.0', contact: { name: 'x' }, description: 'd' },
      servers: [{ url: 'https://api.example.test' }],
      paths: {},
      components: { schemas: { A: { type: 'string', example: 'hi' } } },
    }
    expect(await has(doc, 'oas3_1-schema-example-deprecated')).toBe(true)
  })

  // oasTagKind -------------------------------------------------------------
  it('oasTagKind flags an unregistered tag kind and passes a registered one (3.2)', async () => {
    const bad = {
      openapi: '3.2.0',
      info: { title: 'T', version: '1.0.0', contact: { name: 'x' }, description: 'd' },
      servers: [{ url: 'https://api.example.test' }],
      paths: {},
      tags: [{ name: 'a', kind: 'made-up' }],
    }
    expect(await has(bad, 'oas3_2-tag-kind')).toBe(true)
    const ok = {
      openapi: '3.2.0',
      info: { title: 'T', version: '1.0.0', contact: { name: 'x' }, description: 'd' },
      servers: [{ url: 'https://api.example.test' }],
      paths: {},
      tags: [{ name: 'a', kind: 'nav' }],
    }
    expect(await has(ok, 'oas3_2-tag-kind')).toBe(false)
  })

  // oasExampleValue --------------------------------------------------------
  it('oasExampleValue flags dataValue combined with value (3.2)', async () => {
    const doc = {
      openapi: '3.2.0',
      info: { title: 'T', version: '1.0.0', contact: { name: 'x' }, description: 'd' },
      servers: [{ url: 'https://api.example.test' }],
      paths: {},
      components: { examples: { E: { dataValue: 1, value: 1 } } },
    }
    expect(await has(doc, 'oas3_2-example-value')).toBe(true)
  })

  // oasExampleExternalValue (M7) -------------------------------------------
  it('oasExampleExternalValue flags both/neither value|externalValue', async () => {
    const both = {
      ...base3(),
      components: { examples: { E: { value: 1, externalValue: 'https://x.test' } } },
    }
    expect(await has(both, 'oas3-examples-value-or-externalValue')).toBe(true)
    const neither = { ...base3(), components: { examples: { E: { summary: 's' } } } }
    expect(await has(neither, 'oas3-examples-value-or-externalValue')).toBe(true)
    const one = { ...base3(), components: { examples: { E: { value: 1 } } } }
    expect(await has(one, 'oas3-examples-value-or-externalValue')).toBe(false)
  })

  it('oasExampleExternalValue accepts a 3.2 dataValue-only example (M7)', async () => {
    const doc = {
      openapi: '3.2.0',
      info: { title: 'T', version: '1.0.0', contact: { name: 'x' }, description: 'd' },
      servers: [{ url: 'https://api.example.test' }],
      paths: {},
      components: { examples: { E: { dataValue: 1 } } },
    }
    expect(await has(doc, 'oas3-examples-value-or-externalValue')).toBe(false)
  })

  // oasNoNullable (L4) -----------------------------------------------------
  it('oasNoNullable flags nullable:true and nullable:false but not a property named nullable', async () => {
    const nullableTrue = {
      openapi: '3.1.0',
      info: { title: 'T', version: '1.0.0', contact: { name: 'x' }, description: 'd' },
      servers: [{ url: 'https://api.example.test' }],
      paths: {},
      components: { schemas: { A: { type: 'string', nullable: true } } },
    }
    expect(await has(nullableTrue, 'oas3_1-no-nullable')).toBe(true)

    // `nullable: false` must fire too so the migration fixer can remove it.
    const nullableFalse = {
      openapi: '3.1.0',
      info: { title: 'T', version: '1.0.0', contact: { name: 'x' }, description: 'd' },
      servers: [{ url: 'https://api.example.test' }],
      paths: {},
      components: { schemas: { A: { type: 'string', nullable: false } } },
    }
    expect(await has(nullableFalse, 'oas3_1-no-nullable')).toBe(true)

    // A property literally named `nullable` is not the keyword and must not fire.
    const propertyNamed = {
      openapi: '3.1.0',
      info: { title: 'T', version: '1.0.0', contact: { name: 'x' }, description: 'd' },
      servers: [{ url: 'https://api.example.test' }],
      paths: {},
      components: { schemas: { A: { type: 'object', properties: { nullable: { type: 'boolean' } } } } },
    }
    expect(await has(propertyNamed, 'oas3_1-no-nullable')).toBe(false)
  })
})
