import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { stripContractsEsbuild } from './strip-contracts-esbuild'

/**
 * Captures the plugin's onLoad registration so tests can drive the callback
 * directly — the callback contract is the whole plugin, so no esbuild install
 * is needed to exercise it.
 */
const registrationOf = (plugin: ReturnType<typeof stripContractsEsbuild>) => {
  let filter: RegExp | undefined
  let callback: ((args: { path: string }) => Promise<{ contents: string; loader: string } | undefined>) | undefined
  plugin.setup({
    onLoad: (options, registered) => {
      filter = options.filter
      callback = registered
    },
  })
  if (filter === undefined || callback === undefined) throw new Error('plugin registered no onLoad callback')
  return { filter, callback }
}

const here = dirname(fileURLToPath(import.meta.url))

const contractSource = `export const c = defineContract({ method: 'get', path: '/x', summary: 's', responses: { 200: {} } })`

describe('strip-contracts-esbuild', () => {
  it('registers a filter covering script extensions only', () => {
    const { filter } = registrationOf(stripContractsEsbuild())
    for (const path of ['/a/x.ts', '/a/x.tsx', '/a/x.js', '/a/x.jsx', '/a/x.mjs', '/a/x.cjs']) {
      expect(filter.test(path), path).toBe(true)
    }
    for (const path of ['/a/x.css', '/a/x.json', '/a/x.ts.map']) {
      expect(filter.test(path), path).toBe(false)
    }
  })

  it('strips loaded modules, defers untouched ones, and honors exclude', async () => {
    const fixtureDir = join(here, '.fixtures-esbuild')
    mkdirSync(fixtureDir, { recursive: true })
    try {
      const contractPath = join(fixtureDir, 'contracts.ts')
      writeFileSync(contractPath, contractSource)
      const plainPath = join(fixtureDir, 'plain.ts')
      writeFileSync(plainPath, 'export const x = 1')
      const importOnlyPath = join(fixtureDir, 'import-only.ts')
      // Mentions defineContract but has no call site, so the transform is a
      // no-op and esbuild must keep its original loader pipeline.
      writeFileSync(importOnlyPath, `export { defineContract } from '@amritk/api'`)

      const { callback } = registrationOf(stripContractsEsbuild())
      const stripped = await callback({ path: contractPath })
      expect(stripped?.loader).toBe('ts')
      expect(stripped?.contents).not.toContain('summary')
      expect(stripped?.contents).toContain(`path: '/x'`)
      expect(await callback({ path: plainPath })).toBeUndefined()
      expect(await callback({ path: importOnlyPath })).toBeUndefined()

      // Excluded modules keep their freight — the escape hatch for apps that
      // read contract schemas at runtime.
      const excluding = registrationOf(stripContractsEsbuild({ exclude: /contracts\.ts$/ }))
      expect(await excluding.callback({ path: contractPath })).toBeUndefined()
    } finally {
      rmSync(fixtureDir, { recursive: true, force: true })
    }
  })

  it('picks the loader matching the file extension', async () => {
    const fixtureDir = join(here, '.fixtures-esbuild-loaders')
    mkdirSync(fixtureDir, { recursive: true })
    try {
      const { callback } = registrationOf(stripContractsEsbuild())
      const cases = [
        ['widget.tsx', 'tsx'],
        ['widget.jsx', 'jsx'],
        ['widget.mjs', 'js'],
        ['widget.cjs', 'js'],
        ['widget.js', 'js'],
      ] as const
      for (const [file, loader] of cases) {
        const path = join(fixtureDir, file)
        writeFileSync(path, contractSource)
        expect((await callback({ path }))?.loader, file).toBe(loader)
      }
    } finally {
      rmSync(fixtureDir, { recursive: true, force: true })
    }
  })
})
