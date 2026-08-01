import { describe, expect, it } from 'vitest'

import { buildAnchorMap } from './build-anchor-map'
import { buildDynamicRefMap } from './build-dynamic-ref-map'
import { extractRefs } from './extract-refs'
import { assertSchemaDepth, MAX_SCHEMA_DEPTH } from './max-schema-depth'
import { resolveDynamicRefs } from './resolve-dynamic-refs'
import { upgradeDraft07Schema } from './upgrade-draft07-schema'

/** Builds a schema nested `levels` deep through `properties`. */
const deeplyNested = (levels: number): Record<string, unknown> => {
  let node: Record<string, unknown> = { type: 'string' }
  for (let i = 0; i < levels; i++) node = { type: 'object', properties: { next: node } }
  return node
}

describe('max-schema-depth', () => {
  it('allows anything at or under the limit', () => {
    expect(() => assertSchemaDepth(MAX_SCHEMA_DEPTH, 'test')).not.toThrow()
  })

  it('names both the limit and the walker that hit it', () => {
    expect(() => assertSchemaDepth(MAX_SCHEMA_DEPTH + 1, 'extractRefs')).toThrow(
      `Schema nesting exceeds ${MAX_SCHEMA_DEPTH} levels while running extractRefs`,
    )
  })

  // Without the cap these all died with a bare "Maximum call stack size
  // exceeded" from inside a `traverse` frame, which says nothing about the
  // document that caused it.
  it('reports a nesting error instead of a stack overflow in every walker', () => {
    const schema = deeplyNested(MAX_SCHEMA_DEPTH + 10)

    expect(() => extractRefs(schema)).toThrow(/Schema nesting exceeds/)
    expect(() => buildDynamicRefMap(schema)).toThrow(/Schema nesting exceeds/)
    expect(() => buildAnchorMap(schema)).toThrow(/Schema nesting exceeds/)
    expect(() => resolveDynamicRefs({ $dynamicRef: '#a', ...schema }, { '#a': '#/$defs/a' })).toThrow(
      /Schema nesting exceeds/,
    )
    expect(() =>
      upgradeDraft07Schema({ $schema: 'http://json-schema.org/draft-07/schema', definitions: schema }),
    ).toThrow(/Schema nesting exceeds/)
  })

  it('leaves an ordinary document alone', () => {
    expect(() => extractRefs(deeplyNested(50))).not.toThrow()
  })
})
