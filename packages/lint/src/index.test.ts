import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { DiagnosticSeverity, type RulesetDefinition } from './core/types'
import {
  builtinFunctions,
  createFixPlugin,
  createRuleset,
  type FixerRegistry,
  fixDocument,
  lint,
  lintDocument,
  lintDocumentWithResult,
  parseWithPointers,
  query,
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

  it('turns a pathologically nested document into a diagnostic instead of crashing', async () => {
    // 40 KB of brackets used to take the process down with a RangeError, while
    // every other malformed document came back as findings.
    const deep = `${'['.repeat(20_000)}${']'.repeat(20_000)}`
    const results = await lintDocument(deep, { ruleset: REQUIRE_NAME, source: 'deep.json' })
    expect(results).toHaveLength(1)
    expect(results[0]?.message).toContain('maximum nesting depth')
    expect(results[0]?.code).toBe('parser')
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
      [
        'extends: ["./b.yaml"]',
        'functions: ["fnA"]',
        'rules:',
        '  ruleA:',
        '    given: "$.a"',
        '    severity: error',
        '    then: { function: fnA }',
      ].join('\n'),
    )
    writeFileSync(
      join(dir, 'b.yaml'),
      [
        'extends: ["./a.yaml"]',
        'rules:',
        '  ruleB:',
        '    given: "$.b"',
        '    severity: error',
        '    then: { function: truthy }',
      ].join('\n'),
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

  it('reports convergence, and does not converge when two fixers undo each other', async () => {
    const converged = await fixDocument('host: api.example.com/\n', { ruleset, fixers })
    expect(converged.converged).toBe(true)
    expect(converged.passes).toBe(1)

    // `needs-slash` adds the trailing slash back that `no-trailing-slash` removes,
    // so the document never settles. The caller has to be able to tell that apart
    // from a clean fix — and must not be told eleven problems were fixed.
    const oscillating: RulesetDefinition = {
      rules: {
        'no-trailing-slash': {
          given: '$.host',
          severity: 'error',
          then: { function: 'pattern', functionOptions: { notMatch: '/$' } },
        },
        'needs-slash': {
          given: '$.host',
          severity: 'error',
          then: { function: 'pattern', functionOptions: { match: '/$' } },
        },
      },
    }
    const oscillatingFixers: FixerRegistry = {
      ...fixers,
      'needs-slash': {
        fix: ({ diagnostic, data }) => {
          const value = (data as Record<string, unknown>)[diagnostic.path[0] as string]
          if (typeof value !== 'string') return undefined
          return { op: 'setValue', path: diagnostic.path, value: `${value}/` }
        },
      },
    }
    const result = await fixDocument('host: api.example.com/\n', { ruleset: oscillating, fixers: oscillatingFixers })
    expect(result.converged).toBe(false)
    expect(result.passes).toBe(10)
    // One finding, repeatedly re-applied — reported once, not once per pass.
    expect(result.applied).toEqual([
      { code: 'no-trailing-slash', path: ['host'] },
      { code: 'needs-slash', path: ['host'] },
    ])
    expect(result.remaining).toHaveLength(1)
  })
})

describe('ruleset caching', () => {
  it('builds one ruleset per definition and base path', () => {
    const definition: RulesetDefinition = { ...REQUIRE_NAME }
    expect(createRuleset(definition)).toBe(createRuleset(definition))
    expect(createRuleset(definition, tmp('lint-cache-'))).not.toBe(createRuleset(definition))
    // A different definition object is a different ruleset, even with equal content.
    expect(createRuleset({ ...REQUIRE_NAME })).not.toBe(createRuleset(definition))
  })

  it('does not re-read an extends file for every document', async () => {
    const dir = tmp('lint-reread-')
    const file = join(dir, 'base.yaml')
    const rule = (name: string): string =>
      [
        'rules:',
        `  ${name}:`,
        '    given: "$"',
        '    severity: error',
        '    then: { field: title, function: truthy }',
      ].join('\n')
    writeFileSync(file, rule('needs-title'))
    const definition: RulesetDefinition = { extends: ['./base.yaml'] }
    const first = await lintDocument('name: a\n', { ruleset: definition, rulesetBasePath: dir })
    expect(first.map((r) => r.code)).toEqual(['needs-title'])

    // Rewriting the file mid-run must not change what this ruleset does: the
    // rules a run started with are the rules it finishes with.
    writeFileSync(file, rule('renamed-rule'))
    const second = await lintDocument('name: a\n', { ruleset: definition, rulesetBasePath: dir })
    expect(second.map((r) => r.code)).toEqual(['needs-title'])
    // A fresh definition object opts back in to the new file.
    const reloaded = await lintDocument('name: a\n', { ruleset: { extends: ['./base.yaml'] }, rulesetBasePath: dir })
    expect(reloaded.map((r) => r.code)).toEqual(['renamed-rule'])
  })
})

describe('restrictTo', () => {
  it('refuses an extends target that escapes the permitted root', async () => {
    const root = tmp('lint-root-')
    const outside = tmp('lint-outside-')
    mkdirSync(join(root, 'rules'))
    writeFileSync(join(outside, 'evil.yaml'), 'rules: {}\n')
    writeFileSync(
      join(root, 'rules', 'ok.yaml'),
      [
        'rules:',
        '  needs-title:',
        '    given: "$"',
        '    severity: error',
        '    then: { field: title, function: truthy }',
      ].join('\n'),
    )

    // Inside the root: fine.
    const inside = await lintDocument('name: a\n', {
      ruleset: { extends: ['./rules/ok.yaml'] },
      rulesetBasePath: root,
      restrictTo: root,
    })
    expect(inside.map((r) => r.code)).toEqual(['needs-title'])

    // Absolute escape and `../` escape are both refused.
    await expect(
      lintDocument('name: a\n', {
        ruleset: { extends: [join(outside, 'evil.yaml')] },
        rulesetBasePath: root,
        restrictTo: root,
      }),
    ).rejects.toThrow(/outside the permitted root/)
    await expect(
      lintDocument('name: a\n', {
        ruleset: { extends: [`../${basename(outside)}/evil.yaml`] },
        rulesetBasePath: root,
        restrictTo: root,
      }),
    ).rejects.toThrow(/outside the permitted root/)
  })

  it('refuses a custom function outside the permitted root, and is off by default', async () => {
    const root = tmp('lint-fnroot-')
    const outside = tmp('lint-fnout-')
    writeFileSync(join(outside, 'shout.cjs'), 'module.exports = () => []\n')
    const definition = (): RulesetDefinition => ({
      functions: ['shout'],
      functionsDir: join(outside),
      rules: { quiet: { given: '$', severity: 'error', then: { function: 'shout' } } },
    })
    // Without a root, reaching outside the ruleset directory is allowed (and is
    // exactly why the boundary is documented).
    await expect(lintDocument('a: 1\n', { ruleset: definition(), rulesetBasePath: root })).resolves.toHaveLength(0)
    await expect(
      lintDocument('a: 1\n', { ruleset: definition(), rulesetBasePath: root, restrictTo: root }),
    ).rejects.toThrow(/outside the permitted root/)
  })
})
