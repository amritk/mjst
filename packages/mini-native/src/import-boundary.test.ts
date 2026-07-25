/// <reference types="node" />
// This test walks the source tree, so it needs Node's fs/path/url — pulled in
// explicitly here because the package's tsconfig is deliberately platform-free
// (`lib: ["ESNext"]`, `types: []`) to keep the shipped sources off both the DOM
// and the Node ambient types.
import { existsSync, readFileSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * The package's central claim, enforced: the core carries no platform.
 *
 * The `.` entry's transitive import graph must contain ONLY this package's own
 * core sources and `alien-signals`. Nothing under `hosts/` may be reachable,
 * because a host is the one place that knows what a browser or an engine is —
 * an app that targets Lynx should never pull the DOM host along. Nothing under
 * `flow/` may be reachable either, since the control-flow components are an
 * opt-in subpath rather than part of the runtime everyone pays for.
 *
 * Today the only thing enforcing any of this is the tsconfig's missing DOM lib,
 * which catches a stray `document` but is perfectly happy with an import that
 * merely drags a host's bytes along. This walks the source graph from
 * `src/index.ts` and fails the moment anything else appears.
 */

const SRC = fileURLToPath(new URL('.', import.meta.url))

/** The subpath directories — none of these may be reachable from `.`. */
const SUBPATH_DIRS = ['hosts', 'flow']

/**
 * Drops comments before the specifiers are read.
 *
 * This package documents itself with realistic `@example` blocks, and several
 * of them open with `import … from '@amritk/mini-native/hosts/dom'`. Those are
 * documentation, not dependencies, and counting them would report a host leak
 * in a file that imports nothing of the sort. Line comments are matched only
 * when they start a line, so a `https://` inside a string survives.
 */
const withoutComments = (source: string): string => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

/** Extracts every import/export module specifier from a source file. */
const specifiersOf = (file: string): string[] => {
  const source = withoutComments(readFileSync(file, 'utf-8'))
  const specifiers: string[] = []
  // `import ... from '...'` and `export ... from '...'` (covers type-only too).
  const fromRe = /(?:import|export)\b[^'"]*?\bfrom\s*['"]([^'"]+)['"]/g
  // Bare side-effect imports: `import '...'`.
  const bareRe = /\bimport\s*['"]([^'"]+)['"]/g
  for (const match of source.matchAll(fromRe)) specifiers.push(match[1] as string)
  for (const match of source.matchAll(bareRe)) specifiers.push(match[1] as string)
  return specifiers
}

/** Resolves a relative specifier to a concrete `.ts`/`.tsx` file on disk. */
const resolveRelative = (fromFile: string, specifier: string): string | null => {
  const base = resolve(dirname(fromFile), specifier)
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`]) {
    if (existsSync(candidate)) return candidate
  }
  return null
}

/** Walks the transitive graph from `entry`, collecting visited files and external packages. */
const walk = (entry: string): { files: Set<string>; externals: Set<string> } => {
  const files = new Set<string>()
  const externals = new Set<string>()
  const queue = [entry]
  while (queue.length > 0) {
    const file = queue.pop() as string
    if (files.has(file)) continue
    files.add(file)
    for (const specifier of specifiersOf(file)) {
      if (specifier.startsWith('.')) {
        const resolved = resolveRelative(file, specifier)
        // A type-only import that strips at build time still counts as a source
        // dependency here; an unresolved path is a real problem to surface.
        expect(resolved, `${specifier} from ${relative(SRC, file)} should resolve`).not.toBeNull()
        if (resolved) queue.push(resolved)
      } else {
        externals.add(specifier)
      }
    }
  }
  return { files, externals }
}

/** The graph files that live under one of the forbidden directories, named so a failure points at the culprit. */
const leaksFrom = (files: Set<string>, dirs: readonly string[]): string[] =>
  [...files].map((file) => relative(SRC, file)).filter((path) => dirs.some((dir) => path.startsWith(`${dir}/`)))

describe('import-boundary', () => {
  const { files, externals } = walk(resolve(SRC, 'index.ts'))

  it('pulls in only alien-signals as an external dependency', () => {
    expect([...externals].sort()).toEqual(['alien-signals'])
  })

  it('never reaches a host from the core entry', () => {
    // A leaked host is the worst kind of regression here, because it typechecks
    // and it runs: the app just quietly ships a renderer for a platform it does
    // not target, and on the DOM host that means browser globals in a bundle
    // headed for a device.
    expect(leaksFrom(files, ['hosts'])).toEqual([])
  })

  it('never reaches a control-flow component from the core entry', () => {
    expect(leaksFrom(files, ['flow'])).toEqual([])
  })

  it('never imports one of its own subpaths by package name', () => {
    // A `@amritk/mini-native/<name>` import would re-enter the package graph
    // through the exports map and defeat tree-shaking; core must reference its
    // siblings by relative path only.
    const subpathImports = [...externals].filter((name) => name.startsWith('@amritk/mini-native'))
    expect(subpathImports).toEqual([])
  })

  it('keeps the control-flow subpath free of any host', () => {
    // `/flow` is platform-free for the same reason core is: the components
    // reach the tree through the installed host, never through a concrete one.
    const flow = walk(resolve(SRC, 'flow', 'index.ts'))
    expect(leaksFrom(flow.files, ['hosts'])).toEqual([])
    expect([...flow.externals].sort()).toEqual(['alien-signals'])
  })

  it('keeps every subpath directory out of the core graph at once', () => {
    // The catch-all, so a directory added later is covered without a new case.
    expect(leaksFrom(files, SUBPATH_DIRS)).toEqual([])
  })
})
