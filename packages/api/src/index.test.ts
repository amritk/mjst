import { readFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import * as api from './index'

type Graph = {
  /** Every relative module reachable from the entry, relative to `src/`. */
  readonly files: string[]
  /** Package specifiers imported for their runtime value. */
  readonly valueExternals: string[]
  /** Package specifiers imported only for types — these erase at compile time. */
  readonly typeExternals: string[]
}

const SRC = dirname(fileURLToPath(import.meta.url))

/**
 * Collects every relative module reachable from an entry, splitting the
 * external specifiers it touches into value imports (which a bundler must
 * resolve) and type-only imports (which vanish before a bundler sees them).
 *
 * `client.test.ts` pins the browser subpath the same way. This one pins the
 * *root*, which is what a Cloudflare Workers deployment imports and what
 * `compileToModule`'s emitted module imports by default — the graph nothing
 * used to guard, even though it is the one with the strictest platform.
 */
const walkImportGraph = (entry: string): Graph => {
  const files = new Set<string>()
  const valueExternals = new Set<string>()
  const typeExternals = new Set<string>()

  const visit = (file: string): void => {
    const key = relative(SRC, file)
    if (files.has(key)) return
    files.add(key)
    // Comments go first — JSDoc examples contain import statements too.
    const source = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '')
    // One match per top-level import/export-from statement, anchored to the
    // line start. The body class excludes quotes, so a match can never run
    // past its own specifier into the next statement — and `type` is read from
    // the statement itself, so a module that imports the same package both
    // ways (types on one line, values on the next) classifies each correctly.
    for (const match of source.matchAll(/^(?:import|export)\s+(type\s+)?[^'";]*?from\s*'([^']+)'/gm)) {
      const specifier = match[2] ?? ''
      if (specifier.startsWith('.')) {
        visit(join(dirname(file), `${specifier}.ts`))
      } else if (match[1] === undefined) {
        valueExternals.add(specifier)
      } else {
        typeExternals.add(specifier)
      }
    }
  }

  visit(join(SRC, `${entry}.ts`))
  return {
    files: [...files].sort(),
    valueExternals: [...valueExternals].sort(),
    typeExternals: [...typeExternals].sort(),
  }
}

describe('index', () => {
  it('exports both engines and both adapters', () => {
    expect(api.createApi).toBeTypeOf('function')
    expect(api.compileToModule).toBeTypeOf('function')
    expect(api.toFetchHandler).toBeTypeOf('function')
    expect(api.toNodeHandler).toBeTypeOf('function')
    expect(api.fetchToNodeHandler).toBeTypeOf('function')
  })

  it('keeps node built-ins out of the root entry as runtime imports', () => {
    const { files, valueExternals, typeExternals } = walkImportGraph('index')

    // The invariant. A static `import { Readable } from 'node:stream'`
    // anywhere in this graph fails a Workers or browser bundle outright —
    // esbuild reports `Could not resolve "node:stream"` and stops, and it
    // cannot tree-shake the module away first because resolution runs before
    // elimination. The Node adapters load their built-ins through
    // `importNodeModule` instead, which no bundler can see.
    expect(valueExternals.filter((name) => name.startsWith('node:'))).toEqual([])
    // The one runtime dependency, by design.
    expect(valueExternals).toEqual(['@amritk/runtime-validators'])
    // Type-only `node:*` imports are fine — they erase at compile time — but
    // they are listed here so a change from `import type` to a value import
    // shows up as a diff rather than as a broken deploy.
    expect(typeExternals).toEqual(['@amritk/runtime-validators', 'node:http', 'node:stream'])

    // The adapters that own those built-ins really are in the graph, so the
    // assertions above are testing something rather than passing vacuously.
    expect(files).toContain('to-node-handler.ts')
    expect(files).toContain('fetch-to-node-handler.ts')
    expect(files).toContain('wait-for-drain.ts')
    expect(files).toContain('compile/compile-to-module.ts')
  })
})
