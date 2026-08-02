import { execFileSync } from 'node:child_process'
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

/** The subset of `changeset status --output` that this check reads. */
export type ChangesetStatus = {
  releases: {
    name: string
    oldVersion: string
    newVersion: string
  }[]
  /** Every pending changeset, with the bump it requests per package. */
  changesets: {
    id: string
    releases: { name: string; type: 'major' | 'minor' | 'patch' | 'none' }[]
  }[]
}

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
 * So this looks at the version each package would actually publish at: the one
 * the pending changesets project, or the one in package.json when no changeset
 * touches it. The second half matters because a hand-edited version never
 * appears in the release plan at all.
 *
 * Going 1.0.0 should be a decision, not a side effect — when it is time, set
 * `ALLOW_MAJOR_RELEASE=1` for that run.
 */
export const findVersionLineViolations = (
  packages: PackageVersion[],
  status: ChangesetStatus | null,
): VersionLineViolation[] => {
  const pending = new Map((status?.releases ?? []).map((release) => [release.name, release]))

  return packages.flatMap((pkg) => {
    const nextVersion = pending.get(pkg.name)?.newVersion ?? pkg.version
    if (nextVersion.startsWith('0.')) return []

    // A release lists every changeset that touched the package, but only the
    // ones asking for `major` are worth pointing at — the rest are innocent
    // patches that happen to ride along.
    const changesets = (status?.changesets ?? [])
      .filter((changeset) => changeset.releases.some((r) => r.name === pkg.name && r.type === 'major'))
      .map((changeset) => changeset.id)

    return [{ name: pkg.name, currentVersion: pkg.version, nextVersion, changesets }]
  })
}

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

/**
 * Runs `changeset status` for its machine-readable release plan.
 *
 * Returns null when there is nothing pending: changesets prints "no changesets
 * present" and returns before writing the output file, which is the normal
 * state on `main` right after a release PR merges.
 */
const readChangesetStatus = async (root: string): Promise<ChangesetStatus | null> => {
  const dir = await mkdtemp(join(tmpdir(), 'mjst-version-line-'))
  const output = join(dir, 'status.json')

  try {
    // Not inside the try/catch below: a missing `changeset` binary is also an
    // ENOENT, and swallowing that one would turn a broken install into a pass.
    execFileSync('changeset', ['status', `--output=${output}`], { cwd: root, stdio: 'pipe' })

    try {
      return JSON.parse(await readFile(output, 'utf-8')) as ChangesetStatus
    } catch (error: unknown) {
      const isMissing = typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT'
      if (isMissing) return null
      throw error
    }
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = join(import.meta.dir, '..')

  Promise.all([readPackageVersions(root), readChangesetStatus(root)])
    .then(([packages, status]) => {
      const violations = findVersionLineViolations(packages, status)
      if (violations.length === 0) {
        console.log(`Every package stays on 0.x (${packages.length} checked)`)
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
