import { copyFile, readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

/**
 * Copies the repository LICENSE into every publishable workspace package.
 *
 * npm only bundles a LICENSE file that sits inside the package directory —
 * the root license never reaches the tarball on its own, so published
 * packages would carry a `license: MIT` field with no license text. Like
 * resolve-workspace-protocol and strip-development-exports, this runs in the
 * ephemeral publish job and is never committed.
 */
export const copyLicenses = async (root: string): Promise<string[]> => {
  const source = join(root, 'LICENSE')
  const packagesDir = join(root, 'packages')
  const copied: string[] = []

  for (const entry of await readdir(packagesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const packageDir = join(packagesDir, entry.name)
    const pkg = JSON.parse(await readFile(join(packageDir, 'package.json'), 'utf-8')) as { private?: boolean }
    if (pkg.private === true) continue
    await copyFile(source, join(packageDir, 'LICENSE'))
    copied.push(entry.name)
  }

  return copied
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  copyLicenses(join(import.meta.dir, '..'))
    .then((copied) => {
      for (const name of copied) console.log(`Copied LICENSE into packages/${name}`)
    })
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : error)
      process.exit(1)
    })
}
