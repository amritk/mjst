import { dirname, resolve as resolvePath } from 'node:path'

import type { IDocumentRegistry, IOriginMap, ISourceOrigin, JsonPath } from './types'

const isContainer = (value: unknown): value is Record<string, unknown> | unknown[] =>
  typeof value === 'object' && value !== null

/**
 * Reads one path segment out of a container. `Object.hasOwn`, not a bare index:
 * these paths are built from `$ref` pointers and finding paths, both of which
 * come from the linted document, so a segment named `constructor` would
 * otherwise hand back the function every object inherits instead of "no such
 * node here".
 */
const childOf = (node: Record<string, unknown> | unknown[], segment: string | number): unknown =>
  Object.hasOwn(node, segment) ? (node as Record<string | number, unknown>)[segment] : undefined

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
 * the documents the resolver loaded. `undefined` when the `$ref` does not form a
 * location at all — `$ref: "//"` against a remote base is a `new URL` TypeError,
 * and a `$ref` comes from the linted document, which is untrusted input: it has
 * to stop the walk, not abort the lint run.
 */
const joinLocation = (base: string, ref: string): string | undefined => {
  if (isRemote(ref)) return ref
  if (isRemote(base)) {
    try {
      return new URL(ref, base).href
    } catch {
      return undefined
    }
  }
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
    node = childOf(node, segment)
  }
  return node
}

/**
 * True when `node` is a `$ref` object the walk should step through to reach
 * `next`.
 *
 * A `$ref` can carry siblings — `{ $ref: '#/…/CompletionUsage', nullable: true }`
 * — and those siblings live at the `$ref` site, not in the target. Stepping
 * through the ref to read one produces a path to a node the author never wrote,
 * which then resolves to no range and to nothing a fixer can edit. So a segment
 * the `$ref` object owns itself is read where it was written; anything else
 * (including the end of the path, where the finding is about the referenced node
 * as a whole) follows the ref.
 */
const stepsThroughRef = (node: unknown, next: string | number | undefined): node is { $ref: string } =>
  isContainer(node) &&
  !Array.isArray(node) &&
  typeof node['$ref'] === 'string' &&
  (next === undefined || !Object.hasOwn(node, next))

/**
 * Translates a path into the *resolved* (dereferenced) document back into the
 * equivalent path in the *original* source document, following internal `$ref`s.
 * This lets findings produced against the resolved tree resolve to the exact
 * line:column of the original `$ref` target. External refs stop the walk at the
 * `$ref` site, and so does a segment written as a sibling of the `$ref`.
 */
export const resolveSourcePath = (root: unknown, path: JsonPath): JsonPath => {
  let originalPath: JsonPath = []
  let node: unknown = root

  const followRefs = (next: string | number | undefined) => {
    let guard = 0
    while (stepsThroughRef(node, next) && guard++ < 100) {
      const target = pointerToPath(node.$ref)
      if (!target) return
      originalPath = [...target]
      node = getAtPath(root, target)
    }
  }

  followRefs(path[0])
  for (const [index, segment] of path.entries()) {
    if (!isContainer(node)) break
    originalPath.push(segment)
    node = childOf(node, segment)
    followRefs(path[index + 1])
  }
  return originalPath
}

/**
 * A path built by appending to a shared prefix, so taking a step costs one link
 * rather than a copy of every segment before it. `base` is where the last `$ref`
 * followed led (or the root); `segments` holds what was read after it, innermost
 * first.
 */
type PathTail = { readonly segment: string | number; readonly rest: PathTail | undefined }

/** A route's progress through {@link resolveSourcePath}: up to a node, before following refs past it. */
type SourceStep = {
  readonly base: JsonPath
  readonly segments: PathTail | undefined
  readonly node: unknown
  readonly stopped: boolean
}

/** The whole path a step stands for. */
const pathOfStep = (step: SourceStep): JsonPath => {
  const tail: (string | number)[] = []
  for (let link = step.segments; link !== undefined; link = link.rest) tail.push(link.segment)
  return [...step.base, ...tail.reverse()]
}

/**
 * Follows `$ref`s at `step` the way {@link resolveSourcePath} does before reading
 * `next` (bounded the same way, against a ref cycle in the source).
 */
const followRefsAt = (root: unknown, step: SourceStep, next: string | number | undefined, guard = 0): SourceStep => {
  if (guard >= 100 || !stepsThroughRef(step.node, next)) return step
  const target = pointerToPath(step.node.$ref)
  if (!target) return step
  return followRefsAt(
    root,
    { base: target, segments: undefined, node: getAtPath(root, target), stopped: false },
    next,
    guard + 1,
  )
}

/** One segment of {@link resolveSourcePath}, from the step before it. */
const stepInto = (root: unknown, step: SourceStep, segment: string | number): SourceStep => {
  if (step.stopped) return step
  const followed = followRefsAt(root, step, segment)
  if (!isContainer(followed.node)) return { ...followed, stopped: true }
  return {
    base: followed.base,
    segments: { segment, rest: followed.segments },
    node: childOf(followed.node, segment),
    stopped: false,
  }
}

/**
 * {@link resolveSourcePath} for nodes of a parent-linked walk, computed once per
 * node from its parent's answer rather than from the root on every call. Asking
 * for many nodes of one walk — as revisit checks over a shared tree do — then
 * costs one step each, plus spelling out the path of a node actually asked about.
 * The climb to the nearest node already answered is iterative, since a walk is as
 * deep as its document.
 */
export const createSourcePathIndex = <
  N extends { readonly parent: N | undefined; readonly key: string | number | undefined },
>(
  root: unknown,
): ((node: N) => JsonPath) => {
  const steps = new WeakMap<N, SourceStep>()
  const answers = new WeakMap<N, JsonPath>()
  const stepOf = (node: N): SourceStep => {
    const chain: N[] = [node]
    while (!steps.has(chain[chain.length - 1] as N) && (chain[chain.length - 1] as N).parent !== undefined) {
      chain.push((chain[chain.length - 1] as N).parent as N)
    }
    const top = chain[chain.length - 1] as N
    const start = steps.get(top) ?? { base: [], segments: undefined, node: root, stopped: false }
    steps.set(top, start)
    return chain
      .slice(0, -1)
      .reverse()
      .reduce((step, at) => {
        const next = stepInto(root, step, at.key as string | number)
        steps.set(at, next)
        return next
      }, start)
  }
  return (node) => {
    const known = answers.get(node)
    if (known !== undefined) return known
    const step = stepOf(node)
    const answer = pathOfStep(step.stopped ? step : followRefsAt(root, step, undefined))
    answers.set(node, answer)
    return answer
  }
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
 * stops the walk at the last known location rather than guessing, and a segment
 * written as a sibling of the `$ref` is read at the `$ref` site. Prefer
 * {@link resolveSourceOriginFromMap} when the resolver supplies an origin map —
 * it avoids re-deriving this traversal.
 */
export const resolveSourceOrigin = (registry: IDocumentRegistry, path: JsonPath): ISourceOrigin => {
  let location = registry.rootLocation
  let root: unknown = registry.get(location)?.data
  let originalPath: JsonPath = []
  let node: unknown = root

  const followRefs = (next: string | number | undefined) => {
    let guard = 0
    while (stepsThroughRef(node, next) && guard++ < 1000) {
      const { filePart, fragment } = splitRef(node.$ref)
      if (filePart !== '') {
        const target = joinLocation(location, filePart)
        if (target === undefined) return
        const doc = registry.get(target)
        if (!doc) return
        location = target
        root = doc.data
      }
      originalPath = fragmentToPath(fragment)
      node = getAtPath(root, originalPath)
    }
  }

  followRefs(path[0])
  for (const [index, segment] of path.entries()) {
    if (!isContainer(node)) break
    originalPath.push(segment)
    node = childOf(node, segment)
    followRefs(path[index + 1])
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
    node = childOf(node, segment)
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
