import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  builtinFunctions,
  createFixPlugin,
  createRuleset,
  DiagnosticSeverity,
  type FixerRegistry,
  fixDocument,
  lint,
  lintDocument,
  lintDocumentWithResult,
  parseWithPointers,
  query,
  type RulesetDefinition,
  resolveNamedRuleset,
  validateRuleset,
} from './index'

const tmp = (prefix: string): string => mkdtempSync(join(tmpdir(), prefix))

// A ruleset with one error rule (a required field via `truthy`) reused across cases.
const REQUIRE_NAME: RulesetDefinition = {
  rules: {
    'require-name': { given: '$', severity: 'error', then: { field: 'name', function: 'truthy' } },
  },
}

describe('@amritk/lint public surface', () => {
  it('re-exports the documented API from one entry point', () => {
    for (const fn of [
      lintDocument,
      lintDocumentWithResult,
      fixDocument,
      createRuleset,
      resolveNamedRuleset,
      createFixPlugin,
      validateRuleset,
      query,
      lint,
      parseWithPointers,
    ]) {
      expect(typeof fn).toBe('function')
    }
    // The engine, functions, and fix subsystems are all reachable from `@amritk/lint`.
    expect(DiagnosticSeverity.Error).toBe(0)
    expect(typeof builtinFunctions['truthy']).toBe('function')
    expect(typeof builtinFunctions['schema']).toBe('function')
    expect(typeof builtinFunctions['casing']).toBe('function')
  })
})

describe('lintDocument', () => {
  it('reports a finding at its source location for a violated rule', async () => {
    const results = await lintDocument('version: 1\n', { ruleset: REQUIRE_NAME, source: 'doc.yaml' })
    expect(results).toHaveLength(1)
    expect(results[0]?.code).toBe('require-name')
    expect(results[0]?.path).toEqual(['name'])
    expect(results[0]?.source).toBe('doc.yaml')
  })

  it('produces no findings for a clean document', async () => {
    const results = await lintDocument('name: my-service\n', { ruleset: REQUIRE_NAME })
    expect(results).toHaveLength(0)
  })

  it('validates against a JSON Schema via the built-in `schema` function', async () => {
    const ruleset: RulesetDefinition = {
      rules: {
        'config-schema': {
          given: '$',
          severity: 'error',
          then: {
            function: 'schema',
            functionOptions: { schema: { type: 'object', properties: { port: { type: 'integer' } } } },
          },
        },
      },
    }
    const results = await lintDocument('port: not-a-number\n', { ruleset })
    expect(results.map((r) => r.code)).toContain('config-schema')
  })
})

describe('lintDocumentWithResult', () => {
  it('returns diagnostics plus (empty) plugin data when no plugins run', async () => {
    const result = await lintDocumentWithResult('version: 1\n', { ruleset: REQUIRE_NAME })
    expect(result.diagnostics.map((r) => r.code)).toContain('require-name')
    expect(result.pluginData).toEqual({})
    expect(result.output).toBeUndefined()
  })
})

describe('createRuleset', () => {
  it('layers the built-in functions so a ruleset can invoke them by name', () => {
    const ruleset = createRuleset(REQUIRE_NAME)
    expect(ruleset.getFunction('truthy')).toBeDefined()
    expect(ruleset.getFunction('schema')).toBeDefined()
    expect(ruleset.enabledRules.map((r) => r.name)).toContain('require-name')
  })

  it('loads a custom function by name relative to the ruleset directory', async () => {
    const dir = tmp('lint-fn-')
    mkdirSync(join(dir, 'functions'))
    writeFileSync(
      join(dir, 'functions', 'upper.cjs'),
      "module.exports = (input) => (typeof input === 'string' && input === input.toUpperCase() ? [] : [{ message: 'must be uppercase' }])\n",
    )
    const ruleset: RulesetDefinition = {
      functions: ['upper'],
      rules: { 'name-upper': { given: '$.name', severity: 'error', then: { function: 'upper' } } },
    }
    const bad = await lintDocument('name: abc\n', { ruleset, rulesetBasePath: dir })
    expect(bad.map((r) => r.code)).toContain('name-upper')
    const ok = await lintDocument('name: ABC\n', { ruleset, rulesetBasePath: dir })
    expect(ok.map((r) => r.code)).not.toContain('name-upper')
  })

  it('terminates on a circular extends between ruleset files (no stack overflow)', async () => {
    // a.yaml and b.yaml extend each other; the cycle must be broken while still
    // loading a custom function declared in the cycle.
    const dir = tmp('lint-cycle-')
    mkdirSync(join(dir, 'functions'))
    writeFileSync(
      join(dir, 'functions', 'fnA.cjs'),
      "module.exports = (input) => (input ? [] : [{ message: 'needs value' }])\n",
    )
    writeFileSync(
      join(dir, 'a.yaml'),
      ['extends: ["./b.yaml"]', 'functions: ["fnA"]', 'rules:', '  ruleA:', '    given: "$.a"', '    severity: error', '    then: { function: fnA }'].join('\n'),
    )
    writeFileSync(
      join(dir, 'b.yaml'),
      ['extends: ["./a.yaml"]', 'rules:', '  ruleB:', '    given: "$.b"', '    severity: error', '    then: { function: truthy }'].join('\n'),
    )
    const ruleset = createRuleset({ extends: ['./a.yaml'] }, dir)
    expect(ruleset.rules.map((r) => r.name).sort()).toEqual(['ruleA', 'ruleB'])
    // The custom function from inside the cycle is available.
    expect(ruleset.getFunction('fnA')).toBeDefined()
    const results = await lintDocument('a: 0\nb: 0\n', { ruleset: { extends: ['./a.yaml'] }, rulesetBasePath: dir })
    expect(results.map((r) => r.code).sort()).toEqual(['ruleA', 'ruleB'])
  })

  it('resolves an `extends` reference to a local ruleset file', async () => {
    const dir = tmp('lint-ext-')
    writeFileSync(
      join(dir, 'base.yaml'),
      [
        'rules:',
        '  needs-title:',
        '    given: "$"',
        '    severity: error',
        '    then: { field: title, function: truthy }',
      ].join('\n'),
    )
    const results = await lintDocument('name: my-service\n', {
      ruleset: { extends: ['./base.yaml'] },
      rulesetBasePath: dir,
    })
    expect(results.map((r) => r.code)).toContain('needs-title')
  })
})

describe('resolveNamedRuleset', () => {
  it('loads a local ruleset file by relative path', () => {
    const dir = tmp('lint-rn-')
    writeFileSync(join(dir, 'rs.json'), JSON.stringify(REQUIRE_NAME))
    const resolved = resolveNamedRuleset('./rs.json', dir)
    expect(resolved.definition.rules?.['require-name']).toBeDefined()
    expect(resolved.basePath).toBe(dir)
  })

  it('throws on an unresolvable bare specifier', () => {
    expect(() => resolveNamedRuleset('@amritk/this-package-does-not-exist', process.cwd())).toThrow(
      /Cannot resolve extended ruleset/,
    )
  })
})

describe('fixDocument', () => {
  // A rule that flags a trailing slash, paired with a fixer that removes it.
  const ruleset: RulesetDefinition = {
    rules: {
      'no-trailing-slash': {
        given: '$.host',
        severity: 'error',
        then: { function: 'pattern', functionOptions: { notMatch: '/$' } },
      },
    },
  }
  const fixers: FixerRegistry = {
    'no-trailing-slash': {
      fix: ({ diagnostic, data }) => {
        const value = (data as Record<string, unknown>)[diagnostic.path[0] as string]
        if (typeof value !== 'string') return undefined
        return { op: 'setValue', path: diagnostic.path, value: value.replace(/\/$/, '') }
      },
    },
  }

  it('applies fixers to a fixpoint and re-lints the remaining findings', async () => {
    const result = await fixDocument('host: api.example.com/\n', { ruleset, fixers, source: 'doc.yaml' })
    expect(result.fixed).toBe(true)
    expect(result.output).toBe('host: api.example.com\n')
    expect(result.applied).toEqual([{ code: 'no-trailing-slash', path: ['host'] }])
    expect(result.remaining).toHaveLength(0)
  })

  it('is a no-op with the default (empty) fixer registry', async () => {
    const input = 'host: api.example.com/\n'
    const result = await fixDocument(input, { ruleset, source: 'doc.yaml' })
    expect(result.fixed).toBe(false)
    expect(result.output).toBe(input)
    // The finding is still reported (nothing fixed it), proving the pipeline ran.
    expect(result.remaining.map((r) => r.code)).toContain('no-trailing-slash')
  })
})
