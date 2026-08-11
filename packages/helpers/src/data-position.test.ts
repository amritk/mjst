import { describe, expect, it } from 'vitest'

import { DATA_KEYWORDS } from './build-resource-registry'
import { extractRefs } from './extract-refs'
import { foldNullable } from './fold-nullable'
import { resolveDynamicRefs } from './resolve-dynamic-refs'
import { upgradeDraft07Schema } from './upgrade-draft07-schema'
import { walkRefGraph } from './walk-ref-graph'

/**
 * A `$ref`-shaped object inside every data keyword, run past every walker.
 *
 * `enum`, `const`, `default`, `examples` and `example` hold values the schema
 * *describes*. An object under one that happens to have a `$ref`, `$anchor` or
 * `$dynamicRef` key is part of that value — the case the official suite files
 * under "naive replacement of `$ref` with its destination is not correct" — so
 * no walker may read it as a reference, rewrite it, count it as reachable, or
 * fail the build over it.
 *
 * Each walker was taught this separately and several were missed each time, so
 * the surface is enumerated here rather than sampled: every walker against
 * every data keyword.
 */
const DATA = [...DATA_KEYWORDS]

/** A schema whose only ref-shaped object sits inside `keyword`, naming nothing. */
const withGhost = (keyword: string): Record<string, unknown> => ({
  type: 'object',
  $defs: { Real: { type: 'string' } },
  properties: { a: { $ref: '#/$defs/Real' } },
  [keyword]: keyword === 'enum' || keyword === 'examples' ? [{ $ref: '#/$defs/Ghost' }] : { $ref: '#/$defs/Ghost' },
})

describe('a ref-shaped value inside a data keyword', () => {
  for (const keyword of DATA) {
    it(`is not collected as a reference from "${keyword}"`, () => {
      expect([...extractRefs(withGhost(keyword) as never)]).toEqual(['#/$defs/Real'])
    })

    it(`does not fail the build from "${keyword}"`, () => {
      expect(() => walkRefGraph(withGhost(keyword) as never, 'Doc', {}, () => [])).not.toThrow()
    })

    it(`does not graft a root self-alias from "${keyword}"`, () => {
      const nodes: unknown[] = []
      walkRefGraph(
        { type: 'object', [keyword]: { $ref: '#' }, properties: { a: { type: 'string' } } } as never,
        'Doc',
        {},
        (node) => {
          nodes.push(node.schema)
          return []
        },
      )
      expect((nodes[0] as Record<string, unknown>)['$defs']).toBeUndefined()
    })

    it(`does not rewrite a $dynamicRef inside "${keyword}"`, () => {
      const schema = {
        $defs: { T: { $dynamicAnchor: 'meta', type: 'string' } },
        [keyword]: { $dynamicRef: '#meta', note: 'author value' },
      }
      const resolved = resolveDynamicRefs(schema as never, { '#meta': '#/$defs/T' }) as Record<string, unknown>
      expect(resolved[keyword]).toEqual({ $dynamicRef: '#meta', note: 'author value' })
    })

    it(`does not fail on an unmatched $dynamicRef inside "${keyword}"`, () => {
      expect(() =>
        resolveDynamicRefs({ type: 'object', [keyword]: { $dynamicRef: '#nothing' } } as never, {}),
      ).not.toThrow()
    })

    it(`does not fold a nullable inside "${keyword}"`, () => {
      const schema = { type: 'object', [keyword]: { type: 'string', nullable: true } }
      expect(foldNullable(schema)).toEqual(schema)
    })

    it(`does not rewrite a draft-07 ref inside "${keyword}"`, () => {
      const schema = JSON.parse(
        JSON.stringify({
          $schema: 'http://json-schema.org/draft-07/schema#',
          definitions: { Child: { type: 'string' } },
          [keyword]: { $ref: '#/definitions/Child', note: 'author value' },
        }),
      ) as Record<string, unknown>

      const upgraded = upgradeDraft07Schema(schema) as Record<string, unknown>
      expect(upgraded[keyword]).toEqual({ $ref: '#/definitions/Child', note: 'author value' })
    })
  }
})
