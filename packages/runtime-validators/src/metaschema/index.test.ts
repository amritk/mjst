import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { validate } from '../validate'
import { metaschema } from './index'

/**
 * Reads Ajv's vendored copy of the Draft 2020-12 metaschema documents, keyed by
 * `$id` the same way ours are.
 *
 * Ajv stays a devDependency for the differential oracle, and this is the right
 * use of it here: as a *check* on our transcription rather than the source of
 * truth at runtime. The published package ships its own copy and imports nothing.
 */
const ajvMetaschema = (): Record<string, unknown> => {
  const schemaPath = createRequire(import.meta.url).resolve('ajv/dist/refs/json-schema-2020-12/schema.json')
  const metaDir = join(schemaPath, '..', 'meta')
  const documents: Record<string, unknown> = {}

  for (const path of [schemaPath, ...readdirSync(metaDir).map((entry) => join(metaDir, entry))]) {
    if (!path.endsWith('.json')) continue
    const document = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>
    documents[document['$id'] as string] = document
  }
  return documents
}

describe('metaschema', () => {
  it('matches the specification text Ajv vendors, document for document', () => {
    // The drift check. These are specification documents, so "close enough" is
    // not a thing: a single reworded `$ref` would quietly change what a schema
    // validates against. Deep equality over the whole set catches an edit, a
    // dropped keyword, and a missing document alike.
    expect(metaschema).toEqual(ajvMetaschema())
  })

  it('covers the dialect document and all seven vocabulary metaschemas', () => {
    expect(Object.keys(metaschema).sort()).toEqual([
      'https://json-schema.org/draft/2020-12/meta/applicator',
      'https://json-schema.org/draft/2020-12/meta/content',
      'https://json-schema.org/draft/2020-12/meta/core',
      'https://json-schema.org/draft/2020-12/meta/format-annotation',
      'https://json-schema.org/draft/2020-12/meta/meta-data',
      'https://json-schema.org/draft/2020-12/meta/unevaluated',
      'https://json-schema.org/draft/2020-12/meta/validation',
      'https://json-schema.org/draft/2020-12/schema',
    ])
  })

  it('keys every document by the $id it declares', () => {
    // The keys are what a `$ref` names, so a key that disagrees with its
    // document's `$id` would resolve under one URI and not the other.
    for (const [uri, document] of Object.entries(metaschema)) {
      expect((document as Record<string, unknown>)['$id']).toBe(uri)
    }
  })

  it('is reachable as its own subpath export, and never from the main entry', () => {
    // The whole point of the subpath is that the core stays slim: a caller who
    // never validates a schema-about-schemas must not pay ~9 KB for the privilege.
    // Nothing else in the repo would notice a typo in the `exports` map.
    const manifest = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'))
    const subpath = manifest.exports['./metaschema']

    expect(subpath).toEqual({
      development: './src/metaschema/index.ts',
      types: './dist/metaschema/index.d.ts',
      default: './dist/metaschema/index.js',
    })
    expect(existsSync(new URL(`../../${subpath.development}`, import.meta.url))).toBe(true)
    // `files` ships the whole of `dist`, so the built subpath is covered.
    expect(manifest.files).toContain('dist')

    const barrel = readFileSync(new URL('../index.ts', import.meta.url), 'utf8')
    expect(barrel).not.toContain('metaschema')
  })

  it('lets a validator answer whether a value is a valid 2020-12 schema', () => {
    // The end-to-end point of shipping it: `$ref`ing the dialect resolves, and
    // the eight documents reference each other well enough to reach a verdict.
    const isSchema = validate({ $ref: 'https://json-schema.org/draft/2020-12/schema' }, { schemas: metaschema })

    expect(isSchema({ type: 'string' })).toBe(true)
    expect(isSchema({ $defs: { a: { type: 'integer', minimum: 1 } } })).toBe(true)
    expect(isSchema(true)).toBe(true)
    // `type` must name a known primitive type, and `$defs` must hold schemas.
    expect(isSchema({ type: 'strng' })).not.toBe(true)
    expect(isSchema({ $defs: { a: 1 } })).not.toBe(true)
  })

  it('reads $vocabulary off the registered dialect, which keeps validation asserting', () => {
    // The dialect document lists the validation vocabulary, so nothing switches
    // off — the interesting half of `$vocabulary` support, checked from the
    // direction a real caller comes at it.
    const validator = validate(
      { $schema: 'https://json-schema.org/draft/2020-12/schema', minimum: 10 },
      { schemas: metaschema },
    )

    expect(validator(20)).toBe(true)
    expect(validator(1)).not.toBe(true)
  })
})
