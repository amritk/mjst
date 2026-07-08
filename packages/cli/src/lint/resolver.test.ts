import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { run } from './run'

// A `resolved: true` (default) rule that only matches once references are
// dereferenced: `$.config.name` is behind a `$ref`/`$dynamicRef` in the fixtures.
const RULESET = [
  'rules:',
  '  config-name-kebab:',
  '    given: "$.config.name"',
  '    severity: error',
  '    then: { function: casing, functionOptions: { type: kebab } }',
].join('\n')

const tmp = (prefix: string): string => mkdtempSync(join(tmpdir(), prefix))

const setup = (docName: string, doc: string): { dir: string; file: string } => {
  const dir = tmp('lint-ref-')
  writeFileSync(join(dir, '.lint.yaml'), RULESET)
  const file = join(dir, docName)
  writeFileSync(file, doc)
  return { dir, file }
}

describe('$ref resolution in mjst lint', () => {
  it('dereferences an internal $ref so a resolved rule sees the target', async () => {
    const { file } = setup(
      'doc.json',
      JSON.stringify({ config: { $ref: '#/defs/c' }, defs: { c: { name: 'NotKebab' } } }),
    )
    const { stdout, code } = await run([file])
    expect(code).toBe(1)
    expect(stdout).toContain('config-name-kebab')
  })

  it('leaves references intact under --no-resolve', async () => {
    const { file } = setup(
      'doc.json',
      JSON.stringify({ config: { $ref: '#/defs/c' }, defs: { c: { name: 'NotKebab' } } }),
    )
    const { stdout, code } = await run([file, '--no-resolve'])
    // `$.config.name` never matches the un-dereferenced `{ $ref }` node.
    expect(code).toBe(0)
    expect(stdout).toContain('No problems found')
  })

  it('dereferences a $dynamicRef bound to a $dynamicAnchor', async () => {
    const { file } = setup(
      'doc.json',
      JSON.stringify({ config: { $dynamicRef: '#cfg' }, defs: { c: { $dynamicAnchor: 'cfg', name: 'NotKebab' } } }),
    )
    const { stdout, code } = await run([file])
    expect(code).toBe(1)
    expect(stdout).toContain('config-name-kebab')
  })

  it('dereferences a $recursiveRef bound to a $recursiveAnchor', async () => {
    // `config` pulls in the recursive-anchored root; `config.name` is the root's
    // own `name`, which is not kebab-case.
    const { file } = setup(
      'doc.json',
      JSON.stringify({ $recursiveAnchor: true, name: 'NotKebab', config: { $recursiveRef: '#' } }),
    )
    const { stdout, code } = await run([file])
    expect(code).toBe(1)
    expect(stdout).toContain('config-name-kebab')
  })

  it('follows a cross-file $ref and attributes the finding to the referenced file', async () => {
    const dir = tmp('lint-xfile-')
    writeFileSync(join(dir, '.lint.yaml'), RULESET)
    writeFileSync(join(dir, 'shared.json'), JSON.stringify({ c: { name: 'NotKebab' } }))
    const file = join(dir, 'doc.json')
    writeFileSync(file, JSON.stringify({ config: { $ref: './shared.json#/c' } }))
    const { stdout, code } = await run([file])
    expect(code).toBe(1)
    expect(stdout).toContain('config-name-kebab')
    // The finding maps back to the file the node was inlined from.
    expect(stdout).toContain('shared.json')
  })

  it('does not fetch remote $refs by default (offline, no crash)', async () => {
    // With remote resolution off (the default), the http $ref is refused rather
    // than fetched, so the target never inlines and the rule cannot match — and
    // crucially the run completes without a network call.
    const { file } = setup('doc.json', JSON.stringify({ config: { $ref: 'https://example.test/s.json#/c' } }))
    const { stdout, code } = await run([file])
    expect(code).toBe(0)
    expect(stdout).toContain('No problems found')
  })
})
