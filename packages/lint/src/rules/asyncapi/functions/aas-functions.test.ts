import { describe, expect, it } from 'vitest'

import { createDocument } from '../../../core/document'
import type { IFunctionContext, JsonPath, RulesetFunction } from '../../../core/types'
import { ASYNCAPI_VERSIONS } from '../schemas'
import { getAllMessages, getAllOperations, mergeTraits, parseUrlVariables } from './helpers'
import {
  asyncApiChannelParameters,
  asyncApiChannelServers,
  asyncApiDocumentSchema,
  asyncApiMessageExamples,
  asyncApiMessageIdUnique,
  asyncApiOperationIdUnique,
  asyncApiPayload,
  asyncApiSchemaValidation,
  asyncApiSecurity,
} from './index'

/** A function context whose `document.data` is `data`, matched at `path`. */
const contextFor = (data: unknown, path: JsonPath = []): IFunctionContext =>
  ({
    document: createDocument(JSON.stringify(data)),
    path,
    rule: { name: 'test' },
  }) as unknown as IFunctionContext

const run = (fn: RulesetFunction, input: unknown, options: unknown, context: IFunctionContext): string[] =>
  (fn(input, options as never, context) ?? []).map((finding) => finding.message)

const paths = (fn: RulesetFunction, input: unknown, options: unknown, context: IFunctionContext): JsonPath[] =>
  (fn(input, options as never, context) ?? []).map((finding) => finding.path ?? [])

describe('parseUrlVariables', () => {
  it('reads every braced name, and nothing from an empty pair', () => {
    expect(parseUrlVariables('user/{id}/{kind}')).toEqual(['id', 'kind'])
    expect(parseUrlVariables('user/{}')).toEqual([])
    expect(parseUrlVariables('user/signedup')).toEqual([])
    expect(parseUrlVariables(undefined)).toEqual([])
    expect(parseUrlVariables(42)).toEqual([])
  })
})

describe('mergeTraits', () => {
  it('returns the object untouched when it declares no traits', () => {
    const message = { payload: { type: 'string' } }
    expect(mergeTraits(message)).toBe(message)
  })

  it('applies traits in order, with a later trait overriding an earlier one', () => {
    const merged = mergeTraits({
      name: 'own',
      traits: [{ name: 'first', summary: 's' }, { name: 'second' }],
    })
    expect(merged['name']).toBe('second')
    expect(merged['summary']).toBe('s')
  })

  it('merges nested objects rather than replacing them, and deletes on null', () => {
    const merged = mergeTraits({
      headers: { type: 'object', properties: { a: { type: 'string' } } },
      summary: 'gone',
      traits: [{ headers: { properties: { b: { type: 'number' } } }, summary: null }],
    })
    expect(merged['headers']).toEqual({
      type: 'object',
      properties: { a: { type: 'string' }, b: { type: 'number' } },
    })
    expect('summary' in merged).toBe(false)
  })

  it('keeps a __proto__ key as an own property instead of setting the prototype', () => {
    // Parsed, not written as a literal: `__proto__:` in a literal sets the
    // prototype, while a document that spells the key produces an own property —
    // which is exactly the input this has to survive.
    const trait = JSON.parse('{"__proto__": {"polluted": true}}') as Record<string, unknown>
    const merged = mergeTraits({ traits: [trait] })
    expect(Object.hasOwn(merged, '__proto__')).toBe(true)
    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined()
    expect(Object.getPrototypeOf(merged)).toBe(Object.prototype)
  })

  it('stops merging at a depth cap rather than following the document down', () => {
    // Observable, not merely "did not throw": 200 frames do not overflow, so a
    // no-throw assertion held with the cap removed entirely. Past the cap the
    // trait subtree is adopted wholesale instead of merged, so the message's own
    // leaf stops surviving the merge.
    const chain = (depth: number, leaf: Record<string, unknown>): Record<string, unknown> => {
      let node = leaf
      for (let i = 0; i < depth; i++) node = { nested: node }
      return node
    }
    const merged = mergeTraits({ ...chain(70, { fromMessage: true }), traits: [chain(70, { fromTrait: true })] })
    let node: unknown = merged
    while (node !== null && typeof node === 'object' && 'nested' in node) {
      node = (node as Record<string, unknown>)['nested']
    }
    // Uncapped this would be `{ fromMessage: true, fromTrait: true }`.
    expect(node).toEqual({ fromTrait: true })
  })

  it('keeps a prototype-named key as an own data property', () => {
    // The `Object.hasOwn` read guard in `mergePatch` is defensive rather than
    // load-bearing — every `Object.prototype` value is a function, which the
    // merge treats as "not an object" either way — but the resulting key must
    // still land as the patch wrote it.
    const merged = mergeTraits({ traits: [{ constructor: { injected: true } }] })
    expect(merged['constructor']).toEqual({ injected: true })
    expect(Object.hasOwn(merged, 'constructor')).toBe(true)
  })

  it('ignores a traits entry that is not an object', () => {
    expect(mergeTraits({ name: 'own', traits: ['nope', 3, null] })['name']).toBe('own')
  })
})

describe('getAllOperations / getAllMessages', () => {
  const document = {
    channels: {
      a: { subscribe: { operationId: 's' }, publish: { operationId: 'p' } },
      b: { subscribe: 'not-an-object' },
      c: 'not-an-object',
    },
  }

  it('walks both operations of every channel and skips what is not one', () => {
    expect([...getAllOperations(document)].map((found) => found.path)).toEqual([
      ['channels', 'a', 'subscribe'],
      ['channels', 'a', 'publish'],
    ])
    expect([...getAllOperations({ channels: 'no' })]).toEqual([])
    expect([...getAllOperations(null)]).toEqual([])
  })

  it('yields each oneOf alternative separately, and a plain message once', () => {
    const withMessages = {
      channels: {
        a: { subscribe: { message: { oneOf: [{ messageId: 'x' }, 'skip', { messageId: 'y' }] } } },
        b: { publish: { message: { messageId: 'z' } } },
      },
    }
    expect([...getAllMessages(withMessages)].map((found) => found.path)).toEqual([
      ['channels', 'a', 'subscribe', 'message', 'oneOf', 0],
      ['channels', 'a', 'subscribe', 'message', 'oneOf', 2],
      ['channels', 'b', 'publish', 'message'],
    ])
  })
})

describe('asyncApiChannelParameters', () => {
  /** A 2.x document, whose `$.channels` keys are addresses. */
  const v2 = { asyncapi: '2.6.0' }

  it('reports a parameter the address uses but does not describe', () => {
    const channel = { parameters: {} }
    expect(run(asyncApiChannelParameters, channel, null, contextFor(v2, ['channels', 'user/{id}']))).toEqual([
      'Channel parameters must be described: id',
    ])
  })

  it('reports a described parameter the address never uses', () => {
    const channel = { parameters: { stale: {} } }
    expect(run(asyncApiChannelParameters, channel, null, contextFor(v2, ['channels', 'user/{id}']))).toEqual([
      'Channel parameters must be described: id',
      'Channel parameter "stale" is not used in the channel address',
    ])
  })

  it('prefers the 3.x address field over the map key', () => {
    const channel = { address: 'user/{id}', parameters: { id: {} } }
    expect(run(asyncApiChannelParameters, channel, null, contextFor({}, ['channels', 'user']))).toEqual([])
  })

  it('looks parameters up as own keys, so a {constructor} is still reported', () => {
    const channel = { parameters: {} }
    expect(run(asyncApiChannelParameters, channel, null, contextFor(v2, ['channels', '{constructor}']))).toEqual([
      'Channel parameters must be described: constructor',
    ])
  })

  it('says nothing when there is no parameters object to check', () => {
    expect(run(asyncApiChannelParameters, { address: 'user/{id}' }, null, contextFor({}))).toEqual([])
    expect(run(asyncApiChannelParameters, 'not-a-channel', null, contextFor({}))).toEqual([])
  })

  it('does not read a component channel key as an address', () => {
    // A 2.x `components.channels` entry is keyed by name, so there is no address
    // to compare its parameters against — reading the key as one reported every
    // parameter of a reusable channel as unused.
    const channel = { parameters: { id: {} } }
    const path = ['components', 'channels', 'userSignedUp']
    expect(run(asyncApiChannelParameters, channel, null, contextFor(v2, path))).toEqual([])
    // The same entry in 3.x does carry an address, and is checked against it.
    const addressed = { address: 'user/{other}', parameters: { id: {} } }
    expect(run(asyncApiChannelParameters, addressed, null, contextFor({ asyncapi: '3.0.0' }, path))).toEqual([
      'Channel parameters must be described: other',
      'Channel parameter "id" is not used in the channel address',
    ])
  })

  it('says nothing when a 3.x channel declares no usable address', () => {
    // `address: null` means unknown or dynamic, so there is nothing to check.
    const channel = { address: null, parameters: { id: {} } }
    const context = contextFor({ asyncapi: '3.0.0' }, ['channels', 'user'])
    expect(run(asyncApiChannelParameters, channel, null, context)).toEqual([])
  })

  it('reports a parameter the address does not use, which is the point of the rule', () => {
    const channel = { parameters: { stale: {} } }
    expect(run(asyncApiChannelParameters, channel, null, contextFor(v2, ['channels', 'user/signedup']))).toEqual([
      'Channel parameter "stale" is not used in the channel address',
    ])
  })
})

describe('asyncApiChannelServers', () => {
  it('reports a channel server the document does not declare', () => {
    const document = { servers: { prod: {} }, channels: { a: { servers: ['prod', 'staging'] } } }
    expect(paths(asyncApiChannelServers, document, null, contextFor(document))).toEqual([
      ['channels', 'a', 'servers', 1],
    ])
  })

  it('says nothing when the channel names only declared servers', () => {
    const document = { servers: { prod: {} }, channels: { a: { servers: ['prod'] } } }
    expect(run(asyncApiChannelServers, document, null, contextFor(document))).toEqual([])
  })

  it('says nothing when there are no channels or no servers list', () => {
    expect(run(asyncApiChannelServers, { channels: 'no' }, null, contextFor({}))).toEqual([])
    expect(run(asyncApiChannelServers, { channels: { a: {} } }, null, contextFor({}))).toEqual([])
  })
})

describe('asyncApiSecurity', () => {
  const document = {
    components: {
      securitySchemes: {
        apiKey: { type: 'httpApiKey' },
        oauth: { type: 'oauth2', flows: { implicit: { scopes: { read: 'r' } }, password: { scopes: { write: 'w' } } } },
      },
    },
  }

  it('reports a 2.x requirement naming an undeclared scheme', () => {
    expect(run(asyncApiSecurity, { missing: [] }, { objectType: 'Server' }, contextFor(document))).toEqual([
      'Server security requirement "missing" is not a defined security scheme',
    ])
  })

  it('reports an oauth2 scope none of the scheme flows declare', () => {
    expect(
      run(asyncApiSecurity, { oauth: ['read', 'admin'] }, { objectType: 'Operation' }, contextFor(document)),
    ).toEqual(['Security scope "admin" is not declared by the "oauth" scheme. Available: [read, write]'])
  })

  it('accepts a scope declared in any of the flows', () => {
    expect(
      run(asyncApiSecurity, { oauth: ['read', 'write'] }, { objectType: 'Operation' }, contextFor(document)),
    ).toEqual([])
  })

  it('looks schemes up as own keys, so a scheme named toString is still reported missing', () => {
    expect(run(asyncApiSecurity, { toString: [] }, { objectType: 'Operation' }, contextFor(document))).toEqual([
      'Operation security requirement "toString" is not a defined security scheme',
    ])
  })

  it('checks a 3.x reference points at a declared scheme', () => {
    const good = { $ref: '#/components/securitySchemes/apiKey' }
    const missing = { $ref: '#/components/securitySchemes/nope' }
    const elsewhere = { $ref: '#/components/schemas/apiKey' }
    expect(run(asyncApiSecurity, good, { objectType: 'Operation' }, contextFor(document))).toEqual([])
    expect(run(asyncApiSecurity, missing, { objectType: 'Operation' }, contextFor(document))).toEqual([
      'Operation security requirement "nope" is not a defined security scheme',
    ])
    expect(run(asyncApiSecurity, elsewhere, { objectType: 'Operation' }, contextFor(document))).toEqual([
      'Operation security must reference "#/components/securitySchemes/…", not "#/components/schemas/apiKey"',
    ])
  })

  it('decodes JSON Pointer and percent escapes in a 3.x reference', () => {
    const escaped = {
      components: {
        securitySchemes: {
          'a/b': { type: 'httpApiKey' },
          'c~d': { type: 'httpApiKey' },
          'e f': { type: 'httpApiKey' },
        },
      },
    }
    for (const ref of [
      '#/components/securitySchemes/a~1b',
      '#/components/securitySchemes/c~0d',
      '#/components/securitySchemes/e%20f',
    ]) {
      expect(run(asyncApiSecurity, { $ref: ref }, { objectType: 'Operation' }, contextFor(escaped)), ref).toEqual([])
    }
  })

  it('survives a malformed percent escape instead of throwing', () => {
    // `decodeURIComponent` throws `URIError` on `%zz`, and the `$ref` is document
    // text — the rule used to die and report an internal error on the wrong node.
    const found = run(
      asyncApiSecurity,
      { $ref: '#/components/securitySchemes/%zz' },
      { objectType: 'Operation' },
      contextFor(document),
    )
    expect(found).toEqual(['Operation security requirement "%zz" is not a defined security scheme'])
  })

  it('falls back to Operation when no objectType is given', () => {
    expect(run(asyncApiSecurity, { missing: [] }, undefined, contextFor(document))).toEqual([
      'Operation security requirement "missing" is not a defined security scheme',
    ])
  })

  it('leaves an inline 3.x scheme alone — it defines itself', () => {
    expect(run(asyncApiSecurity, { type: 'userPassword' }, { objectType: 'Operation' }, contextFor(document))).toEqual(
      [],
    )
  })

  it('ignores a requirement value that is not a scope list, leaving it to the structural rules', () => {
    expect(run(asyncApiSecurity, { apiKey: 'not-a-list' }, { objectType: 'Operation' }, contextFor(document))).toEqual(
      [],
    )
  })
})

describe('asyncApiOperationIdUnique / asyncApiMessageIdUnique', () => {
  it('reports the second use of an operationId, at its own path', () => {
    const document = {
      channels: { a: { subscribe: { operationId: 'dup' } }, b: { publish: { operationId: 'dup' } } },
    }
    const found = asyncApiOperationIdUnique(document, null as never, contextFor(document)) ?? []
    expect(found).toHaveLength(1)
    expect(found[0]?.path).toEqual(['channels', 'b', 'publish', 'operationId'])
    expect(found[0]?.message).toBe('operationId "dup" must be unique')
  })

  it('reads the id a trait sets, and reports the trait that set it', () => {
    const document = {
      channels: {
        a: { subscribe: { operationId: 'own', traits: [{ operationId: 'fromTrait' }] } },
        b: { publish: { operationId: 'fromTrait' } },
      },
    }
    const found = asyncApiOperationIdUnique(document, null as never, contextFor(document)) ?? []
    expect(found).toHaveLength(1)
    expect(found[0]?.path).toEqual(['channels', 'b', 'publish', 'operationId'])
  })

  it('prefers the last trait that sets an id', () => {
    const document = {
      channels: {
        a: { subscribe: { traits: [{ operationId: 'first' }, { operationId: 'last' }] } },
        b: { publish: { operationId: 'last' } },
      },
    }
    expect(asyncApiOperationIdUnique(document, null as never, contextFor(document))).toHaveLength(1)
  })

  it('reports duplicate messageIds across channels and oneOf alternatives', () => {
    const document = {
      channels: {
        a: { subscribe: { message: { oneOf: [{ messageId: 'dup' }, { messageId: 'dup' }] } } },
      },
    }
    const found = asyncApiMessageIdUnique(document, null as never, contextFor(document)) ?? []
    expect(found).toHaveLength(1)
    expect(found[0]?.path).toEqual(['channels', 'a', 'subscribe', 'message', 'oneOf', 1, 'messageId'])
  })

  it('says nothing when every id is distinct or absent', () => {
    const document = { channels: { a: { subscribe: { operationId: 'x' } }, b: { publish: {} } } }
    expect(run(asyncApiOperationIdUnique, document, null, contextFor(document))).toEqual([])
    expect(run(asyncApiMessageIdUnique, document, null, contextFor(document))).toEqual([])
  })
})

describe('asyncApiSchemaValidation', () => {
  it('reports a default that does not match the schema it sits in', () => {
    const schema = { type: 'string', default: 12 }
    const found = asyncApiSchemaValidation(schema, { type: 'default' }, contextFor({}, ['components', 'schemas', 'S']))
    expect(found).toHaveLength(1)
    expect(found?.[0]?.path).toEqual(['components', 'schemas', 'S', 'default'])
  })

  it('reports each failing example at its own index', () => {
    const schema = { type: 'string', examples: ['ok', 3, 4] }
    const found = asyncApiSchemaValidation(schema, { type: 'examples' }, contextFor({}, ['s'])) ?? []
    expect(found.map((finding) => finding.path)).toEqual([
      ['s', 'examples', 1],
      ['s', 'examples', 2],
    ])
  })

  it('says nothing when there is nothing of that kind to check', () => {
    expect(run(asyncApiSchemaValidation, { type: 'string' }, { type: 'examples' }, contextFor({}))).toEqual([])
    expect(
      run(asyncApiSchemaValidation, { type: 'string', examples: 'no' }, { type: 'examples' }, contextFor({})),
    ).toEqual([])
    expect(run(asyncApiSchemaValidation, 'not-a-schema', { type: 'default' }, contextFor({}))).toEqual([])
  })
})

describe('asyncApiMessageExamples', () => {
  const message = {
    payload: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
    headers: { type: 'object', properties: { trace: { type: 'string' } }, required: ['trace'] },
  }

  it('checks each example payload and headers against the message schemas', () => {
    const input = { ...message, examples: [{ payload: { id: 1 }, headers: { trace: 2 } }] }
    const found = asyncApiMessageExamples(input, null as never, contextFor({}, ['m'])) ?? []
    // The path points at the field that actually failed, not just the example.
    expect(found.map((finding) => finding.path)).toEqual([
      ['m', 'examples', 0, 'payload', 'id'],
      ['m', 'examples', 0, 'headers', 'trace'],
    ])
  })

  it('accepts an example that matches', () => {
    const input = { ...message, examples: [{ payload: { id: 'a' }, headers: { trace: 'b' } }] }
    expect(run(asyncApiMessageExamples, input, null, contextFor({}))).toEqual([])
  })

  it('judges the example against the schema a trait contributes', () => {
    const input = {
      traits: [{ payload: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } }],
      examples: [{ payload: {} }],
    }
    expect(run(asyncApiMessageExamples, input, null, contextFor({}))).toHaveLength(1)
  })

  it('says nothing without examples, and skips an example that is not an object', () => {
    expect(run(asyncApiMessageExamples, message, null, contextFor({}))).toEqual([])
    expect(run(asyncApiMessageExamples, { ...message, examples: 'no' }, null, contextFor({}))).toEqual([])
    expect(run(asyncApiMessageExamples, { ...message, examples: ['no'] }, null, contextFor({}))).toEqual([])
    expect(run(asyncApiMessageExamples, 'not-a-message', null, contextFor({}))).toEqual([])
  })
})

describe('asyncApiPayload', () => {
  const document = { asyncapi: '2.6.0' }

  it('reports a payload that is not a valid AsyncAPI Schema object', () => {
    expect(run(asyncApiPayload, { type: 'nope' }, null, contextFor(document))).not.toEqual([])
  })

  it('accepts a valid payload', () => {
    expect(
      run(asyncApiPayload, { type: 'object', properties: { a: { type: 'string' } } }, null, contextFor(document)),
    ).toEqual([])
  })

  it('says nothing when the document declares a version it has no schema for', () => {
    expect(run(asyncApiPayload, { type: 'nope' }, null, contextFor({ asyncapi: '2.7.0' }))).toEqual([])
  })

  it('finds the Schema Object definition in every bundled version', () => {
    // The subschema is reached by its `$id`, which is built from the version. A
    // version whose schema does not declare that `$id` would silently validate
    // nothing, so check each one actually judges a payload.
    for (const version of ASYNCAPI_VERSIONS) {
      const context = contextFor({ asyncapi: `${version}.0` })
      expect(run(asyncApiPayload, { type: 'object' }, null, context), version).toEqual([])
      expect(run(asyncApiPayload, { type: 'nope' }, null, context), version).not.toEqual([])
    }
  })
})

describe('asyncApiDocumentSchema', () => {
  it('validates against the schema for the version the document declares', () => {
    const bad = { asyncapi: '2.6.0', info: { title: 'T', version: '1' }, channels: 'no' }
    expect(run(asyncApiDocumentSchema, bad, undefined, contextFor(bad))).not.toEqual([])
  })

  it('says nothing for a version it bundles no schema for', () => {
    const future = { asyncapi: '2.7.0', channels: 'no' }
    expect(run(asyncApiDocumentSchema, future, undefined, contextFor(future))).toEqual([])
  })

  it('validates whichever tree it is handed, with no options to configure', () => {
    // There is one structural rule per major and it takes no options, so the
    // function must not depend on any being passed.
    const bad = { asyncapi: '3.0.0', info: { title: 'T', version: '1' }, channels: 'no' }
    const context = contextFor(bad)
    expect(run(asyncApiDocumentSchema, context.document.data, undefined, context)).not.toEqual([])
    expect(run(asyncApiDocumentSchema, structuredClone(bad), undefined, context)).not.toEqual([])
  })
})
