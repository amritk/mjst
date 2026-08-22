import { describe, expect, it } from 'vitest'

import { lint } from '../../core'
import { asyncapi, createAsyncApiRuleset } from './index'

// Rule-wiring coverage: the `given`/`field`/`formats` plumbing in `asyncapi.ts`,
// as opposed to the function bodies covered by `functions/aas-functions.test.ts`.
const allRules = createAsyncApiRuleset({ extends: [[asyncapi, 'all']] })
// Default preset: `extends: [asyncapi]`, so only `recommended` rules run.
const recommendedOnly = createAsyncApiRuleset()

const codesWith = async (
  ruleset: ReturnType<typeof createAsyncApiRuleset>,
  doc: unknown,
): Promise<Set<string | number>> =>
  new Set((await lint(JSON.stringify(doc), { ruleset })).map((finding) => finding.code))

const has = async (doc: unknown, code: string): Promise<boolean> => (await codesWith(allRules, doc)).has(code)

/**
 * Walks into a document to a nested object, so a test can break one field of an
 * otherwise-valid document without restating the whole thing.
 */
const at = (document: unknown, ...keys: string[]): Record<string, unknown> => {
  let node = document as Record<string, unknown>
  for (const key of keys) node = node[key] as Record<string, unknown>
  return node
}

/** A 2.6 document that every recommended rule is happy with. */
const base2 = (): Record<string, unknown> => ({
  asyncapi: '2.6.0',
  info: {
    title: 'T',
    version: '1.0.0',
    description: 'd',
    contact: { name: 'n', url: 'https://example.test', email: 'a@example.test' },
    license: { name: 'MIT', url: 'https://example.test/mit' },
  },
  servers: { prod: { url: 'wss://api.test', protocol: 'wss' } },
  tags: [{ name: 'a', description: 'd' }],
  channels: {
    'user/signedup': {
      subscribe: {
        operationId: 'onUserSignedUp',
        description: 'd',
        message: { messageId: 'userSignedUp', payload: { type: 'object' } },
      },
    },
  },
})

/** A 3.0 document that every recommended rule is happy with. */
const base3 = (): Record<string, unknown> => ({
  asyncapi: '3.0.0',
  info: {
    title: 'T',
    version: '1.0.0',
    description: 'd',
    contact: { name: 'n', url: 'https://example.test', email: 'a@example.test' },
    license: { name: 'MIT', url: 'https://example.test/mit' },
    tags: [{ name: 'a', description: 'd' }],
  },
  servers: { prod: { host: 'api.test', protocol: 'wss' } },
  channels: { user: { address: 'user/signedup', messages: { userSignedUp: { payload: { type: 'object' } } } } },
  operations: { onUserSignedUp: { action: 'receive', description: 'd', channel: { $ref: '#/channels/user' } } },
})

describe('asyncapi ruleset', () => {
  it('is clean on a well-formed 2.6 document, with every rule enabled', async () => {
    // Everything but the informational note that 2.6 is not the latest version.
    expect([...(await codesWith(allRules, base2()))]).toEqual(['asyncapi-latest-version'])
  })

  it('is clean on a well-formed 3.0 document, with every rule enabled', async () => {
    expect([...(await codesWith(allRules, base3()))]).toEqual([])
  })

  it('runs no rule at all on a document that is neither 2.x nor 3.x', async () => {
    const doc = { asyncapi: '1.2.0', channels: {} }
    expect([...(await codesWith(allRules, doc))]).toEqual([])
  })

  // Format gating -----------------------------------------------------------
  it('applies the 2.x operation rules only to 2.x documents', async () => {
    const missingOperationId = base2()
    delete at(missingOperationId, 'channels', 'user/signedup', 'subscribe')['operationId']
    expect(await has(missingOperationId, 'asyncapi-operation-operationId')).toBe(true)

    // 3.0 has no `operationId`, so the 2.x rule must not reach it.
    const three = base3()
    expect(await has(three, 'asyncapi-operation-operationId')).toBe(false)
  })

  it('applies the 3.x tag rules to info.tags and the 2.x ones to the root', async () => {
    const three = base3()
    delete (three['info'] as Record<string, unknown>)['tags']
    expect(await has(three, 'asyncapi-3-tags')).toBe(true)
    expect(await has(three, 'asyncapi-tags')).toBe(false)

    const two = base2()
    delete two['tags']
    expect(await has(two, 'asyncapi-tags')).toBe(true)
    expect(await has(two, 'asyncapi-3-tags')).toBe(false)
  })

  // Channel addressing ------------------------------------------------------
  it('flags an empty parameter, a query/fragment, and a trailing slash in a 2.x channel key', async () => {
    const doc = base2()
    doc['channels'] = { 'user/{}/signed?up/': { subscribe: { operationId: 'x', description: 'd', message: {} } } }
    const codes = await codesWith(allRules, doc)
    expect(codes.has('asyncapi-channel-no-empty-parameter')).toBe(true)
    expect(codes.has('asyncapi-channel-no-query-nor-fragment')).toBe(true)
    expect(codes.has('asyncapi-channel-no-trailing-slash')).toBe(true)
  })

  it('flags the same three problems in a 3.x channel address', async () => {
    const doc = base3()
    doc['channels'] = { user: { address: 'user/{}/signed?up/', messages: {} } }
    const codes = await codesWith(allRules, doc)
    expect(codes.has('asyncapi-3-channel-no-empty-parameter')).toBe(true)
    expect(codes.has('asyncapi-3-channel-no-query-nor-fragment')).toBe(true)
    expect(codes.has('asyncapi-3-channel-no-trailing-slash')).toBe(true)
  })

  it('flags a 3.x channel server that is not a #/servers reference', async () => {
    const doc = base3()
    at(doc, 'channels', 'user')['servers'] = [{ $ref: '#/components/servers/prod' }]
    expect(await has(doc, 'asyncapi-3-channel-servers')).toBe(true)
  })

  // Servers -----------------------------------------------------------------
  it('flags an empty variable, a trailing slash, and example.com in a 2.x server url', async () => {
    const doc = base2()
    doc['servers'] = { prod: { url: 'wss://example.com/{}/', protocol: 'wss' } }
    const codes = await codesWith(allRules, doc)
    expect(codes.has('asyncapi-server-no-empty-variable')).toBe(true)
    expect(codes.has('asyncapi-server-no-trailing-slash')).toBe(true)
    expect(codes.has('asyncapi-server-not-example-com')).toBe(true)
  })

  it('flags an empty variable in a 3.x server host or pathname', async () => {
    const doc = base3()
    doc['servers'] = { prod: { host: 'api.test/{}', pathname: '/{}', protocol: 'wss' } }
    expect(await has(doc, 'asyncapi-3-server-no-empty-variable')).toBe(true)
  })

  it('flags a missing servers object', async () => {
    const doc = base2()
    delete doc['servers']
    expect(await has(doc, 'asyncapi-servers')).toBe(true)
  })

  // Headers, payloads, schemaFormat -----------------------------------------
  it('flags a non-object headers schema on both majors', async () => {
    const two = base2()
    at(two, 'channels', 'user/signedup', 'subscribe', 'message')['headers'] = { type: 'string' }
    expect(await has(two, 'asyncapi-headers-schema-type-object')).toBe(true)

    const three = base3()
    at(three, 'channels', 'user', 'messages', 'userSignedUp')['headers'] = { type: 'string' }
    expect(await has(three, 'asyncapi-3-headers-schema-type-object')).toBe(true)
  })

  it('flags a payload that is not a valid AsyncAPI Schema object', async () => {
    const doc = base2()
    at(doc, 'channels', 'user/signedup', 'subscribe', 'message')['payload'] = { type: 'nope' }
    expect(await has(doc, 'asyncapi-payload')).toBe(true)
  })

  it('reports a non-default schemaFormat instead of validating the payload', async () => {
    const doc = base2()
    const message = at(doc, 'channels', 'user/signedup', 'subscribe', 'message')
    message['schemaFormat'] = 'application/vnd.apache.avro;version=1.9.0'
    message['payload'] = { type: 'nope' }
    const codes = await codesWith(allRules, doc)
    expect(codes.has('asyncapi-payload-unsupported-schemaFormat')).toBe(true)
    // The payload is Avro, not an AsyncAPI Schema object, so it is not judged as one.
    expect(codes.has('asyncapi-payload')).toBe(false)
  })

  it('flags a payload default and examples that do not match the payload schema', async () => {
    const doc = base2()
    const message = at(doc, 'channels', 'user/signedup', 'subscribe', 'message')
    message['payload'] = { type: 'string', default: 12, examples: [34] }
    const codes = await codesWith(allRules, doc)
    expect(codes.has('asyncapi-payload-default')).toBe(true)
    expect(codes.has('asyncapi-payload-examples')).toBe(true)
  })

  it('flags a component schema default and examples that do not match their schema', async () => {
    const doc = base2()
    doc['components'] = { schemas: { S: { type: 'string', default: 1, examples: [2] } } }
    const codes = await codesWith(allRules, doc)
    expect(codes.has('asyncapi-schema-default')).toBe(true)
    expect(codes.has('asyncapi-schema-examples')).toBe(true)
  })

  // Structural validation ---------------------------------------------------
  it('validates a 2.x document against its own meta-schema', async () => {
    const doc = base2()
    doc['channels'] = { 'user/signedup': 'not-an-object' }
    expect(await has(doc, 'asyncapi-schema')).toBe(true)
  })

  it('validates a 3.x document against its own meta-schema', async () => {
    const doc = base3()
    doc['operations'] = { onUserSignedUp: { action: 'shout', channel: { $ref: '#/channels/user' } } }
    expect(await has(doc, 'asyncapi-3-document-unresolved')).toBe(true)
  })

  it('does not report the 3.x structure twice when no resolver is injected', async () => {
    const doc = base3()
    doc['operations'] = { onUserSignedUp: { action: 'shout', channel: { $ref: '#/channels/user' } } }
    const codes = await codesWith(allRules, doc)
    expect(codes.has('asyncapi-3-document-resolved')).toBe(false)
  })

  // Descriptions and tags ---------------------------------------------------
  it('flags a missing operation description on both majors', async () => {
    const two = base2()
    delete at(two, 'channels', 'user/signedup', 'subscribe')['description']
    expect(await has(two, 'asyncapi-operation-description')).toBe(true)

    const three = base3()
    delete at(three, 'operations', 'onUserSignedUp')['description']
    expect(await has(three, 'asyncapi-3-operation-description')).toBe(true)
  })

  it('flags missing info fields', async () => {
    const doc = base2()
    doc['info'] = { title: 'T', version: '1.0.0' }
    const codes = await codesWith(allRules, doc)
    expect(codes.has('asyncapi-info-description')).toBe(true)
    expect(codes.has('asyncapi-info-contact')).toBe(true)
    expect(codes.has('asyncapi-info-license')).toBe(true)
  })

  it('flags an incomplete contact object and a license with no url', async () => {
    const doc = base2()
    doc['info'] = { title: 'T', version: '1.0.0', description: 'd', contact: { name: 'n' }, license: { name: 'MIT' } }
    const codes = await codesWith(allRules, doc)
    expect(codes.has('asyncapi-info-contact-properties')).toBe(true)
    expect(codes.has('asyncapi-info-license-url')).toBe(true)
  })

  it('flags unsorted and duplicated tags', async () => {
    const doc = base2()
    doc['tags'] = [
      { name: 'b', description: 'd' },
      { name: 'a', description: 'd' },
      { name: 'a', description: 'd' },
    ]
    const codes = await codesWith(allRules, doc)
    expect(codes.has('asyncapi-tags-alphabetical')).toBe(true)
    expect(codes.has('asyncapi-tags-uniqueness')).toBe(true)
  })

  it('flags duplicated tags under info on 3.x', async () => {
    const doc = base3()
    ;(doc['info'] as Record<string, unknown>)['tags'] = [
      { name: 'a', description: 'd' },
      { name: 'a', description: 'd' },
    ]
    expect(await has(doc, 'asyncapi-3-tags-uniqueness')).toBe(true)
  })

  it('flags a tag and a parameter with no description', async () => {
    const doc = base2()
    doc['tags'] = [{ name: 'a' }]
    doc['channels'] = {
      'user/{id}': {
        parameters: { id: { schema: { type: 'string' } } },
        subscribe: { operationId: 'x', description: 'd', message: { messageId: 'm' } },
      },
    }
    const codes = await codesWith(allRules, doc)
    expect(codes.has('asyncapi-tag-description')).toBe(true)
    expect(codes.has('asyncapi-parameter-description')).toBe(true)
  })

  // Version currency --------------------------------------------------------
  it('reports an older version as informational only', async () => {
    const doc = base2()
    const findings = await lint(JSON.stringify(doc), { ruleset: allRules })
    const latest = findings.filter((finding) => finding.code === 'asyncapi-latest-version')
    expect(latest).toHaveLength(1)
    // DiagnosticSeverity.Information
    expect(latest[0]?.severity).toBe(2)
  })

  it('says nothing about the version on a 3.0 document', async () => {
    expect(await has(base3(), 'asyncapi-latest-version')).toBe(false)
  })

  // Unused components -------------------------------------------------------
  it('flags an unused component schema and server', async () => {
    const doc = base2()
    doc['components'] = { schemas: { Unused: { type: 'object' } }, servers: { unused: { url: 'x', protocol: 'y' } } }
    const codes = await codesWith(allRules, doc)
    expect(codes.has('asyncapi-unused-components-schema')).toBe(true)
    expect(codes.has('asyncapi-unused-components-server')).toBe(true)
  })

  // The recommended preset ---------------------------------------------------
  it('leaves the opt-in rules off in the default preset', async () => {
    const doc = base2()
    doc['tags'] = [{ name: 'b' }, { name: 'a' }]
    doc['servers'] = { prod: { url: 'wss://example.com', protocol: 'wss' } }
    doc['info'] = {
      title: 'T',
      version: '1.0.0',
      description: 'd',
      contact: { name: 'n', url: 'u', email: 'e' },
      license: { name: 'MIT' },
    }
    const codes = await codesWith(recommendedOnly, doc)
    expect(codes.has('asyncapi-tags-alphabetical')).toBe(false)
    expect(codes.has('asyncapi-tag-description')).toBe(false)
    expect(codes.has('asyncapi-server-not-example-com')).toBe(false)
    expect(codes.has('asyncapi-info-license-url')).toBe(false)
  })
})
