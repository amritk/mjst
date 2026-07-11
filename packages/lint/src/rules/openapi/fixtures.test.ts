import { describe, expect, it } from 'vitest'

import { loadOpenApiFixtures } from '../../../../../fixtures/openapi/load-fixtures'
import { lint } from '../../core'
import { createOpenApiRuleset, oas } from './index'

// Robustness smoke test: run the whole preset (every rule, including the broad
// recursive-descent example/schema givens) against the vendored real-world specs.
// This guards against a rule throwing or mis-behaving on real documents, and
// confirms findings always carry a concrete source range. The fixtures are
// already `$ref`-resolved by the loader, so `resolved: true` rules see a real
// dereferenced tree.
const allRules = createOpenApiRuleset({ extends: [[oas, 'all']] })
const fixtures = loadOpenApiFixtures()

describe('fixtures', () => {
  it('loads at least the vendored v3.0 and v3.1 specs', () => {
    expect(fixtures.length).toBeGreaterThan(0)
  })

  for (const fixture of fixtures) {
    it(`lints ${fixture.name} without throwing, with ranged findings`, async () => {
      const findings = await lint(JSON.stringify(fixture.document), { ruleset: allRules })
      for (const finding of findings) {
        expect(finding.range.start.line).toBeGreaterThanOrEqual(0)
        expect(typeof finding.code).toBe('string')
      }
    })
  }
})
