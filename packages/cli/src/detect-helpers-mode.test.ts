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

  it("returns 'package' when @amritk/helpers is resolvable from outDir", async () => {
    const outDir = join(tmpRoot, 'with-helpers/out')
    const helpersPkgDir = join(tmpRoot, 'with-helpers/node_modules/@amritk/helpers')
    await mkdir(outDir, { recursive: true })
    await mkdir(helpersPkgDir, { recursive: true })
    await writeFile(join(helpersPkgDir, 'is-object.js'), 'export const isObject = () => true\n', 'utf-8')
    await writeFile(
      join(helpersPkgDir, 'package.json'),
      JSON.stringify({
        name: '@amritk/helpers',
        version: '0.0.0',
        type: 'module',
        exports: { './is-object': './is-object.js' },
      }),
      'utf-8',
    )

    expect(detectHelpersMode(outDir)).toBe('package')
  })

  it("returns 'embedded' when @amritk/helpers cannot be resolved from outDir", async () => {
    const outDir = join(tmpRoot, 'no-helpers/out')
    await mkdir(outDir, { recursive: true })

    expect(detectHelpersMode(outDir)).toBe('embedded')
  })
})
