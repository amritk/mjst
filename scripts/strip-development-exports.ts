import { readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * Strips the `development` condition from every workspace package's `exports`.
 *
 * Locally we resolve packages to their TypeScript source via the `development`
 * export condition (see the `dev` scripts and `--conditions development`). That
 * condition points at `./src/*.ts`, and `src` ships in the published tarball —
 * so any consumer or bundler that happens to resolve `development` would load
 * raw, uncompiled TypeScript instead of the built JS in `dist`.
 *
 * Removing the condition from the published manifests closes that hole while
 * leaving the source maps in `src` intact. Like resolve-workspace-protocol,
 * this runs in the ephemeral publish job and is never committed.
 */

const ROOT = join(import.meta.dir, '..')

type Exports = Record<string, unknown>
type PackageJson = { name?: string; exports?: Exports }

const readJson = async (path: string): Promise<PackageJson> => JSON.parse(await readFile(path, 'utf-8'))

/** Recursively delete every `development` condition within an exports subtree. */
const stripDevelopment = (node: unknown): boolean => {
  if (node === null || typeof node !== 'object') return false
  let changed = false
  const conditions = node as Record<string, unknown>
  if ('development' in conditions) {
    delete conditions.development
    changed = true
  }
  for (const value of Object.values(conditions)) {
    if (stripDevelopment(value)) changed = true
  }
  return changed
}

const run = async (): Promise<void> => {
  const packagesDir = join(ROOT, 'packages')
  const entries = await readdir(packagesDir, { withFileTypes: true })

  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const path = join(packagesDir, entry.name, 'package.json')
    const pkg = await readJson(path)
    if (!pkg.exports) continue

    if (stripDevelopment(pkg.exports)) {
      await writeFile(path, `${JSON.stringify(pkg, null, 2)}\n`, 'utf-8')
      console.log(`Stripped development exports in ${pkg.name ?? path}`)
    }
  }
}

run().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
