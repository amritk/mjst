import type { JSONSchema } from 'json-schema-typed/draft-2020-12'
import { describe, expect, it } from 'vitest'

import { loadComponentSchemas } from '../../../../fixtures/openapi/load-fixtures'
import { buildValidatorSchema } from './build-schema'

/**
 * Generates predicate validators for every `components.schemas` entry in the
 * vendored, real-world OpenAPI corpus (see `fixtures/openapi/README.md`). Every
 * schema we don't control must yield non-empty validator source without the
 * generator throwing.
 */
const corpus = loadComponentSchemas()

describe('openapi-fixtures', () => {
  it('loads a non-trivial corpus of component schemas', () => {
    const total = corpus.reduce((sum, group) => sum + group.schemas.length, 0)
    expect(total).toBeGreaterThan(50)
  })

  for (const { fixture, schemas } of corpus) {
    // Generating validators for the whole real-world corpus (notably the large
    // `openai.yaml`) runs right at the 5s default and flakes on slower CI runners.
    // Give it the same generous headroom the heavy differential suites use.
    it(`generates validator files for every schema in ${fixture}`, async () => {
      for (const { name, schema } of schemas) {
        const files = await buildValidatorSchema(schema as JSONSchema, 'Schema')
        expect(files.length, `${name} produced no files`).toBeGreaterThan(0)
        for (const file of files) {
          expect(file.filename).toBeTruthy()
          expect(file.content.trim().length, `${name} → ${file.filename} was empty`).toBeGreaterThan(0)
        }
      }
    }, 30_000)
  }
})
