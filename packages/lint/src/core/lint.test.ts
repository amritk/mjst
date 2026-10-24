import { describe, expect, it } from 'vitest'

import { builtinFunctions } from '../functions'
import { parseWithPointers } from '../parsers'
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

  it('ignores a parserOptions severity naming a prototype member', async () => {
    // `parserOptions` is ruleset input, so a bare index resolved `'constructor'`
    // to `Object` itself and handed that to the parser as a severity. An
    // unrecognized name has to fall through to the parser's own default instead.
    const ruleset = build({
      ...NOOP,
      parserOptions: { duplicateKeys: 'constructor' as never },
    })
    const { diagnostics } = await lintWithResult('a: 1\na: 2\n', { ruleset })
    const parserFinding = diagnostics.find((d) => d.code === 'parser')
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

  it('lints pre-parsed data with the same findings and ranges as the text', async () => {
    const ruleset = build({
      rules: {
        'no-x-objects': { given: '$..[?(@ && @.x)]', severity: 'warn', then: { function: 'falsy' } },
        'needs-name': { given: '$', severity: 'error', then: { field: 'name', function: 'truthy' } },
      },
    })
    const json = JSON.stringify({ a: { x: 1 }, b: [{ x: true }, { y: 2 }], '200': { x: 'y' } }, null, 2)
    const yaml = 'a:\n  x: 1\nb:\n  - x: true\n  - y: 2\n'
    for (const text of [json, yaml]) {
      const fromText = await lintWithResult(text, { ruleset, source: 'doc' })
      const data = parseWithPointers(text).data
      const fromData = await lintWithResult({ data, text }, { ruleset, source: 'doc' })
      expect(fromData.diagnostics).toEqual(fromText.diagnostics)
      expect(fromData.diagnostics.length).toBeGreaterThan(1)
    }
  })

  it('reports zero ranges for data linted without its text', async () => {
    const ruleset = build({
      rules: { 'needs-name': { given: '$', severity: 'error', then: { field: 'name', function: 'truthy' } } },
    })
    const { diagnostics } = await lintWithResult({ data: { version: 1 } }, { ruleset })
    expect(diagnostics.map((d) => [d.code, d.path, d.range])).toEqual([
      ['needs-name', ['name'], { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } }],
    ])
  })

  it('places a finding on a path the text lacks at its closest ancestor', async () => {
    // The caller normalized the data, adding a node the source never had.
    const ruleset = build({
      rules: { 'no-added': { given: '$.info.added', severity: 'error', then: { function: 'falsy' } } },
    })
    const text = '{\n  "info": {\n    "title": "t"\n  }\n}'
    const { diagnostics } = await lintWithResult({ data: { info: { title: 't', added: true } }, text }, { ruleset })
    expect(diagnostics[0]?.range).toEqual({ start: { line: 1, character: 10 }, end: { line: 3, character: 3 } })
  })

  it('refuses plugins when given data without its text', async () => {
    await expect(
      lintWithResult({ data: {} }, { ruleset: build(NOOP), plugins: [{ name: 'p', afterLint: () => undefined }] }),
    ).rejects.toThrow('Plugins need the document text')
  })

  it('keeps a rule with `descent: schema` out of example payloads', async () => {
    const given = "$.components.schemas..[?(@ && @.type === 'object' && @.properties === undefined)]"
    const document = JSON.stringify({
      components: {
        schemas: {
          Event: {
            type: 'object',
            properties: { payload: { type: 'object' } },
            examples: [[1, 2, 3, 4, 5, 6, { properties: [{ type: 'object' }] }]],
          },
        },
      },
    })
    const rule = { given, severity: 'warn' as const, then: { function: 'falsy' } }
    const everywhere = await lintWithResult(document, { ruleset: build({ rules: { r: rule } }) })
    const schemaOnly = await lintWithResult(document, {
      ruleset: build({ rules: { r: { ...rule, descent: 'schema' } } }),
    })
    expect(everywhere.diagnostics.map((d) => d.path.join('/'))).toEqual([
      'components/schemas/Event/properties/payload',
      'components/schemas/Event/examples/0/6/properties/0',
    ])
    expect(schemaOnly.diagnostics.map((d) => d.path.join('/'))).toEqual(['components/schemas/Event/properties/payload'])
  })

  it('reports every route through objects the caller shared, with no resolver', async () => {
    // Without a resolver nothing says the sharing came from a `$ref`, so each route
    // is its own authored path and keeps its own finding.
    const shared = { description: 'eval(1)' }
    // One key under two parents: the walk enters `shared` the same way both times.
    const data = { a: { s: shared }, b: { s: shared } }
    const ruleset = build({
      rules: {
        'no-eval': {
          given: '$..description',
          resolved: true,
          severity: 'error',
          then: { function: 'pattern', functionOptions: { notMatch: 'eval\\(' } },
        },
      },
    })
    const { diagnostics } = await lintWithResult({ data }, { ruleset })
    expect(diagnostics.map((d) => d.path.join('/'))).toEqual(['a/s/description', 'b/s/description'])
  })

  it('reports a node a cross-document ref inlined at every ref site when there is no source set', async () => {
    // Without a source set a finding inside another document is located at the
    // `$ref` that reached it, so the two ref sites are two findings, not one.
    const source = JSON.stringify({ a: { schema: { $ref: './pet.json' } }, b: { schema: { $ref: './pet.json' } } })
    const pet = { type: 'object' }
    const resolve = () => ({ resolved: { a: { schema: pet }, b: { schema: pet } } })
    const ruleset = build({
      rules: {
        'no-object': {
          given: '$..type',
          resolved: true,
          severity: 'error',
          then: { function: 'pattern', functionOptions: { notMatch: '^object$' } },
        },
      },
    })
    const { diagnostics } = await lintWithResult(source, { ruleset, resolve })
    expect(diagnostics.map((d) => d.path.join('/'))).toEqual(['a/schema/type', 'b/schema/type'])
  })

  it('checks every route when a cross-document ref site is gone from the resolved tree', async () => {
    // The resolver merged `a` into an `allOf`, so nothing says what it inlined at
    // `a/b`: routes are checked rather than assumed to be one finding, and the node
    // shared by an internal ref is still reported once.
    const source = JSON.stringify({
      a: { b: { $ref: './x.json' } },
      c: { s: { type: 'object' } },
      d: { s: { $ref: '#/c/s' } },
    })
    const shared = { type: 'object' }
    const resolve = () => ({ resolved: { a: { allOf: [{ b: {} }] }, c: { s: shared }, d: { s: shared } } })
    const ruleset = build({
      rules: {
        'no-object': {
          given: '$..type',
          resolved: true,
          severity: 'error',
          then: { function: 'pattern', functionOptions: { notMatch: '^object$' } },
        },
      },
    })
    const { diagnostics } = await lintWithResult(source, { ruleset, resolve })
    expect(diagnostics.map((d) => d.path.join('/'))).toEqual(['c/s/type'])
  })

  it('reports a shared node once and fast when references layer on each other', async () => {
    // Each schema references the next twice, so the resolved tree has 2^30 routes to the
    // last one. Every route translates back to the same authored node, so walking each
    // would only produce duplicates — and would not finish.
    const schemas: Record<string, unknown> = { L30: { description: 'eval(1)' } }
    for (let i = 0; i < 30; i++) {
      const next = { $ref: `#/components/schemas/L${i + 1}` }
      schemas[`L${i}`] = { properties: { left: next, right: next } }
    }
    const source = JSON.stringify({ openapi: '3.1.0', components: { schemas } })
    // Inlines each reference as one shared object, the way `@amritk/resolve-refs` does.
    const resolve = (document: { data: unknown }) => {
      const inlined = new Map<string, unknown>()
      const visit = (value: unknown): unknown => {
        if (Array.isArray(value)) return value.map(visit)
        if (typeof value !== 'object' || value === null) return value
        const ref = (value as { $ref?: unknown }).$ref
        if (typeof ref === 'string') {
          const name = ref.slice('#/components/schemas/'.length)
          if (!inlined.has(name)) inlined.set(name, visit(schemas[name]))
          return inlined.get(name)
        }
        return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, visit(child)]))
      }
      return { resolved: visit(document.data) }
    }
    const ruleset = build({
      rules: {
        'no-eval': {
          given: '$..description',
          resolved: true,
          severity: 'error',
          then: { function: 'pattern', functionOptions: { notMatch: 'eval\\(' } },
        },
      },
    })
    const { diagnostics } = await lintWithResult(source, { ruleset, resolve })
    expect(diagnostics.map((d) => d.path.join('/'))).toEqual(['components/schemas/L30/description'])
  })
})
