import { describe, expect, it } from 'vitest'

import { createDocument, createLinter, createRuleset } from '../core'
import type { ISourceDocument, ISourceOrigin, ISourceSet, JsonPath, RulesetDefinition } from '../core/types'
import { builtinFunctions } from './index'

const lint = (source: string, definition: RulesetDefinition) =>
  createLinter(createRuleset(definition, { functions: builtinFunctions })).run(createDocument(source))

// A tiny function that flags every target it sees — handy for asserting exactly
// which nodes a `then.field` selected.
const flagEach = () => [{ message: 'flagged' }]

describe('runner: message templates', () => {
  it('interpolates {{property}}, {{value}}, and {{error}}', async () => {
    const results = await lint('name: api/\n', {
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

  it('interpolates {{path}} and {{description}}', async () => {
    const results = await lint('info:\n  title: Hi\n', {
      rules: {
        'title-desc': {
          given: '$.info',
          severity: 'error',
          description: 'Titles must be long enough',
          message: '{{path}}: {{description}}',
          then: { field: 'title', function: 'length', functionOptions: { min: 5 } },
        },
      },
    })
    expect(results).toHaveLength(1)
    expect(results[0]?.message).toBe('info.title: Titles must be long enough')
  })
})

describe('runner: multiple given / then', () => {
  it('runs a rule against every given expression', async () => {
    const results = await lint('a: false\nb: false\nc: true\n', {
      rules: {
        both: { given: ['$.a', '$.b'], severity: 'error', then: { function: 'truthy' } },
      },
    })
    expect(results.map((r) => r.path)).toEqual([['a'], ['b']])
  })

  it('runs every then action for a single match', async () => {
    const results = await lint('a: 0\nb: 0\n', {
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

describe('runner: field targeting on arrays', () => {
  it('selects array indices via @key', async () => {
    // Spectral treats arrays as indexable, so `@key` yields the numeric indices.
    const results = await lint('tags:\n  - a\n  - b\n', {
      rules: {
        'tag-keys': { given: '$.tags', severity: 'error', then: { field: '@key', function: flagEach } },
      },
    })
    expect(results.map((r) => r.path)).toEqual([
      ['tags', 0],
      ['tags', 1],
    ])
  })

  it('indexes into an array with a numeric field', async () => {
    const results = await lint('tags:\n  - filled\n  - ""\n', {
      rules: {
        'first-tag': { given: '$.tags', severity: 'error', then: { field: '1', function: 'truthy' } },
      },
    })
    expect(results).toHaveLength(1)
    expect(results[0]?.path).toEqual(['tags', 1])
  })

  it('lints a primitive match directly when a field targets a non-container', async () => {
    // `$.name` matches a string; a field cannot descend, so the value itself is linted.
    const results = await lint('name: ""\n', {
      rules: {
        'name-set': { given: '$.name', severity: 'error', then: { field: 'anything', function: 'truthy' } },
      },
    })
    expect(results).toHaveLength(1)
    expect(results[0]?.path).toEqual(['name'])
  })
})

describe('runner: positions', () => {
  it('maps recursive-descent matches to their exact nested paths and lines', async () => {
    const source = ['outer:', '  x: false', 'inner:', '  deep:', '    x: false'].join('\n')
    const results = await lint(source, {
      rules: {
        'no-x': { given: '$..x', severity: 'error', then: { function: 'truthy' } },
      },
    })
    const byPath = results.map((r) => ({ path: r.path, line: r.range.start.line }))
    expect(byPath).toContainEqual({ path: ['outer', 'x'], line: 1 })
    expect(byPath).toContainEqual({ path: ['inner', 'deep', 'x'], line: 4 })
  })

  it('points array-item findings at the offending element', async () => {
    const source = ['tags:', '  - a', '  - ""', '  - c'].join('\n')
    const results = await lint(source, {
      rules: {
        'non-empty': { given: '$.tags[*]', severity: 'error', then: { function: 'truthy' } },
      },
    })
    expect(results).toHaveLength(1)
    expect(results[0]?.path).toEqual(['tags', 1])
    expect(results[0]?.range.start.line).toBe(2) // the `- ""` line (0-based)
  })
})

describe('runner: resolved rules with a source set', () => {
  it('maps a finding on an inlined node back to its origin document and source', async () => {
    // The root inlines `pet` from an external file at `$.pet`; the resolved tree
    // therefore holds the external object directly. A resolved-rule finding on it
    // must report the external file's `source`, not the root's.
    const root = { swagger: '2.0', pet: { $ref: './pet.yaml' } }
    const resolved = { swagger: '2.0', pet: { name: '' } }

    const external: ISourceDocument = {
      data: { name: '' },
      source: 'pet.yaml',
      getLocationForJsonPath: () => ({
        range: { start: { line: 3, character: 2 }, end: { line: 3, character: 8 } },
      }),
    }
    const sources: ISourceSet = {
      get: (location) => (location === 'pet.yaml' ? external : undefined),
      // The finding path `['pet', 'name']` originates from `pet.yaml` at `['name']`.
      origin: (path: JsonPath): ISourceOrigin => ({ location: 'pet.yaml', path: path.slice(1) }),
    }

    const ruleset = createRuleset(
      {
        rules: {
          'pet-name': {
            given: '$.pet',
            severity: 'error',
            resolved: true,
            then: { field: 'name', function: 'truthy' },
          },
        },
      },
      { functions: builtinFunctions },
    )
    const document = createDocument(JSON.stringify(root), { source: 'root.json' })
    const results = await createLinter(ruleset).run(document, { resolved, sources })
    expect(results).toHaveLength(1)
    expect(results[0]?.source).toBe('pet.yaml')
    expect(results[0]?.range.start.line).toBe(3)
    expect(results[0]?.path).toEqual(['pet', 'name'])
  })
})
