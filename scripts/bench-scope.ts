import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Decides which benchmark suites a pull request actually needs to run.
 *
 * Benching every suite on every PR costs ~8 minutes and buries the one table
 * that matters under three tables of pure runner noise. A change to
 * `packages/yaml` cannot move the api request throughput, so timing it says
 * nothing — but it can move anything that *depends* on yaml, so "just the
 * edited package" is too narrow. The scope is therefore the edited packages
 * plus their transitive dependants, resolved from the workspace graph.
 *
 * Anything outside `packages/` that could plausibly change a number (the
 * bench harness itself, the lockfile, root tsconfig) falls back to running
 * every suite; only paths that provably cannot (markdown, changesets, docs)
 * are ignored outright. Unrecognised paths run everything — the failure mode
 * of a stale ignore list should be a slow bench, not a silently missing one.
 */

/** One benchmarked surface in the delta table, and the workspace package it times. */
export type Suite = {
  /** Suite name as it appears in the `Suite` column and in `--suites`. */
  readonly name: string
  /** Directory under `packages/` whose code this suite times. */
  readonly pkgDir: string
}

/**
 * Every suite `bench-compare.ts` can run, in table order. `codegen` shares
 * generate-parsers with `parsers`: it times `buildSchema` (compile time)
 * rather than the parser it emits (run time).
 *
 * `runtime` times @amritk/runtime-validators directly. It used to be covered
 * only through `api`, which runs the interpreter behind a whole request path —
 * so an interpreter regression arrived diluted by request overhead, and one in
 * a keyword the api bench's contracts happen not to use arrived not at all,
 * even though @amritk/lint runs those keywords on every schema rule.
 */
export const SUITES: readonly Suite[] = [
  { name: 'parsers', pkgDir: 'generate-parsers' },
  { name: 'validators', pkgDir: 'generate-validators' },
  { name: 'api', pkgDir: 'api' },
  { name: 'codegen', pkgDir: 'generate-parsers' },
  { name: 'yaml', pkgDir: 'yaml' },
  { name: 'runtime', pkgDir: 'runtime-validators' },
]

/** One workspace package, reduced to what the dependant walk needs. */
export type WorkspacePackage = {
  /** Directory name under `packages/`, which is what changed paths carry. */
  readonly dir: string
  /** Manifest name, which is what dependency entries carry. */
  readonly name: string
  /** Names of the workspace packages this one depends on. */
  readonly dependencies: readonly string[]
}

/**
 * Paths that cannot change a benchmark number. `bench.yml` already keeps
 * docs-only PRs from triggering at all; this list matters for the mixed PR
 * that edits code *and* touches a README, where the markdown must not widen
 * the scope to the package it happens to live in.
 */
const cannotAffectBench = (path: string): boolean =>
  path.endsWith('.md') ||
  path.startsWith('.changeset/') ||
  path.startsWith('docs/') ||
  path === 'LICENSE' ||
  // The bench workflow is deliberately excluded — a change to how the
  // comparison runs should be exercised against the full suite set.
  (path.startsWith('.github/') && path !== '.github/workflows/bench.yml')

/** Reads the workspace graph from the `package.json` of every directory under `packages/`. */
export const readWorkspace = (tree: string): readonly WorkspacePackage[] => {
  const packagesDir = join(tree, 'packages')
  if (!existsSync(packagesDir)) return []

  const packages: WorkspacePackage[] = []
  for (const dir of readdirSync(packagesDir)) {
    const manifestPath = join(packagesDir, dir, 'package.json')
    if (!existsSync(manifestPath)) continue
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
      name?: string
      dependencies?: Record<string, string>
      peerDependencies?: Record<string, string>
      devDependencies?: Record<string, string>
    }
    if (!manifest.name) continue
    // devDependencies count: bench code imports sibling packages through them
    // (generate-parsers' bench reaches for generate-markdown), and an
    // over-wide scope only costs runtime, while a missing edge costs the
    // regression you were looking for.
    const deps = { ...manifest.dependencies, ...manifest.peerDependencies, ...manifest.devDependencies }
    const dependencies = Object.entries(deps)
      .filter(([, range]) => range.startsWith('workspace:'))
      .map(([name]) => name)
    packages.push({ dir, name: manifest.name, dependencies })
  }
  return packages
}

/** The packages a set of changed paths edits directly, keyed by directory name. */
const directlyChanged = (paths: readonly string[]): Set<string> => {
  const dirs = new Set<string>()
  for (const path of paths) {
    const [root, dir, ...rest] = path.split('/')
    // `rest` non-empty rules out `packages/foo` itself (a stray file at that
    // depth is not a package directory).
    if (root === 'packages' && dir && rest.length > 0) dirs.add(dir)
  }
  return dirs
}

/**
 * True when a change reaches beyond one package's runtime code: anything
 * outside `packages/` that isn't provably inert, or any bench harness edit.
 * Harness code crosses package lines (every bench shares
 * generate-parsers/bench/measure.ts) and a change to how a number is measured
 * should be seen against every number, so those run the full set.
 */
const forcesFullRun = (paths: readonly string[]): boolean =>
  paths.some((path) => {
    if (cannotAffectBench(path)) return false
    if (!path.startsWith('packages/')) return true
    return path.split('/')[2] === 'bench'
  })

/**
 * Expands directly-edited packages into themselves plus every package that
 * transitively depends on them — a change to `helpers` reaches every suite,
 * a change to `yaml` reaches only yaml's own dependants.
 */
export const withDependants = (
  changedDirs: ReadonlySet<string>,
  packages: readonly WorkspacePackage[],
): Set<string> => {
  const dirOf = new Map(packages.map((pkg) => [pkg.name, pkg.dir]))
  /** dir → dirs that depend on it, one hop. */
  const dependants = new Map<string, string[]>()
  for (const pkg of packages) {
    for (const depName of pkg.dependencies) {
      const depDir = dirOf.get(depName)
      if (!depDir) continue
      const existing = dependants.get(depDir)
      if (existing) existing.push(pkg.dir)
      else dependants.set(depDir, [pkg.dir])
    }
  }

  const affected = new Set(changedDirs)
  const queue = [...changedDirs]
  for (let i = 0; i < queue.length; i++) {
    const dir = queue[i]
    if (dir === undefined) continue
    for (const dependant of dependants.get(dir) ?? []) {
      // The `has` guard also terminates on a dependency cycle.
      if (affected.has(dependant)) continue
      affected.add(dependant)
      queue.push(dependant)
    }
  }
  return affected
}

/** What {@link selectSuites} decided, and the one-line explanation for the report. */
export type Scope = {
  /** Suite names to run, in {@link SUITES} order. */
  readonly suites: readonly string[]
  /** Human-readable scope, rendered under the delta table. */
  readonly reason: string
}

/**
 * Picks the suites to run for a set of changed paths. An empty path list means
 * "nothing known about the change" (a local run, or a first push whose file
 * list could not be read) and runs everything.
 */
export const selectSuites = (paths: readonly string[], packages: readonly WorkspacePackage[]): Scope => {
  const everything = { suites: SUITES.map((suite) => suite.name), reason: 'all suites' } as const

  if (paths.length === 0) return { ...everything, reason: 'all suites (no changed-file list)' }
  if (forcesFullRun(paths)) return { ...everything, reason: 'all suites (shared or bench-harness changes)' }

  const changedDirs = directlyChanged(paths.filter((path) => !cannotAffectBench(path)))
  if (changedDirs.size === 0) return { suites: [], reason: 'no benchmarked code changed' }

  const affected = withDependants(changedDirs, packages)
  const suites = SUITES.filter((suite) => affected.has(suite.pkgDir)).map((suite) => suite.name)
  const edited = [...changedDirs].sort().join(', ')

  return {
    suites,
    reason: suites.length === 0 ? `no benchmarked package depends on ${edited}` : `scoped to ${edited} and dependants`,
  }
}
