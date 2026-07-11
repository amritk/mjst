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

  it('does not clone the rule list when no override matches the source', () => {
    const rs = build(definition)
    // A non-matching source must return the shared array rather than a fresh clone.
    expect(rs.rulesForSource('src/api.yaml')).toBe(rs.rules)
    expect(rs.rulesForSource('legacy/api.yaml')).not.toBe(rs.rules)
  })
})

describe('circular extends', () => {
  it('does not stack overflow on a two-ruleset cycle', () => {
    const a: RulesetDefinition = { rules: { fromA: rule() } }
    const b: RulesetDefinition = { extends: [a], rules: { fromB: rule() } }
    // Close the loop: a now extends b, which extends a.
    a.extends = [b]
    const names = build({ extends: [[a, 'all']] }).rules.map((r) => r.name)
    expect(names).toEqual(expect.arrayContaining(['fromA', 'fromB']))
  })
})

describe('inherited aliases', () => {
  it('keeps an alias defined in an extended ruleset resolvable', () => {
    const base: RulesetDefinition = {
      aliases: { Info: ['$.info'] },
      rules: { 'needs-title': rule({ given: '#Info' }) },
    }
    const rs = build({ extends: [[base, 'all']] })
    // The inherited rule survives with its alias, and the alias is in the table.
    expect(rs.rules.find((r) => r.name === 'needs-title')?.given).toEqual(['#Info'])
    expect(rs.expandGiven(['#Info'], new Set())).toEqual(['$.info'])
  })

  it('throws when a rule references an alias that is defined nowhere', () => {
    expect(() => build({ rules: { r: rule({ given: '#Missing' }) } })).toThrow(/undefined alias/)
  })
})

describe('nested extends modifier propagation', () => {
  const base: RulesetDefinition = {
    rules: { rec: rule({ recommended: true }), opt: rule({ recommended: false }) },
  }
  const mid: RulesetDefinition = { extends: [base], rules: { midRule: rule() } }

  it('propagates an outer "all" through a nested extends to the base', () => {
    const enabled = build({ extends: [[mid, 'all']] }).enabledRules.map((r) => r.name)
    expect(enabled).toEqual(expect.arrayContaining(['rec', 'opt', 'midRule']))
  })

  it('leaves recommended-only defaults when the outer extend is plain', () => {
    const enabled = build({ extends: [mid] }).enabledRules.map((r) => r.name)
    expect(enabled).toContain('rec')
    expect(enabled).not.toContain('opt')
  })
})

describe('invalid severity fallback', () => {
  it('falls back to Warning (enabled) for an unrecognized severity string', () => {
    const r = build({ rules: { r: rule({ severity: 'warning' }) } }).rules.find((x) => x.name === 'r')
    expect(r?.severity).toBe(DiagnosticSeverity.Warning)
    expect(r?.enabled).toBe(true)
  })
})

describe('ruleset-level formats', () => {
  it('stamps a ruleset-level format onto rules lacking their own', () => {
    const rs = build({ formats: ['oas3'], rules: { a: rule(), b: rule({ formats: ['oas2'] }) } })
    expect([...(rs.rules.find((r) => r.name === 'a')?.formats ?? [])]).toEqual(['oas3'])
    // A rule with its own formats keeps them.
    expect([...(rs.rules.find((r) => r.name === 'b')?.formats ?? [])]).toEqual(['oas2'])
  })

  it('applies each ruleset\'s own formats to its rules across extends', () => {
    const base: RulesetDefinition = { formats: ['oas2'], rules: { baseRule: rule() } }
    const rs = build({ formats: ['oas3'], extends: [[base, 'all']], rules: { childRule: rule() } })
    expect([...(rs.rules.find((r) => r.name === 'baseRule')?.formats ?? [])]).toEqual(['oas2'])
    expect([...(rs.rules.find((r) => r.name === 'childRule')?.formats ?? [])]).toEqual(['oas3'])
  })
})

describe('documentationUrl and parserOptions', () => {
  it('derives a per-rule documentationUrl anchor from the ruleset', () => {
    const rs = build({ documentationUrl: 'https://docs.test/rules', rules: { r: rule() } })
    expect(rs.rules.find((x) => x.name === 'r')?.documentationUrl).toBe('https://docs.test/rules#r')
  })

  it('lets a rule\'s own documentationUrl win', () => {
    const rs = build({
      documentationUrl: 'https://docs.test',
      rules: { r: rule({ documentationUrl: 'https://custom.test/r' }) },
    })
    expect(rs.rules.find((x) => x.name === 'r')?.documentationUrl).toBe('https://custom.test/r')
  })

  it('threads parserOptions from an extended base, with the child winning', () => {
    const base: RulesetDefinition = { parserOptions: { duplicateKeys: 'error' }, rules: { r: rule() } }
    expect(build({ extends: [base] }).parserOptions?.duplicateKeys).toBe('error')
    expect(build({ extends: [base], parserOptions: { duplicateKeys: 'warn' } }).parserOptions?.duplicateKeys).toBe(
      'warn',
    )
  })
})

describe('malformed given', () => {
  it('throws at build time for a given that is not valid JSONPath', () => {
    expect(() => build({ rules: { r: { given: 'info.title', then: { function: 'truthy' } } } })).toThrow(
      /invalid `given`/,
    )
  })
})
