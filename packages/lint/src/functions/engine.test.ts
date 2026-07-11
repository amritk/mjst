import { describe, expect, it } from 'vitest'

import {
  type AsyncRulesetFunction,
  createDocument,
  createLinter,
  createRuleset,
  DiagnosticSeverity,
  type RuleEntry,
  type RulesetDefinition,
  type RulesetFunction,
} from '../core'
import { builtinFunctions } from './index'

// The runner is async (rule functions may return a Promise), so `lint` resolves
// to the findings; synchronous built-in functions still resolve immediately.
function lint(source: string, definition: RulesetDefinition) {
  const ruleset = createRuleset(definition, { functions: builtinFunctions })
  const document = createDocument(source)
  return createLinter(ruleset).run(document)
}

describe('engine', () => {
  it('flags a falsy/missing value with truthy and reports the closest position', async () => {
    const source = ['openapi: 3.1.0', 'info:', '  version: 1.0.0'].join('\n')
    const results = await lint(source, {
      rules: {
        'info-title': {
          given: '$.info',
          then: { field: 'title', function: 'truthy' },
          severity: 'error',
          message: '{{path}} is missing a title',
        },
      },
    })
    expect(results).toHaveLength(1)
    expect(results[0]?.code).toBe('info-title')
    expect(results[0]?.severity).toBe(DiagnosticSeverity.Error)
    expect(results[0]?.message).toBe('info.title is missing a title')
    expect(results[0]?.path).toEqual(['info', 'title'])
  })

  it('applies pattern against an exact source position and selects the key via ~', async () => {
    const source = ['openapi: 3.1.0', 'paths:', '  /Users:', '    get: {}'].join('\n')
    const results = await lint(source, {
      rules: {
        'paths-kebab': {
          given: '$.paths[*]~',
          then: { function: 'pattern', functionOptions: { match: '^/[a-z]+$' } },
        },
      },
    })
    // `$.paths[*]~` selects the keys; the key "/Users" violates the lowercase pattern.
    expect(results).toHaveLength(1)
    expect(results[0]?.path).toEqual(['paths', '/Users'])
  })

  it('validates casing on object keys via @key', async () => {
    const source = ['components:', '  schemas:', '    Bad_Name: {}', '    GoodName: {}'].join('\n')
    const results = await lint(source, {
      rules: {
        'schema-pascal': {
          given: '$.components.schemas',
          then: { field: '@key', function: 'casing', functionOptions: { type: 'pascal' } },
        },
      },
    })
    expect(results).toHaveLength(1)
    expect(results[0]?.path).toEqual(['components', 'schemas', 'Bad_Name'])
    expect(results[0]?.range.start.line).toBe(2)
  })

  it('enforces length and reports the right node', async () => {
    const source = 'info:\n  title: Hi\n'
    const results = await lint(source, {
      rules: {
        'title-length': {
          given: '$.info.title',
          then: { function: 'length', functionOptions: { min: 5 } },
        },
      },
    })
    expect(results).toHaveLength(1)
    expect(results[0]?.message).toContain('shorter than 5')
  })

  it('honors severity shorthand and disabling', async () => {
    const definition: RulesetDefinition = {
      rules: {
        'always-fail': {
          given: '$',
          then: { field: 'nope', function: 'truthy' },
          severity: 'error',
        },
      },
    }
    expect(await lint('a: 1', definition)).toHaveLength(1)
    // Disabling an inherited rule via the `off` shorthand suppresses it.
    const disabled: RulesetDefinition = { extends: [[definition, 'all']], rules: { 'always-fail': 'off' } }
    expect(await lint('a: 1', disabled)).toHaveLength(0)
  })

  it('throws when a shorthand targets a rule that exists nowhere', () => {
    // Spectral parity: a bare severity/boolean for an undefined rule is a loud
    // "Cannot extend non-existing rule" error rather than a silent no-op.
    expect(() => createRuleset({ rules: { 'ghost-rule': 'off' } }, { functions: builtinFunctions })).toThrow(
      /non-existing rule/,
    )
  })

  it('extends another ruleset and overrides severity', async () => {
    const base: RulesetDefinition = {
      rules: {
        'has-info': { given: '$', then: { field: 'info', function: 'truthy' }, severity: 'warn' },
      },
    }
    const ruleset = createRuleset(
      { extends: [[base, 'all']], rules: { 'has-info': 'error' } },
      { functions: builtinFunctions },
    )
    const results = await createLinter(ruleset).run(createDocument('openapi: 3.1.0'))
    expect(results).toHaveLength(1)
    expect(results[0]?.severity).toBe(DiagnosticSeverity.Error)
  })

  it('accepts a direct function reference in then (JS ruleset style)', async () => {
    const results = await lint('a: 1', {
      rules: {
        'js-rule': {
          given: '$',
          then: {
            field: 'missing',
            function: (input) => (input ? [] : [{ message: 'must exist' }]),
          },
        },
      },
    })
    expect(results).toHaveLength(1)
    expect(results[0]?.message).toBe('must exist')
  })

  it('awaits a Spectral-style async rule function', async () => {
    // A JS ruleset may pass an async function reference; the runner awaits it.
    const asyncFn: AsyncRulesetFunction = async (input) => (input ? [] : [{ message: 'resolved later' }])
    const results = await lint('a: 1', {
      rules: {
        'async-rule': {
          given: '$',
          severity: 'error',
          then: {
            field: 'missing',
            function: asyncFn as unknown as RulesetFunction,
          },
        },
      },
    })
    expect(results).toHaveLength(1)
    expect(results[0]?.message).toBe('resolved later')
  })

  it('isolates a throwing rule function into an error diagnostic and keeps other findings', async () => {
    const results = await lint('a: 1\nb: 0\n', {
      rules: {
        boom: {
          given: '$.a',
          severity: 'warn',
          then: {
            function: () => {
              throw new Error('kaboom')
            },
          },
        },
        // A sibling rule must still run and report despite `boom` throwing.
        'needs-b': { given: '$', severity: 'error', then: { field: 'b', function: 'truthy' } },
      },
    })
    const boom = results.find((r) => r.code === 'boom')
    expect(boom?.severity).toBe(DiagnosticSeverity.Error)
    expect(boom?.message).toContain('kaboom')
    expect(results.some((r) => r.code === 'needs-b')).toBe(true)
  })

  it('reports an unknown named function once per rule and continues', async () => {
    const results = await lint('a: 1\nb: 2\n', {
      rules: {
        'ghost-fn': { given: '$..*', severity: 'error', then: { function: 'doesNotExist' } },
      },
    })
    // One diagnostic for the whole rule, not one per matched node.
    const ghost = results.filter((r) => r.code === 'ghost-fn')
    expect(ghost).toHaveLength(1)
    expect(ghost[0]?.severity).toBe(DiagnosticSeverity.Error)
    expect(ghost[0]?.message).toContain('unknown function "doesNotExist"')
  })

  it('resolves #alias references in given', async () => {
    const results = await lint('components:\n  schemas:\n    Bad_Name: {}\n', {
      aliases: { Schemas: ['$.components.schemas'] },
      rules: {
        'schema-pascal': {
          given: '#Schemas',
          then: { field: '@key', function: 'casing', functionOptions: { type: 'pascal' } },
        },
      },
    })
    expect(results).toHaveLength(1)
    expect(results[0]?.path).toEqual(['components', 'schemas', 'Bad_Name'])
  })

  it('applies pointer-scoped overrides only within the targeted path', async () => {
    const definition: RulesetDefinition = {
      rules: {
        'no-x': { given: '$..x^', then: { field: 'x', function: 'falsy' }, severity: 'error' },
      },
      overrides: [{ files: ['**#/allowed'], rules: { 'no-x': 'off' } }],
    }
    const ruleset = createRuleset(definition, { functions: builtinFunctions })
    const source = 'allowed:\n  x: 1\nblocked:\n  x: 1\n'
    const results = await createLinter(ruleset).run(createDocument(source, { source: 'api.yaml' }))
    // The finding under `allowed` is suppressed; the one under `blocked` remains.
    expect(results).toHaveLength(1)
    expect(results[0]?.path).toEqual(['blocked', 'x'])
  })

  it('remaps severity via a pointer-scoped override (number and name forms)', async () => {
    const build = (entry: number | string): RulesetDefinition => ({
      rules: {
        'flag-x': { given: '$..x^', then: { field: 'x', function: 'falsy' }, severity: 'error' },
      },
      // A pointer-scoped override may remap severity by number or name; the
      // numeric shorthand is not part of the authored `RuleEntry` union, so cast.
      overrides: [{ files: ['**#/soft'], rules: { 'flag-x': entry as RuleEntry } }],
    })
    const source = 'soft:\n  x: 1\nhard:\n  x: 1\n'
    const run = async (entry: number | string) => {
      const ruleset = createRuleset(build(entry), { functions: builtinFunctions })
      return createLinter(ruleset).run(createDocument(source, { source: 'api.yaml' }))
    }
    // Numeric severity: the finding under `soft` is downgraded to a warning.
    const byNumber = await run(DiagnosticSeverity.Warning)
    expect(byNumber.find((r) => r.path.join('.') === 'soft.x')?.severity).toBe(DiagnosticSeverity.Warning)
    expect(byNumber.find((r) => r.path.join('.') === 'hard.x')?.severity).toBe(DiagnosticSeverity.Error)
    // Name form: same downgrade, spelled as a severity string.
    const byName = await run('info')
    expect(byName.find((r) => r.path.join('.') === 'soft.x')?.severity).toBe(DiagnosticSeverity.Information)
  })

  it('applies overrides matching the document source', async () => {
    const definition: RulesetDefinition = {
      rules: { 'needs-x': { given: '$', then: { field: 'x', function: 'truthy' }, severity: 'error' } },
      overrides: [{ files: ['legacy/**'], rules: { 'needs-x': 'off' } }],
    }
    const ruleset = createRuleset(definition, { functions: builtinFunctions })
    const run = (source: string) => createLinter(ruleset).run(createDocument('a: 1', { source }))
    expect(await run('src/api.yaml')).toHaveLength(1)
    expect(await run('legacy/api.yaml')).toHaveLength(0)
  })

  it('skips rules whose formats do not match the document', async () => {
    const results = await lint('swagger: "2.0"', {
      rules: {
        'oas3-only': {
          given: '$',
          then: { field: 'missing', function: 'truthy' },
          formats: ['oas3'],
        },
      },
    })
    expect(results).toHaveLength(0)
  })
})
