import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { run } from './run'

/**
 * A kebab-case rule on `given`. `resolved` defaults to `true`, so a `given` that
 * reaches through a `$ref` only matches once the resolver has inlined it.
 */
const ruleset = (given: string, resolved = true): string =>
  [
    'rules:',
    '  name-kebab:',
    `    given: "${given}"`,
    '    severity: error',
    ...(resolved ? [] : ['    resolved: false']),
    '    then: { function: casing, functionOptions: { type: kebab } }',
  ].join('\n')

/** Writes `files` plus a ruleset for `given` into a fresh directory; returns the linted file's path. */
const project = (files: Record<string, string>, given: string, resolved = true): { dir: string; file: string } => {
  const dir = mkdtempSync(join(tmpdir(), 'lint-multi-doc-'))
  writeFileSync(join(dir, '.lint.yaml'), ruleset(given, resolved))
  for (const [name, content] of Object.entries(files)) writeFileSync(join(dir, name), content)
  return { dir, file: join(dir, 'doc.yaml') }
}

/** The report lines carrying `code`, for asserting on exactly which findings a run produced. */
const findings = (stdout: string, code: string): string[] =>
  stdout.split('\n').filter((line) => line.includes(`  ${code}  `))

describe('resolver: multi-document root', () => {
  // Each document is its own root: `#/config` in document 0 means document 0's
  // `config`, not index `config` of the array the linter holds the stream in.
  // And document 1's missing file is reported, at its own `$ref`, instead of
  // being skipped because only the first document was looked at.
  it('resolves each document against itself and reports failures in later documents', async () => {
    const { dir, file } = project(
      {
        'doc.yaml': [
          'config:', // 1
          "  $ref: './shared.yaml#/c'", // 2
          'local:', // 3
          "  $ref: '#/config'", // 4
          '---', // 5
          'other:', // 6
          "  $ref: './nope.yaml'", // 7
          '',
        ].join('\n'),
        'shared.yaml': ['c:', '  name: NotKebab', ''].join('\n'),
      },
      '$[*].local.name',
    )

    const { stdout, code } = await run([file])

    expect(code).toBe(1)
    const unresolved = findings(stdout, 'unresolved-ref')
    expect(unresolved).toHaveLength(1)
    expect(unresolved[0]).toContain(`${file}:7:9  error  unresolved-ref  ENOENT: no such file or directory`)
    expect(unresolved[0]).toContain(join(dir, 'nope.yaml'))
    expect(findings(stdout, 'name-kebab')).toEqual([expect.stringContaining(`${join(dir, 'shared.yaml')}:2:9  error`)])
  })

  // A root naming its own file reaches the document the `$ref` is written in.
  // Findings on the inlined node land on that document's lines, not document 0's.
  it('resolves a self-reference by filename into the same document', async () => {
    const { file } = project(
      {
        'doc.yaml': [
          'defs:', // 1
          '  c:', // 2
          '    name: fine', // 3
          '---', // 4
          'defs:', // 5
          '  c:', // 6
          '    name: NotKebab', // 7
          'config:', // 8
          "  $ref: './doc.yaml#/defs/c'", // 9
          '',
        ].join('\n'),
      },
      '$[1].config.name',
    )

    const { stdout, code } = await run([file])

    expect(code).toBe(1)
    expect(findings(stdout, 'unresolved-ref')).toEqual([])
    expect(findings(stdout, 'name-kebab')).toEqual([expect.stringContaining(`${file}:7:11  error`)])
  })

  // A referenced file pointing back at the root reaches the document whose
  // `$ref` pulled it in.
  it('resolves a back-reference from a referenced file into the referring document', async () => {
    const { dir, file } = project(
      {
        'doc.yaml': [
          'defs:', // 1
          '  c:', // 2
          '    name: fine', // 3
          '---', // 4
          'defs:', // 5
          '  c:', // 6
          '    name: NotKebab', // 7
          'config:', // 8
          "  $ref: './shared.yaml#/c'", // 9
          '',
        ].join('\n'),
        'shared.yaml': ['c:', "  $ref: './doc.yaml#/defs/c'", ''].join('\n'),
      },
      '$[1].config.name',
    )

    const { stdout, code } = await run([file])

    expect(code).toBe(1)
    expect(findings(stdout, 'unresolved-ref')).toEqual([])
    expect(stdout).not.toContain(join(dir, 'shared.yaml'))
    expect(findings(stdout, 'name-kebab')).toEqual([expect.stringContaining(`${file}:7:11  error`)])
  })

  // A failure inside a referenced file has no path in the root. It lands at the
  // start of the document that pulled the file in, rather than at line 1.
  it('anchors a failure with no root path at the start of its own document', async () => {
    const { file } = project(
      {
        'doc.yaml': ['first: 1', '---', 'config:', "  $ref: './shared.yaml#/c'", ''].join('\n'),
        'shared.yaml': ['c:', "  $ref: './missing.yaml'", ''].join('\n'),
      },
      '$[1].config.name',
    )

    const { stdout, code } = await run([file])

    expect(code).toBe(1)
    expect(findings(stdout, 'unresolved-ref')).toEqual([expect.stringContaining(`${file}:3:1  error  unresolved-ref`)])
  })

  // No cross-file refs at all: the in-memory resolve takes the same
  // per-document view. Document 1's `#/defs/c` does not borrow document 0's.
  it('resolves internal refs per document when there is nothing to read from disk', async () => {
    const { file } = project(
      {
        'doc.yaml': [
          'config:', // 1
          "  $ref: '#/defs/c'", // 2
          'defs:', // 3
          '  c:', // 4
          '    name: NotKebab', // 5
          '---', // 6
          'config:', // 7
          "  $ref: '#/defs/c'", // 8
          '',
        ].join('\n'),
      },
      '$[*].config.name',
    )

    const { stdout, code } = await run([file])

    expect(code).toBe(1)
    expect(findings(stdout, 'unresolved-ref')).toEqual([
      expect.stringContaining(`${file}:8:9  error  unresolved-ref  Cannot resolve internal $ref "#/defs/c"`),
    ])
    expect(findings(stdout, 'name-kebab')).toEqual([expect.stringContaining(`${file}:5:11  error`)])
  })

  // One document with cross-file refs sends the file down the from-disk path;
  // a document with internal refs only is still located in the root file.
  it('locates findings in an internal-only document of a root that also has cross-file refs', async () => {
    const { file } = project(
      {
        'doc.yaml': [
          'config:', // 1
          "  $ref: '#/defs/c'", // 2
          'defs:', // 3
          '  c:', // 4
          '    name: NotKebab', // 5
          '---', // 6
          'other:', // 7
          "  $ref: './shared.yaml#/c'", // 8
          '',
        ].join('\n'),
        'shared.yaml': ['c:', '  name: fine', ''].join('\n'),
      },
      '$[*].config.name',
    )

    const { stdout, code } = await run([file])

    expect(code).toBe(1)
    expect(findings(stdout, 'unresolved-ref')).toEqual([])
    expect(findings(stdout, 'name-kebab')).toEqual([expect.stringContaining(`${file}:5:11  error`)])
  })

  // The resolved view has the shape the linter gives the raw one: an array of
  // documents, addressed as `$[i]`. A rule written for a single document
  // (`$.config.name`) matches neither view; one written for the stream matches
  // both.
  it.each([
    ['resolved', true],
    ['raw', false],
  ])('addresses documents of the %s view as $[i]', async (_view, resolved) => {
    const files = { 'doc.yaml': ['config:', '  name: NotKebab', '---', 'x: 1', ''].join('\n') }

    const flat = project(files, '$.config.name', resolved)
    expect(await run([flat.file])).toMatchObject({ code: 0 })

    const indexed = project(files, '$[0].config.name', resolved)
    const { stdout, code } = await run([indexed.file])
    expect(code).toBe(1)
    expect(findings(stdout, 'name-kebab')).toEqual([expect.stringContaining(`${indexed.file}:2:9  error`)])
  })

  // A single document whose root is an array is not a stream: `#/1/c` is item 1
  // of that array.
  it.each([
    ['doc.json', JSON.stringify([{ config: { $ref: '#/1/c' } }, { c: { name: 'NotKebab' } }])],
    ['doc.yaml', ["- config: { $ref: '#/1/c' }", '- c: { name: NotKebab }', ''].join('\n')],
  ])('resolves a single-document array root (%s) as one document', async (name, content) => {
    const dir = mkdtempSync(join(tmpdir(), 'lint-array-root-'))
    writeFileSync(join(dir, '.lint.yaml'), ruleset('$[0].config.name'))
    writeFileSync(join(dir, name), content)

    const { stdout, code } = await run([join(dir, name)])

    expect(code).toBe(1)
    expect(findings(stdout, 'unresolved-ref')).toEqual([])
    expect(findings(stdout, 'name-kebab')).toHaveLength(1)
  })
})
