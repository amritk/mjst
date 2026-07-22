import { describe, expect, it } from 'vitest'

import { builtinFunctions } from '../functions'
import { createRuleset } from './index'
import { lintWithResult } from './lint'
import type { RulesetDefinition } from './types'

const build = (definition: RulesetDefinition) => createRuleset(definition, { functions: builtinFunctions })

// A rule that never fires — the point of these tests is the pipeline around the
// rule pass (parser options, the skip predicate), not the findings themselves.
const NOOP: RulesetDefinition = {
  rules: { 'always-ok': { given: '$', severity: 'error', then: { field: 'x', function: 'defined' } } },
}

describe('lint pipeline', () => {
  it('maps ruleset parserOptions severity onto parser diagnostics', async () => {
    // A duplicate key is a parser-level problem; `parserOptions.duplicateKeys`
    // controls the severity it is reported at.
    const source = 'a: 1\na: 2\n'
    const ruleset = build({ ...NOOP, parserOptions: { duplicateKeys: 'error' } })
    const { diagnostics } = await lintWithResult(source, { ruleset })
    const parserFinding = diagnostics.find((d) => d.code === 'parser')
    expect(parserFinding).toBeDefined()
    // 0 === DiagnosticSeverity.Error.
    expect(parserFinding?.severity).toBe(0)
  })

  it('skips the whole document when the skip predicate returns true', async () => {
    const ruleset = build({
      rules: { 'needs-name': { given: '$', severity: 'error', then: { field: 'name', function: 'truthy' } } },
    })
    // The predicate sees the parsed data and short-circuits before any rule runs.
    const { diagnostics } = await lintWithResult('version: 1\n', {
      ruleset,
      skip: (data) => typeof data === 'object' && data !== null && !('name' in (data as object)),
    })
    expect(diagnostics).toHaveLength(0)
  })

  it('runs normally when the skip predicate returns false', async () => {
    const ruleset = build({
      rules: { 'needs-name': { given: '$', severity: 'error', then: { field: 'name', function: 'truthy' } } },
    })
    const { diagnostics } = await lintWithResult('version: 1\n', { ruleset, skip: () => false })
    expect(diagnostics.map((d) => d.code)).toContain('needs-name')
  })
})
