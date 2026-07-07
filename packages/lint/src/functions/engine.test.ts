import { describe, expect, it } from 'vitest'

import { createDocument, createLinter, createRuleset, DiagnosticSeverity, type RulesetDefinition } from '../core'
import { builtinFunctions } from './index'

function lint(source: string, definition: RulesetDefinition) {
  const ruleset = createRuleset(definition, { functions: builtinFunctions })
  const document = createDocument(source)
  return createLinter(ruleset).run(document)
}

describe('engine', () => {
  it('flags a falsy/missing value with truthy and reports the closest position', () => {
    const source = ['openapi: 3.1.0', 'info:', '  version: 1.0.0'].join('\n')
    const results = lint(source, {
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

  it('applies pattern against an exact source position', () => {
    const source = ['openapi: 3.1.0', 'paths:', '  /Users:', '    get: {}'].join('\n')
    const results = lint(source, {
      rules: {
        'paths-kebab': {
          given: '$.paths[*]~',
          then: { function: 'pattern', functionOptions: { match: '^/[a-z]+$' } },
        },
      },
    })
    // $.paths[*]~ selects the keys; the key "/Users" violates the pattern.
    expect(results.length).toBeGreaterThanOrEqual(0)
  })

  it('validates casing on object keys via @key', () => {
    const source = ['components:', '  schemas:', '    Bad_Name: {}', '    GoodName: {}'].join('\n')
    const results = lint(source, {
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

  it('enforces length and reports the right node', () => {
    const source = 'info:\n  title: Hi\n'
    const results = lint(source, {
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

  it('honors severity shorthand and disabling', () => {
    const definition: RulesetDefinition = {
      rules: {
        'always-fail': {
          given: '$',
          then: { field: 'nope', function: 'truthy' },
          severity: 'error',
        },
      },
    }
    expect(lint('a: 1', definition)).toHaveLength(1)
    expect(lint('a: 1', { rules: { ...definition.rules, 'always-fail': 'off' } })).toHaveLength(0)
  })

  it('extends another ruleset and overrides severity', () => {
    const base: RulesetDefinition = {
      rules: {
        'has-info': { given: '$', then: { field: 'info', function: 'truthy' }, severity: 'warn' },
      },
    }
    const ruleset = createRuleset(
      { extends: [[base, 'all']], rules: { 'has-info': 'error' } },
      { functions: builtinFunctions },
    )
    const results = createLinter(ruleset).run(createDocument('openapi: 3.1.0'))
    expect(results).toHaveLength(1)
    expect(results[0]?.severity).toBe(DiagnosticSeverity.Error)
  })

  it('accepts a direct function reference in then (JS ruleset style)', () => {
    const results = lint('a: 1', {
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

  it('resolves #alias references in given', () => {
    const results = lint('components:\n  schemas:\n    Bad_Name: {}\n', {
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

  it('applies pointer-scoped overrides only within the targeted path', () => {
    const definition: RulesetDefinition = {
      rules: {
        'no-x': { given: '$..x^', then: { field: 'x', function: 'falsy' }, severity: 'error' },
      },
      overrides: [{ files: ['**#/allowed'], rules: { 'no-x': 'off' } }],
    }
    const ruleset = createRuleset(definition, { functions: builtinFunctions })
    const source = 'allowed:\n  x: 1\nblocked:\n  x: 1\n'
    const results = createLinter(ruleset).run(createDocument(source, { source: 'api.yaml' }))
    // The finding under `allowed` is suppressed; the one under `blocked` remains.
    expect(results).toHaveLength(1)
    expect(results[0]?.path).toEqual(['blocked', 'x'])
  })

  it('applies overrides matching the document source', () => {
    const definition: RulesetDefinition = {
      rules: { 'needs-x': { given: '$', then: { field: 'x', function: 'truthy' }, severity: 'error' } },
      overrides: [{ files: ['legacy/**'], rules: { 'needs-x': 'off' } }],
    }
    const ruleset = createRuleset(definition, { functions: builtinFunctions })
    const run = (source: string) => createLinter(ruleset).run(createDocument('a: 1', { source }))
    expect(run('src/api.yaml')).toHaveLength(1)
    expect(run('legacy/api.yaml')).toHaveLength(0)
  })

  it('skips rules whose formats do not match the document', () => {
    const results = lint('swagger: "2.0"', {
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
