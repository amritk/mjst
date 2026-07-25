import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'

import { importFresh } from './import-fresh'

const directories: string[] = []

const project = (): string => {
  const path = mkdtempSync(join(tmpdir(), 'mjst-import-'))
  directories.push(path)
  return path
}

afterEach(() => {
  for (const path of directories.splice(0)) rmSync(path, { recursive: true, force: true })
})

describe('import-fresh', () => {
  it('re-evaluates a module that has already been imported', async () => {
    const root = project()
    const file = join(root, 'routes.mjs')
    writeFileSync(file, 'export const version = 1\n')

    const first = await importFresh<{ version: number }>(file)
    expect(first.version).toBe(1)

    writeFileSync(file, 'export const version = 2\n')
    const second = await importFresh<{ version: number }>(file)

    expect(second.version).toBe(2)
    // The point of a fresh import: the old module object is untouched, so an
    // in-flight request holding it keeps the code it started with.
    expect(first.version).toBe(1)
  })

  it('resolves a relative specifier against a directory base', async () => {
    const root = project()
    writeFileSync(join(root, 'routes.mjs'), 'export const version = 7\n')

    const loaded = await importFresh<{ version: number }>('./routes.mjs', { base: root })
    expect(loaded.version).toBe(7)
  })

  it('resolves a relative specifier against a file URL base, the way an import would', async () => {
    const root = project()
    writeFileSync(join(root, 'routes.mjs'), 'export const version = 9\n')

    const base = pathToFileURL(join(root, 'dev.mjs'))
    const loaded = await importFresh<{ version: number }>('./routes.mjs', { base })
    expect(loaded.version).toBe(9)
  })

  it('accepts a URL and a file: string as the specifier', async () => {
    const root = project()
    const file = join(root, 'routes.mjs')
    writeFileSync(file, 'export const version = 3\n')

    expect((await importFresh<{ version: number }>(pathToFileURL(file))).version).toBe(3)
    expect((await importFresh<{ version: number }>(pathToFileURL(file).href)).version).toBe(3)
  })

  it('reports a module that fails to load, rather than caching the failure', async () => {
    const root = project()
    const file = join(root, 'routes.mjs')
    writeFileSync(file, 'throw new Error("boom")\n')

    await expect(importFresh(file)).rejects.toThrow('boom')

    writeFileSync(file, 'export const version = 1\n')
    expect((await importFresh<{ version: number }>(file)).version).toBe(1)
  })
})
