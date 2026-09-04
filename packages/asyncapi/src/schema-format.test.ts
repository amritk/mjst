import { describe, expect, it } from 'vitest'

import { classifySchemaFormat } from './schema-format'

describe('schema-format', () => {
  it('treats an absent format as the AsyncAPI default dialect', () => {
    expect(classifySchemaFormat(undefined)).toBe('asyncapi')
  })

  it('recognizes the AsyncAPI dialect media type across spellings', () => {
    expect(classifySchemaFormat('application/vnd.aai.asyncapi;version=2.6.0')).toBe('asyncapi')
    expect(classifySchemaFormat('application/vnd.aai.asyncapi+json;version=3.0.0')).toBe('asyncapi')
    expect(classifySchemaFormat('application/vnd.aai.asyncapi+yaml;version=2.0.0')).toBe('asyncapi')
  })

  it('recognizes declared JSON Schema drafts', () => {
    expect(classifySchemaFormat('application/schema+json;version=draft-07')).toBe('draft-07')
    expect(classifySchemaFormat('application/schema+yaml;version=draft-07')).toBe('draft-07')
    expect(classifySchemaFormat('application/schema+json;version=draft-2020-12')).toBe('2020-12')
  })

  it('recognizes OpenAPI schema objects', () => {
    expect(classifySchemaFormat('application/vnd.oai.openapi;version=3.0.0')).toBe('openapi')
    expect(classifySchemaFormat('application/vnd.oai.openapi+json;version=3.0.0')).toBe('openapi')
  })

  it('rejects everything else', () => {
    expect(classifySchemaFormat('application/vnd.apache.avro;version=1.9.0')).toBe('unsupported')
    expect(classifySchemaFormat('application/vnd.google.protobuf;version=2')).toBe('unsupported')
    expect(classifySchemaFormat('application/raml+yaml;version=1.0')).toBe('unsupported')
    expect(classifySchemaFormat('application/schema+json;version=draft-04')).toBe('unsupported')
    // A lookalike prefix must not be claimed by the boundary-anchored match.
    expect(classifySchemaFormat('application/vnd.aai.asyncapi-like;version=1')).toBe('unsupported')
    expect(classifySchemaFormat(42)).toBe('unsupported')
    expect(classifySchemaFormat(null)).toBe('unsupported')
  })
})
