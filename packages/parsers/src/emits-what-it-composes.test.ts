import { buildSchema } from '@amritk/generate-parsers'
import { buildValidatorSchema } from '@amritk/generate-validators'
import type { JSONSchema } from 'json-schema-typed/draft-2020-12'
import { describe, expect, it } from 'vitest'

import { type GeneratedFile, generate, type Mode } from './generate'

/**
 * The load-bearing promise of a facade: asking it for one mode gives you exactly
 * what the package that owns that mode would have given you. Not equivalent code
 * — the same bytes.
 *
 * This is worth a test rather than a benchmark. If the output is identical then
 * runtime parity is a tautology and there is nothing to measure; if it ever
 * stops being identical, a benchmark would report a number while this reports
 * *which file* changed. It is also the thing most likely to rot: the composer
 * rewrites imports and strips declarations, and every one of those rewrites is a
 * chance to differ from the generator it is standing in front of.
 *
 * The barrel is compared separately because the composer rebuilds it over the
 * whole set rather than taking either generator's.
 */

const schema: JSONSchema = {
  type: 'object',
  properties: {
    id: { type: 'string', minLength: 1 },
    status: { type: 'string', enum: ['open', 'paid'], default: 'open' },
    total: { type: 'number', minimum: 0 },
    customer: {
      type: 'object',
      properties: { name: { type: 'string', minLength: 1 }, age: { type: 'integer', minimum: 0 } },
      required: ['name', 'age'],
    },
    items: { type: 'array', items: { $ref: '#/$defs/item' } },
  },
  required: ['id', 'total', 'customer'],
  $defs: {
    item: {
      type: 'object',
      properties: { sku: { type: 'string', minLength: 1 }, qty: { type: 'integer', minimum: 1 } },
      required: ['sku', 'qty'],
    },
  },
}

/** The file set as a comparable value, barrel excluded. */
const fingerprint = (files: readonly GeneratedFile[]): string =>
  files
    .filter((file) => file.filename !== 'index.ts')
    .map((file) => `${file.filename}\u0000${file.content}`)
    .sort()
    .join('\u0001')

const V = (coerce: boolean, repair: boolean): Promise<GeneratedFile[]> =>
  buildValidatorSchema(schema, 'Order', '', undefined, 'count-keys', undefined, coerce, false, repair)

const P = (strict: boolean): Promise<GeneratedFile[]> =>
  buildSchema(schema, 'Order', undefined, false, false, strict, 'embedded', './', false, false)

describe('@amritk/parsers emits what it composes', () => {
  it.each([
    ['guard', ['types', 'guard'] as Mode[], () => V(false, false)],
    ['validate', ['types', 'validate'] as Mode[], () => V(false, false)],
    ['coerce', ['types', 'coerce'] as Mode[], () => V(true, false)],
    ['repair', ['types', 'repair'] as Mode[], () => V(false, true)],
    ['parse', ['types', 'parse'] as Mode[], () => P(false)],
    ['parseStrict', ['types', 'parseStrict'] as Mode[], () => P(true)],
  ])('emits byte-identical output to the direct call for %s', async (_label, modes, direct) => {
    const composed = await generate(schema, 'Order', { modes, helpersMode: 'embedded' })

    expect(fingerprint(composed)).toBe(fingerprint(await direct()))
  })

  it('declares the type twice across the two direct calls, and once through the facade', async () => {
    const count = (files: readonly GeneratedFile[]): number =>
      files.reduce((total, file) => total + (file.content.match(/^export type Order\b/gm)?.length ?? 0), 0)

    // The duplicate is the whole reason the composer does any rewriting at all:
    // reaching every mode used to mean two type trees for one schema.
    expect(count([...(await V(true, true)), ...(await P(false))])).toBe(2)
    expect(
      count(
        await generate(schema, 'Order', {
          modes: ['types', 'guard', 'validate', 'coerce', 'repair', 'parse'],
          helpersMode: 'embedded',
        }),
      ),
    ).toBe(1)
  })
})
