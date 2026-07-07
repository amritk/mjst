import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { run } from '../src/index'
import { discoverRuleset, loadRuleset } from '../src/ruleset-loader'

// A generic (non-OpenAPI) ruleset over an arbitrary config document: a required
// field (`name`) via `truthy`, and a kebab-case style rule via `casing`.
const RULESET = [
  'rules:',
  '  require-name:',
  '    given: "$"',
  '    severity: error',
  '    then: { field: name, function: truthy }',
  '  name-kebab:',
  '    given: "$.name"',
  '    severity: warn',
  '    then: { function: casing, functionOptions: { type: kebab } }',
].join('\n')

const tmp = (prefix: string): string => mkdtempSync(join(tmpdir(), prefix))

describe('ruleset-loader', () => {
  it('discovers a .lint.* ruleset by walking up from a directory', () => {
    const dir = tmp('lint-rs-')
    writeFileSync(join(dir, '.lint.yaml'), RULESET)
    expect(discoverRuleset(dir)).toBe(join(dir, '.lint.yaml'))
  })

  it('parses a JSON ruleset', async () => {
    const dir = tmp('lint-rs-')
    const file = join(dir, '.lint.json')
    writeFileSync(file, JSON.stringify({ rules: { 'require-name': { given: '$', then: { function: 'truthy' } } } }))
    const definition = await loadRuleset(file)
    expect(definition.rules?.['require-name']).toBeDefined()
  })

  it('extends a local ruleset file resolved relative to the ruleset', async () => {
    const dir = tmp('lint-ext-')
    // base.yaml lives next to the ruleset and is referenced by a relative path.
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
    writeFileSync(join(dir, '.lint.yaml'), 'extends:\n  - ./base.yaml\n')
    const doc = join(dir, 'doc.yaml')
    writeFileSync(doc, 'name: my-service\n')
    const { stdout } = await run([doc, '-r', join(dir, '.lint.yaml'), '-f', 'json'])
    const codes = JSON.parse(stdout).map((r: { code: string }) => r.code)
    expect(codes).toContain('needs-title')
  })
})

describe('cli', () => {
  it('exits 1 and reports findings for a document that violates an error rule', async () => {
    const dir = tmp('lint-cli-')
    writeFileSync(join(dir, '.lint.yaml'), RULESET)
    const file = join(dir, 'doc.yaml')
    writeFileSync(file, 'version: 1\n') // no `name` -> require-name (error)
    const { stdout, code } = await run([file, '-f', 'json'])
    expect(code).toBe(1)
    expect(JSON.parse(stdout).map((r: { code: string }) => r.code)).toContain('require-name')
  })

  it('exits 0 for a clean document (warnings do not fail by default)', async () => {
    const dir = tmp('lint-cli-')
    writeFileSync(join(dir, '.lint.yaml'), RULESET)
    const file = join(dir, 'doc.yaml')
    writeFileSync(file, 'name: my-service\n')
    const { code } = await run([file])
    expect(code).toBe(0)
  })

  it('reports a warning-level finding without failing the run', async () => {
    const dir = tmp('lint-cli-')
    writeFileSync(join(dir, '.lint.yaml'), RULESET)
    const file = join(dir, 'doc.yaml')
    writeFileSync(file, 'name: MyService\n') // not kebab-case -> name-kebab (warn)
    const { stdout, code } = await run([file, '-f', 'json'])
    expect(code).toBe(0)
    expect(JSON.parse(stdout).map((r: { code: string }) => r.code)).toContain('name-kebab')
  })

  it('writes each --format to the --output at the same position', async () => {
    const dir = tmp('lint-out-')
    writeFileSync(join(dir, '.lint.yaml'), RULESET)
    const file = join(dir, 'doc.yaml')
    writeFileSync(file, 'version: 1\n')
    const jsonOut = join(dir, 'out.json')
    const stylishOut = join(dir, 'out.txt')
    await run([file, '-f', 'json', '-f', 'stylish', '-o', jsonOut, '-o', stylishOut])
    // Each output file must hold its own format — the json file is parseable JSON,
    // and the stylish file is not (regression test for the overwrite bug).
    expect(() => JSON.parse(readFileSync(jsonOut, 'utf8'))).not.toThrow()
    expect(() => JSON.parse(readFileSync(stylishOut, 'utf8'))).toThrow()
  })

  it('lints stdin with --stdin-filepath and discovers a ruleset from its dir', async () => {
    const dir = tmp('lint-stdin-')
    writeFileSync(join(dir, '.lint.yaml'), RULESET)
    const { stdout } = await run(['--stdin-filepath', join(dir, 'doc.yaml'), '-f', 'json'], { stdin: 'version: 1\n' })
    const codes = JSON.parse(stdout).map((r: { code: string }) => r.code)
    expect(codes).toContain('require-name')
  })

  it('lints multiple files (parallel) and includes findings from each', async () => {
    const dir = tmp('lint-many-')
    writeFileSync(join(dir, '.lint.yaml'), RULESET)
    for (let i = 0; i < 6; i++) writeFileSync(join(dir, `doc${i}.yaml`), 'version: 1\n')
    const { stdout } = await run([join(dir, 'doc*.yaml'), '-f', 'json'])
    const results = JSON.parse(stdout) as { source?: string }[]
    // Every file contributed a finding (require-name is missing on each).
    expect(new Set(results.map((r) => r.source)).size).toBe(6)
  })

  it('warns about a structurally invalid ruleset on stderr without crashing', async () => {
    const dir = tmp('lint-badrs-')
    const file = join(dir, 'doc.yaml')
    writeFileSync(file, 'name: my-service\n')
    const rs = join(dir, 'bad.json')
    // `then` is missing its function — validateRuleset should warn (non-fatal).
    writeFileSync(rs, JSON.stringify({ rules: { broken: { given: '$' } } }))
    const { code, stderr } = await run([file, '-r', rs, '-f', 'json'])
    expect(stderr).toContain('ruleset')
    expect(code).not.toBe(2)
  })
})
