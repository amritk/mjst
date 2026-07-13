import { describe, expect, it } from 'vitest'

import { loadOpenApiFixtures } from '../../../fixtures/openapi/load-fixtures'
import { resolveFragment } from './reference'
import { resolveRefs } from './resolve-refs'

/**
 * Exercises the `$ref` resolver against the vendored, real-world OpenAPI corpus
 * (see `fixtures/openapi/README.md`). Every internal `#/...` pointer in these
 * documents — whether it points at a schema, parameter, response, or callback —
 * must either inline cleanly or, at a reference cycle, be kept as a `$ref` that
 * still resolves within the output. No dangling refs, no errors recorded.
 */
const fixtures = loadOpenApiFixtures()

/** Walk a resolved document and collect any leftover internal `$ref` strings. */
const findInternalRefs = (node: unknown, path: string, found: string[]): void => {
  if (node === null || typeof node !== 'object') return
  if (Array.isArray(node)) {
    node.forEach((item, i) => {
      findInternalRefs(item, `${path}/${i}`, found)
    })
    return
  }
  for (const [key, value] of Object.entries(node)) {
    if (key === '$ref' && typeof value === 'string' && value.startsWith('#')) found.push(`${path} → ${value}`)
    else findInternalRefs(value, `${path}/${key}`, found)
  }
}

describe('openapi-fixtures', () => {
  it('loads the vendored corpus', () => {
    expect(fixtures.length).toBeGreaterThan(0)
  })

  for (const { name, document } of fixtures) {
    it(`inlines or keeps-resolvable every internal $ref in ${name}`, () => {
      const { resolved, errors } = resolveRefs(document)
      expect(errors).toEqual([])
      const leftover: string[] = []
      findInternalRefs(resolved, '', leftover)
      // Leftover refs are intentional cycle breakers: each must still resolve
      // within the resolved document (its target survived inlining), otherwise
      // it is a genuine dangling ref and the resolver has a bug.
      const dangling = leftover.filter((entry) => {
        const ref = entry.split(' → ')[1] as string
        return resolveFragment(resolved, '$ref', ref.slice(1)) === undefined
      })
      expect(dangling).toEqual([])
    })
  }
})
