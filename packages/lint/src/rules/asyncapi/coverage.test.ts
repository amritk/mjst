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
