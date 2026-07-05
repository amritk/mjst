import { readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { type PackageJson, resolveProtocols } from './workspace-protocol'

/**
 * Rewrites `workspace:` and `catalog:` dependency specifiers to concrete
 * version ranges in every workspace package.json.
 *
 * `changeset publish` packs via `npm publish`, and npm understands neither
 * protocol — so without this step they ship literally and break installs.
 * Bun's own publisher resolves them at pack time; we reproduce that here so
 * the npm publish path (which gives us provenance) emits installable packages.
 * Intended to run in the ephemeral publish job, never committed.
 *
 * The resolution logic lives in ./workspace-protocol so the consumer e2e test
 * can pack tarballs exactly the way this release step does.
 */

const ROOT = join(import.meta.dir, '..')

const readJson = async (path: string): Promise<PackageJson> => JSON.parse(await readFile(path, 'utf-8'))

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
    if (resolveProtocols(pkg, versions, root)) {
      pending.push({ path, content: `${JSON.stringify(pkg, null, 2)}\n`, name: pkg.name ?? path })
    }
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
