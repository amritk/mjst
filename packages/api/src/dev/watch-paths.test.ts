import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { watchPaths } from './watch-paths'

const directories: string[] = []

const project = (): string => {
  const path = mkdtempSync(join(tmpdir(), 'mjst-watch-'))
  directories.push(path)
  return path
}

afterEach(() => {
  for (const path of directories.splice(0)) rmSync(path, { recursive: true, force: true })
})

/**
 * Filesystem events are asynchronous and, on some platforms, coalesced by the
 * kernel — so the tests wait for the batch to arrive rather than assuming a
 * write has been reported by the next tick.
 */
const collect = () => {
  const batches: Array<readonly string[]> = []
  return { batches, onChange: (changed: readonly string[]) => batches.push(changed) }
}

describe('watch-paths', () => {
  it('reports an edited file under a watched directory', async () => {
    const root = project()
    writeFileSync(join(root, 'routes.ts'), 'export const version = 1\n')

    const { batches, onChange } = collect()
    const dispose = watchPaths(root, { debounceMs: 5 })(onChange)

    writeFileSync(join(root, 'routes.ts'), 'export const version = 2\n')
    await vi.waitFor(() => expect(batches).toHaveLength(1), { timeout: 3000 })

    expect(batches[0]).toEqual([join(root, 'routes.ts')])
    dispose()
  })

  it('watches nested directories', async () => {
    const root = project()
    mkdirSync(join(root, 'handlers'))

    const { batches, onChange } = collect()
    const dispose = watchPaths(root, { debounceMs: 5 })(onChange)

    writeFileSync(join(root, 'handlers', 'users.ts'), 'export const list = () => []\n')
    await vi.waitFor(() => expect(batches).toHaveLength(1), { timeout: 3000 })

    expect(batches[0]).toContain(join(root, 'handlers', 'users.ts'))
    dispose()
  })

  it('collapses a burst of edits into one batch', async () => {
    const root = project()

    const { batches, onChange } = collect()
    const dispose = watchPaths(root, { debounceMs: 60 })(onChange)

    writeFileSync(join(root, 'a.ts'), 'export const a = 1\n')
    writeFileSync(join(root, 'b.ts'), 'export const b = 1\n')
    writeFileSync(join(root, 'c.ts'), 'export const c = 1\n')
    await vi.waitFor(() => expect(batches).toHaveLength(1), { timeout: 3000 })

    expect([...(batches[0] ?? [])].sort()).toEqual([join(root, 'a.ts'), join(root, 'b.ts'), join(root, 'c.ts')])
    dispose()
  })

  it('ignores files the reload cannot care about', async () => {
    const root = project()
    mkdirSync(join(root, 'node_modules'))

    const { batches, onChange } = collect()
    const dispose = watchPaths(root, { debounceMs: 5 })(onChange)

    writeFileSync(join(root, 'node_modules', 'dep.ts'), 'export const dep = 1\n')
    writeFileSync(join(root, 'notes.md'), '# notes\n')
    // A relevant edit last: if it arrives and the others did not, they were filtered.
    writeFileSync(join(root, 'routes.ts'), 'export const version = 1\n')

    await vi.waitFor(() => expect(batches).toHaveLength(1), { timeout: 3000 })
    expect(batches[0]).toEqual([join(root, 'routes.ts')])
    dispose()
  })

  it('accepts a custom extension list', async () => {
    const root = project()

    const { batches, onChange } = collect()
    const dispose = watchPaths(root, { debounceMs: 5, extensions: ['.yaml'] })(onChange)

    writeFileSync(join(root, 'routes.ts'), 'export const version = 1\n')
    writeFileSync(join(root, 'openapi.yaml'), 'openapi: 3.1.0\n')

    await vi.waitFor(() => expect(batches).toHaveLength(1), { timeout: 3000 })
    expect(batches[0]).toEqual([join(root, 'openapi.yaml')])
    dispose()
  })

  it('watches a single file by path', async () => {
    const root = project()
    const file = join(root, 'routes.ts')
    writeFileSync(file, 'export const version = 1\n')

    const { batches, onChange } = collect()
    const dispose = watchPaths([file], { debounceMs: 5 })(onChange)

    writeFileSync(file, 'export const version = 2\n')
    await vi.waitFor(() => expect(batches).toHaveLength(1), { timeout: 3000 })

    expect(batches[0]).toEqual([file])
    dispose()
  })

  it('stops reporting once disposed', async () => {
    const root = project()

    const { batches, onChange } = collect()
    const dispose = watchPaths(root, { debounceMs: 5 })(onChange)
    dispose()

    writeFileSync(join(root, 'routes.ts'), 'export const version = 1\n')
    await new Promise((resolve) => setTimeout(resolve, 150))

    expect(batches).toEqual([])
  })

  it('throws when a watched path does not exist', () => {
    const root = project()
    // A typo in a watch path would otherwise be a dev server that silently
    // never reloads, so it fails at setup instead.
    expect(() => watchPaths(join(root, 'nope'))(() => {})).toThrow()
  })
})
