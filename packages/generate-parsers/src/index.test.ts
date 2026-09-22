import { generate } from '@amritk/validation'
import type { JSONSchema } from 'json-schema-typed/draft-2020-12'
import { describe, expect, it } from 'vitest'

import { buildSchema } from './index'

/**
 * This package is a compatibility shim over `@amritk/validation`, so the only thing
 * it can get wrong is the mapping: which positional argument becomes which
 * option, and which flags choose which modes.
 *
 * The test therefore compares the shim against `generate()` rather than against
 * a frozen snapshot. A snapshot would pin the *engine's* output too, and break
 * on any legitimate improvement to it — which says nothing about whether this
 * mapping is right.
 *
 * That the mapping reproduces the retired package byte for byte was established
 * against the real pre-retirement engine at the point of retirement, across all
 * 129 emitted files of every positional option of both signatures, barrel
 * included.
 */
const schema: JSONSchema = {
  type: 'object',
  properties: {
    id: { type: 'string', minLength: 1 },
    n: { type: 'integer', minimum: 0, default: 1 },
    r: { $ref: '#/$defs/inner' },
  },
  required: ['id', 'n'],
  $defs: { inner: { type: 'object', properties: { x: { type: 'string' } }, required: ['x'] } },
}

/** The file set as a comparable value, barrel included — it is emitted output too. */
const fingerprint = (files: readonly { filename: string; content: string }[]): string =>
  files
    .map((file) => `${file.filename}\u0000${file.content}`)
    .sort()
    .join('\u0001')

describe('buildSchema (compatibility shim)', () => {
  it.each([
    ['default', [] as const, { modes: ['types', 'parse'] }],
    ['typesOnly', [undefined, true] as const, { modes: ['types'] }],
    ['strict', [undefined, false, false, true] as const, { modes: ['types', 'parseStrict'] }],
    [
      'embedded helpers',
      [undefined, false, false, false, 'embedded'] as const,
      { modes: ['types', 'parse'], helpersMode: 'embedded' },
    ],
    [
      'readonly',
      [undefined, false, false, false, 'package', './', true] as const,
      { modes: ['types', 'parse'], readonly: true },
    ],
    [
      'stripUnknown',
      [undefined, false, false, false, 'package', './', false, true] as const,
      { modes: ['types', 'parse'], stripUnknown: true },
    ],
    [
      'typeSuffix',
      [undefined, false, false, false, 'package', './', false, false, 'Dto'] as const,
      { modes: ['types', 'parse'], typeSuffix: 'Dto' },
    ],
    [
      'importExt ts',
      [undefined, false, false, false, 'package', './', false, false, '', 'ts'] as const,
      { modes: ['types', 'parse'], importExt: 'ts' },
    ],
    [
      'caseInsensitive',
      [undefined, false, false, false, 'package', './', false, false, '', 'js', true] as const,
      { modes: ['types', 'parse'], caseInsensitive: true },
    ],
  ])('maps %s onto the same output generate() produces', async (_label, args, options) => {
    const viaShim = await buildSchema(schema, 'Doc', ...(args as never[]))
    const viaFacade = await generate(schema, 'Doc', options as never)

    expect(fingerprint(viaShim)).toBe(fingerprint(viaFacade))
  })

  it('still produces real generator output, not an empty set', async () => {
    const files = await buildSchema(schema, 'Doc')

    expect(files.map((file) => file.filename)).toContain('doc.ts')
    expect(files.find((file) => file.filename === 'doc.ts')?.content).toContain('export const parseDoc')
  })
})
