import { readdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { findCalledSignalBindings } from '../packages/mini/src/vite/find-called-signal-bindings'

/**
 * The repo-internal gate for mini's called-signal footgun — `attr={signal()}`
 * calls the getter and freezes a plain value at creation, where `attr={signal}`
 * binds it reactively. Consumers get the same check live in their editor and CI
 * through the shipped Vite plugin (`@amritk/mini/vite`); this CLI reuses that
 * plugin's {@link findCalledSignalBindings} core to guard the tsx inside this
 * monorepo, printing `file:line:col` and exiting non-zero so it can run next to
 * `biome check`.
 */

/** Every `.tsx` file under a path, skipping the noise directories a walk hits. */
const collectTsxFiles = async (path: string): Promise<string[]> => {
  const info = await stat(path)
  if (info.isFile()) return path.endsWith('.tsx') ? [path] : []

  const files: string[] = []
  for (const entry of await readdir(path, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name.startsWith('.')) continue
    files.push(...(await collectTsxFiles(join(path, entry.name))))
  }
  return files
}

/**
 * Scans the given files or directories (default: `packages`), prints a
 * `file:line:col` report for each finding, and exits non-zero when any are
 * found. Only `.tsx` files are scanned — mini's JSX transform is the only place
 * this footgun can appear.
 */
const main = async (paths: readonly string[]): Promise<number> => {
  const roots = paths.length > 0 ? paths : ['packages']
  let total = 0

  for (const root of roots) {
    for (const file of await collectTsxFiles(root)) {
      const bindings = findCalledSignalBindings(await readFile(file, 'utf-8'))
      for (const { attribute, callee, line, column } of bindings) {
        total += 1
        console.log(
          `${file}:${line}:${column}  ${attribute}={${callee}()} freezes the signal — pass ${attribute}={${callee}} to keep it reactive`,
        )
      }
    }
  }

  console.log(total === 0 ? 'No frozen signal bindings found.' : `Found ${total} frozen signal binding(s).`)
  return total === 0 ? 0 : 1
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : error)
      process.exit(1)
    })
}
