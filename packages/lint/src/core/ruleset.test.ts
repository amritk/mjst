import { describe, expect, it } from 'vitest'

import { createRuleset, DiagnosticSeverity, type FunctionRegistry, type RulesetDefinition } from './index'

// A minimal function registry — these tests exercise ruleset merging/resolution,
// not the functions themselves.
const truthy = () => []
const functions: FunctionRegistry = { truthy }
const build = (definition: RulesetDefinition) => createRuleset(definition, { functions })
const rule = (over: Record<string, unknown> = {}) => ({ given: '$', then: { function: 'truthy' }, ...over })

describe('severity resolution', () => {
  it('maps names and numbers, defaults to warn, and disables on "off"', () => {
    const rs = build({
      rules: {
        errorRule: rule({ severity: 'error' }),
        infoRule: rule({ severity: DiagnosticSeverity.Information }),
        defaultRule: rule({}),
        offRule: rule({ severity: 'off' }),
      },
    })
    const byName = Object.fromEntries(rs.rules.map((r) => [r.name, r]))
    expect(byName['errorRule']?.severity).toBe(DiagnosticSeverity.Error)
    expect(byName['errorRule']?.enabled).toBe(true)
    expect(byName['infoRule']?.severity).toBe(DiagnosticSeverity.Information)
    expect(byName['defaultRule']?.severity).toBe(DiagnosticSeverity.Warning)
    expect(byName['defaultRule']?.enabled).toBe(true)
    expect(byName['offRule']?.enabled).toBe(false)
    expect(rs.enabledRules.map((r) => r.name)).not.toContain('offRule')
  })
})

describe('extends modifiers', () => {
  const base: RulesetDefinition = {
    rules: {
      rec: rule({ recommended: true, severity: 'warn' }),
      opt: rule({ recommended: false, severity: 'warn' }),
    },
  }

  it('a plain extends enables only recommended rules', () => {
    const enabled = build({ extends: [base] }).enabledRules.map((r) => r.name)
    expect(enabled).toContain('rec')
    expect(enabled).not.toContain('opt')
  })

  it('the "all" modifier enables every inherited rule', () => {
    const enabled = build({ extends: [[base, 'all']] }).enabledRules.map((r) => r.name)
    expect(enabled).toEqual(expect.arrayContaining(['rec', 'opt']))
  })

  it('the "off" modifier disables every inherited rule', () => {
    expect(build({ extends: [[base, 'off']] }).enabledRules).toHaveLength(0)
  })

  it('a child can toggle and re-severity an inherited rule', () => {
    const disabled = build({ extends: [[base, 'all']], rules: { rec: false } })
    expect(disabled.enabledRules.map((r) => r.name)).not.toContain('rec')

    const reSeverity = build({ extends: [[base, 'all']], rules: { rec: 'error' } })
    expect(reSeverity.rules.find((r) => r.name === 'rec')?.severity).toBe(DiagnosticSeverity.Error)
  })
})

describe('aliases and expandGiven', () => {
  it('resolves a flat alias and appends any trailing selector', () => {
    const rs = build({ aliases: { Paths: ['$.paths'] }, rules: {} })
    expect(rs.expandGiven(['#Paths'], new Set())).toEqual(['$.paths'])
    expect(rs.expandGiven(['#Paths[*]'], new Set())).toEqual(['$.paths[*]'])
    expect(rs.expandGiven(['$.info'], new Set())).toEqual(['$.info']) // non-alias passthrough
  })

  it('resolves a per-format alias to the matching format targets', () => {
    const rs = build({
      aliases: {
        Root: {
          targets: [
            { formats: ['oas3'], given: ['$.a'] },
            { formats: ['oas2'], given: ['$.b'] },
          ],
        },
      },
      rules: {},
    })
    expect(rs.expandGiven(['#Root'], new Set(['oas3']))).toEqual(['$.a'])
    expect(rs.expandGiven(['#Root'], new Set(['oas2']))).toEqual(['$.b'])
    expect(rs.expandGiven(['#Root'], new Set())).toEqual([]) // no matching format
  })
})

describe('rulesForSource (overrides by file glob)', () => {
  const definition: RulesetDefinition = {
    rules: { r: rule({ severity: 'error' }) },
    overrides: [{ files: ['legacy/**'], rules: { r: 'off' } }],
  }

  it('applies a matching override and leaves non-matching sources unchanged', () => {
    const rs = build(definition)
    expect(rs.rulesForSource('legacy/api.yaml').find((r) => r.name === 'r')?.enabled).toBe(false)
    expect(rs.rulesForSource('src/api.yaml').find((r) => r.name === 'r')?.enabled).toBe(true)
    expect(rs.rulesForSource(undefined).find((r) => r.name === 'r')?.enabled).toBe(true)
  })

  it('ignores pointer-scoped overrides here (they are applied per-finding)', () => {
    const rs = build({
      rules: { r: rule({ severity: 'error' }) },
      overrides: [{ files: ['**#/x'], rules: { r: 'off' } }],
    })
    expect(rs.rulesForSource('any.yaml').find((r) => r.name === 'r')?.enabled).toBe(true)
  })
})
