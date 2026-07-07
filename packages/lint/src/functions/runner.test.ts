import { describe, expect, it } from 'vitest'

import { createDocument, createLinter, createRuleset, type RulesetDefinition } from '../core'
import { builtinFunctions } from './index'

const lint = (source: string, definition: RulesetDefinition) =>
  createLinter(createRuleset(definition, { functions: builtinFunctions })).run(createDocument(source))

describe('runner: message templates', () => {
  it('interpolates {{property}}, {{value}}, and {{error}}', () => {
    const results = lint('name: api/\n', {
      rules: {
        'no-slash': {
          given: '$.name',
          severity: 'error',
          message: '{{property}} "{{value}}" -> {{error}}',
          then: { function: 'pattern', functionOptions: { notMatch: '/$' } },
        },
      },
    })
    expect(results).toHaveLength(1)
    expect(results[0]?.message).toBe('name "api/" -> The value must not match the pattern "/$"')
  })
})

describe('runner: multiple given / then', () => {
  it('runs a rule against every given expression', () => {
    const results = lint('a: false\nb: false\nc: true\n', {
      rules: {
        both: { given: ['$.a', '$.b'], severity: 'error', then: { function: 'truthy' } },
      },
    })
    expect(results.map((r) => r.path)).toEqual([['a'], ['b']])
  })

  it('runs every then action for a single match', () => {
    const results = lint('a: 0\nb: 0\n', {
      rules: {
        pair: {
          given: '$',
          severity: 'error',
          then: [
            { field: 'a', function: 'truthy' },
            { field: 'b', function: 'truthy' },
          ],
        },
      },
    })
    expect(results.map((r) => r.path)).toEqual([['a'], ['b']])
  })
})

describe('runner: positions', () => {
  it('maps recursive-descent matches to their exact nested paths and lines', () => {
    const source = ['outer:', '  x: false', 'inner:', '  deep:', '    x: false'].join('\n')
    const results = lint(source, {
      rules: {
        'no-x': { given: '$..x', severity: 'error', then: { function: 'truthy' } },
      },
    })
    const byPath = results.map((r) => ({ path: r.path, line: r.range.start.line }))
    expect(byPath).toContainEqual({ path: ['outer', 'x'], line: 1 })
    expect(byPath).toContainEqual({ path: ['inner', 'deep', 'x'], line: 4 })
  })

  it('points array-item findings at the offending element', () => {
    const source = ['tags:', '  - a', '  - ""', '  - c'].join('\n')
    const results = lint(source, {
      rules: {
        'non-empty': { given: '$.tags[*]', severity: 'error', then: { function: 'truthy' } },
      },
    })
    expect(results).toHaveLength(1)
    expect(results[0]?.path).toEqual(['tags', 1])
    expect(results[0]?.range.start.line).toBe(2) // the `- ""` line (0-based)
  })
})
