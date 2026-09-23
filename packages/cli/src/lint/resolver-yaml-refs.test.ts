import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { run } from './run'

/** A `resolved: true` rule on `given`, so it only matches once the `$ref` behind it inlines. */
const ruleset = (given = '$.config.name'): string =>
  [
    'rules:',
    '  config-name-kebab:',
    `    given: "${given}"`,
    '    severity: error',
    '    then: { function: casing, functionOptions: { type: kebab } }',
  ].join('\n')

/** Writes `files` (plus a ruleset) into a fresh directory and returns its path. */
const project = (files: Record<string, string>, given?: string): string => {
  const dir = mkdtempSync(join(tmpdir(), 'lint-yaml-ref-'))
  const rulesetPath = join(dir, '.lint.yaml')
  writeFileSync(rulesetPath, ruleset(given))
  for (const [name, content] of Object.entries(files)) writeFileSync(join(dir, name), content)
  return dir
}

const ROOT = ['openapi: 3.1.0', 'config:', "  $ref: './shared.yaml#/c'", ''].join('\n')

describe('resolver', () => {
  // `b: [x, y` never closes, so the salvage folds the next line into the
  // sequence and `c.name` still reads `NotKebab`: linting that would report
  // findings against data the file does not actually contain.
  it('reports a malformed referenced YAML file instead of linting its salvage', async () => {
    const dir = project({
      'doc.yaml': ROOT,
      'shared.yaml': ['c:', '  name: NotKebab', '  tags: [x, y', ''].join('\n'),
    })
    const shared = join(dir, 'shared.yaml')

    const { stdout, code } = await run([join(dir, 'doc.yaml')])

    expect(code).toBe(1)
    // Anchored on the `$ref` that pulled the file in, and naming the problem's
    // own position inside the referenced file.
    expect(stdout).toContain(`${join(dir, 'doc.yaml')}:3:9  error  unresolved-ref  `)
    expect(stdout).toContain(
      `unresolved-ref  Failed to parse YAML: ${shared}:3:9: Missing closing "]" for flow sequence`,
    )
    expect(stdout).not.toContain('config-name-kebab')
    // One finding per line: the report format has no room for a multi-line message.
    expect(stdout.split('\n').filter((line) => line.includes('unresolved-ref'))).toHaveLength(1)
  })

  it('reports a multi-document referenced YAML file instead of reading only its first document', async () => {
    const dir = project({
      'doc.yaml': ROOT,
      'shared.yaml': ['c:', '  name: kebab-case', '---', 'c:', '  name: NotKebab', ''].join('\n'),
    })
    const shared = join(dir, 'shared.yaml')

    const { stdout, code } = await run([join(dir, 'doc.yaml')])

    expect(code).toBe(1)
    expect(stdout).toContain(
      `unresolved-ref  ${shared}:3:1: this file contains multiple YAML documents (another one follows this marker); a $ref target must be a single-document file.`,
    )
  })

  // No extension: tried as JSON first, then YAML — the YAML fallback must be
  // just as strict.
  it('reports a malformed extensionless referenced file', async () => {
    const dir = project({
      'doc.yaml': ['config:', "  $ref: './shared#/c'", ''].join('\n'),
      shared: ['c:', '  name: NotKebab', '  tags: [x, y', ''].join('\n'),
    })

    const { stdout, code } = await run([join(dir, 'doc.yaml')])

    expect(code).toBe(1)
    expect(stdout).toContain(`unresolved-ref  Failed to parse YAML: ${join(dir, 'shared')}:3:9: `)
    expect(stdout).not.toContain('config-name-kebab')
  })

  it('still resolves a well-formed referenced YAML file', async () => {
    const dir = project({ 'doc.yaml': ROOT, 'shared.yaml': ['c:', '  name: NotKebab', ''].join('\n') })

    const { stdout, code } = await run([join(dir, 'doc.yaml')])

    expect(code).toBe(1)
    expect(stdout).toContain(`${join(dir, 'shared.yaml')}:2:9  error  config-name-kebab`)
    expect(stdout).not.toContain('unresolved-ref')
  })

  // A referenced JSON file has always resolved duplicate keys the `JSON.parse`
  // way (last wins), and the ruleset's `parserOptions.duplicateKeys` governs the
  // linted document only; a referenced YAML file behaves like the JSON one.
  it('accepts duplicate keys in a referenced YAML file, last value winning', async () => {
    const dir = project({
      'doc.yaml': ROOT,
      'shared.yaml': ['c:', '  name: kebab-case', '  name: NotKebab', ''].join('\n'),
    })

    const { stdout, code } = await run([join(dir, 'doc.yaml')])

    expect(code).toBe(1)
    expect(stdout).toContain('config-name-kebab')
    expect(stdout).not.toContain('unresolved-ref')
  })

  // The root is resolved from the value the linter already parsed rather than
  // re-parsed from disk, so the strict referenced-file parse never sees it: a
  // syntax error in the linted document is its own `parser` finding and does not
  // also cost it every cross-file reference.
  it('resolves the cross-file refs of a root that has its own parse error', async () => {
    const dir = project({
      'doc.yaml': [...ROOT.trimEnd().split('\n'), 'broken: [x, y', ''].join('\n'),
      'shared.yaml': ['c:', '  name: NotKebab', ''].join('\n'),
    })

    const { stdout, code } = await run([join(dir, 'doc.yaml')])

    expect(code).toBe(1)
    expect(stdout).toContain('parser')
    expect(stdout).toContain(`${join(dir, 'shared.yaml')}:2:9  error  config-name-kebab`)
    expect(stdout).not.toContain('unresolved-ref')
  })

  // The linter reads a multi-document root as an array of its documents; the
  // resolved view has to have that same shape, or rules addressing a later
  // document never see its references inlined.
  it('resolves refs in every document of a multi-document root', async () => {
    const dir = project(
      {
        'doc.yaml': ['first: 1', '---', 'config:', "  $ref: './shared.yaml#/c'", ''].join('\n'),
        'shared.yaml': ['c:', '  name: NotKebab', ''].join('\n'),
      },
      '$[1].config.name',
    )

    const { stdout, code } = await run([join(dir, 'doc.yaml')])

    expect(code).toBe(1)
    expect(stdout).toContain(`${join(dir, 'shared.yaml')}:2:9  error  config-name-kebab`)
  })
})
