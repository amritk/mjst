import type { Plugin } from 'vite'
import { describe, expect, it } from 'vitest'

import { acceptHotUpdates } from './accept-hot-updates'

/**
 * Runs the plugin's `transform` and returns the emitted code, or `null` when the
 * module was left untouched. Vite types the hook as an object-or-function; this
 * takes the function form (the shape the plugin uses) and reads the result the
 * same way Rollup does.
 */
const runTransform = (plugin: Plugin, code: string, id: string): string | null => {
  const hook = plugin.transform
  const handler = typeof hook === 'function' ? hook : hook?.handler
  const run = handler as (code: string, id: string) => { code: string } | null
  return run(code, id)?.code ?? null
}

/** The entry module a mini app writes: one `hotMount` call and nothing else. */
const ENTRY = `import { hotMount } from '@amritk/mini/hot'\n\nhotMount(document.body, App, import.meta.hot)\n`

describe('accept-hot-updates', () => {
  it('appends the accept call Vite scans for to a module that mounts', () => {
    const emitted = runTransform(acceptHotUpdates(), ENTRY, '/app/main.ts')

    // The literal text is the contract: Vite's import analysis reads the source
    // for `import.meta.hot.accept(` and only then treats the module as a
    // boundary. A runtime call through a helper does not register.
    expect(emitted).toContain('import.meta.hot?.accept()')
    expect(emitted?.startsWith(ENTRY)).toBe(true)
  })

  it('leaves every line of the original module where it was', () => {
    const emitted = runTransform(acceptHotUpdates(), ENTRY, '/app/main.ts')

    // Appending rather than inserting is why the plugin can return `map: null`
    // without misreporting positions to the error overlay or the debugger.
    const before = ENTRY.split('\n')
    const after = (emitted ?? '').split('\n')
    expect(after.slice(0, before.length - 1)).toEqual(before.slice(0, before.length - 1))
  })

  it('ignores modules that never mount', () => {
    const code = `export const Counter = () => document.createElement('button')\n`

    expect(runTransform(acceptHotUpdates(), code, '/app/counter.ts')).toBeNull()
  })

  it('leaves a module that already accepts on its own alone', () => {
    // Injecting a second bare accept would layer mini's boundary on top of a
    // hand-written one the author is managing themselves.
    const code = `${ENTRY}\nimport.meta.hot?.accept(() => {})\n`

    expect(runTransform(acceptHotUpdates(), code, '/app/main.ts')).toBeNull()
  })

  it('skips dependencies, virtual modules, and non-source files', () => {
    const plugin = acceptHotUpdates()

    expect(runTransform(plugin, ENTRY, '/repo/node_modules/some-dep/dist/main.js')).toBeNull()
    expect(runTransform(plugin, ENTRY, '\0virtual:mini-entry')).toBeNull()
    expect(runTransform(plugin, ENTRY, '/app/styles.css')).toBeNull()
  })

  it('transforms a module with a query suffix, as Vite serves it', () => {
    expect(runTransform(acceptHotUpdates(), ENTRY, '/app/main.tsx?t=1730000000000')).toContain('accept()')
  })

  it('only runs during dev, never in a production build', () => {
    // `vite build` has no hot runtime, and the injected call must not ship.
    expect(acceptHotUpdates().apply).toBe('serve')
  })
})
