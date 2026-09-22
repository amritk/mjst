import { generate } from '@amritk/validation'
import type { JSONSchema } from 'json-schema-typed/draft-2020-12'
import { describe, expect, it } from 'vitest'

import { buildValidatorSchema } from './index'

/**
 * As with the parser shim: the only thing this package can get wrong is the
 * mapping from the old positional signature onto `generate()`'s options, so that
 * is what is compared — against the facade, not against a frozen snapshot that
 * would also pin the engine's output and break on any improvement to it.
 */
const schema: JSONSchema = {
  type: 'object',
  properties: {
    id: { type: 'string', format: 'uuid', minLength: 1 },
    n: { type: 'integer', minimum: 0, default: 1 },
    u: { anyOf: [{ type: 'string' }, { type: 'integer' }] },
  },
  required: ['id', 'n'],
}

const fingerprint = (files: readonly { filename: string; content: string }[]): string =>
  files
    .map((file) => `${file.filename}\u0000${file.content}`)
    .sort()
    .join('\u0001')

const BASE = ['types', 'guard', 'validate'] as const

describe('buildValidatorSchema (compatibility shim)', () => {
  it.each([
    ['default', [] as const, { modes: [...BASE] }],
    ['typeSuffix', ['Dto'] as const, { modes: [...BASE], typeSuffix: 'Dto' }],
    [
      'unknownKeys',
      ['', undefined, 'count-enumerable'] as const,
      { modes: [...BASE], unknownKeys: 'count-enumerable' },
    ],
    ['formats all', ['', undefined, 'count-keys', 'all'] as const, { modes: [...BASE], formats: 'all' }],
    ['formats list', ['', undefined, 'count-keys', ['uuid']] as const, { modes: [...BASE], formats: ['uuid'] }],
    ['coerce', ['', undefined, 'count-keys', undefined, true] as const, { modes: [...BASE, 'coerce'] }],
    [
      'branchErrors',
      ['', undefined, 'count-keys', undefined, false, true] as const,
      { modes: [...BASE], branchErrors: true },
    ],
    ['repair', ['', undefined, 'count-keys', undefined, false, false, true] as const, { modes: [...BASE, 'repair'] }],
    [
      'importExt ts',
      ['', undefined, 'count-keys', undefined, false, false, false, 'ts'] as const,
      { modes: [...BASE], importExt: 'ts' },
    ],
    [
      'check',
      ['', undefined, 'count-keys', undefined, false, false, false, 'js', true] as const,
      { modes: [...BASE, 'check'] },
    ],
  ])('maps %s onto the same output generate() produces', async (_label, args, options) => {
    const viaShim = await buildValidatorSchema(schema, 'Doc', ...(args as never[]))
    const viaFacade = await generate(schema, 'Doc', options as never)

    expect(fingerprint(viaShim)).toBe(fingerprint(viaFacade))
  })

  it('still produces real generator output, not an empty set', async () => {
    const files = await buildValidatorSchema(schema, 'Doc')

    expect(files.map((file) => file.filename)).toContain('doc.ts')
    expect(files.find((file) => file.filename === 'doc.ts')?.content).toContain('export const validateDoc')
  })
})
