import { describe, expect, it } from 'vitest'

import { lintWithResult, type Ruleset } from '../../core'
import { createFixPlugin } from '../../fix'
import { oasFixers } from './fixers'
import { createOpenApiRuleset, oas } from './index'

// Behavioral fixer coverage: apply the `oasFixers` to a violating document and
// assert both the concrete rewrite and that the fix loop reaches a fixpoint. The
// package-root `fixDocument` builds its ruleset with the core `createRuleset`,
// which does not know the OpenAPI custom functions, so we drive the same
// lint-fix-to-fixpoint loop here with the OpenAPI-aware built ruleset.
const built = createOpenApiRuleset({ extends: [[oas, 'all']] })

/** Runs the fix loop to a fixpoint (mirroring `fixDocument`) and returns the final text. */
const runFix = async (doc: unknown, ruleset: Ruleset = built, safeOnly = true): Promise<string> => {
  const plugin = createFixPlugin(oasFixers, { safeOnly })
  let current = JSON.stringify(doc, null, 2)
  for (let pass = 0; pass < 10; pass++) {
    const result = await lintWithResult(current, { ruleset, plugins: [plugin] })
    if (result.output === undefined || result.output === current) return current
    current = result.output
  }
  return current
}

/** Asserts a further fix pass changes nothing (the loop converged). */
const assertConverged = async (text: string, safeOnly = true): Promise<void> => {
  const plugin = createFixPlugin(oasFixers, { safeOnly })
  const again = await lintWithResult(text, { ruleset: built, plugins: [plugin] })
  expect(again.output === undefined || again.output === text).toBe(true)
}

const base3 = (): Record<string, unknown> => ({
  openapi: '3.0.0',
  info: { title: 'T', version: '1.0.0', contact: { name: 'x' }, description: 'd' },
  servers: [{ url: 'https://api.example.test' }],
  paths: {},
})

describe('fixers', () => {
  it('trailingSlashValue strips a trailing slash from a 3.x server URL', async () => {
    const out = JSON.parse(await runFix({ ...base3(), servers: [{ url: 'https://api.example.test/' }] }))
    expect(out.servers[0].url).toBe('https://api.example.test')
    await assertConverged(await runFix({ ...base3(), servers: [{ url: 'https://api.example.test/' }] }))
  })

  it('trailingSlashValue strips a trailing slash from an OAS2 host', async () => {
    const doc = {
      swagger: '2.0',
      info: { title: 'T', version: '1', contact: { name: 'x' }, description: 'd' },
      host: 'api.test/',
      schemes: ['https'],
      paths: {},
    }
    const out = JSON.parse(await runFix(doc))
    expect(out.host).toBe('api.test')
  })

  it('pathKeyTrailingSlash renames a path key to drop its trailing slash', async () => {
    const out = JSON.parse(
      await runFix({ ...base3(), paths: { '/pets/': { get: { responses: { '200': { description: 'ok' } } } } } }),
    )
    expect(Object.keys(out.paths)).toEqual(['/pets'])
  })

  it('pathKeyTrailingSlash does not clobber an existing sibling path (H3 collision guard)', async () => {
    // Renaming `/pets/` onto the existing `/pets` would silently drop a path, so
    // the fixer must leave it alone rather than lose data.
    const doc = {
      ...base3(),
      paths: {
        '/pets': { get: { responses: { '200': { description: 'ok' } } } },
        '/pets/': { post: { responses: { '200': { description: 'ok' } } } },
      },
    }
    const out = JSON.parse(await runFix(doc))
    expect(Object.keys(out.paths).sort()).toEqual(['/pets', '/pets/'])
  })

  it('pathKeyQueryString strips a query string from a path key', async () => {
    const out = JSON.parse(
      await runFix({
        ...base3(),
        paths: { '/pets?limit=1': { get: { responses: { '200': { description: 'ok' } } } } },
      }),
    )
    expect(Object.keys(out.paths)).toEqual(['/pets'])
  })

  it('refSibling removes a sibling key next to $ref', async () => {
    const doc = { ...base3(), components: { schemas: { A: { $ref: '#/components/schemas/B', description: 'sib' } } } }
    // B must exist so A is "used"; keep the doc otherwise minimal.
    ;(doc.components.schemas as Record<string, unknown>)['B'] = { type: 'string' }
    const out = JSON.parse(await runFix(doc))
    expect(out.components.schemas.A).toEqual({ $ref: '#/components/schemas/B' })
  })

  it('duplicatedEnum removes repeated enum entries, including key-reordered objects', async () => {
    const doc = {
      ...base3(),
      components: {
        schemas: {
          A: {
            type: 'object',
            enum: [
              { a: 1, b: 2 },
              { b: 2, a: 1 },
              { a: 1, b: 2 },
            ],
          },
        },
      },
    }
    const out = JSON.parse(await runFix(doc))
    // All three entries are deep-equal, so only one survives — and the fix loop
    // must converge, which requires the order-independent dedup key.
    expect(out.components.schemas.A.enum).toHaveLength(1)
    await assertConverged(await runFix(doc))
  })

  it('tagsAlphabetical reorders tags and converges with the alphabetical comparator', async () => {
    const doc = { ...base3(), tags: [{ name: 'gamma' }, { name: 'alpha' }, { name: 'beta' }] }
    const out = JSON.parse(await runFix(doc))
    expect(out.tags.map((t: { name: string }) => t.name)).toEqual(['alpha', 'beta', 'gamma'])
    await assertConverged(await runFix(doc))
  })

  it('tagsUnique removes duplicate tag names', async () => {
    const doc = { ...base3(), tags: [{ name: 'a' }, { name: 'a' }, { name: 'b' }] }
    const out = JSON.parse(await runFix(doc))
    expect(out.tags.map((t: { name: string }) => t.name)).toEqual(['a', 'b'])
  })

  it('unusedComponent removes an unreferenced component under --fix-unsafe', async () => {
    const doc = { ...base3(), components: { schemas: { Ghost: { type: 'string' } } } }
    const out = JSON.parse(await runFix(doc, built, false))
    expect(out.components.schemas.Ghost).toBeUndefined()
  })

  it('noNullable migrates nullable:true and drops nullable:false under --fix-unsafe', async () => {
    const doc = {
      openapi: '3.1.0',
      info: { title: 'T', version: '1.0.0', contact: { name: 'x' }, description: 'd' },
      servers: [{ url: 'https://api.example.test' }],
      // Reference A and B so the unsafe unused-component fixer does not remove them.
      paths: {
        '/a': {
          get: {
            responses: {
              '200': {
                description: 'ok',
                content: { 'application/json': { schema: { $ref: '#/components/schemas/A' } } },
              },
              '201': {
                description: 'ok',
                content: { 'application/json': { schema: { $ref: '#/components/schemas/B' } } },
              },
            },
          },
        },
      },
      components: {
        schemas: { A: { type: 'string', nullable: true }, B: { type: 'string', nullable: false } },
      },
    }
    const out = JSON.parse(await runFix(doc, built, false))
    // nullable:true widens the type to include "null"; nullable:false is just dropped.
    expect(out.components.schemas.A.type).toEqual(['string', 'null'])
    expect(out.components.schemas.A.nullable).toBeUndefined()
    expect(out.components.schemas.B.type).toBe('string')
    expect(out.components.schemas.B.nullable).toBeUndefined()
  })

  it('schemaExampleDeprecated migrates a singular example to the examples array', async () => {
    const doc = {
      openapi: '3.1.0',
      info: { title: 'T', version: '1.0.0', contact: { name: 'x' }, description: 'd' },
      servers: [{ url: 'https://api.example.test' }],
      paths: {},
      components: { schemas: { A: { type: 'string', example: 'hi' } } },
    }
    const out = JSON.parse(await runFix(doc))
    expect(out.components.schemas.A.example).toBeUndefined()
    expect(out.components.schemas.A.examples).toEqual(['hi'])
    await assertConverged(await runFix(doc))
  })

  it('exposes a fixer for every mechanically-repairable rule code', () => {
    // Guards against a rule/fixer registry drift (all keys resolve to a fixer).
    for (const code of Object.keys(oasFixers)) {
      expect(typeof oasFixers[code]?.fix).toBe('function')
    }
    expect(oasFixers['oas3_1-schema-example-deprecated']).toBeDefined()
  })
})
