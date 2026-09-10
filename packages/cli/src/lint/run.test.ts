import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
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

// Valid enough to lint, sparse enough to draw preset findings — proving a
// preset's own rules actually ran rather than an empty ruleset reporting nothing.
const ASYNCAPI_DOC = [
  'asyncapi: 2.6.0',
  'info:',
  '  title: Sparse',
  '  version: 1.0.0',
  'channels:',
  '  events: {}',
  '',
].join('\n')

const OPENAPI_DOC = ['openapi: 3.1.0', 'info:', '  title: Sparse', '  version: 1.0.0', 'paths: {}', ''].join('\n')

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

  // The failure this pins: with no TTY (CI) an empty stdin pipe made a typo'd path
  // lint an empty document, print "No problems found", and exit 0 — a lint gate
  // that silently passes. `stdin` is supplied here to stand in for that pipe.
  it('exits non-zero when the document arguments match no files', async () => {
    const dir = tmp('lint-nomatch-')
    const { code, stdout, stderr } = await run([join(dir, 'typo-path/**/*.yaml')], { stdin: '' })

    expect(code).toBe(2)
    expect(stdout).toBe('')
    expect(stderr).toContain('No files matched:')
  })

  it('still lints stdin when no document arguments were given at all', async () => {
    const dir = tmp('lint-stdin2-')
    writeFileSync(join(dir, '.lint.yaml'), RULESET)
    const { code, stdout } = await run(['--stdin-filepath', join(dir, 'doc.yaml')], { stdin: 'name: my-service\n' })

    expect(code).toBe(0)
    expect(stdout).toContain('No problems found')
  })

  // Without `.strict()` a mistyped flag was dropped and the run used the defaults
  // while reporting success — the same class of silent miss as the one above.
  it('rejects an unknown flag instead of linting with the defaults', async () => {
    const dir = tmp('lint-strict-')
    const file = join(dir, 'doc.yaml')
    writeFileSync(file, 'name: my-service\n')

    const { code, stdout, stderr } = await run([file, '--bogus-flag', 'xyz'])

    expect(code).toBe(2)
    expect(stdout).toBe('')
    expect(stderr).toContain('Unknown argument')
  })

  it('rejects a mistyped value for a known flag', async () => {
    const dir = tmp('lint-choice-')
    const file = join(dir, 'doc.yaml')
    writeFileSync(file, 'name: my-service\n')

    const { code, stderr } = await run([file, '--fail-severity', 'wrn'])

    expect(code).toBe(2)
    expect(stderr).toContain('fail-severity')
  })

  it('reports a non-numeric --concurrency instead of crashing on Invalid array length', async () => {
    const dir = tmp('lint-conc-bad-')
    const file = join(dir, 'doc.yaml')
    writeFileSync(file, 'name: my-service\n')

    const { code, stderr } = await run([file, '--concurrency', 'abc'])

    expect(code).toBe(2)
    expect(stderr).toContain('Invalid --concurrency value')
  })

  it('keeps the documents positional working under strict parsing', async () => {
    const dir = tmp('lint-pos-')
    writeFileSync(join(dir, '.lint.yaml'), RULESET)
    for (let i = 0; i < 2; i++) writeFileSync(join(dir, `doc${i}.yaml`), 'version: 1\n')

    const { code, stdout } = await run([join(dir, 'doc0.yaml'), join(dir, 'doc1.yaml')])

    expect(code).toBe(1)
    expect(stdout).toContain('doc0.yaml')
    expect(stdout).toContain('doc1.yaml')
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

  it('resolves --ruleset asyncapi to the built-in preset', async () => {
    const dir = tmp('lint-aas-')
    const file = join(dir, 'doc.yaml')
    writeFileSync(file, ASYNCAPI_DOC)

    const { code, stdout } = await run([file, '--ruleset', 'asyncapi'])

    expect(code).not.toBe(2)
    expect(stdout).not.toContain('No problems found')
    expect(stdout).toContain('asyncapi')
  })

  it('resolves --ruleset oas to the built-in OpenAPI preset', async () => {
    const dir = tmp('lint-oas-')
    const file = join(dir, 'doc.yaml')
    writeFileSync(file, OPENAPI_DOC)

    const { code, stdout } = await run([file, '--ruleset', 'oas'])

    expect(code).not.toBe(2)
    expect(stdout).not.toContain('No problems found')
  })

  it('still treats an unknown --ruleset value as a file path', async () => {
    const dir = tmp('lint-missing-rs-')
    const file = join(dir, 'doc.yaml')
    writeFileSync(file, 'name: my-service\n')

    await expect(run([file, '--ruleset', join(dir, 'nope.yaml')])).rejects.toThrow()
  })

  // A ruleset file that extends a preset used to die with "Cannot resolve
  // extended ruleset" — only the bare `--ruleset asyncapi` name reached the
  // preset builder, so a loaded definition was built with the core
  // `createRuleset`, which knows none of the preset names.
  it('runs a discovered ruleset that extends the asyncapi preset', async () => {
    const dir = tmp('lint-ext-aas-')
    const file = join(dir, 'doc.yaml')
    writeFileSync(file, ASYNCAPI_DOC)
    writeFileSync(join(dir, '.lint.yaml'), 'extends:\n  - asyncapi\n')

    const extended = await run([file])
    const preset = await run([file, '--ruleset', 'asyncapi'])

    // Extending the preset has to be indistinguishable from naming it.
    expect(extended.stdout).toBe(preset.stdout)
    expect(extended.stdout).toContain('asyncapi-')
  })

  it('runs a discovered ruleset that extends the oas preset', async () => {
    const dir = tmp('lint-ext-oas-')
    const file = join(dir, 'doc.yaml')
    writeFileSync(file, OPENAPI_DOC)
    writeFileSync(join(dir, '.lint.yaml'), 'extends:\n  - oas\n')

    const extended = await run([file])
    const preset = await run([file, '--ruleset', 'oas'])

    expect(extended.stdout).toBe(preset.stdout)
    expect(extended.stdout).not.toContain('No problems found')
  })

  it('runs a --ruleset file that extends a preset under an alias name', async () => {
    const dir = tmp('lint-ext-alias-')
    const file = join(dir, 'doc.yaml')
    writeFileSync(file, ASYNCAPI_DOC)
    const rs = join(dir, 'rules.yaml')
    writeFileSync(rs, 'extends:\n  - spectral:asyncapi\n')

    const { stdout } = await run([file, '-r', rs])

    expect(stdout).toContain('asyncapi-')
  })

  // `[[asyncapi, all]]` is the tuple shape of `extends`; the preset name sits in
  // the first slot rather than being the entry itself.
  it('recognizes a preset named in an [name, level] extends tuple', async () => {
    const dir = tmp('lint-ext-tuple-')
    const file = join(dir, 'doc.yaml')
    writeFileSync(file, ASYNCAPI_DOC)
    writeFileSync(join(dir, '.lint.yaml'), 'extends:\n  - [asyncapi, all]\n')

    const { stdout } = await run([file])

    expect(stdout).toContain('asyncapi-')
  })

  it('runs both the preset rules and the ruleset own rules when extending a preset', async () => {
    const dir = tmp('lint-ext-own-')
    const file = join(dir, 'doc.yaml')
    writeFileSync(file, ASYNCAPI_DOC)
    writeFileSync(
      join(dir, '.lint.yaml'),
      [
        'extends:',
        '  - asyncapi',
        'rules:',
        '  needs-terms-of-service:',
        '    given: "$.info"',
        '    severity: error',
        '    then: { field: termsOfService, function: truthy }',
        '',
      ].join('\n'),
    )

    const { stdout, code } = await run([file])

    expect(stdout).toContain('asyncapi-info-contact') // a preset rule
    expect(stdout).toContain('needs-terms-of-service') // the ruleset's own rule
    expect(code).toBe(1)
  })

  // The preset builder loads custom functions relative to the ruleset that
  // declared them, so `basePath` has to survive the switch to that builder.
  it('loads a custom function next to a ruleset that extends a preset', async () => {
    const dir = tmp('lint-ext-fn-')
    mkdirSync(join(dir, 'functions'))
    writeFileSync(
      join(dir, 'functions', 'must-shout.cjs'),
      "module.exports = (input) => (input === String(input).toUpperCase() ? undefined : [{ message: 'must be SHOUTED' }])\n",
    )
    const file = join(dir, 'doc.yaml')
    writeFileSync(file, ASYNCAPI_DOC)
    writeFileSync(
      join(dir, '.lint.yaml'),
      [
        'extends:',
        '  - asyncapi',
        'functions:',
        '  - must-shout',
        'rules:',
        '  shout-title:',
        '    given: "$.info.title"',
        '    severity: error',
        '    then: { function: must-shout }',
        '',
      ].join('\n'),
    )

    const { stdout } = await run([file])

    expect(stdout).toContain('must be SHOUTED')
    expect(stdout).toContain('asyncapi-') // the preset still ran alongside it
  })

  // Neither preset can resolve the other's name, so the deep resolver failure
  // ("Cannot resolve extended ruleset \"oas\"") would be a riddle. Say what is
  // wrong instead.
  it('refuses a ruleset that extends both presets with an actionable error', async () => {
    const dir = tmp('lint-ext-both-')
    const file = join(dir, 'doc.yaml')
    writeFileSync(file, ASYNCAPI_DOC)
    const rs = join(dir, '.lint.yaml')
    writeFileSync(rs, 'extends:\n  - asyncapi\n  - oas\n')

    await expect(run([file])).rejects.toThrow(/extends both built-in presets/)
    await expect(run([file])).rejects.toThrow(rs)
  })

  // Everything `extends` could name before still resolves through the core path.
  it('keeps a discovered ruleset that extends a plain relative file working', async () => {
    const dir = tmp('lint-ext-plain-')
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
    const file = join(dir, 'doc.yaml')
    writeFileSync(file, 'name: my-service\n')

    const { stdout, code } = await run([file])

    expect(stdout).toContain('needs-title')
    expect(code).toBe(1)
  })
})
