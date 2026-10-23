import { beforeEach, describe, expect, it, vi } from 'vitest'

import { builtinFunctions } from '../functions'
import { createDocument } from './document'
import * as jsonpath from './jsonpath'
import { createRuleset } from './ruleset'
import { createLinter } from './runner'
import type { JsonPath, RulesetDefinition, RulesetFunction } from './types'

// Wrap the path builder so a test can count how many paths a run built. The
// runner is meant to build one only for a match that becomes a finding or whose
// function reads `context.path`, so the count is the behaviour under test.
vi.mock('./jsonpath', async (importOriginal) => {
  const original = await importOriginal<typeof import('./jsonpath')>()
  return { ...original, matchPath: vi.fn(original.matchPath) }
})

const SPEC = `openapi: 3.1.0
paths:
  /users:
    get:
      responses:
        '200':
          description: ok
    post:
      responses:
        '201':
          description: created
`

const run = (definition: RulesetDefinition, functions: Record<string, RulesetFunction> = {}) =>
  createLinter(createRuleset(definition, { functions: { ...builtinFunctions, ...functions } })).run(
    createDocument(SPEC),
  )

describe('runner', () => {
  beforeEach(() => {
    vi.mocked(jsonpath.matchPath).mockClear()
  })

  it('never builds a path for a match that yields no finding', async () => {
    const diagnostics = await run({
      rules: {
        described: { given: '$..responses.*', severity: 'error', then: { field: 'description', function: 'truthy' } },
      },
    })
    expect(diagnostics).toEqual([])
    expect(jsonpath.matchPath).not.toHaveBeenCalled()
  })

  it('builds the path once for a match several rules report on', async () => {
    const diagnostics = await run({
      rules: {
        'no-get': { given: '$.paths.*.get', severity: 'error', then: { function: 'falsy' } },
        'no-get-either': { given: '$.paths.*.get', severity: 'warn', then: { function: 'falsy' } },
      },
    })
    expect(diagnostics.map((d) => [d.code, d.path])).toEqual([
      ['no-get', ['paths', '/users', 'get']],
      ['no-get-either', ['paths', '/users', 'get']],
    ])
    expect(jsonpath.matchPath).toHaveBeenCalledTimes(1)
  })

  it('hands a function that reads context.path the normalized path', async () => {
    const seen: JsonPath[] = []
    const record: RulesetFunction = (_input, _options, context) => {
      seen.push(context.path)
      return undefined
    }
    await run(
      { rules: { record: { given: '$..responses.*', severity: 'error', then: { function: 'record' } } } },
      { record },
    )
    // The all-digit status codes come back as numbers, as `query` has always reported them.
    expect(seen).toEqual([
      ['paths', '/users', 'get', 'responses', 200],
      ['paths', '/users', 'post', 'responses', 201],
    ])
  })

  it('extends the match path with a field on a finding', async () => {
    const diagnostics = await run({
      rules: { summary: { given: '$.paths.*.*', severity: 'error', then: { field: 'summary', function: 'truthy' } } },
    })
    expect(diagnostics.map((d) => d.path)).toEqual([
      ['paths', '/users', 'get', 'summary'],
      ['paths', '/users', 'post', 'summary'],
    ])
  })

  it('reports a throwing function on the path of the node it threw on', async () => {
    const boom: RulesetFunction = () => {
      throw new Error('boom')
    }
    const diagnostics = await run(
      { rules: { boom: { given: '$.paths.*.get', severity: 'error', then: { function: 'boom' } } } },
      { boom },
    )
    expect(diagnostics.map((d) => [d.message, d.path])).toEqual([
      ['Rule "boom" threw: boom', ['paths', '/users', 'get']],
    ])
  })
})
