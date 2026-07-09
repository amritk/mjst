import { validate } from '@amritk/runtime-validators'
import { describe, expect, it } from 'vitest'

import { lint } from '../../../core'
import { createOpenApiRuleset } from '../index'
import { oas31Schema } from './oas31'
import { oas32Schema } from './oas32'

// The 3.1 and 3.2 structural schemas are the official, self-contained
// spec.openapis.org meta-schemas. They validate the document envelope while
// leaving Schema Object internals permissive via a local `$dynamicRef`, which
// @amritk/runtime-validators resolves natively — no bundling, no dialect engine.
describe('official OpenAPI 3.1 / 3.2 meta-schemas', () => {
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
