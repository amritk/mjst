/**
 * Resolution of `workspace:` and `catalog:` dependency specifiers to concrete
 * version ranges — the logic behind `scripts/resolve-workspace-protocol.ts`
 * (the release pipeline runs it before `changeset publish`) and the consumer
 * e2e test (which packs tarballs the same way the release does).
 *
 * Kept as a side-effect-free library so tests can exercise exactly the code
 * the release uses without touching the working tree.
 */

export const DEP_FIELDS = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'] as const

export type PackageJson = {
  name?: string
  version?: string
  private?: boolean
  // The default (unnamed) catalog and any named catalogs (`catalog:<name>`).
  catalog?: Record<string, string>
  catalogs?: Record<string, Record<string, string>>
} & Partial<Record<(typeof DEP_FIELDS)[number], Record<string, string>>>

export const resolveWorkspace = (spec: string, version: string): string => {
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
export const resolveCatalog = (spec: string, name: string, root: PackageJson): string => {
  const catalogName = spec.slice('catalog:'.length)
  const table = catalogName === '' ? (root.catalog ?? {}) : (root.catalogs?.[catalogName] ?? {})
  const resolved = table[name]
  if (!resolved) {
    const where = catalogName === '' ? 'catalog' : `catalog "${catalogName}"`
    throw new Error(`No ${where} entry for "${name}" in root package.json`)
  }
  return resolved
}

/**
 * Rewrites every `workspace:`/`catalog:` specifier in `pkg`'s dependency
 * fields (in place) to a concrete range. Returns true when anything changed.
 */
export const resolveProtocols = (pkg: PackageJson, versions: Map<string, string>, root: PackageJson): boolean => {
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

  return changed
}
