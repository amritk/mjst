import { readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * Rewrites `workspace:` and `catalog:` dependency specifiers to concrete
 * version ranges in every workspace package.json.
 *
 * `changeset publish` packs via `npm publish`, and npm understands neither
 * protocol — so without this step they ship literally and break installs.
 * Bun's own publisher resolves them at pack time; we reproduce that here so
 * the npm publish path (which gives us provenance) emits installable packages.
 * Intended to run in the ephemeral publish job, never committed.
 */

const ROOT = join(import.meta.dir, '..')
const DEP_FIELDS = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'] as const

type PackageJson = {
  name?: string
  version?: string
  catalog?: Record<string, string>
} & Partial<Record<(typeof DEP_FIELDS)[number], Record<string, string>>>

const readJson = async (path: string): Promise<PackageJson> => JSON.parse(await readFile(path, 'utf-8'))

const resolveWorkspace = (spec: string, version: string): string => {
  const range = spec.slice('workspace:'.length)
  if (range === '' || range === '*') return version
  if (range === '^' || range === '~') return `${range}${version}`
  // workspace:1.2.3 / workspace:^1.0.0 — keep the explicit range
  return range
}

const run = async (): Promise<void> => {
  const root = await readJson(join(ROOT, 'package.json'))
  const catalog = root.catalog ?? {}

  const packagesDir = join(ROOT, 'packages')
  const entries = await readdir(packagesDir, { withFileTypes: true })

  // name -> version across the workspace, for resolving workspace:* refs
  const versions = new Map<string, string>()
  const manifests: { path: string; pkg: PackageJson }[] = []

  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const path = join(packagesDir, entry.name, 'package.json')
    const pkg = await readJson(path)
    if (pkg.name && pkg.version) versions.set(pkg.name, pkg.version)
    manifests.push({ path, pkg })
  }

  for (const { path, pkg } of manifests) {
    let changed = false

    for (const field of DEP_FIELDS) {
      const deps = pkg[field]
      if (!deps) continue

      for (const [name, spec] of Object.entries(deps)) {
        if (spec === 'catalog:') {
          const resolved = catalog[name]
          if (!resolved) throw new Error(`No catalog entry for "${name}" in root package.json`)
          deps[name] = resolved
          changed = true
        } else if (spec.startsWith('workspace:')) {
          const version = versions.get(name)
          if (!version) throw new Error(`No workspace version found for "${name}"`)
          deps[name] = resolveWorkspace(spec, version)
          changed = true
        }
      }
    }

    if (changed) {
      await writeFile(path, `${JSON.stringify(pkg, null, 2)}\n`, 'utf-8')
      console.log(`Resolved protocols in ${pkg.name ?? path}`)
    }
  }
}

run().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
