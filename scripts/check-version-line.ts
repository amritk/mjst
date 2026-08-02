import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { type PendingChangeset, readPendingChangesets } from './read-pending-changesets'

export type PackageVersion = {
  name: string
  version: string
}

export type VersionLineViolation = {
  name: string
  currentVersion: string
  nextVersion: string
  /**
   * The changeset IDs asking for a `major` on this package — the exact files to
   * edit. Empty when the package.json version is itself already past 0.x.
   */
  changesets: string[]
}

/**
 * Reports every package that would leave the `0.x` line.
 *
 * This project stays pre-1.0 on purpose, but changesets has no config knob for
 * that: a `major` bump on a `0.x` package resolves to `1.0.0`, not `0.(x+1).0`.
 * Six PRs in a row each marked a genuinely breaking codegen change as `major`
 * — correct under plain semver, and individually invisible — and the release
 * PR quietly grew four 1.0.0 packages. Nothing failed, because nothing was
 * looking.
 *
 * An explicit `major` is the only way a package here reaches 1.0.0: with no
 * `fixed` or `linked` groups configured, and `updateInternalDependencies` set
 * to `patch`, a dependent picks up at most a patch when a dependency breaks.
 * So the whole rule is "no `major` while on 0.x", plus a look at the versions
 * themselves to catch one edited past 0.x by hand, which no changeset explains.
 *
 * Going 1.0.0 should be a decision, not a side effect — when it is time, set
 * `ALLOW_MAJOR_RELEASE=1` for that run.
 */
export const findVersionLineViolations = (
  packages: PackageVersion[],
  changesets: PendingChangeset[],
): VersionLineViolation[] =>
  packages.flatMap((pkg) => {
    if (!pkg.version.startsWith('0.')) {
      return [{ name: pkg.name, currentVersion: pkg.version, nextVersion: pkg.version, changesets: [] }]
    }

    const guilty = changesets
      .filter((changeset) => changeset.releases.some((r) => r.name === pkg.name && r.type === 'major'))
      .map((changeset) => changeset.id)
    if (guilty.length === 0) return []

    return [{ name: pkg.name, currentVersion: pkg.version, nextVersion: '1.0.0', changesets: guilty }]
  })

/** Reads the name and version of every publishable workspace package. */
const readPackageVersions = async (root: string): Promise<PackageVersion[]> => {
  const packagesDir = join(root, 'packages')
  const versions: PackageVersion[] = []

  for (const entry of await readdir(packagesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const manifest = join(packagesDir, entry.name, 'package.json')
    const pkg = JSON.parse(await readFile(manifest, 'utf-8')) as {
      name: string
      version?: string
      private?: boolean
    }
    if (pkg.private === true || pkg.version === undefined) continue
    versions.push({ name: pkg.name, version: pkg.version })
  }

  return versions
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = join(import.meta.dir, '..')

  Promise.all([readPackageVersions(root), readPendingChangesets(root)])
    .then(([packages, changesets]) => {
      const violations = findVersionLineViolations(packages, changesets)
      if (violations.length === 0) {
        console.log(`Every package stays on 0.x (${packages.length} packages, ${changesets.length} changesets)`)
        return
      }

      if (process.env.ALLOW_MAJOR_RELEASE !== undefined) {
        for (const violation of violations) {
          console.log(`ALLOW_MAJOR_RELEASE set — allowing ${violation.name} ${violation.nextVersion}`)
        }
        return
      }

      console.error('These packages would leave the 0.x line:\n')
      for (const violation of violations) {
        console.error(`  ${violation.name}  ${violation.currentVersion} -> ${violation.nextVersion}`)
        for (const id of violation.changesets) console.error(`    .changeset/${id}.md`)
      }
      console.error(
        '\nChange the `major` bump in those changesets to `minor` — the summary can still' +
          '\ndescribe the breaking change. If this release really is meant to be 1.0.0, run' +
          '\nwith ALLOW_MAJOR_RELEASE=1.',
      )
      process.exit(1)
    })
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : error)
      process.exit(1)
    })
}
