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
})
