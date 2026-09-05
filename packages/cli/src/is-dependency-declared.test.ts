import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { isDependencyDeclared } from './is-dependency-declared'

describe('is-dependency-declared', () => {
  let root: string

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'mjst-declared-'))
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('finds a dependency declared in any of the four fields', async () => {
    for (const field of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
      await writeFile(join(root, 'package.json'), JSON.stringify({ [field]: { '@amritk/api': '^0.1.0' } }))
      expect(isDependencyDeclared(root, '@amritk/api')).toBe(true)
    }
  })

  it('answers false for a package the nearest package.json does not declare', async () => {
    await writeFile(join(root, 'package.json'), JSON.stringify({ dependencies: { zod: '^4.0.0' } }))
    expect(isDependencyDeclared(root, '@amritk/api')).toBe(false)
  })

  it('walks up to the nearest package.json above the directory', async () => {
    await writeFile(join(root, 'package.json'), JSON.stringify({ dependencies: { '@amritk/api': '^0.1.0' } }))
    const nested = join(root, 'src', 'generated')
    await mkdir(nested, { recursive: true })
    expect(isDependencyDeclared(nested, '@amritk/api')).toBe(true)
  })

  // The nearest package.json is the one whose install layout the generated code
  // lives under. A workspace root above it may declare the package, but a nested
  // package that does not cannot rely on the hoist.
  it('stops at the nearest package.json rather than continuing upwards', async () => {
    await writeFile(join(root, 'package.json'), JSON.stringify({ dependencies: { '@amritk/api': '^0.1.0' } }))
    const nested = join(root, 'packages', 'web')
    await mkdir(nested, { recursive: true })
    await writeFile(join(nested, 'package.json'), JSON.stringify({ dependencies: {} }))
    expect(isDependencyDeclared(nested, '@amritk/api')).toBe(false)
  })

  it('skips an unreadable package.json and keeps walking', async () => {
    await writeFile(join(root, 'package.json'), JSON.stringify({ dependencies: { '@amritk/api': '^0.1.0' } }))
    const nested = join(root, 'app')
    await mkdir(nested, { recursive: true })
    await writeFile(join(nested, 'package.json'), '{ not json')
    expect(isDependencyDeclared(nested, '@amritk/api')).toBe(true)
  })

  it('answers false when no package.json exists anywhere above', async () => {
    // The walk ends at the filesystem root; a machine with a package.json at `/`
    // would answer for it, which is the same answer any resolver would give.
    expect(isDependencyDeclared(root, '@amritk/definitely-not-installed-anywhere')).toBe(false)
  })
})
