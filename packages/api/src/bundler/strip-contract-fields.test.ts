import { describe, expect, it } from 'vitest'

import { createApi } from '../create-api'
import { createClient } from '../create-client'
import { defineContract } from '../define-contract'
import { formBodySerializer } from '../form-body-serializer'
import { implementRoute } from '../implement-route'
import { toFetchHandler } from '../to-fetch-handler'
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
  security: [{ bearerAuth: ['read:status'] }],
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
      // Kept, though `createClient` never reads it — an app may. See below.
      security: [{ bearerAuth: ['read:status'] }],
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

  it('keeps per-operation security — the client may gate on it', () => {
    // Not a size decision that could go either way: a requirement is tens of
    // bytes, and an app reading it to attach a token, skip a call that will
    // 401, or hide a control for a missing scope must not have it deleted
    // underneath it. Everything else on the strip list is inert in a browser.
    const stripped = stripContractFields(widget)
    expect(stripped).toContain(`security: [{ bearerAuth: ['read:status'] }]`)
    expect(evaluateContracts(stripped)['getStatus']?.security).toEqual([{ bearerAuth: ['read:status'] }])
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

  it('keeps a literal body: undefined meaning "no body"', () => {
    // The marker replacement must not flip an explicit undefined into true —
    // the client would start JSON-parsing (or sending) a body that is not there.
    const source = `const c = defineContract({
      method: 'get',
      path: '/x',
      request: { body: undefined },
      responses: { 200: { body: undefined }, 201: { body: { type: 'object' } } },
    })`
    const contracts = evaluateContracts(`exports.c = ${stripContractFields(source).slice('const c = '.length)}`)
    expect(contracts['c']).toEqual({
      method: 'get',
      path: '/x',
      request: { body: undefined },
      responses: { 200: { body: undefined }, 201: { body: true } },
    })
  })

  it('bails on trailing casts instead of dropping them', () => {
    const source = `const c = defineContract({ method: 'get', path: '/x', request: { query: qs } as const, responses: { 200: {} } })`
    const stripped = stripContractFields(source)
    expect(stripped).toContain('as const')
  })

  it('drives createClient against the real server identically after the strip', async () => {
    // The no-functional-regression proof: the server keeps FULL contracts
    // (it validates), the client gets the STRIPPED ones — exactly the split a
    // browser build with the plugin produces — and every reply behavior
    // (JSON parse, empty-body status, form serialization) must be unchanged.
    // The server contracts are declared inline (evaluated ones lose the
    // literal types handlers need); any drift from the widget source shows up
    // as a route mismatch at runtime.
    const stripped = evaluateContracts(stripContractFields(widget))
    const routes = [
      implementRoute(
        defineContract({
          method: 'get',
          path: '/status',
          responses: { 200: { body: { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'] } } },
        }),
        () => ({ status: 200, body: { ok: true } }),
      ),
      implementRoute(
        defineContract({
          method: 'post',
          path: '/messages',
          request: {
            body: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
            bodyType: 'form',
          },
          responses: { 201: { body: { type: 'object' } } },
        }),
        ({ body }) => ({ status: 201, body }),
      ),
    ]
    const server = toFetchHandler(createApi({ routes }))
    // Evaluated contracts lose their literal types, so the per-slot input
    // typing degrades to "everything required" — loosen the call surface;
    // this test is about runtime behavior, the typing is covered elsewhere.
    type LooseClient = Record<string, (input?: Record<string, unknown>) => Promise<{ status: number; body?: unknown }>>
    const client = createClient(stripped, 'https://api.test', {
      fetch: (url, init) => server(new Request(url, init)),
      serializers: [formBodySerializer],
    }) as unknown as LooseClient

    const status = await client['getStatus']?.({ headers: { 'x-api-key': 'k' } })
    expect(status?.status).toBe(200)
    // The 200 body schema became a marker, so the client still JSON-parses.
    expect(status?.body).toEqual({ ok: true })

    // bodyType survived the strip: the form body round-trips through the
    // server's urlencoded parser and coercion.
    const sent = await client['sendMessage']?.({ body: { text: 'hi' } })
    expect(sent?.status).toBe(201)
    expect(sent?.body).toEqual({ text: 'hi' })
  })

  it('preserves the total line count of a multi-line call site', () => {
    // The documented wirings return `map: null`, so downstream sourcemaps only
    // stay aligned if the strip never changes which line anything sits on.
    const stripped = stripContractFields(widget)
    expect(stripped).not.toBe(widget)
    expect(stripped.split('\n').length).toBe(widget.split('\n').length)
  })

  it('keeps code after a stripped call site on its original line numbers', () => {
    const source = `${widget}\nconst sentinelAfterContracts = 1\n`
    const stripped = stripContractFields(source)
    const lineOf = (text: string, needle: string): number => text.split('\n').findIndex((line) => line.includes(needle))
    // The second contract starts after the first stripped one — it must not
    // have drifted, and neither may the plain statement after both.
    expect(lineOf(stripped, 'sendMessage')).toBe(lineOf(source, 'sendMessage'))
    expect(lineOf(stripped, 'sentinelAfterContracts')).toBe(lineOf(source, 'sentinelAfterContracts'))
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

  it('leaves a call site quoted inside a string or template alone', () => {
    // A docs page holding a usage sample as data. Rewriting it would edit the
    // string's value — the sample would render missing the very fields it
    // exists to show — with nothing anywhere to trace the change back to.
    const source = [
      'export const sample = `',
      "defineContract({ method: 'get', path: '/x', responses: { 200: {} }, summary: 'shown' })",
      '`',
      "export const inline = \"defineContract({ method: 'get', path: '/y', summary: 'shown' })\"",
    ].join('\n')
    expect(stripContractFields(source)).toBe(source)
  })

  it('leaves a call site shown in a comment alone', () => {
    const source = [
      "// defineContract({ method: 'get', path: '/y', responses: { 200: {} }, summary: 'shown' })",
      '/*',
      " * defineContract({ method: 'get', path: '/z', responses: { 200: {} }, summary: 'shown' })",
      ' */',
    ].join('\n')
    expect(stripContractFields(source)).toBe(source)
  })

  it('still strips a real call site that follows a quoted one', () => {
    // The scan has to resume in code position after skipping the literal, or
    // guarding against strings would quietly disable the transform.
    const source = [
      "export const sample = `defineContract({ summary: 'kept' })`",
      "export const real = defineContract({ method: 'get', path: '/x', responses: { 200: {} }, summary: 'gone' })",
    ].join('\n')
    const stripped = stripContractFields(source)
    expect(stripped).toContain("summary: 'kept'")
    expect(stripped).not.toContain("summary: 'gone'")
    expect(evaluateContracts(stripped)['real']).toEqual({ method: 'get', path: '/x', responses: { 200: {} } })
  })

  it('keeps scanning past an apostrophe in JSX text', () => {
    // `.tsx` is a scannable id, and JSX text is not a string literal — a bare
    // apostrophe there must not strand the rest of the module unstripped.
    const source = [
      "const label = <p>don't stop</p>",
      "export const real = defineContract({ method: 'get', path: '/x', responses: { 200: {} }, summary: 'gone' })",
    ].join('\n')
    expect(stripContractFields(source)).not.toContain("summary: 'gone'")
  })
})
