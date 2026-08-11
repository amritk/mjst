import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { DATA_KEYWORDS, SCHEMA_MAPS } from './build-resource-registry'

/**
 * The two sets that decide, at every schema walk in the monorepo, which keys
 * are keywords and which are author-chosen names.
 *
 * `@amritk/resolve-refs`, `@amritk/runtime-validators` and
 * `@amritk/generate-markdown` take no `@amritk/*` dependency by design, so each
 * restates them — and each restatement has drifted at least once, every time
 * producing the same class of bug: a definition or property named `default`,
 * `examples` or `example` silently skipped, so an `$anchor` under it never
 * registered, a `pattern` under it was never screened, or a tuple inside it was
 * never normalized. Three rounds of review found three of these one at a time.
 *
 * Parsing the sources is deliberate. Importing them is impossible across the
 * dependency boundary that makes the copies necessary in the first place, and a
 * hand-written expected list would be a sixth copy to keep in step.
 */
const COPIES: ReadonlyArray<{ file: string; data: string; maps?: string }> = [
  {
    file: '../../resolve-refs/src/child-role.ts',
    data: 'VALUE_KEYWORDS',
    maps: 'SCHEMA_MAP_KEYWORDS',
  },
  {
    file: '../../runtime-validators/src/interpreter/schema-registry.ts',
    data: 'DATA_KEYWORDS',
    maps: 'SCHEMA_MAPS',
  },
  {
    file: '../../runtime-validators/src/interpreter/limits.ts',
    data: 'DATA_KEYWORDS',
    maps: 'SCHEMA_MAPS',
  },
  {
    file: '../../generate-markdown/src/index.ts',
    data: 'DATA_KEYWORDS',
    maps: 'SCHEMA_MAP_KEYWORDS',
  },
]

/** The string members of a `const <name> = new Set([...])` declaration. */
const readSet = (source: string, name: string): string[] => {
  const match = new RegExp(`const ${name}[^=]*= new Set(?:<[^>]*>)?\\(\\[([^\\]]*)\\]\\)`).exec(source)
  if (match === null) throw new Error(`${name} not found, or not a Set literal`)
  return [...(match[1] as string).matchAll(/'([^']+)'/g)].map((entry) => entry[1] as string).sort()
}

describe('keyword-set parity', () => {
  const here = new URL('.', import.meta.url).pathname

  for (const copy of COPIES) {
    const source = readFileSync(join(here, copy.file), 'utf8')

    it(`${copy.file} restates DATA_KEYWORDS exactly`, () => {
      expect(readSet(source, copy.data)).toEqual([...DATA_KEYWORDS].sort())
    })

    if (copy.maps !== undefined) {
      it(`${copy.file} restates SCHEMA_MAPS exactly`, () => {
        expect(readSet(source, copy.maps as string)).toEqual([...SCHEMA_MAPS].sort())
      })
    }
  }
})
