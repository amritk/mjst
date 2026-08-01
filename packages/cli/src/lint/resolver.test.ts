import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
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

/**
 * The split-spec layout that local-`$ref` confinement refuses by default: the
 * linted document sits in `v1/` and reaches a shared schema in a sibling
 * `common/`. The ruleset is passed explicitly (rather than discovered) so the
 * walk-up never picks a `.lint.*` from somewhere above the temp directory.
 */
const splitSpec = (ref: string): { root: string; ruleset: string; file: string } => {
  const root = tmp('lint-roots-')
  const ruleset = join(root, '.lint.yaml')
  writeFileSync(ruleset, RULESET)
  mkdirSync(join(root, 'v1'))
  mkdirSync(join(root, 'common'))
  writeFileSync(join(root, 'common', 'shared.json'), JSON.stringify({ c: { name: 'NotKebab' } }))
  const file = join(root, 'v1', 'doc.json')
  writeFileSync(file, JSON.stringify({ config: { $ref: ref } }))
  return { root, ruleset, file }
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

  it('does not fetch remote $refs by default, and reports the refusal (offline, no crash)', async () => {
    // With remote resolution off (the default), the http $ref is refused rather
    // than fetched, so the target never inlines — and crucially the run completes
    // without a network call. The refusal surfaces as a finding rather than being
    // silently dropped.
    const { file } = setup('doc.json', JSON.stringify({ config: { $ref: 'https://example.test/s.json#/c' } }))
    const { stdout, code } = await run([file])
    expect(code).toBe(1)
    expect(stdout).toContain('Refusing to resolve remote $ref')
  })

  it('reports a finding for an unresolvable internal $ref instead of dropping it', async () => {
    // `#/defs/missing` points at nothing: previously the resolver discarded the
    // error and lint reported no problem. Now the failed resolution is a finding.
    const { file } = setup('doc.json', JSON.stringify({ config: { $ref: '#/defs/missing' } }))
    const { stdout, code } = await run([file])
    expect(code).toBe(1)
    expect(stdout).toContain('unresolved-ref')
    expect(stdout).toContain('#/defs/missing')
  })

  it('refuses a sibling-directory $ref without --allowed-roots and names the flag', async () => {
    const { ruleset, file } = splitSpec('../common/shared.json#/c')

    const { stdout, code } = await run([file, '-r', ruleset])
    expect(code).toBe(1)
    expect(stdout).toContain('Refusing to read local $ref')
    // The library's own wording ("set allowedRoots") is a dead end at a terminal.
    expect(stdout).toContain('pass --allowed-roots <dir>')
  })

  it('resolves a sibling-directory $ref once --allowed-roots names the shared parent', async () => {
    const { root, ruleset, file } = splitSpec('../common/shared.json#/c')

    const { stdout, code } = await run([file, '-r', ruleset, '--allowed-roots', root])
    // The target inlines, so the casing rule fires on the referenced file's node.
    expect(code).toBe(1)
    expect(stdout).toContain('config-name-kebab')
    expect(stdout).not.toContain('Refusing to read local $ref')
  })

  // `--allowed-roots` replaces the resolver's default, so the CLI re-adds each
  // document's own directory: naming a shared folder must not cut off the refs a
  // document already resolved.
  it('keeps a document own directory allowed alongside --allowed-roots', async () => {
    const { root, ruleset, file } = splitSpec('./neighbour.json#/c')
    writeFileSync(join(root, 'v1', 'neighbour.json'), JSON.stringify({ c: { name: 'NotKebab' } }))

    const { stdout, code } = await run([file, '-r', ruleset, '--allowed-roots', join(root, 'common')])
    expect(code).toBe(1)
    expect(stdout).toContain('config-name-kebab')
    expect(stdout).not.toContain('Refusing to read local $ref')
  })

  // Widening the roots must not dissolve the confinement: a ref that climbs past
  // every named root is still refused.
  it('still refuses a traversing $ref when --allowed-roots names a legitimate directory', async () => {
    const outside = tmp('lint-outside-')
    writeFileSync(join(outside, 'secret.json'), JSON.stringify({ c: { name: 'NotKebab' } }))
    const { root, ruleset, file } = splitSpec(join('..', '..', basename(outside), 'secret.json') + '#/c')

    const { stdout, code } = await run([file, '-r', ruleset, '--allowed-roots', root])
    expect(code).toBe(1)
    expect(stdout).toContain('Refusing to read local $ref')
    expect(stdout).not.toContain('config-name-kebab')
  })

  it('rejects an unknown resolution flag rather than silently ignoring it', async () => {
    const { ruleset, file } = splitSpec('../common/shared.json#/c')

    // `.strict()` is what stops `--allowed-root` (singular) from quietly running
    // with the confinement still in place.
    const { code, stderr } = await run([file, '-r', ruleset, '--allowed-root', '/tmp'])
    expect(code).toBe(2)
    expect(stderr).toContain('mjst lint --help')
  })
})
