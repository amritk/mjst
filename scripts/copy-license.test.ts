import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { copyLicenses } from './copy-license'

const LICENSE_TEXT = 'MIT License\n\nCopyright (c) test\n'

describe('copy-license', () => {
  let root: string

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'mjst-copy-license-'))
    await writeFile(join(root, 'LICENSE'), LICENSE_TEXT, 'utf-8')
    const write = async (name: string, pkg: Record<string, unknown>): Promise<void> => {
      await mkdir(join(root, 'packages', name), { recursive: true })
      await writeFile(join(root, 'packages', name, 'package.json'), JSON.stringify(pkg), 'utf-8')
    }
    await write('published-a', { name: '@amritk/a' })
    await write('published-b', { name: '@amritk/b', private: false })
    await write('internal', { name: '@amritk/internal', private: true })
  })

  afterAll(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('copies the root LICENSE into every non-private package', async () => {
    const copied = await copyLicenses(root)
    expect(copied.sort()).toEqual(['published-a', 'published-b'])
    expect(await readFile(join(root, 'packages', 'published-a', 'LICENSE'), 'utf-8')).toBe(LICENSE_TEXT)
    expect(await readFile(join(root, 'packages', 'published-b', 'LICENSE'), 'utf-8')).toBe(LICENSE_TEXT)
  })

  it('leaves private packages without a LICENSE copy', async () => {
    await copyLicenses(root)
    await expect(readFile(join(root, 'packages', 'internal', 'LICENSE'), 'utf-8')).rejects.toThrow()
  })

  it('is idempotent across successive runs', async () => {
    await copyLicenses(root)
    const copied = await copyLicenses(root)
    expect(copied.sort()).toEqual(['published-a', 'published-b'])
    expect(await readFile(join(root, 'packages', 'published-a', 'LICENSE'), 'utf-8')).toBe(LICENSE_TEXT)
  })
})
