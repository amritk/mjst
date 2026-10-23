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

  it('reads context.path directly, destructured, after an await and in a copy that sets it', async () => {
    // `path` is a getter inherited from the context's prototype, so pin the ways
    // a function commonly reads it besides the plain `context.path` form.
    const seen: JsonPath[] = []
    const later = (async (_input: unknown, _options: unknown, context: { path: JsonPath }) => {
      const { path } = context
      const copy = { ...context, path: [...context.path, 'copy'] }
      await Promise.resolve()
      seen.push(path, context.path, copy.path)
      return undefined
    }) as unknown as RulesetFunction
    await run(
      { rules: { later: { given: '$.paths.*.get', severity: 'error', then: { function: 'later' } } } },
      { later },
    )
    expect(seen).toEqual([
      ['paths', '/users', 'get'],
      ['paths', '/users', 'get'],
      ['paths', '/users', 'get', 'copy'],
    ])
  })

  it('leaves path out of a bare copy of the context and out of its keys', async () => {
    // The documented cost of the inherited getter: a copy that does not set
    // `path` has none, and `path` is not an own key.
    const seen: unknown[] = []
    const inspect: RulesetFunction = (_input, _options, context) => {
      seen.push(Object.keys(context), { ...context }.path, 'path' in context)
      return undefined
    }
    await run(
      { rules: { inspect: { given: '$.paths.*.get', severity: 'error', then: { function: 'inspect' } } } },
      { inspect },
    )
    expect(seen).toEqual([['document', 'value', 'rule', 'functionOptions'], undefined, true])
  })

  it('gives a context that assigns path its own writable property', async () => {
    const seen: unknown[] = []
    const rewrite: RulesetFunction = (_input, _options, context) => {
      context.path = ['rewritten']
      seen.push(context.path, Object.getOwnPropertyDescriptor(context, 'path'), { ...context }.path)
      context.path = ['again']
      seen.push(context.path)
      return [{ message: 'found' }]
    }
    const diagnostics = await run(
      { rules: { rewrite: { given: '$.paths.*.get', severity: 'error', then: { function: 'rewrite' } } } },
      { rewrite },
    )
    expect(seen).toEqual([
      ['rewritten'],
      { value: ['rewritten'], writable: true, enumerable: true, configurable: true },
      ['rewritten'],
      ['again'],
    ])
    // The write only changes what the function reads back; the finding stays on the matched node.
    expect(diagnostics.map((d) => d.path)).toEqual([['paths', '/users', 'get']])
  })

  it('keeps an assigned path on the context that assigned it', async () => {
    // The setter lives on the shared prototype, so a write must land on the one
    // context, not the prototype every later context inherits from.
    const seen: JsonPath[] = []
    const rewriteFirst: RulesetFunction = (_input, _options, context) => {
      if (seen.length === 0) context.path = ['rewritten']
      seen.push(context.path)
      return undefined
    }
    await run(
      { rules: { first: { given: '$.paths.*.*', severity: 'error', then: { function: 'rewriteFirst' } } } },
      { rewriteFirst },
    )
    expect(seen).toEqual([['rewritten'], ['paths', '/users', 'post']])
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

  it('reports @key targets on each key', async () => {
    const diagnostics = await run({
      rules: {
        keys: { given: '$.paths./users', severity: 'error', then: { field: '@key', function: 'falsy' } },
        tags: { given: '$', severity: 'error', then: { field: 'openapi', function: 'falsy' } },
      },
    })
    expect(diagnostics.map((d) => [d.code, d.path])).toEqual([
      ['tags', ['openapi']],
      ['keys', ['paths', '/users', 'get']],
      ['keys', ['paths', '/users', 'post']],
    ])
  })

  it('appends a $-field sub-query path to the match path', async () => {
    const diagnostics = await run({
      rules: {
        codes: { given: '$.paths./users', severity: 'error', then: { field: '$..description', function: 'falsy' } },
      },
    })
    expect(diagnostics.map((d) => d.path)).toEqual([
      ['paths', '/users', 'get', 'responses', 200, 'description'],
      ['paths', '/users', 'post', 'responses', 201, 'description'],
    ])
  })

  it('lints the matched value itself when a field meets a primitive', async () => {
    const diagnostics = await run({
      rules: { version: { given: '$.openapi', severity: 'error', then: { field: 'major', function: 'falsy' } } },
    })
    expect(diagnostics.map((d) => d.path)).toEqual([['openapi']])
  })
})
