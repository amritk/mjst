import { readFileSync } from 'node:fs'
import { dirname, join, parse as parsePath, resolve } from 'node:path'

/** Reads a package.json's declared dependency names, or `undefined` if unreadable. */
const readDeclaredDeps = (packageJsonPath: string): Set<string> | undefined => {
  try {
    const pkg = JSON.parse(readFileSync(packageJsonPath, 'utf-8')) as {
      dependencies?: Record<string, unknown>
      devDependencies?: Record<string, unknown>
      peerDependencies?: Record<string, unknown>
      optionalDependencies?: Record<string, unknown>
    }
    return new Set([
      ...Object.keys(pkg.dependencies ?? {}),
      ...Object.keys(pkg.devDependencies ?? {}),
      ...Object.keys(pkg.peerDependencies ?? {}),
      ...Object.keys(pkg.optionalDependencies ?? {}),
    ])
  } catch {
    return undefined
  }
}

/**
 * True when `packageName` is a *declared* dependency (dependencies /
 * devDependencies / peer / optional) of the nearest readable `package.json` at
 * or above `fromDir`.
 *
 * Declared, not merely resolvable: under npm/bun's hoisted layouts a package can
 * sit in `node_modules` purely as a transitive dependency of `@amritk/mjst`,
 * which makes importing it work locally but break under pnpm/isolated installs
 * where undeclared packages are not reachable. Generated code has to survive
 * both, so the question worth asking is whether the *project* asked for the
 * package, not whether this machine happens to have it.
 *
 * Only the nearest package.json is consulted. A workspace root above it may well
 * declare the package, but a nested package that does not declare it cannot rely
 * on the hoist — which is exactly the case this is meant to catch.
 */
export const isDependencyDeclared = (fromDir: string, packageName: string): boolean => {
  let dir = resolve(fromDir)
  const { root } = parsePath(dir)

  while (true) {
    const declared = readDeclaredDeps(join(dir, 'package.json'))
    if (declared) return declared.has(packageName)
    if (dir === root) break
    dir = dirname(dir)
  }

  return false
}
