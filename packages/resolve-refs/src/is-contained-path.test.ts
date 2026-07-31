import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { isContainedPath } from './is-contained-path'

describe('is-contained-path', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'contained-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('accepts a file directly inside the root', () => {
    expect(isContainedPath(dir, join(dir, 'schema.json'))).toBe(true)
  })

  it('accepts a file nested below the root', () => {
    expect(isContainedPath(dir, join(dir, 'a', 'b', 'schema.json'))).toBe(true)
  })

  it('accepts the root itself', () => {
    expect(isContainedPath(dir, dir)).toBe(true)
  })

  it('rejects a parent-relative escape', () => {
    expect(isContainedPath(join(dir, 'sub'), join(dir, 'sub', '..', 'secret.json'))).toBe(false)
    expect(isContainedPath(dir, '/etc/passwd')).toBe(false)
  })

  it('rejects a sibling whose name merely starts with the root', () => {
    // `/tmp/x-evil` must not count as living under `/tmp/x`.
    expect(isContainedPath(join(dir, 'x'), join(dir, 'x-evil', 'schema.json'))).toBe(false)
  })

  it('rejects a symlink inside the root that points outside it', () => {
    // The lexical path looks contained; only the real path gives it away.
    const outside = join(dir, 'outside')
    const root = join(dir, 'root')
    mkdirSync(outside)
    mkdirSync(root)
    writeFileSync(join(outside, 'secret.json'), '{}')
    symlinkSync(join(outside, 'secret.json'), join(root, 'link.json'))

    expect(isContainedPath(root, join(root, 'link.json'))).toBe(false)
  })

  it('accepts a file that does not exist yet, judged by its would-be location', () => {
    // A `$ref` to a missing file still has to be classified before we try to
    // read it, so the answer comes from the deepest ancestor that does exist.
    expect(isContainedPath(dir, join(dir, 'nope.json'))).toBe(true)
    expect(isContainedPath(dir, join(dir, '..', 'nope.json'))).toBe(false)
  })
})
