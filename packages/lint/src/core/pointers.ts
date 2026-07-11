import { dirname, resolve as resolvePath } from 'node:path'

import type { IDocumentRegistry, IOriginMap, ISourceOrigin, JsonPath } from './types'

const isContainer = (value: unknown): value is Record<string, unknown> | unknown[] =>
  typeof value === 'object' && value !== null

/**
 * Decodes one JSON-pointer segment the way `getByPointer` does: percent-escapes
 * first (pointers arrive inside URI-reference `$ref`s), then the JSON-pointer
 * escapes `~1`/`~0`, then all-digit segments become numbers. Shared by both the
 * `#/...` and fragment parsers so they decode identically.
 */
const decodeSegment = (segment: string): string | number => {
  let decoded = segment
  try {
    decoded = decodeURIComponent(segment)
  } catch {
    // Leave invalid percent-escapes as-is rather than throwing.
  }
  decoded = decoded.replace(/~1/g, '/').replace(/~0/g, '~')
  return /^\d+$/.test(decoded) ? Number(decoded) : decoded
}

/** Parses an internal JSON pointer (`#/a/b`) into a path; returns undefined for external refs. */
export const pointerToPath = (pointer: string): JsonPath | undefined => {
  if (pointer === '#') return []
  if (!pointer.startsWith('#/')) return undefined
  return pointer.slice(2).split('/').map(decodeSegment)
}

const isRemote = (location: string): boolean => /^https?:\/\//i.test(location)

/**
 * Resolves the location of `ref` (its file/URL part) relative to `base`, exactly
 * as `@amritk/resolve-refs` does, so the keys we look up in the source set match
 * the documents the resolver loaded.
 */
const joinLocation = (base: string, ref: string): string => {
  if (isRemote(ref)) return ref
  if (isRemote(base)) return new URL(ref, base).href
  return resolvePath(dirname(base), ref)
}

/** Splits a `$ref` into its document part and JSON-pointer fragment (without `#`). */
const splitRef = (ref: string): { filePart: string; fragment: string } => {
  const hashIndex = ref.indexOf('#')
  return {
    filePart: hashIndex === -1 ? ref : ref.slice(0, hashIndex),
    fragment: hashIndex === -1 ? '' : ref.slice(hashIndex + 1),
  }
}

/**
 * Parses a JSON-pointer fragment (the part after `#`, e.g. `/a/b`) into a path,
 * mirroring `getByPointer`'s decoding (`%XX` then `~1`/`~0`) so cross-file
 * pointers resolve to the same nodes the resolver inlined.
 */
const fragmentToPath = (fragment: string): JsonPath => {
  if (fragment === '' || fragment === '/') return []
  return fragment.replace(/^\//, '').split('/').map(decodeSegment)
}

const getAtPath = (root: unknown, path: JsonPath): unknown => {
  let node: unknown = root
  for (const segment of path) {
    if (!isContainer(node)) return undefined
    node = (node as Record<string | number, unknown>)[segment]
  }
  return node
}

/**
 * Translates a path into the *resolved* (dereferenced) document back into the
 * equivalent path in the *original* source document, following internal `$ref`s.
 * This lets findings produced against the resolved tree resolve to the exact
 * line:column of the original `$ref` target. External refs stop the walk at the
 * `$ref` site.
 */
export const resolveSourcePath = (root: unknown, path: JsonPath): JsonPath => {
  let originalPath: JsonPath = []
  let node: unknown = root

  const followRefs = () => {
    let guard = 0
    while (isContainer(node) && !Array.isArray(node) && typeof node['$ref'] === 'string' && guard++ < 100) {
      const target = pointerToPath(node['$ref'])
      if (!target) return
      originalPath = [...target]
      node = getAtPath(root, target)
    }
  }

  followRefs()
  for (const segment of path) {
    if (!isContainer(node)) break
    originalPath.push(segment)
    node = (node as Record<string | number, unknown>)[segment]
    followRefs()
  }
  return originalPath
}

/**
 * Cross-document generalization of {@link resolveSourcePath}: translates a path
 * in the *resolved* (dereferenced) tree back to the document it actually came
 * from and the path within it, following both internal (`#/...`) and external
 * (other-file / remote) `$ref`s through the {@link IDocumentRegistry}. This is
 * what lets a finding on a node inlined from `./pet.yaml` report `pet.yaml`'s own
 * line:column instead of the `$ref` site in the root.
 *
 * The walk re-derives the resolver's traversal over the *unresolved* documents,
 * so a `$ref` whose target file is not in the registry (e.g. it failed to load)
 * stops the walk at the last known location rather than guessing. Prefer
 * {@link resolveSourceOriginFromMap} when the resolver supplies an origin map —
 * it avoids re-deriving this traversal.
 */
export const resolveSourceOrigin = (registry: IDocumentRegistry, path: JsonPath): ISourceOrigin => {
  let location = registry.rootLocation
  let root: unknown = registry.get(location)?.data
  let originalPath: JsonPath = []
  let node: unknown = root

  const followRefs = () => {
    let guard = 0
    while (isContainer(node) && !Array.isArray(node) && typeof node['$ref'] === 'string' && guard++ < 1000) {
      const { filePart, fragment } = splitRef(node['$ref'])
      if (filePart !== '') {
        const target = joinLocation(location, filePart)
        const doc = registry.get(target)
        if (!doc) return
        location = target
        root = doc.data
      }
      originalPath = fragmentToPath(fragment)
      node = getAtPath(root, originalPath)
    }
  }

  followRefs()
  for (const segment of path) {
    if (!isContainer(node)) break
    originalPath.push(segment)
    node = (node as Record<string | number, unknown>)[segment]
    followRefs()
  }
  return { location, path: originalPath }
}

/**
 * Single-walk equivalent of {@link resolveSourceOrigin} that uses the resolver's
 * per-node origin map instead of re-walking the unresolved documents. We descend
 * the *resolved* tree along `path`; whenever we step onto a node the resolver
 * stamped (it was inlined from a `$ref`), we re-base onto that node's origin
 * document and in-file path, then keep appending the remaining segments. Nodes
 * straight from the root carry no stamp, so they stay attributed to the root.
 */
export const resolveSourceOriginFromMap = (
  resolved: unknown,
  origins: IOriginMap,
  rootLocation: string,
  path: JsonPath,
): ISourceOrigin => {
  let location = rootLocation
  let inFilePath: JsonPath = []
  let node: unknown = resolved
  for (const segment of path) {
    if (!isContainer(node)) break
    node = (node as Record<string | number, unknown>)[segment]
    const stamp = isContainer(node) ? origins.get(node) : undefined
    if (stamp) {
      location = stamp.location
      inFilePath = [...stamp.pointer]
    } else {
      inFilePath.push(segment)
    }
  }
  return { location, path: inFilePath }
}
