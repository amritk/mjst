import { describe, expect, it } from 'vitest'

import { readWorkspace, SUITES, selectSuites, type WorkspacePackage, withDependants } from './bench-scope.ts'

/**
 * A miniature stand-in for the real workspace, so the selection rules are
 * pinned independently of the packages that happen to exist today.
 * `beta` depends on `alpha`; `gamma` depends on `beta`.
 */
const PACKAGES: readonly WorkspacePackage[] = [
  { dir: 'alpha', name: '@x/alpha', dependencies: [] },
  { dir: 'beta', name: '@x/beta', dependencies: ['@x/alpha'] },
  { dir: 'gamma', name: '@x/gamma', dependencies: ['@x/beta'] },
]

const names = (suites: readonly string[]): string => [...suites].sort().join(',')

describe('bench-scope', () => {
  it('walks dependants transitively', () => {
    expect([...withDependants(new Set(['alpha']), PACKAGES)].sort()).toEqual(['alpha', 'beta', 'gamma'])
    expect([...withDependants(new Set(['beta']), PACKAGES)].sort()).toEqual(['beta', 'gamma'])
    expect([...withDependants(new Set(['gamma']), PACKAGES)]).toEqual(['gamma'])
  })

  it('terminates on a dependency cycle', () => {
    const cyclic: readonly WorkspacePackage[] = [
      { dir: 'a', name: '@x/a', dependencies: ['@x/b'] },
      { dir: 'b', name: '@x/b', dependencies: ['@x/a'] },
    ]
    expect([...withDependants(new Set(['a']), cyclic)].sort()).toEqual(['a', 'b'])
  })

  it('ignores dependencies on packages outside the workspace', () => {
    const withExternal: readonly WorkspacePackage[] = [{ dir: 'solo', name: '@x/solo', dependencies: ['vitest'] }]
    expect([...withDependants(new Set(['solo']), withExternal)]).toEqual(['solo'])
  })

  it('runs everything when nothing is known about the change', () => {
    const scope = selectSuites([], readWorkspace(`${import.meta.dirname}/..`))
    expect(names(scope.suites)).toBe(names(SUITES.map((suite) => suite.name)))
  })

  it('runs everything for a change outside packages/', () => {
    const scope = selectSuites(['scripts/bench-compare.ts'], readWorkspace(`${import.meta.dirname}/..`))
    expect(names(scope.suites)).toBe(names(SUITES.map((suite) => suite.name)))
  })

  // The workflow's own paths-ignore keeps docs-only PRs from triggering, but a
  // PR that edits code *and* a README must not have the README widen its scope.
  it('does not let markdown, changesets or docs widen the scope', () => {
    const scope = selectSuites(
      ['packages/yaml/src/parse.ts', 'packages/api/README.md', '.changeset/soft-pans-clap.md', 'docs/guide.md'],
      readWorkspace(`${import.meta.dirname}/..`),
    )
    expect(scope.suites).toEqual(['yaml'])
  })

  it('reports no coverage when only inert paths changed', () => {
    const scope = selectSuites(['README.md', 'docs/guide.md'], readWorkspace(`${import.meta.dirname}/..`))
    expect(scope.suites).toEqual([])
    expect(scope.reason).toBe('no benchmarked code changed')
  })

  // A change to the bench workflow itself should be validated against every
  // suite, not just whatever package the PR happens to also touch.
  it('runs everything when the bench workflow changes', () => {
    const scope = selectSuites(['.github/workflows/bench.yml'], readWorkspace(`${import.meta.dirname}/..`))
    expect(names(scope.suites)).toBe(names(SUITES.map((suite) => suite.name)))
  })

  it('ignores unrelated workflow changes', () => {
    const scope = selectSuites(['.github/workflows/ci.yml'], readWorkspace(`${import.meta.dirname}/..`))
    expect(scope.suites).toEqual([])
  })

  it('scopes a yaml-only change to the yaml suite', () => {
    const scope = selectSuites(['packages/yaml/src/parse-document.ts'], readWorkspace(`${import.meta.dirname}/..`))
    expect(scope.suites).toEqual(['yaml'])
    expect(scope.reason).toBe('scoped to yaml and dependants')
  })

  // helpers sits under every benchmarked package except yaml, which is
  // deliberately zero-dependency — so its suite must stay out of the scope.
  // `runtime` is in only because runtime-validators keeps helpers as a
  // devDependency, and the graph merges dev/peer/prod edges: a devDependency
  // cannot move that package's shipped numbers, so this row is over-broad by
  // design. Widening beats the alternative — dropping dev edges would also
  // drop the bench harness edges that genuinely do move numbers.
  it('scopes a helpers change to its dependants', () => {
    const scope = selectSuites(['packages/helpers/src/index.ts'], readWorkspace(`${import.meta.dirname}/..`))
    expect(names(scope.suites)).toBe('api,codegen,parsers,runtime,validators')
  })

  // Bench harness code is shared across packages (every bench measures through
  // generate-parsers/bench/measure.ts), so it cannot be scoped to one suite.
  it('runs everything when bench harness code changes', () => {
    const scope = selectSuites(['packages/yaml/bench/worker.ts'], readWorkspace(`${import.meta.dirname}/..`))
    expect(names(scope.suites)).toBe(names(SUITES.map((suite) => suite.name)))
  })

  // api and generate-validators both depend on runtime-validators; nothing
  // downstream of it feeds the parser benches. Its own `runtime` suite leads,
  // so an interpreter change is now timed directly rather than only through
  // the request path that wraps it.
  it('scopes a runtime-validators change to its dependants', () => {
    const scope = selectSuites(['packages/runtime-validators/src/index.ts'], readWorkspace(`${import.meta.dirname}/..`))
    expect(names(scope.suites)).toBe('api,runtime,validators')
  })

  it('explains when a benchmarked package simply does not depend on the change', () => {
    const scope = selectSuites(['packages/resolve-refs/src/index.ts'], readWorkspace(`${import.meta.dirname}/..`))
    expect(scope.suites).toEqual([])
    expect(scope.reason).toBe('no benchmarked package depends on resolve-refs')
  })

  it('reads the real workspace graph', () => {
    const packages = readWorkspace(`${import.meta.dirname}/..`)
    const yaml = packages.find((pkg) => pkg.dir === 'yaml')
    expect(yaml?.name).toBe('@amritk/yaml')
    // Every suite must name a package that actually exists, or it would never run.
    for (const suite of SUITES) expect(packages.some((pkg) => pkg.dir === suite.pkgDir)).toBe(true)
  })

  it('returns an empty graph for a checkout without packages/', () => {
    expect(readWorkspace('/nonexistent-checkout')).toEqual([])
  })
})
