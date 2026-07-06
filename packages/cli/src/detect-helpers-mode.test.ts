import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { detectHelpersMode } from './detect-helpers-mode'

describe('detect-helpers-mode', () => {
  let tmpRoot: string

  beforeAll(async () => {
    tmpRoot = await mkdtemp(join(tmpdir(), 'mjst-detect-'))
  })

  afterAll(async () => {
    await rm(tmpRoot, { recursive: true, force: true })
  })

  it("returns 'package' when @amritk/helpers is a declared dependency", async () => {
    const projectDir = join(tmpRoot, 'declared-dep')
    const outDir = join(projectDir, 'out')
    await mkdir(outDir, { recursive: true })
    await writeFile(
      join(projectDir, 'package.json'),
      JSON.stringify({ name: 'consumer', dependencies: { '@amritk/helpers': '^0.1.0' } }),
      'utf-8',
    )

    expect(detectHelpersMode(outDir)).toBe('package')
  })

  it("returns 'package' when @amritk/helpers is a declared devDependency", async () => {
    const projectDir = join(tmpRoot, 'declared-dev-dep')
    const outDir = join(projectDir, 'out')
    await mkdir(outDir, { recursive: true })
    await writeFile(
      join(projectDir, 'package.json'),
      JSON.stringify({ name: 'consumer', devDependencies: { '@amritk/helpers': '^0.1.0' } }),
      'utf-8',
    )

    expect(detectHelpersMode(outDir)).toBe('package')
  })

  it("returns 'embedded' when @amritk/helpers is only resolvable but not declared", async () => {
    // The exact pnpm/isolated-install trap: the package is hoisted into
    // node_modules as a transitive dep of @amritk/mjst but never declared, so
    // 'package' output would break at runtime under an isolated layout.
    const projectDir = join(tmpRoot, 'undeclared')
    const outDir = join(projectDir, 'out')
    const helpersPkgDir = join(projectDir, 'node_modules/@amritk/helpers')
    await mkdir(outDir, { recursive: true })
    await mkdir(helpersPkgDir, { recursive: true })
    await writeFile(join(helpersPkgDir, 'is-object.js'), 'export const isObject = () => true\n', 'utf-8')
    await writeFile(
      join(helpersPkgDir, 'package.json'),
      JSON.stringify({ name: '@amritk/helpers', version: '0.0.0', exports: { './is-object': './is-object.js' } }),
      'utf-8',
    )
    await writeFile(
      join(projectDir, 'package.json'),
      JSON.stringify({ name: 'consumer', dependencies: { '@amritk/mjst': '^0.8.0' } }),
      'utf-8',
    )

    expect(detectHelpersMode(outDir)).toBe('embedded')
  })

  it("returns 'embedded' when no package.json is found above the output dir", async () => {
    const outDir = join(tmpRoot, 'no-package-json/out')
    await mkdir(outDir, { recursive: true })

    expect(detectHelpersMode(outDir)).toBe('embedded')
  })

  it('reads the nearest package.json, walking up from the output dir', async () => {
    // Output nested several directories below the project root still resolves
    // to the root package.json's declared dependency.
    const projectDir = join(tmpRoot, 'nested')
    const outDir = join(projectDir, 'a/b/c/out')
    await mkdir(outDir, { recursive: true })
    await writeFile(
      join(projectDir, 'package.json'),
      JSON.stringify({ name: 'consumer', dependencies: { '@amritk/helpers': '^0.1.0' } }),
      'utf-8',
    )

    expect(detectHelpersMode(outDir)).toBe('package')
  })
})
