import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

// @ts-expect-error -- plain JS so `prepublishOnly` can run it under bare node.
import { checkPublishable } from './check-publishable.mjs'

const HEALTHY = {
  name: '@amritk/healthy',
  exports: {
    './package.json': './package.json',
    '.': { types: './dist/index.d.ts', import: './dist/index.js', default: './dist/index.js' },
  },
}

/** `@amritk/mjst`' shape: an executable and no module exports at all. */
const CLI = {
  name: '@amritk/cli-only',
  bin: { thing: './dist/index.js' },
  exports: { './package.json': './package.json' },
}

/** `@amritk/helpers`' shape: a wildcard subpath over whatever the build emitted. */
const WILDCARD = {
  name: '@amritk/wild',
  exports: {
    './*': { types: './dist/*.d.ts', import: './dist/*.js', default: './dist/*.js' },
  },
}

describe('check-publishable', () => {
  let root: string

  /** Writes a package directory, creating whichever of dist/LICENSE it is told to. */
  const write = async (
    name: string,
    pkg: Record<string, unknown>,
    { dist = true, license = true }: { dist?: boolean; license?: boolean } = {},
  ): Promise<string> => {
    const dir = join(root, name)
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'package.json'), JSON.stringify(pkg), 'utf-8')
    if (dist) {
      await mkdir(join(dir, 'dist'), { recursive: true })
      await writeFile(join(dir, 'dist/index.js'), 'export const ok = true\n', 'utf-8')
      await writeFile(join(dir, 'dist/index.d.ts'), 'export declare const ok: boolean\n', 'utf-8')
    }
    if (license) await writeFile(join(dir, 'LICENSE'), 'MIT License\n', 'utf-8')
    return dir
  }

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'mjst-check-publishable-'))
  })

  afterAll(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('passes a package whose build output, manifest and LICENSE all line up', async () => {
    expect(checkPublishable(await write('healthy', HEALTHY))).toEqual([])
  })

  it('passes a wildcard subpath backed by a dist that emitted something', async () => {
    expect(checkPublishable(await write('wild', WILDCARD))).toEqual([])
  })

  it('rejects a wildcard subpath over an empty dist, rather than passing on the pattern alone', async () => {
    const dir = await write('wild-empty', WILDCARD, { dist: false })
    await mkdir(join(dir, 'dist'), { recursive: true })
    const problems = checkPublishable(dir)
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain('./dist/*.js')
  })

  it('passes a CLI whose only entry is bin, with no module exports to read', async () => {
    expect(checkPublishable(await write('cli', CLI))).toEqual([])
  })

  it('rejects a CLI whose executable was never built', async () => {
    const problems = checkPublishable(await write('cli-unbuilt', CLI, { dist: false }))
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain('./dist/index.js')
  })

  it('rejects a manifest promising dist against a tree with none', async () => {
    const problems = checkPublishable(await write('unbuilt', HEALTHY, { dist: false }))
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain('./dist/index.js')
    expect(problems[0]).toContain('bun run build')
  })

  it('rejects a surviving development condition, which release:publish exists to strip', async () => {
    const pkg = {
      ...HEALTHY,
      exports: { ...HEALTHY.exports, '.': { development: './src/index.ts', ...HEALTHY.exports['.'] } },
    }
    const problems = checkPublishable(await write('unstripped', pkg))
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain('development')
  })

  it('rejects a missing LICENSE, which npm only bundles from inside the package', async () => {
    const problems = checkPublishable(await write('unlicensed', HEALTHY, { license: false }))
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain('LICENSE')
  })

  it('rejects an exports map with no dist target at all, rather than passing vacuously', async () => {
    const pkg = { name: '@amritk/srconly', exports: { '.': { default: './src/index.ts' } } }
    const problems = checkPublishable(await write('srconly', pkg))
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain('no ./dist/ target')
  })

  it('reports every problem at once, so one publish attempt names them all', async () => {
    expect(checkPublishable(await write('broken', HEALTHY, { dist: false, license: false }))).toHaveLength(2)
  })

  it('has nothing to say about a private package, which npm will not publish', async () => {
    const pkg = { name: '@amritk/internal', private: true, exports: { '.': './src/index.ts' } }
    expect(checkPublishable(await write('private', pkg, { dist: false, license: false }))).toEqual([])
  })
})
