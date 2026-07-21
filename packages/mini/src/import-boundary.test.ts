/// <reference types="node" />
// This test walks the source tree, so it needs Node's fs/path/url — pulled in
// explicitly here because the package's tsconfig is browser-only (`types: []`)
// to keep the shipped sources off the Node ambient types.
import { existsSync, readFileSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * The charter's hardest constraint, enforced: the `.` entry's transitive import
 * graph must contain ONLY mini's own core sources and `alien-signals`. No
 * subpath module (`/router`, `/flow`, `/forms`, `/query`) and no other package
 * may leak into core, because the bundle-size-sensitive widget imports `.` — a
 * single stray import here is bytes added to that bundle. This walks the source
 * graph from `src/index.ts` and fails CI the moment anything else appears.
 */

const SRC = fileURLToPath(new URL('.', import.meta.url))

/** The subpath feature directories — none of these may be reachable from `.`. */
const SUBPATH_DIRS = ['flow', 'router', 'forms', 'query', 'internal']

/** Extracts every import/export module specifier from a source file. */
const specifiersOf = (file: string): string[] => {
  const source = readFileSync(file, 'utf-8')
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

describe('import-boundary', () => {
  const { files, externals } = walk(resolve(SRC, 'index.ts'))

  it('pulls in only alien-signals as an external dependency', () => {
    expect([...externals].sort()).toEqual(['alien-signals'])
  })

  it('never reaches a subpath feature module from the core entry', () => {
    const leaked = [...files]
      .map((file) => relative(SRC, file))
      .filter((path) => SUBPATH_DIRS.some((dir) => path.startsWith(`${dir}/`)))
    expect(leaked).toEqual([])
  })

  it('never imports a mini subpath by its package name', () => {
    // A `@amritk/mini/<name>` import would defeat tree-shaking by re-entering the
    // package graph; core must reference siblings by relative path only.
    const subpathImports = [...externals].filter((name) => name.startsWith('@amritk/mini/'))
    expect(subpathImports).toEqual([])
  })

  // Each feature must tree-shake independently: importing `/flow` must not drag
  // in `/router` or `/forms`, and so on. Sharing a leaf helper under `internal/`
  // is fine (it carries no other feature's weight); reaching a sibling FEATURE
  // directory is the leak this guards against.
  const FEATURES = ['flow', 'router', 'forms', 'query'] as const
  for (const feature of FEATURES) {
    it(`keeps /${feature} free of the other feature modules`, () => {
      const { files } = walk(resolve(SRC, feature, 'index.ts'))
      const others = FEATURES.filter((name) => name !== feature)
      const leaked = [...files]
        .map((file) => relative(SRC, file))
        .filter((path) => others.some((name) => path.startsWith(`${name}/`)))
      expect(leaked).toEqual([])
    })
  }
})
