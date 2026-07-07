import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { discoverRuleset, loadRuleset } from './ruleset-loader'
import { run } from './run'

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
    const { stdout } = await run([doc, '-r', join(dir, '.lint.yaml')])
    expect(stdout).toContain('needs-title')
  })
})

describe('cli', () => {
  it('exits 1 and reports findings for a document that violates an error rule', async () => {
    const dir = tmp('lint-cli-')
    writeFileSync(join(dir, '.lint.yaml'), RULESET)
    const file = join(dir, 'doc.yaml')
    writeFileSync(file, 'version: 1\n') // no `name` -> require-name (error)
    const { stdout, code } = await run([file])
    expect(code).toBe(1)
    expect(stdout).toContain('require-name')
    expect(stdout).toContain('error')
  })

  it('exits 0 and reports no problems for a clean document', async () => {
    const dir = tmp('lint-cli-')
    writeFileSync(join(dir, '.lint.yaml'), RULESET)
    const file = join(dir, 'doc.yaml')
    writeFileSync(file, 'name: my-service\n')
    const { stdout, code } = await run([file])
    expect(code).toBe(0)
    expect(stdout).toContain('No problems found')
  })

  it('points each finding at its exact file:line:col', async () => {
    const dir = tmp('lint-loc-')
    writeFileSync(join(dir, '.lint.yaml'), RULESET)
    const file = join(dir, 'doc.yaml')
    writeFileSync(file, 'name: MyService\n') // not kebab-case -> name-kebab (warn) on the value
    const { stdout, code } = await run([file])
    expect(code).toBe(0) // a warning does not fail by default
    // `MyService` starts at line 1, column 7 (1-based).
    expect(stdout).toContain(`${file}:1:7`)
    expect(stdout).toContain('name-kebab')
  })

  it('lints stdin with --stdin-filepath and discovers a ruleset from its dir', async () => {
    const dir = tmp('lint-stdin-')
    writeFileSync(join(dir, '.lint.yaml'), RULESET)
    const { stdout } = await run(['--stdin-filepath', join(dir, 'doc.yaml')], { stdin: 'version: 1\n' })
    expect(stdout).toContain('require-name')
  })

  it('lints multiple files (parallel) and includes findings from each', async () => {
    const dir = tmp('lint-many-')
    writeFileSync(join(dir, '.lint.yaml'), RULESET)
    for (let i = 0; i < 6; i++) writeFileSync(join(dir, `doc${i}.yaml`), 'version: 1\n')
    const { stdout } = await run([join(dir, 'doc*.yaml')])
    // Every file contributed a finding (require-name is missing on each).
    for (let i = 0; i < 6; i++) expect(stdout).toContain(`doc${i}.yaml`)
  })

  it('suppresses the report under --quiet but keeps the exit code', async () => {
    const dir = tmp('lint-quiet-')
    writeFileSync(join(dir, '.lint.yaml'), RULESET)
    const file = join(dir, 'doc.yaml')
    writeFileSync(file, 'version: 1\n')
    const { stdout, code } = await run([file, '-q'])
    expect(code).toBe(1)
    expect(stdout).toBe('')
  })

  it('warns about a structurally invalid ruleset on stderr without crashing', async () => {
    const dir = tmp('lint-badrs-')
    const file = join(dir, 'doc.yaml')
    writeFileSync(file, 'name: my-service\n')
    const rs = join(dir, 'bad.json')
    // `then` is missing its function — validateRuleset should warn (non-fatal).
    writeFileSync(rs, JSON.stringify({ rules: { broken: { given: '$' } } }))
    const { code, stderr } = await run([file, '-r', rs])
    expect(stderr).toContain('ruleset')
    expect(code).not.toBe(2)
  })
})
