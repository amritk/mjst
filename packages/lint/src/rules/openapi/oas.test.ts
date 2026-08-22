import { describe, expect, it } from 'vitest'

import { compileQuery, lint, query } from '../../core'
import { createOpenApiRuleset, oas } from './index'

// Rule-wiring coverage: the `given`/`field`/`formats` plumbing in `oas.ts`, as
// opposed to the function bodies covered by `functions/oas-functions.test.ts`.
const allRules = createOpenApiRuleset({ extends: [[oas, 'all']] })
// Default preset: `extends: [oas]`, so only `recommended` rules run.
const recommendedOnly = createOpenApiRuleset()

const codesWith = async (
  ruleset: ReturnType<typeof createOpenApiRuleset>,
  doc: unknown,
): Promise<Set<string | number>> =>
  new Set((await lint(JSON.stringify(doc), { ruleset })).map((finding) => finding.code))

const has = async (doc: unknown, code: string): Promise<boolean> => (await codesWith(allRules, doc)).has(code)

const base3 = (): Record<string, unknown> => ({
  openapi: '3.0.0',
  info: { title: 'T', version: '1.0.0', contact: { name: 'x' }, description: 'd' },
  servers: [{ url: 'https://api.example.test' }],
  paths: {},
})

const base2 = (): Record<string, unknown> => ({
  swagger: '2.0',
  info: { title: 'T', version: '1', contact: { name: 'x' }, description: 'd' },
  host: 'api.test',
  schemes: ['https'],
  paths: {},
})

describe('oas', () => {
  // H4: field-targeting reports a MISSING key, not just an empty array ---------
  it('oas3-api-servers fires when servers is missing or empty (H4)', async () => {
    const missing = {
      openapi: '3.0.0',
      info: { title: 'T', version: '1.0.0', contact: { name: 'x' }, description: 'd' },
      paths: {},
    }
    expect(await has(missing, 'oas3-api-servers')).toBe(true)
    const empty = { ...base3(), servers: [] }
    expect(await has(empty, 'oas3-api-servers')).toBe(true)
    expect(await has(base3(), 'oas3-api-servers')).toBe(false)
  })

  it('oas2-api-schemes fires when schemes is missing or empty (H4)', async () => {
    const missing = {
      swagger: '2.0',
      info: { title: 'T', version: '1', contact: { name: 'x' }, description: 'd' },
      host: 'api.test',
      paths: {},
    }
    expect(await has(missing, 'oas2-api-schemes')).toBe(true)
    const empty = { ...base2(), schemes: [] }
    expect(await has(empty, 'oas2-api-schemes')).toBe(true)
    expect(await has(base2(), 'oas2-api-schemes')).toBe(false)
  })

  // M4: array-items only applies to 2.0 / 3.0 -------------------------------
  it('array-items fires on 3.0 but not on a valid 3.1 array schema (M4)', async () => {
    const doc30 = { ...base3(), components: { schemas: { A: { type: 'array' } } } }
    expect(await has(doc30, 'array-items')).toBe(true)
    const doc31 = {
      openapi: '3.1.0',
      info: { title: 'T', version: '1.0.0', contact: { name: 'x' }, description: 'd' },
      servers: [{ url: 'https://api.example.test' }],
      paths: {},
      components: { schemas: { A: { type: 'array' } } },
    }
    expect(await has(doc31, 'array-items')).toBe(false)
  })

  // M5: webhook servers/callbacks, incl. 3.2 and path-item-level servers ----
  it('oas3_1-servers-in-webhook fires for operation- and path-item-level servers in 3.2 (M5)', async () => {
    const opLevel = {
      openapi: '3.2.0',
      info: { title: 'T', version: '1.0.0', contact: { name: 'x' }, description: 'd' },
      servers: [{ url: 'https://api.example.test' }],
      paths: {},
      webhooks: {
        hook: { post: { servers: [{ url: 'https://x.test' }], responses: { '200': { description: 'ok' } } } },
      },
    }
    expect(await has(opLevel, 'oas3_1-servers-in-webhook')).toBe(true)

    const pathItemLevel = {
      openapi: '3.2.0',
      info: { title: 'T', version: '1.0.0', contact: { name: 'x' }, description: 'd' },
      servers: [{ url: 'https://api.example.test' }],
      paths: {},
      webhooks: { hook: { servers: [{ url: 'https://x.test' }] } },
    }
    expect(await has(pathItemLevel, 'oas3_1-servers-in-webhook')).toBe(true)
  })

  it('oas3_1-callbacks-in-webhook fires in 3.2 (M5)', async () => {
    const doc = {
      openapi: '3.2.0',
      info: { title: 'T', version: '1.0.0', contact: { name: 'x' }, description: 'd' },
      servers: [{ url: 'https://api.example.test' }],
      paths: {},
      webhooks: { hook: { post: { callbacks: { cb: {} }, responses: { '200': { description: 'ok' } } } } },
    }
    expect(await has(doc, 'oas3_1-callbacks-in-webhook')).toBe(true)
  })

  // M6: 3.2 `query` operations are covered by operation-scoped rules --------
  it('operation-scoped rules cover a 3.2 query operation (M6)', async () => {
    const doc = {
      openapi: '3.2.0',
      info: { title: 'T', version: '1.0.0', contact: { name: 'x' }, description: 'd' },
      servers: [{ url: 'https://api.example.test' }],
      // `query` op is missing a description -> operation-description must fire.
      paths: { '/a': { query: { operationId: 'q', responses: { '200': { description: 'ok' } } } } },
    }
    expect(await has(doc, 'operation-description')).toBe(true)
  })

  it('oasPathParam covers a 3.2 query operation (M6)', async () => {
    const doc = {
      openapi: '3.2.0',
      info: { title: 'T', version: '1.0.0', contact: { name: 'x' }, description: 'd' },
      servers: [{ url: 'https://api.example.test' }],
      // The query op does not define the {id} template parameter.
      paths: { '/a/{id}': { query: { operationId: 'q', responses: { '200': { description: 'ok' } } } } },
    }
    expect(await has(doc, 'path-params')).toBe(true)
  })

  // L1: markdown rules also scan `title` -----------------------------------
  it('no-eval-in-markdown and no-script-tags-in-markdown scan title too (L1)', async () => {
    const evalTitle = { ...base3(), info: { ...(base3()['info'] as object), title: 'eval(x)' } }
    expect(await has(evalTitle, 'no-eval-in-markdown')).toBe(true)
    const scriptTitle = { ...base3(), info: { ...(base3()['info'] as object), title: '<script>x</script>' } }
    expect(await has(scriptTitle, 'no-script-tags-in-markdown')).toBe(true)
  })

  // recommended toggling ---------------------------------------------------
  it('keeps recommended:false rules off under plain extends: [oas] and on under [[oas, all]]', async () => {
    // `info-license` is recommended:false; the doc has no license object.
    const doc = base3()
    expect((await codesWith(recommendedOnly, doc)).has('info-license')).toBe(false)
    expect((await codesWith(allRules, doc)).has('info-license')).toBe(true)
  })

  // A full, clean OAS2 document should pass the recommended preset ----------
  it('lints a complete OAS2 document with no recommended findings', async () => {
    const doc = {
      swagger: '2.0',
      info: {
        title: 'Petstore',
        version: '1.0.0',
        contact: { name: 'x', url: 'https://x.test', email: 'a@b.test' },
        description: 'A store',
      },
      host: 'api.test',
      basePath: '/v1',
      schemes: ['https'],
      paths: {
        '/pets': {
          get: {
            operationId: 'listPets',
            description: 'List pets.',
            tags: ['pets'],
            responses: { '200': { description: 'ok', schema: { $ref: '#/definitions/Pet' } } },
          },
        },
      },
      tags: [{ name: 'pets', description: 'Pet operations' }],
      definitions: { Pet: { type: 'object', properties: { id: { type: 'string' } } } },
    }
    const codes = await codesWith(recommendedOnly, doc)
    // None of the structural / correctness recommended rules should fire.
    for (const code of [
      'oas2-schema',
      'operation-description',
      'operation-success-response',
      'path-params',
      'oas2-api-schemes',
    ]) {
      expect(codes.has(code)).toBe(false)
    }
  })
  // The preset's three filter `given`s are the only expressions in the shipped
  // rulesets that go through the filter interpreter. These pin the exact nodes
  // they select, so a change to the filter grammar cannot quietly widen or
  // narrow what the OpenAPI rules look at.
  it('filter givens select exactly the intended nodes', () => {
    const document = {
      openapi: '3.0.0',
      paths: {
        '/pets': {
          get: {
            responses: {
              '200': {
                schema: { type: 'array', items: { type: 'string' } },
                examples: { 'application/json': [] },
                content: { 'application/json': { schema: { type: 'string', example: 'x' } } },
              },
            },
          },
        },
      },
      components: {
        schemas: {
          Pet: { type: 'object', properties: { name: { type: 'string', default: 'rex' } } },
          Tags: { type: 'array', items: { type: 'string' } },
        },
      },
    }
    const givens = Object.fromEntries(
      Object.entries(oas.rules ?? {})
        .filter(([, rule]) => typeof rule === 'object')
        .flatMap(([name, rule]) => {
          const given = (rule as { given: string | string[] }).given
          return (Array.isArray(given) ? given : [given]).map((expression) => [`${name}:${expression}`, expression])
        }),
    )
    const withFilters = Object.values(givens).filter((expression) => expression.includes('[?('))
    // Exactly three filter givens ship today; a new one needs its own assertion.
    expect(new Set(withFilters).size).toBe(3)
    for (const expression of withFilters) expect(compileQuery(expression).error).toBeUndefined()

    const paths = (expression: string): string[] =>
      query(document, expression)
        .map((match) => match.path.join('.'))
        .sort()

    const schemaExample = withFilters.find((expression) => expression.includes('patternProperties')) as string
    expect(paths(schemaExample)).toEqual([
      'components.schemas.Pet.properties.name',
      'paths./pets.get.responses.200.content.application/json.schema',
    ])

    const arrayType = withFilters.find((expression) => expression.includes("@.type === 'array'")) as string
    expect(paths(arrayType)).toEqual(['components.schemas.Tags', 'paths./pets.get.responses.200.schema'])

    const mediaExample = withFilters.find((expression) => expression.includes('@.examples')) as string
    expect(paths(mediaExample)).toEqual(['paths./pets.get.responses.200'])
  })
})

describe('server variables stay scoped to the url field', () => {
  it('says nothing about a host or pathname reached by the recursive links given', async () => {
    // `oas3-server-variables` runs under `$..links[*].server`, so teaching the
    // shared check to read AsyncAPI 3.0's `host`/`pathname` turned any object
    // with those keys — an example payload, say — into an error about undefined
    // server variables. The fields are opt-in per caller now.
    const doc = JSON.stringify({
      openapi: '3.0.3',
      info: { title: 'T', version: '1', description: 'd', contact: { name: 'n' } },
      servers: [{ url: 'https://a.test' }],
      tags: [{ name: 't', description: 'd' }],
      paths: {
        '/p': {
          get: {
            operationId: 'g',
            description: 'd',
            tags: ['t'],
            responses: {
              '200': {
                description: 'OK',
                content: {
                  'application/json': {
                    example: { links: { next: { server: { host: 'api.{region}.test', pathname: '/{ver}' } } } },
                  },
                },
              },
            },
          },
        },
      },
    })
    const ruleset = createOpenApiRuleset({ extends: [[oas, 'all']] })
    const codes = (await lint(doc, { ruleset })).map((finding) => String(finding.code))
    expect(codes.filter((code) => code.includes('server-variables'))).toEqual([])
  })
})
