import { describe, expect, it } from 'vitest'

import { loadOpenApiFixtures } from '../../../fixtures/openapi/load-fixtures'
import { resolveRefs } from './resolve-refs'

/**
 * Exercises the `$ref` resolver against the vendored, real-world OpenAPI corpus
 * (see `fixtures/openapi/README.md`). Every internal `#/...` pointer in these
 * documents — whether it points at a schema, parameter, response, or callback —
 * must inline cleanly, leaving no internal refs behind and no internal-resolution
 * errors. External (non-`#`) refs the in-memory resolver can't load are reported
 * separately, so we only assert the absence of internal-resolution errors here.
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
    it(`inlines every internal $ref in ${name}`, () => {
      const { resolved, errors } = resolveRefs(document)
      // External refs the in-memory resolver can't load are expected diagnostics;
      // only internal-resolution failures should be absent.
      const internalErrors = errors.filter((error) => !error.message.includes('Cannot resolve external'))
      expect(internalErrors).toEqual([])
      const leftover: string[] = []
      findInternalRefs(resolved, '', leftover)
      expect(leftover).toEqual([])
    })
  }
})
