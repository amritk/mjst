import { isMap, isSeq } from './guards'
import type { YamlNode } from './types'

/** A path into a document, e.g. `['paths', '/pets', 'get']` or `['tags', 0]`. */
export type NodePath = readonly (string | number)[]

/**
 * Walks a node tree to the node addressed by `path`, returning it (with its
 * exact `range`) or `undefined` if the path does not exist.
 *
 * When `closest` is true and the full path is missing, it returns the deepest
 * ancestor that does exist — exactly what a linter wants so a diagnostic can
 * still point at the nearest real source span instead of nowhere. Keys are
 * compared as strings so a numeric path segment matches a stringified map key.
 */
export const nodeAtPath = (root: YamlNode | null, path: NodePath, closest = false): YamlNode | undefined => {
  let node: YamlNode | null | undefined = root
  let matched: YamlNode | undefined = root ?? undefined

  for (const segment of path) {
    if (!node) break
    let next: YamlNode | null | undefined

    if (isMap(node)) {
      const key = String(segment)
      for (const pair of node.items) {
        if (keyOf(pair.key) === key) {
          next = pair.value
          break
        }
      }
    } else if (isSeq(node)) {
      const index = typeof segment === 'number' ? segment : Number(segment)
      next = Number.isInteger(index) ? node.items[index] : undefined
    }

    if (next == null) return closest ? matched : undefined
    node = next
    matched = next
  }

  return node ?? undefined
}

const keyOf = (node: YamlNode): string => {
  if (node.kind === 'scalar') return node.value === null ? 'null' : String(node.value)
  if (node.kind === 'alias') return '*' + node.source
  return ''
}
