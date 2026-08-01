import { realpathSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'

/** Whether `target` is `root` itself or lives somewhere beneath it. */
const isUnder = (root: string, target: string): boolean => {
  const rel = relative(root, target)
  // `relative` returns '' for the same path, a '..'-prefixed path for an escape,
  // and an absolute path when the two are on different roots (Windows drives).
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

/**
 * The real (symlink-free) form of `path`. A path that does not exist yet — a
 * `$ref` to a missing file — still needs an answer, so we resolve the deepest
 * ancestor that *does* exist and re-attach the rest.
 */
const realPathOf = (path: string): string => {
  const tail: string[] = []
  let current = path
  for (;;) {
    try {
      const real = realpathSync(current)
      return tail.length === 0 ? real : join(real, ...tail)
    } catch {
      const parent = dirname(current)
      // `dirname('/')` is `/`: we ran out of ancestors, so nothing on this path
      // exists and the lexical form is the best answer available.
      if (parent === current) return path
      tail.unshift(basename(current))
      current = parent
    }
  }
}

/**
 * Whether the file at `target` is confined to the directory `root`, used to keep
 * a local `$ref` from reaching outside the document tree it belongs to
 * (`{"$ref": "../../../etc/passwd"}`).
 *
 * Both the lexical path *and* the symlink-resolved path must be contained: the
 * lexical check alone misses a symlink planted inside the root that points out
 * of it, and the real-path check alone would reject a root that is itself
 * reached through a symlink (`/tmp` → `/private/tmp` on macOS) unless both sides
 * were normalized the same way — which is exactly what this does.
 */
export const isContainedPath = (root: string, target: string): boolean => {
  const absoluteRoot = resolve(root)
  const absoluteTarget = resolve(target)
  if (!isUnder(absoluteRoot, absoluteTarget)) return false
  return isUnder(realPathOf(absoluteRoot), realPathOf(absoluteTarget))
}
