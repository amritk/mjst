import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resolveRefs } from '@amritk/resolve-refs'
import { describe, expect, it } from 'vitest'

import { type LintResolver, lint } from '../../core'
import { asyncapi, createAsyncApiRuleset } from './index'

const allRules = createAsyncApiRuleset({ extends: [[asyncapi, 'all']] })
const resolve: LintResolver = (document) => ({ resolved: resolveRefs(document.data).resolved })

const codesFor = async (doc: unknown, options: { resolve?: boolean } = {}): Promise<Set<string>> =>
  new Set(
    (
      await lint(JSON.stringify(doc, null, 2), options.resolve ? { ruleset: allRules, resolve } : { ruleset: allRules })
    ).map((finding) => String(finding.code)),
  )

/**
 * A message that is broken four ways at once, so one document can prove a rule
 * reaches a location rather than needing one document per rule.
 */
const brokenMessage = (): Record<string, unknown> => ({
  headers: { type: 'string' },
  payload: { type: 'not-a-type' },
  tags: [
    { name: 'dup', description: 'one' },
    { name: 'dup', description: 'two' },
  ],
})

// Every 2.x location a message can be written, matching `V2_MESSAGES` /
// `V2_MESSAGE_TRAITS` in `asyncapi.ts`. `plant` builds a 2.6 document carrying a
// broken message at exactly that location.
const V2_LOCATIONS: { name: string; plant: (message: Record<string, unknown>) => Record<string, unknown> }[] = [
  {
    name: 'channels.*.subscribe.message',
    plant: (m) => ({ channels: { c: { subscribe: { operationId: 'o', message: m } } } }),
  },
  {
    name: 'channels.*.publish.message',
    plant: (m) => ({ channels: { c: { publish: { operationId: 'o', message: m } } } }),
  },
  {
    name: 'channels.*.subscribe.message.oneOf[*]',
    plant: (m) => ({ channels: { c: { subscribe: { operationId: 'o', message: { oneOf: [m] } } } } }),
  },
  {
    name: 'channels.*.subscribe.message.traits[*]',
    plant: (m) => ({ channels: { c: { subscribe: { operationId: 'o', message: { traits: [m] } } } } }),
  },
  {
    name: 'channels.*.subscribe.message.oneOf[*].traits[*]',
    plant: (m) => ({ channels: { c: { subscribe: { operationId: 'o', message: { oneOf: [{ traits: [m] }] } } } } }),
  },
  { name: 'components.messages[*]', plant: (m) => ({ components: { messages: { m } } }) },
  { name: 'components.messages[*].traits[*]', plant: (m) => ({ components: { messages: { x: { traits: [m] } } } }) },
  { name: 'components.messageTraits[*]', plant: (m) => ({ components: { messageTraits: { m } } }) },
  {
    name: 'components.channels[*].subscribe.message',
    plant: (m) => ({ components: { channels: { c: { subscribe: { operationId: 'o', message: m } } } } }),
  },
  {
    name: 'components.channels[*].subscribe.message.oneOf[*]',
    plant: (m) => ({ components: { channels: { c: { subscribe: { operationId: 'o', message: { oneOf: [m] } } } } } }),
  },
  {
    name: 'components.channels[*].subscribe.message.traits[*]',
    plant: (m) => ({ components: { channels: { c: { subscribe: { operationId: 'o', message: { traits: [m] } } } } } }),
  },
]

const V3_LOCATIONS: { name: string; plant: (message: Record<string, unknown>) => Record<string, unknown> }[] = [
  { name: 'channels.*.messages[*]', plant: (m) => ({ channels: { c: { address: 'a', messages: { m } } } }) },
  {
    name: 'channels.*.messages[*].traits[*]',
    plant: (m) => ({ channels: { c: { address: 'a', messages: { x: { traits: [m] } } } } }),
  },
  { name: 'components.messages[*]', plant: (m) => ({ components: { messages: { m } } }) },
  { name: 'components.messages[*].traits[*]', plant: (m) => ({ components: { messages: { x: { traits: [m] } } } }) },
  { name: 'components.messageTraits[*]', plant: (m) => ({ components: { messageTraits: { m } } }) },
  {
    name: 'components.channels[*].messages[*]',
    plant: (m) => ({ components: { channels: { c: { address: 'a', messages: { m } } } } }),
  },
  {
    name: 'components.channels[*].messages[*].traits[*]',
    plant: (m) => ({ components: { channels: { c: { address: 'a', messages: { x: { traits: [m] } } } } } }),
  },
]

describe('message-location coverage', () => {
  // The ruleset defines `V2_MESSAGES` / `V3_MESSAGES` precisely so that every
  // rule meaning "every message" reaches the same places. Nothing enforced that:
  // whole given lists could be truncated to a single path with the suite green.
  for (const location of V2_LOCATIONS) {
    it(`checks headers and tags of a 2.x message at ${location.name}`, async () => {
      const doc = { asyncapi: '2.6.0', info: { title: 'T', version: '1.0.0' }, ...location.plant(brokenMessage()) }
      const codes = await codesFor(doc)
      expect(codes.has('asyncapi-headers-schema-type-object'), 'headers').toBe(true)
      expect(codes.has('asyncapi-tags-uniqueness'), 'tags').toBe(true)
      expect(codes.has('asyncapi-payload'), 'payload').toBe(true)
    })
  }

  for (const location of V2_LOCATIONS) {
    it(`reports an unsupported schemaFormat at ${location.name}`, async () => {
      const message = { ...brokenMessage(), schemaFormat: 'application/vnd.apache.avro;version=1.9.0' }
      const doc = { asyncapi: '2.6.0', info: { title: 'T', version: '1.0.0' }, ...location.plant(message) }
      const codes = await codesFor(doc)
      expect(codes.has('asyncapi-payload-unsupported-schemaFormat')).toBe(true)
      // An Avro payload is not an AsyncAPI Schema Object, so it is not judged as one.
      expect(codes.has('asyncapi-payload')).toBe(false)
    })
  }

  for (const location of V3_LOCATIONS) {
    it(`checks headers and tags of a 3.x message at ${location.name}`, async () => {
      const doc = { asyncapi: '3.0.0', info: { title: 'T', version: '1.0.0' }, ...location.plant(brokenMessage()) }
      const codes = await codesFor(doc)
      expect(codes.has('asyncapi-3-headers-schema-type-object'), 'headers').toBe(true)
      expect(codes.has('asyncapi-3-tags-uniqueness'), 'tags').toBe(true)
    })
  }

  it('checks a 3.x channel and operation for duplicate tags', async () => {
    const tags = [
      { name: 'dup', description: 'one' },
      { name: 'dup', description: 'two' },
    ]
    for (const doc of [
      { asyncapi: '3.0.0', info: { title: 'T', version: '1.0.0' }, channels: { c: { address: 'a', tags } } },
      {
        asyncapi: '3.0.0',
        info: { title: 'T', version: '1.0.0' },
        components: { channels: { c: { address: 'a', tags } } },
      },
      { asyncapi: '3.0.0', info: { title: 'T', version: '1.0.0' }, operations: { o: { action: 'send', tags } } },
    ]) {
      expect((await codesFor(doc)).has('asyncapi-3-tags-uniqueness'), JSON.stringify(doc).slice(0, 60)).toBe(true)
    }
  })
})

describe('headers schema shape', () => {
  it('reports headers that declare no type at all, not just a wrong one', async () => {
    // The schema requires `type`, so dropping `required: ['type']` would let a
    // typeless headers object through — both existing tests used `type: string`,
    // which fails either way.
    const doc = {
      asyncapi: '2.6.0',
      info: { title: 'T', version: '1.0.0' },
      channels: { c: { subscribe: { operationId: 'o', message: { headers: { properties: {} } } } } },
    }
    expect((await codesFor(doc)).has('asyncapi-headers-schema-type-object')).toBe(true)
  })
})

describe('both 2.x operations', () => {
  // `V2_OPERATIONS` could be narrowed to `[subscribe]` with the suite green,
  // silently halving what every 2.x operation rule inspects.
  for (const kind of ['publish', 'subscribe'] as const) {
    it(`checks a ${kind} operation`, async () => {
      const doc = {
        asyncapi: '2.6.0',
        info: { title: 'T', version: '1.0.0' },
        channels: { c: { [kind]: { message: { payload: { type: 'object' } } } } },
      }
      const codes = await codesFor(doc)
      expect(codes.has('asyncapi-operation-operationId'), 'operationId').toBe(true)
      expect(codes.has('asyncapi-operation-description'), 'description').toBe(true)
    })
  }

  it('finds a duplicate operationId across publish and subscribe', async () => {
    const doc = {
      asyncapi: '2.6.0',
      info: { title: 'T', version: '1.0.0' },
      channels: {
        a: { subscribe: { operationId: 'dup', message: { payload: { type: 'object' } } } },
        b: { publish: { operationId: 'dup', message: { payload: { type: 'object' } } } },
      },
    }
    expect((await codesFor(doc)).has('asyncapi-operation-operationId-uniqueness')).toBe(true)
  })
})

describe('findings point at the offending node', () => {
  // `range.start.line >= 0` is unfalsifiable — lines are 0-based and never
  // negative — so the previous assertions held even with every range zeroed.
  it('reports each finding on the line the mistake is written on', async () => {
    const source = [
      '{', // 1
      '  "asyncapi": "2.6.0",', // 2
      '  "info": { "title": "T", "version": "1.0.0" },', // 3
      '  "servers": {', // 4
      '    "prod": { "url": "wss://api.test/", "protocol": "wss" }', // 5  trailing slash
      '  },', // 6
      '  "channels": {', // 7
      '    "user/signedup": {', // 8
      '      "subscribe": {', // 9
      '        "operationId": "onSignup",', // 10
      '        "message": { "messageId": "m", "payload": { "type": "object" } }', // 11
      '      }', // 12
      '    }', // 13
      '  }', // 14
      '}', // 15
    ].join('\n')
    const findings = await lint(source, { ruleset: allRules })
    const lineOf = (code: string): number | undefined =>
      findings.find((finding) => finding.code === code)?.range.start.line

    // 0-based, so the JSON line number minus one.
    expect(lineOf('asyncapi-server-no-trailing-slash')).toBe(4)
    expect(lineOf('asyncapi-operation-description')).toBe(8)
    expect(lineOf('asyncapi-info-contact')).toBe(2)
    for (const finding of findings) {
      expect(finding.range.end.character, String(finding.code)).toBeGreaterThan(0)
    }
  })
})

describe('resolution boundaries', () => {
  it('does not call a component unused just because a $ref inlined it', async () => {
    // `asyncapi-unused-components-*` must stay unresolved: once `$ref`s are
    // inlined there is nothing left pointing at `#/components/schemas`.
    const doc = {
      asyncapi: '2.6.0',
      info: { title: 'T', version: '1.0.0' },
      channels: {
        c: { subscribe: { operationId: 'o', message: { payload: { $ref: '#/components/schemas/Used' } } } },
      },
      components: { schemas: { Used: { type: 'object' } } },
    }
    expect((await codesFor(doc, { resolve: true })).has('asyncapi-unused-components-schema')).toBe(false)
  })

  it('reports every structural error in one pass, not just the first', async () => {
    const doc = { asyncapi: '2.6.0', info: { title: 42 }, channels: 'nope' }
    const findings = await lint(JSON.stringify(doc, null, 2), { ruleset: allRules })
    expect(findings.filter((finding) => finding.code === 'asyncapi-schema').length).toBeGreaterThan(1)
  })
})

describe('server variables and security, end to end', () => {
  it('reports an undefined and an unused server variable', async () => {
    const doc = {
      asyncapi: '2.6.0',
      info: { title: 'T', version: '1.0.0' },
      servers: { prod: { url: 'wss://api.test/{env}', protocol: 'wss', variables: { other: { default: 'x' } } } },
      channels: {},
    }
    expect((await codesFor(doc)).has('asyncapi-server-variables')).toBe(true)
  })

  it('accepts a scope declared under any of the four OAuth2 flows', async () => {
    for (const flow of ['implicit', 'password', 'clientCredentials', 'authorizationCode']) {
      const doc = {
        asyncapi: '2.6.0',
        info: { title: 'T', version: '1.0.0' },
        servers: {
          prod: { url: 'wss://api.test', protocol: 'wss', security: [{ oauth: ['granted'] }] },
        },
        channels: {},
        components: {
          securitySchemes: { oauth: { type: 'oauth2', flows: { [flow]: { scopes: { granted: 'ok' } } } } },
        },
      }
      expect((await codesFor(doc)).has('asyncapi-server-security'), flow).toBe(false)
    }
  })

  it('reports a server security requirement naming no declared scheme', async () => {
    const doc = {
      asyncapi: '2.6.0',
      info: { title: 'T', version: '1.0.0' },
      servers: { prod: { url: 'wss://api.test', protocol: 'wss', security: [{ ghost: [] }] } },
      channels: {},
      components: { securitySchemes: { real: { type: 'userPassword' } } },
    }
    expect((await codesFor(doc)).has('asyncapi-server-security')).toBe(true)
  })
})

describe('custom functions in a user ruleset', () => {
  it('loads a function from disk and runs it', async () => {
    // `createAsyncApiRuleset` documents that custom functions are loaded
    // relative to the declaring ruleset; nothing exercised that path.
    const dir = mkdtempSync(join(tmpdir(), 'aas-fn-'))
    writeFileSync(
      join(dir, 'noShouting.mjs'),
      "export default (input) => (typeof input === 'string' && input === input.toUpperCase() ? [{ message: 'no shouting' }] : undefined)\n",
    )
    const ruleset = createAsyncApiRuleset(
      {
        extends: ['asyncapi'],
        functions: ['noShouting'],
        functionsDir: '.',
        rules: {
          'no-shouting': {
            description: 'Titles must not shout.',
            given: '$.info.title',
            severity: 'error',
            then: { function: 'noShouting' },
          },
        },
      },
      dir,
    )
    const doc = JSON.stringify({ asyncapi: '2.6.0', info: { title: 'LOUD', version: '1.0.0' }, channels: {} })
    const codes = (await lint(doc, { ruleset })).map((finding) => finding.code)
    expect(codes).toContain('no-shouting')
  })
})

describe('schema languages other than the AsyncAPI dialect', () => {
  const withPayload = (message: Record<string, unknown>): Record<string, unknown> => ({
    asyncapi: '2.6.0',
    info: { title: 'T', version: '1.0.0' },
    channels: { a: { subscribe: { operationId: 'o', description: 'd', message } } },
  })

  it('validates a payload that names the AsyncAPI dialect explicitly', async () => {
    // Stating the spec's own default used to switch payload checking off, and the
    // "only supported with an unspecified schemaFormat" note was untrue for these.
    for (const schemaFormat of [
      undefined,
      'application/vnd.aai.asyncapi;version=2.6.0',
      'application/vnd.aai.asyncapi+json;version=2.6.0',
      'application/vnd.aai.asyncapi+yaml;version=2.6.0',
    ]) {
      const message: Record<string, unknown> = { messageId: 'm', payload: { type: 'not-a-type' } }
      if (schemaFormat !== undefined) message['schemaFormat'] = schemaFormat
      const codes = await codesFor(withPayload(message))
      expect(codes.has('asyncapi-payload'), String(schemaFormat)).toBe(true)
      expect(codes.has('asyncapi-payload-unsupported-schemaFormat'), String(schemaFormat)).toBe(false)
    }
  })

  it('leaves an Avro payload alone, and says so once', async () => {
    const message = {
      messageId: 'm',
      schemaFormat: 'application/vnd.apache.avro;version=1.9.0',
      payload: { type: 'record', name: 'P', fields: [] },
      examples: [{ payload: { age: 3 } }],
    }
    const codes = await codesFor(withPayload(message))
    expect(codes.has('asyncapi-payload-unsupported-schemaFormat')).toBe(true)
    expect(codes.has('asyncapi-payload')).toBe(false)
    // Judging an Avro schema as JSON Schema surfaced the validator's own
    // complaints ("unknown type \"record\"") as error-level findings.
    expect(codes.has('asyncapi-message-examples')).toBe(false)
  })

  it('still checks an example against headers when the payload is foreign', async () => {
    const message = {
      messageId: 'm',
      schemaFormat: 'application/vnd.apache.avro;version=1.9.0',
      payload: { type: 'record', name: 'P', fields: [] },
      headers: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
      examples: [{ headers: { id: 42 } }],
    }
    expect((await codesFor(withPayload(message))).has('asyncapi-message-examples')).toBe(true)
  })

  it('accepts 3.0 headers written as a Multi Format Schema Object', async () => {
    const headers = (schema: unknown): Record<string, unknown> => ({
      asyncapi: '3.0.0',
      info: { title: 'T', version: '1.0.0' },
      channels: { c: { address: 'a/b', messages: { m: { headers: schema, payload: { type: 'object' } } } } },
    })
    const wrapped = { schemaFormat: 'application/vnd.aai.asyncapi;version=3.0.0', schema: { type: 'object' } }
    // The bundled meta-schema accepts this shape, so the style rule must too.
    expect((await codesFor(headers(wrapped))).has('asyncapi-3-headers-schema-type-object')).toBe(false)
    // ...but the wrapper must not become a way to smuggle a non-object through.
    const wrongInner = { ...wrapped, schema: { type: 'string' } }
    expect((await codesFor(headers(wrongInner))).has('asyncapi-3-headers-schema-type-object')).toBe(true)
    // Headers in another schema language are left alone, like a foreign payload.
    const foreign = { schemaFormat: 'application/vnd.apache.avro;version=1.9.0', schema: { type: 'record' } }
    expect((await codesFor(headers(foreign))).has('asyncapi-3-headers-schema-type-object')).toBe(false)
  })
})

describe('reusable channels and pointer escapes', () => {
  const v3 = (extra: Record<string, unknown>): Record<string, unknown> => ({
    asyncapi: '3.0.0',
    info: { title: 'T', version: '1.0.0' },
    servers: { 'a b': { host: 'x.test', protocol: 'kafka' } },
    ...extra,
  })

  it('lets a reusable 3.0 channel point at a server anywhere', async () => {
    // Channel Object `servers`, AsyncAPI 3.0: a root channel "MUST point to a
    // subset of server definitions located in the root Servers Object, and MUST
    // NOT point to … the Components Object", but a channel in the Components
    // Object "MAY point to a Server Object in any location". Reporting the
    // second was an error-severity finding on a document the spec allows.
    const reusable = v3({
      channels: { c: { address: 'a', servers: [{ $ref: '#/servers/a b' }] } },
      components: {
        servers: { staging: { host: 'staging.test', protocol: 'kafka' } },
        channels: { R: { address: 'b', servers: [{ $ref: '#/components/servers/staging' }] } },
      },
    })
    expect((await codesFor(reusable, { resolve: true })).has('asyncapi-3-channel-servers')).toBe(false)

    // A root channel pointing outside `#/servers` is still an error.
    const root = v3({
      channels: { c: { address: 'a', servers: [{ $ref: '#/components/servers/staging' }] } },
      components: { servers: { staging: { host: 'staging.test', protocol: 'kafka' } } },
    })
    expect((await codesFor(root, { resolve: true })).has('asyncapi-3-channel-servers')).toBe(true)
  })

  it('resolves a percent-encoded server pointer', async () => {
    // RFC 6901 requires percent-encoding in a pointer carried in a URI fragment;
    // comparing the encoded spelling flagged a valid document.
    const doc = v3({ channels: { c: { address: 'a', servers: [{ $ref: '#/servers/a%20b' }] } } })
    expect((await codesFor(doc)).has('asyncapi-3-channel-servers')).toBe(false)
  })

  it('reports a message-example failure once, not once per trait location', async () => {
    // The message-level pass folds traits in and reports against whichever array
    // the merge took; also matching each trait printed the identical finding twice.
    const doc = {
      asyncapi: '2.6.0',
      info: { title: 'T', version: '1.0.0' },
      components: {
        messages: {
          X: {
            traits: [
              {
                headers: { type: 'object', properties: { id: { type: 'string' } } },
                examples: [{ headers: { id: 42 } }],
              },
            ],
          },
        },
      },
    }
    const findings = await lint(JSON.stringify(doc, null, 2), { ruleset: allRules })
    expect(findings.filter((finding) => finding.code === 'asyncapi-message-examples')).toHaveLength(1)
  })
})

describe('references inside a message', () => {
  const v2 = (extra: Record<string, unknown>): Record<string, unknown> => ({
    asyncapi: '2.6.0',
    info: { title: 'T', version: '1.0.0' },
    ...extra,
  })

  it("says nothing about an example that matches a $ref'd payload schema", async () => {
    // Unresolved, the raw `{$ref: …}` reached the validator and every document
    // using the commonest AsyncAPI idiom drew "Cannot resolve $ref" at error
    // severity — a validator-internal message, on a valid document.
    const doc = v2({
      channels: {
        c: {
          subscribe: {
            operationId: 'op',
            message: { messageId: 'm', payload: { $ref: '#/components/schemas/S' }, examples: [{ payload: { a: 1 } }] },
          },
        },
      },
      components: { schemas: { S: { type: 'object' } } },
    })
    expect((await codesFor(doc, { resolve: true })).has('asyncapi-message-examples')).toBe(false)
  })

  it("checks the examples a $ref'd message trait supplies", async () => {
    // Reachable from neither direction for a while: the declaration was not in
    // the given, and the use site could not see through the reference.
    const doc = v2({
      channels: {
        c: {
          subscribe: {
            operationId: 'op',
            message: {
              messageId: 'm',
              payload: { type: 'object' },
              traits: [{ $ref: '#/components/messageTraits/T' }],
            },
          },
        },
      },
      components: {
        messageTraits: {
          T: {
            headers: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
            examples: [{ headers: { id: 42 } }],
          },
        },
      },
    })
    expect((await codesFor(doc, { resolve: true })).has('asyncapi-message-examples')).toBe(true)
  })

  it("says nothing about $ref'd headers, resolver or not", async () => {
    const doc = v2({
      channels: {
        c: {
          subscribe: {
            operationId: 'o',
            message: { messageId: 'm', headers: { $ref: '#/components/schemas/H' }, payload: { type: 'object' } },
          },
        },
      },
      components: { schemas: { H: { type: 'object' } } },
    })
    expect((await codesFor(doc, { resolve: true })).has('asyncapi-headers-schema-type-object')).toBe(false)
    expect((await codesFor(doc)).has('asyncapi-headers-schema-type-object')).toBe(false)
  })

  it('reports headers written as a boolean schema', async () => {
    // `false` rejects every message that carries headers, and the structural
    // meta-schema accepts it, so this rule is the only thing that reports it.
    for (const headers of [true, false]) {
      const doc = v2({
        channels: {
          c: { subscribe: { operationId: 'o', message: { messageId: 'm', headers, payload: { type: 'object' } } } },
        },
      })
      expect((await codesFor(doc)).has('asyncapi-headers-schema-type-object'), String(headers)).toBe(true)
    }
  })

  it('leaves a payload alone when a trait declares a foreign schemaFormat', async () => {
    // The gate used to live in the rule's `given`, which cannot fold traits in.
    const doc = v2({
      channels: {
        c: {
          subscribe: {
            operationId: 'o',
            description: 'd',
            message: {
              messageId: 'm',
              traits: [{ schemaFormat: 'application/vnd.apache.avro;version=1.9.0' }],
              payload: { type: 'record', name: 'P', fields: [] },
            },
          },
        },
      },
    })
    const codes = await codesFor(doc, { resolve: true })
    expect(codes.has('asyncapi-payload')).toBe(false)
    expect(codes.has('asyncapi-payload-unsupported-schemaFormat')).toBe(true)
  })

  it('reports a rule over authored structure once, however many $refs reach it', async () => {
    // Rules that read what the author wrote run unresolved, so a reusable
    // definition is read at its declaration and nowhere else.
    //
    // Rules that validate schema *content* must see the dereferenced tree, and
    // there one `components` entry appears once per `$ref` reaching it. Every
    // resolved rule in this package behaves that way, the OpenAPI preset
    // included, so `asyncapi-payload` below reports per reference site. This
    // pins the difference rather than pretending it away.
    const doc = v2({
      channels: {
        a: { subscribe: { operationId: 'a', description: 'd', message: { $ref: '#/components/messages/M' } } },
        b: { subscribe: { operationId: 'b', description: 'd', message: { $ref: '#/components/messages/M' } } },
      },
      components: {
        messages: {
          M: { messageId: 'm', payload: { type: 'not-a-type' }, tags: [{ name: 'dup' }, { name: 'dup' }] },
        },
      },
    })
    const findings = await lint(JSON.stringify(doc, null, 2), { ruleset: allRules, resolve })
    expect(findings.filter((finding) => finding.code === 'asyncapi-tags-uniqueness')).toHaveLength(1)
    expect(findings.filter((finding) => finding.code === 'asyncapi-payload').length).toBeGreaterThan(0)
  })

  it('checks the servers of a reusable 2.x channel exactly once', async () => {
    const doc = v2({
      servers: { s: { url: 'wss://api.test', protocol: 'wss' } },
      channels: { a: { $ref: '#/components/channels/R' }, b: { $ref: '#/components/channels/R' } },
      components: {
        channels: {
          R: { servers: ['nope'], subscribe: { operationId: 'o', message: { payload: { type: 'object' } } } },
        },
      },
    })
    const findings = await lint(JSON.stringify(doc, null, 2), { ruleset: allRules, resolve })
    expect(findings.filter((finding) => finding.code === 'asyncapi-channel-servers')).toHaveLength(1)
  })
})

describe('the 3.0 Server Object', () => {
  const v3 = (servers: Record<string, unknown>, components: Record<string, unknown> = {}): Record<string, unknown> => ({
    asyncapi: '3.0.0',
    info: { title: 'T', version: '1.0.0' },
    servers,
    channels: {},
    ...(Object.keys(components).length > 0 ? { components } : {}),
  })

  it('checks server security against the declared schemes', async () => {
    // 3.0 keeps `security` on the Server Object; only the operation-level rule
    // existed, so a dangling scheme reference on a server was unreported.
    const dangling = v3(
      { p: { host: 'a.test', protocol: 'ws', security: [{ $ref: '#/components/securitySchemes/ghost' }] } },
      { securitySchemes: { real: { type: 'userPassword' } } },
    )
    expect((await codesFor(dangling)).has('asyncapi-3-server-security')).toBe(true)

    const declared = v3(
      { p: { host: 'a.test', protocol: 'ws', security: [{ $ref: '#/components/securitySchemes/real' }] } },
      { securitySchemes: { real: { type: 'userPassword' } } },
    )
    expect((await codesFor(declared)).has('asyncapi-3-server-security')).toBe(false)
  })

  it('checks variables against templates in host and pathname', async () => {
    // 3.0 split the 2.x `url` into `host` and `pathname`; the shared check only
    // knew about `url`, so 3.0 server variables went unchecked entirely.
    const wrong = v3({
      p: { host: '{stage}.api.test', pathname: '/{ws}', protocol: 'ws', variables: { unused: { default: 'x' } } },
    })
    const codes = await codesFor(wrong)
    expect(codes.has('asyncapi-3-server-variables')).toBe(true)

    const right = v3({
      p: {
        host: '{stage}.api.test',
        pathname: '/{ws}',
        protocol: 'ws',
        variables: { stage: { default: 'dev' }, ws: { default: 'events' } },
      },
    })
    expect((await codesFor(right)).has('asyncapi-3-server-variables')).toBe(false)
  })

  it('reports a templated 2.x channel with no parameters object at all', async () => {
    const doc = {
      asyncapi: '2.6.0',
      info: { title: 'T', version: '1.0.0' },
      channels: {
        'user/{userId}': {
          subscribe: { operationId: 'o', description: 'd', message: { messageId: 'm', payload: { type: 'object' } } },
        },
      },
    }
    expect((await codesFor(doc)).has('asyncapi-channel-parameters')).toBe(true)
  })
})

describe('references and templates that are not what they look like', () => {
  it('says nothing about a 2.x channel item written as a $ref', async () => {
    // `$ref` is a fixed field of the 2.x Channel Item Object and this rule runs
    // unresolved, so the matched value is the reference itself. Treating an
    // absent `parameters` as empty made it demand what the target declares.
    const doc = {
      asyncapi: '2.6.0',
      info: { title: 'T', version: '1.0.0' },
      channels: { 'user/{userId}/signup': { $ref: '#/components/channels/u' } },
      components: {
        channels: {
          u: {
            parameters: { userId: { description: 'd', schema: { type: 'string' } } },
            subscribe: { operationId: 'o', description: 'd', message: { messageId: 'm', payload: { type: 'object' } } },
          },
        },
      },
    }
    expect((await codesFor(doc, { resolve: true })).has('asyncapi-channel-parameters')).toBe(false)
  })

  it('names the real parameter in an address that also contains {}', async () => {
    // A lazy `.+?` swallowed the closing brace of `{}` and ran on to the next,
    // so `a/{}/b/{id}` yielded the name `}/b/{id` and never mentioned `id`.
    const doc = {
      asyncapi: '3.0.0',
      info: { title: 'T', version: '1.0.0' },
      channels: { c: { address: 'a/{}/b/{id}' } },
    }
    const findings = await lint(JSON.stringify(doc, null, 2), { ruleset: allRules })
    const messages = findings.filter((f) => f.code === 'asyncapi-channel-parameters').map((f) => f.message)
    expect(messages).toEqual(['Channel parameters must be described: id'])
  })

  it('checks a dangling #/servers reference from a reusable 3.0 channel', async () => {
    // The spec carve-out excuses references pointing *outside* `#/servers`; one
    // that names the root Servers Object must still exist there.
    const base = {
      asyncapi: '3.0.0',
      info: { title: 'T', version: '1.0.0' },
      servers: { prod: { host: 'b.org', protocol: 'kafka' } },
    }
    const dangling = {
      ...base,
      channels: { live: { $ref: '#/components/channels/r' } },
      components: { channels: { r: { address: 'a', servers: [{ $ref: '#/servers/nope' }], messages: {} } } },
    }
    expect((await codesFor(dangling, { resolve: true })).has('asyncapi-3-channel-servers')).toBe(true)
  })

  it('reaches server security on a reusable 3.0 server', async () => {
    const doc = {
      asyncapi: '3.0.0',
      info: { title: 'T', version: '1.0.0' },
      servers: { prod: { $ref: '#/components/servers/p' } },
      channels: {},
      components: {
        servers: { p: { host: 'b.org', protocol: 'kafka', security: [{ $ref: '#/components/securitySchemes/nope' }] } },
        securitySchemes: { real: { type: 'userPassword' } },
      },
    }
    expect((await codesFor(doc, { resolve: true })).has('asyncapi-3-server-security')).toBe(true)
  })
})

describe('server variable wording per major', () => {
  it('says URL for 2.x and address for 3.0', async () => {
    const v2 = {
      asyncapi: '2.6.0',
      info: { title: 'T', version: '1.0.0' },
      servers: {
        p: {
          url: 'wss://{region}.test',
          protocol: 'wss',
          variables: { region: { default: 'us' }, unused: { default: 'x' } },
        },
      },
      channels: {},
    }
    const v3 = {
      asyncapi: '3.0.0',
      info: { title: 'T', version: '1.0.0' },
      servers: {
        p: {
          host: '{region}.test',
          protocol: 'wss',
          variables: { region: { default: 'us' }, unused: { default: 'x' } },
        },
      },
      channels: {},
    }
    const messagesFor = async (doc: unknown): Promise<string[]> =>
      (await lint(JSON.stringify(doc), { ruleset: allRules }))
        .filter((finding) => String(finding.code).includes('server-variables'))
        .map((finding) => finding.message)

    expect(await messagesFor(v2)).toContain('Server variable "unused" is not used in the URL')
    // 3.0 has no `url`; the address is `host` plus `pathname`.
    expect(await messagesFor(v3)).toContain('Server variable "unused" is not used in the address')
  })
})

describe('every tags-uniqueness location', () => {
  const duplicate = [{ name: 'dup' }, { name: 'dup' }]

  const V2_TAG_LOCATIONS: { name: string; doc: Record<string, unknown> }[] = [
    { name: 'root tags', doc: { tags: duplicate } },
    { name: 'servers', doc: { servers: { s: { url: 'wss://a', protocol: 'wss', tags: duplicate } } } },
    {
      name: 'components.servers',
      doc: { components: { servers: { s: { url: 'wss://a', protocol: 'wss', tags: duplicate } } } },
    },
    { name: 'operation', doc: { channels: { c: { subscribe: { operationId: 'o', tags: duplicate } } } } },
    {
      name: 'operation trait',
      doc: { channels: { c: { subscribe: { operationId: 'o', traits: [{ tags: duplicate }] } } } },
    },
    { name: 'components.operationTraits', doc: { components: { operationTraits: { t: { tags: duplicate } } } } },
    {
      name: 'components.channels operation',
      doc: { components: { channels: { c: { subscribe: { operationId: 'o', tags: duplicate } } } } },
    },
    { name: 'message', doc: { channels: { c: { subscribe: { operationId: 'o', message: { tags: duplicate } } } } } },
    { name: 'components.messages', doc: { components: { messages: { m: { tags: duplicate } } } } },
  ]

  for (const location of V2_TAG_LOCATIONS) {
    it(`finds duplicate 2.x tags at ${location.name}`, async () => {
      const doc = { asyncapi: '2.6.0', info: { title: 'T', version: '1.0.0' }, ...location.doc }
      expect((await codesFor(doc)).has('asyncapi-tags-uniqueness')).toBe(true)
    })
  }

  for (const location of [
    { name: 'info.tags', doc: { info: { title: 'T', version: '1.0.0', tags: duplicate } } },
    { name: 'servers', doc: { servers: { s: { host: 'a', protocol: 'ws', tags: duplicate } } } },
    { name: 'operations', doc: { operations: { o: { action: 'send', tags: duplicate } } } },
    { name: 'components.operationTraits', doc: { components: { operationTraits: { t: { tags: duplicate } } } } },
  ]) {
    it(`finds duplicate 3.0 tags at ${location.name}`, async () => {
      const doc = { asyncapi: '3.0.0', info: { title: 'T', version: '1.0.0' }, ...location.doc }
      expect((await codesFor(doc)).has('asyncapi-3-tags-uniqueness')).toBe(true)
    })
  }
})

describe('schemas the linter cannot resolve', () => {
  const withPayload = (payload: unknown, examples: unknown): Record<string, unknown> => ({
    asyncapi: '2.6.0',
    info: { title: 'T', version: '1.0.0' },
    channels: {
      c: { subscribe: { operationId: 'o', description: 'd', message: { messageId: 'm', payload, examples } } },
    },
    components: { schemas: { User: { type: 'object', properties: { id: { type: 'string' } } } } },
  })

  it('says nothing about an example whose schema is a $ref it cannot follow', async () => {
    // Two ways to get there, both ordinary: no resolver was injected (the
    // README's own example), or the reference crosses into another file. The
    // validator's complaint is about this package's API, not the document.
    const internal = withPayload({ $ref: '#/components/schemas/User' }, [{ payload: { id: 'a' } }])
    expect((await codesFor(internal)).has('asyncapi-message-examples')).toBe(false)

    const crossFile = withPayload({ $ref: './schemas/user.yaml#/User' }, [{ payload: { id: 'a' } }])
    expect((await codesFor(crossFile, { resolve: true })).has('asyncapi-message-examples')).toBe(false)
  })

  it('still reports an example that genuinely fails a schema it can follow', async () => {
    const doc = withPayload({ type: 'object', properties: { id: { type: 'string' } } }, [{ payload: { id: 42 } }])
    expect((await codesFor(doc)).has('asyncapi-message-examples')).toBe(true)
  })

  it('says nothing about a default or example under an unfollowable $ref', async () => {
    const doc = {
      asyncapi: '2.6.0',
      info: { title: 'T', version: '1.0.0' },
      channels: {},
      components: {
        schemas: {
          S: {
            type: 'object',
            properties: { a: { $ref: './other.yaml#/A' } },
            default: { a: 1 },
            examples: [{ a: 2 }],
          },
        },
      },
    }
    const codes = await codesFor(doc, { resolve: true })
    expect(codes.has('asyncapi-schema-default')).toBe(false)
    expect(codes.has('asyncapi-schema-examples')).toBe(false)
  })
})

describe('headers, per major', () => {
  it('does not let a 2.x headers object opt out by spelling a key "schema"', async () => {
    // The Multi Format Schema Object is 3.0 only. Accepting the wrapper in 2.x
    // meant a typeless headers object switched the check off by naming a key
    // that major does not define.
    const doc = {
      asyncapi: '2.6.0',
      info: { title: 'T', version: '1.0.0' },
      channels: {
        c: { subscribe: { operationId: 'o', message: { payload: {}, headers: { schema: { type: 'object' } } } } },
      },
    }
    expect((await codesFor(doc)).has('asyncapi-headers-schema-type-object')).toBe(true)
  })

  it('accepts a 3.0 wrapped headers schema written as a $ref', async () => {
    const doc = {
      asyncapi: '3.0.0',
      info: { title: 'T', version: '1.0.0' },
      channels: {
        c: {
          address: 'a',
          messages: {
            m: {
              headers: {
                schemaFormat: 'application/vnd.aai.asyncapi;version=3.0.0',
                schema: { $ref: '#/components/schemas/H' },
              },
              payload: {},
            },
          },
        },
      },
      components: { schemas: { H: { type: 'object' } } },
    }
    expect((await codesFor(doc)).has('asyncapi-3-headers-schema-type-object')).toBe(false)
  })
})

describe('security in reusable locations', () => {
  it('checks security wherever the ruleset already looks for the object it hangs off', async () => {
    const cases: { name: string; doc: Record<string, unknown>; code: string }[] = [
      {
        name: '2.x components.channels operation',
        code: 'asyncapi-operation-security',
        doc: {
          asyncapi: '2.6.0',
          info: { title: 'T', version: '1.0.0' },
          channels: {},
          components: {
            channels: { r: { subscribe: { operationId: 'o', security: [{ ghost: [] }], message: { payload: {} } } } },
            securitySchemes: { real: { type: 'userPassword' } },
          },
        },
      },
      {
        name: '2.x components.servers',
        code: 'asyncapi-server-security',
        doc: {
          asyncapi: '2.6.0',
          info: { title: 'T', version: '1.0.0' },
          channels: {},
          components: {
            servers: { s: { url: 'wss://a', protocol: 'wss', security: [{ ghost: [] }] } },
            securitySchemes: { real: { type: 'userPassword' } },
          },
        },
      },
      {
        name: '3.0 components.operations',
        code: 'asyncapi-3-operation-security',
        doc: {
          asyncapi: '3.0.0',
          info: { title: 'T', version: '1.0.0' },
          channels: {},
          components: {
            operations: { r: { action: 'send', security: [{ $ref: '#/components/securitySchemes/ghost' }] } },
            securitySchemes: { real: { type: 'userPassword' } },
          },
        },
      },
    ]
    for (const scenario of cases) {
      expect((await codesFor(scenario.doc)).has(scenario.code), scenario.name).toBe(true)
    }
  })

  it('reports a variable repeated across host and pathname once', async () => {
    const doc = {
      asyncapi: '3.0.0',
      info: { title: 'T', version: '1.0.0' },
      servers: { s: { host: '{stage}.api.test', pathname: '/{stage}/ws', protocol: 'ws' } },
      channels: {},
    }
    const findings = await lint(JSON.stringify(doc, null, 2), { ruleset: allRules })
    expect(findings.filter((finding) => finding.code === 'asyncapi-3-server-variables')).toHaveLength(1)
  })
})
