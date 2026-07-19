import { describe, expect, it } from 'vitest'

import { defineContract } from '../define-contract'
import { stripContractFields } from './strip-contract-fields'

/**
 * The transform's contract: whatever it emits must still be valid JS whose
 * evaluated object drives `createClient` identically. Evaluating the emitted
 * call sites (with a passthrough defineContract) is therefore the strongest
 * assertion available — string checks alone could pass on broken output.
 */
const evaluateContracts = (source: string): Record<string, ReturnType<typeof defineContract>> => {
  const body = source.replace(/^import[^\n]*\n/gm, '').replace(/export const /g, 'exports.')
  const factory = new Function('defineContract', 'exports', body)
  const exports: Record<string, ReturnType<typeof defineContract>> = {}
  factory(defineContract, exports)
  return exports
}

const widget = `import { defineContract } from '@amritk/api'

export const getStatus = defineContract({
  method: 'get',
  path: '/status',
  summary: 'Read widget status',
  description: 'A long paragraph nobody in the browser ever reads.',
  tags: ['widget'],
  operationId: 'getStatus',
  request: {
    query: { type: 'object', properties: { verbose: { type: 'boolean' } } },
    headers: { type: 'object', properties: { 'x-api-key': { type: 'string' } }, required: ['x-api-key'] },
  },
  responses: {
    200: {
      description: 'The status payload',
      body: { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'] },
      headers: { 'x-ratelimit-remaining': { type: 'integer' } },
    },
    404: {},
  },
})

export const sendMessage = defineContract({
  method: 'post',
  path: '/messages',
  request: {
    body: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
    bodyType: 'form',
  },
  refine: ({ body }) => (body.text.length > 10_000 ? [{ path: '/text', message: 'too long' }] : undefined),
  responses: { 201: { body: { type: 'object' } }, 400: { description: 'nope' } },
})
`

describe('strip-contract-fields', () => {
  it('keeps only what the client runtime reads', () => {
    const stripped = stripContractFields(widget)
    const contracts = evaluateContracts(stripped)
    expect(contracts['getStatus']).toEqual({
      method: 'get',
      path: '/status',
      request: {},
      responses: { 200: { body: true }, 404: {} },
    })
    expect(contracts['sendMessage']).toEqual({
      method: 'post',
      path: '/messages',
      request: { body: true, bodyType: 'form' },
      responses: { 201: { body: true }, 400: {} },
    })
  })

  it('drops every freight string from the output', () => {
    const stripped = stripContractFields(widget)
    for (const freight of [
      'summary',
      'Read widget status',
      'nobody in the browser',
      'properties',
      'refine',
      'too long',
      'x-ratelimit-remaining',
    ]) {
      expect(stripped).not.toContain(freight)
    }
  })

  it('drops references to imported schemas so they can tree-shake away', () => {
    const source = `const c = defineContract({
      method: 'post',
      path: '/users',
      request: { body: userSchema },
      responses: { 201: { body: userSchema } },
    })`
    const stripped = stripContractFields(source)
    expect(stripped).not.toContain('userSchema')
    expect(stripped).toContain('body: true')
  })

  it('keeps response contentType markers verbatim', () => {
    const source = `const c = defineContract({
      method: 'post',
      path: '/chat',
      responses: { 200: { contentType: 'text/event-stream', body: { type: 'object' } }, 401: {} },
    })`
    const contracts = evaluateContracts(`exports.c = ${stripContractFields(source).slice('const c = '.length)}`)
    expect(contracts['c']?.responses).toEqual({ 200: { contentType: 'text/event-stream', body: true }, 401: {} })
  })

  it('survives refine functions full of tricky syntax', () => {
    const source = `const c = defineContract({
      method: 'get',
      path: '/x',
      refine: ({ query }) => {
        const pattern = /[},{]+\\//
        const text = \`nested \${query.a > 1 ? '}' : ","} template \${\`inner \${1}\`}\`
        // a comment with , and }
        return pattern.test(text) ? [{ path: '/a', message: 'bad, very bad}' }] : undefined
      },
      responses: { 204: {} },
    })`
    const stripped = stripContractFields(source)
    expect(stripped).not.toContain('refine')
    expect(stripped).toContain(`responses: { 204: {} }`)
  })

  it('handles multiple call sites and leaves surrounding code alone', () => {
    const source = `const before = 1\n${widget}\nconst after = defineContractish()`
    const stripped = stripContractFields(source)
    expect(stripped).toContain('const before = 1')
    // A longer identifier merely containing the name is not a call site.
    expect(stripped).toContain('defineContractish()')
    expect(stripped).not.toContain('summary')
  })

  it('leaves unparseable call sites byte-for-byte untouched', () => {
    const spread = `const c = defineContract({ ...base, responses: { 200: {} } })`
    expect(stripContractFields(spread)).toBe(spread)
    const computed = `const c = defineContract({ [key]: 1, method: 'get', path: '/x', responses: {} })`
    expect(stripContractFields(computed)).toBe(computed)
    const typeArgs = `const c = defineContract<P>({ method: 'get', path: '/x', responses: {} })`
    expect(stripContractFields(typeArgs)).toBe(typeArgs)
    const notACall = `import { defineContract } from '@amritk/api'`
    expect(stripContractFields(notACall)).toBe(notACall)
  })

  it('keeps non-literal request/responses values it cannot slim', () => {
    const source = `const c = defineContract({ method: 'get', path: '/x', request: sharedRequest, responses: sharedResponses })`
    const stripped = stripContractFields(source)
    expect(stripped).toContain('request: sharedRequest')
    expect(stripped).toContain('responses: sharedResponses')
  })

  it('keeps unknown fields — future contract additions must survive an older plugin', () => {
    const source = `const c = defineContract({ method: 'get', path: '/x', futureRuntimeField: 42, responses: { 200: { futureMarker: true } } })`
    const stripped = stripContractFields(source)
    expect(stripped).toContain('futureRuntimeField: 42')
    expect(stripped).toContain('futureMarker: true')
  })

  it('bails on trailing casts instead of dropping them', () => {
    const source = `const c = defineContract({ method: 'get', path: '/x', request: { query: qs } as const, responses: { 200: {} } })`
    const stripped = stripContractFields(source)
    expect(stripped).toContain('as const')
  })

  it('handles quoted keys, trailing commas, and comments between properties', () => {
    const source = `const c = defineContract({
      // the verb
      'method': 'get',
      path: '/x', /* inline */
      "summary": 'gone',
      responses: {
        200: {}, // ok
      },
    })`
    const contracts = evaluateContracts(`exports.c = ${stripContractFields(source).slice('const c = '.length)}`)
    expect(contracts['c']).toEqual({ method: 'get', path: '/x', responses: { 200: {} } })
  })
})
