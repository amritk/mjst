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
 * Detects whether generated parsers should import `@amritk/helpers` from the
 * package (`'package'`) or ship the helper sources alongside them (`'embedded'`).
 *
 * We select `'package'` only when `@amritk/helpers` is a *declared* dependency
 * (dependencies / devDependencies / peer / optional) of the target project's
 * nearest `package.json` above `outputDir`. Merely being *resolvable* is not
 * enough: under npm/bun's hoisted layouts `@amritk/helpers` can sit in
 * `node_modules` purely as a transitive dependency of `@amritk/mjst`, which
 * makes `import '@amritk/helpers/...'` work locally but break under
 * pnpm/isolated installs where undeclared packages are not reachable. Requiring
 * a declaration keeps auto-detected `'package'` output portable across install
 * layouts; everything else falls back to the self-contained `'embedded'` mode.
 */
export const detectHelpersMode = (outputDir: string): 'package' | 'embedded' => {
  let dir = resolve(outputDir)
  const { root } = parsePath(dir)

  while (true) {
    const declared = readDeclaredDeps(join(dir, 'package.json'))
    if (declared) {
      return declared.has('@amritk/helpers') ? 'package' : 'embedded'
    }
    if (dir === root) break
    dir = dirname(dir)
  }

  return 'embedded'
}
