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
  // The default (unnamed) catalog and any named catalogs (`catalog:<name>`).
  catalog?: Record<string, string>
  catalogs?: Record<string, Record<string, string>>
} & Partial<Record<(typeof DEP_FIELDS)[number], Record<string, string>>>

const readJson = async (path: string): Promise<PackageJson> => JSON.parse(await readFile(path, 'utf-8'))

const resolveWorkspace = (spec: string, version: string): string => {
  const range = spec.slice('workspace:'.length)
  if (range === '' || range === '*') return version
  if (range === '^' || range === '~') return `${range}${version}`
  // workspace:1.2.3 / workspace:^1.0.0 — keep the explicit range
  return range
}

/**
 * Resolves a `catalog:` / `catalog:<name>` specifier to a concrete range.
 * The bare form reads the default `catalog`; a named form reads `catalogs[name]`.
 * A specifier pointing at a missing catalog or entry throws — previously a
 * `catalog:<name>` matched neither branch and shipped literally, breaking installs.
 */
const resolveCatalog = (spec: string, name: string, root: PackageJson): string => {
  const catalogName = spec.slice('catalog:'.length)
  const table = catalogName === '' ? (root.catalog ?? {}) : (root.catalogs?.[catalogName] ?? {})
  const resolved = table[name]
  if (!resolved) {
    const where = catalogName === '' ? 'catalog' : `catalog "${catalogName}"`
    throw new Error(`No ${where} entry for "${name}" in root package.json`)
  }
  return resolved
}

const run = async (): Promise<void> => {
  const root = await readJson(join(ROOT, 'package.json'))

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

  // Resolve every manifest fully *before* writing any of them. An unresolvable
  // specifier throws here, leaving the working tree untouched — otherwise a
  // mid-run failure would leave the tree half-rewritten with no restore path.
  const pending: { path: string; content: string; name: string }[] = []

  for (const { path, pkg } of manifests) {
    let changed = false

    for (const field of DEP_FIELDS) {
      const deps = pkg[field]
      if (!deps) continue

      for (const [name, spec] of Object.entries(deps)) {
        if (spec.startsWith('catalog:')) {
          deps[name] = resolveCatalog(spec, name, root)
          changed = true
        } else if (spec.startsWith('workspace:')) {
          const version = versions.get(name)
          if (!version) throw new Error(`No workspace version found for "${name}"`)
          deps[name] = resolveWorkspace(spec, version)
          changed = true
        }
      }
    }

    if (changed) pending.push({ path, content: `${JSON.stringify(pkg, null, 2)}\n`, name: pkg.name ?? path })
  }

  for (const { path, content, name } of pending) {
    await writeFile(path, content, 'utf-8')
    console.log(`Resolved protocols in ${name}`)
  }
}

run().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
