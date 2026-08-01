import type { JSONSchema } from 'json-schema-typed/draft-2020-12'
import { describe, expect, it } from 'vitest'

import { loadComponentSchemas } from '../../../../fixtures/openapi/load-fixtures'
import { buildSchema } from './build-schema'

/**
 * Generates parsers + types for every `components.schemas` entry in the
 * vendored, real-world OpenAPI corpus (see `fixtures/openapi/README.md`). The
 * point is breadth: hundreds of hand-written schemas we don't control must each
 * produce non-empty TypeScript output without the generator throwing.
 *
 * Strict mode gets its own pass because it is the mode that can *refuse*: any
 * keyword it cannot enforce stops the build rather than emitting a permissive
 * parser, and only a corpus this size says whether that bar is set somewhere
 * real schemas actually live. (It was not, twice: a property named `items` read
 * as the keyword, and `{ allOf: [ …, { $ref } ], required: [...] }` — the most
 * ordinary OpenAPI idiom there is — was refused because the surrounding `allOf`
 * member could not be inlined.)
 */
const corpus = loadComponentSchemas()

describe('openapi-fixtures', () => {
  it('loads a non-trivial corpus of component schemas', () => {
    const total = corpus.reduce((sum, group) => sum + group.schemas.length, 0)
    expect(total).toBeGreaterThan(50)
  })

  for (const { fixture, schemas } of corpus) {
    it(`generates parser files for every schema in ${fixture}`, async () => {
      for (const { name, schema } of schemas) {
        const files = await buildSchema(schema as JSONSchema, 'Schema')
        expect(files.length, `${name} produced no files`).toBeGreaterThan(0)
        for (const file of files) {
          expect(file.filename).toBeTruthy()
          expect(file.content.trim().length, `${name} → ${file.filename} was empty`).toBeGreaterThan(0)
        }
      }
    })

    it(`generates strict parsers for every schema in ${fixture}`, async () => {
      const refused: string[] = []
      for (const { name, schema } of schemas) {
        try {
          const files = await buildSchema(schema as JSONSchema, 'Schema', undefined, undefined, undefined, true)
          expect(files.length, `${name} produced no files`).toBeGreaterThan(0)
        } catch (error) {
          refused.push(`${name}: ${(error as Error).message}`)
        }
      }
      expect(refused, refused.join('\n')).toEqual([])
    })
  }
})
