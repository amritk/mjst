import { describe, expect, it } from 'vitest'

import { type FixerRegistry, fixDocument, type RulesetDefinition } from '../index'
import { applyEditOpsWithChanges, type EditOp } from './edit-model'
import { parseYaml } from './index'

const apply = (source: string, op: EditOp): { output: string; changed: boolean } => {
  const result = applyEditOpsWithChanges(source, 'yaml', [op])
  return { output: result.output, changed: result.changed[0] ?? false }
}

/**
 * The three key shapes whose projected key is not the key's own source text. The
 * edit model has to address each one by the key `toJS` produced, because that is
 * the key a finding's path carries.
 */
const KEY_SHAPES = [
  { name: 'a null key', source: '~: bad\n', key: '', fixed: '~: good\n' },
  { name: 'an alias key', source: 'base: &k name\n*k : bad\n', key: 'name', fixed: 'base: &k name\n*k : good\n' },
  { name: 'a collection key', source: '? [a, b]\n: bad\n', key: '[ a, b ]', fixed: '? [a, b]\n: good\n' },
]

describe('edit-model-keys', () => {
  it.each(KEY_SHAPES)('addresses $name by its projected key', ({ source, key, fixed }) => {
    // The key has to be the one the parser projects, or a finding is located
    // but its fix silently does nothing.
    expect(Object.keys(parseYaml<Record<string, unknown>>(source).data)).toContain(key)
    expect(apply(source, { op: 'setValue', path: [key], value: 'good' })).toEqual({ output: fixed, changed: true })
  })

  it.each(KEY_SHAPES)('renames and removes $name by its projected key', ({ source, key }) => {
    const renamed = apply(source, { op: 'renameProperty', path: [key], newKey: 'renamed' })
    expect(renamed.changed).toBe(true)
    expect(parseYaml<Record<string, unknown>>(renamed.output).data).toMatchObject({ renamed: 'bad' })

    const removed = apply(source, { op: 'removeProperty', path: [key] })
    expect(removed.changed).toBe(true)
    expect(Object.keys(parseYaml<object | null>(removed.output).data ?? {})).not.toContain(key)
  })

  it('no longer matches the stale renderings of those keys', () => {
    expect(apply('~: bad\n', { op: 'setValue', path: ['null'], value: 'good' }).changed).toBe(false)
    expect(apply('base: &k name\n*k : bad\n', { op: 'setValue', path: ['*k'], value: 'good' }).changed).toBe(false)
  })

  it('treats an existing projected key as present when inserting', () => {
    const source = 'base: &k name\n*k : bad\n'
    expect(apply(source, { op: 'insertProperty', path: [], key: 'name', value: 'x' }).changed).toBe(false)
  })

  it('accepts only canonical sequence index strings', () => {
    const source = 'list:\n  - a\n  - b\n'
    expect(apply(source, { op: 'setValue', path: ['list', '1'], value: 'c' })).toEqual({
      output: 'list:\n  - a\n  - c\n',
      changed: true,
    })
    // `Number()` reads all of these as 1, but none of them is how an index is
    // written, so they must not silently land on element 1.
    for (const segment of ['01', ' 1', '1.0', '0x1', '+1']) {
      expect(apply(source, { op: 'setValue', path: ['list', segment], value: 'c' }).changed).toBe(false)
    }
  })

  it.each(KEY_SHAPES)('fixes a finding under $name end to end', async ({ source, fixed }) => {
    const ruleset: RulesetDefinition = {
      rules: {
        'no-bad': {
          given: '$.*',
          severity: 'error',
          then: { function: 'pattern', functionOptions: { notMatch: '^bad$' } },
        },
      },
    }
    const fixers: FixerRegistry = {
      'no-bad': { fix: ({ diagnostic }) => ({ op: 'setValue', path: diagnostic.path, value: 'good' }) },
    }
    const result = await fixDocument(source, { ruleset, fixers })
    expect(result.output).toBe(fixed)
    expect(result.fixed).toBe(true)
    expect(result.remaining).toHaveLength(0)
  })
})
