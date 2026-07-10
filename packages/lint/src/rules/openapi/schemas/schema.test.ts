import { validate } from '@amritk/runtime-validators'
import { describe, expect, it } from 'vitest'

import { type IRuleDefinition, lint } from '../../../core'
import { createOpenApiRuleset, oas } from '../index'
import { loadOasSchema } from './index'

// The 3.1 and 3.2 structural schemas are the official, self-contained
// spec.openapis.org meta-schemas. They validate the document envelope while
// leaving Schema Object internals permissive via a local `$dynamicRef`, which
// @amritk/runtime-validators resolves natively — no bundling, no dialect engine.
describe('official OpenAPI 3.1 / 3.2 meta-schemas', () => {
  const oas31Schema = loadOasSchema('3.1')
  const oas32Schema = loadOasSchema('3.2')
  const v31 = validate(oas31Schema)
  const v32 = validate(oas32Schema)

  it('are self-contained (no external $refs left to bundle)', () => {
    const externalRefs = (root: unknown): string[] => {
      const found: string[] = []
      const walk = (node: unknown): void => {
        if (!node || typeof node !== 'object') return
        for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
          if (key === '$ref' && typeof value === 'string' && /^https?:/.test(value)) found.push(value)
          walk(value)
        }
      }
      walk(root)
      return found
    }
    expect(externalRefs(oas31Schema)).toEqual([])
    expect(externalRefs(oas32Schema)).toEqual([])
  })

  it('3.1 accepts a valid document, including webhooks and 2020-12 Schema constructs', () => {
    expect(
      v31({
        openapi: '3.1.1',
        info: { title: 'T', version: '1.0.0' },
        webhooks: { newPet: { post: { responses: { '200': { description: 'ok' } } } } },
        components: { schemas: { Pet: { type: ['object', 'null'], prefixItems: [{ type: 'string' }] } } },
      }),
    ).toBe(true)
  })

  it('3.1 rejects envelope violations the permissive envelope used to miss', () => {
    // Malformed `openapi` version + missing required `info.title`.
    expect(v31({ openapi: 'three-one', info: { version: '1.0.0' } })).not.toBe(true)
    // Response Object missing its required `description`.
    expect(
      v31({
        openapi: '3.1.0',
        info: { title: 'T', version: '1' },
        paths: { '/x': { get: { responses: { '200': {} } } } },
      }),
    ).not.toBe(true)
  })

  it('3.2 accepts a valid document and rejects a bad version', () => {
    expect(
      v32({
        openapi: '3.2.0',
        info: { title: 'T', version: '1.0.0' },
        paths: { '/x': { get: { responses: { '200': { description: 'ok' } } } } },
      }),
    ).toBe(true)
    expect(v32({ openapi: '9.9.9', info: { title: 'T', version: '1' }, paths: {} })).not.toBe(true)
  })

  it('wires oas3_1-schema / oas3_2-schema into the ruleset and fires on malformed docs', async () => {
    const ruleset = createOpenApiRuleset({ extends: [['oas', 'all']] })

    const bad31 = ['openapi: "3.1.0"', 'info:', '  version: "1.0.0"'].join('\n') // missing info.title
    const codes31 = new Set((await lint(bad31, { ruleset })).map((f) => f.code))
    expect(codes31.has('oas3_1-schema')).toBe(true)

    // Detected as oas3.2 (so the format-gated rule runs) but missing info.title.
    const bad32 = ['openapi: "3.2.0"', 'info:', '  version: "1.0.0"', 'paths: {}'].join('\n')
    const codes32 = new Set((await lint(bad32, { ruleset })).map((f) => f.code))
    expect(codes32.has('oas3_2-schema')).toBe(true)
  })
})

// The schema files are loaded lazily and per-version: building the ruleset pulls
// in no schema at all, and linting a document only ever reads its own version's
// schema (each `*-schema` rule is format-gated to a single version, and the
// `oasSchema` function only loads that version).
describe('lazy per-version schema loading', () => {
  it('the built ruleset embeds no schema object — only a version tag', () => {
    for (const name of ['oas2-schema', 'oas3-schema', 'oas3_1-schema', 'oas3_2-schema']) {
      const rule = oas.rules?.[name] as IRuleDefinition
      const then = Array.isArray(rule.then) ? rule.then[0] : rule.then
      expect(then?.function).toBe('oasSchema')
      // A version tag, not an inlined ~35 KB meta-schema, keeps the rule cheap to build.
      expect(then?.functionOptions).toHaveProperty('version')
      expect(then?.functionOptions).not.toHaveProperty('schema')
    }
  })

  it('loadOasSchema memoizes, returning a stable object per version', () => {
    expect(loadOasSchema('3.1')).toBe(loadOasSchema('3.1'))
    expect(loadOasSchema('2.0')).not.toBe(loadOasSchema('3.0'))
  })

  it('linting a 3.1 document runs only the 3.1 structural rule (so only 3.1 loads)', async () => {
    const doc = ['openapi: "3.1.0"', 'info:', '  version: "1.0.0"'].join('\n') // missing info.title
    const codes = new Set(
      (await lint(doc, { ruleset: createOpenApiRuleset({ extends: [['oas', 'all']] }) })).map((f) => f.code),
    )
    expect(codes.has('oas3_1-schema')).toBe(true)
    // The 2.0 / 3.0 / 3.2 structural rules are format-gated out, so their schemas never load.
    expect(codes.has('oas2-schema')).toBe(false)
    expect(codes.has('oas3-schema')).toBe(false)
    expect(codes.has('oas3_2-schema')).toBe(false)
  })
})
