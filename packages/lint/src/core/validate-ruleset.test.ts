import { describe, expect, it } from 'vitest'

import { validateRuleset } from './validate-ruleset'

describe('validateRuleset', () => {
  it('accepts a well-formed ruleset', () => {
    const problems = validateRuleset({
      extends: 'lint:recommended',
      rules: {
        'my-rule': { given: '$.info', then: { field: 'title', function: 'truthy' } },
        'toggle-off': false,
        'as-warning': 'warn',
      },
    })
    expect(problems).toEqual([])
  })

  it('flags a non-object ruleset', () => {
    expect(validateRuleset('nope').map((p) => p.message)).toContain('Ruleset must be an object')
  })

  it('flags a rule missing given/then', () => {
    const problems = validateRuleset({ rules: { broken: { then: { function: 'truthy' } } } })
    expect(problems.some((p) => p.message.includes('missing `given`'))).toBe(true)
  })

  it('flags a missing then', () => {
    const problems = validateRuleset({ rules: { broken: { given: '$' } } })
    expect(problems.some((p) => p.message.includes('missing `then`'))).toBe(true)
  })

  it('flags an invalid severity', () => {
    const problems = validateRuleset({ rules: { r: 'screaming' } })
    expect(problems.some((p) => p.message.includes('invalid severity'))).toBe(true)
  })

  it('flags a malformed given expression', () => {
    const problems = validateRuleset({ rules: { r: { given: 'info.title', then: { function: 'truthy' } } } })
    expect(problems.some((p) => p.message.includes('invalid `given`'))).toBe(true)
  })

  it('accepts an alias reference in given without flagging it', () => {
    const problems = validateRuleset({
      aliases: { Info: ['$.info'] },
      rules: { r: { given: '#Info', then: { function: 'truthy' } } },
    })
    expect(problems.some((p) => p.message.includes('invalid `given`'))).toBe(false)
  })

  it('flags a then without a function', () => {
    const problems = validateRuleset({ rules: { r: { given: '$', then: { field: 'x' } } } })
    expect(problems.some((p) => p.path.join('.') === 'rules.r.then.function')).toBe(true)
  })

  it('flags an override without files', () => {
    const problems = validateRuleset({ extends: 'lint:recommended', overrides: [{ rules: {} }] })
    expect(problems.some((p) => p.message.includes('files'))).toBe(true)
  })

  it('flags an empty ruleset (no rules, no extends)', () => {
    const problems = validateRuleset({ formats: ['oas3'] })
    expect(problems.some((p) => p.message.includes('no `rules`'))).toBe(true)
  })

  it('reports the path to the offending rule', () => {
    const problems = validateRuleset({ rules: { 'a-rule': { then: { function: 'truthy' } } } })
    expect(problems[0]?.path).toEqual(['rules', 'a-rule', 'given'])
  })
})
