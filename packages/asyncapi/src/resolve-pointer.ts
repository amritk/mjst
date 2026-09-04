import { readKey } from '@amritk/helpers/read-key'

import type { ExtractionIssue } from './types'

/**
 * Follows a same-document JSON Pointer (`#/a/b`) to its target value, or
 * `undefined` when any segment is missing. Segments are unescaped per RFC 6901
 * (`~1` → `/`, `~0` → `~`), and each map step reads own properties only — a
 * pointer segment of `constructor` must find the document's key or nothing,
 * never `Object.prototype`.
 */
export const getByPointer = (document: unknown, pointer: string): unknown => {
  if (pointer === '#' || pointer === '#/') return document
  if (!pointer.startsWith('#/')) return undefined
  let current: unknown = document
  for (const rawSegment of pointer.slice(2).split('/')) {
    const segment = rawSegment.replace(/~1/g, '/').replace(/~0/g, '~')
    if (Array.isArray(current)) {
      const index = Number(segment)
      if (!Number.isInteger(index) || index < 0 || index >= current.length) return undefined
      current = current[index]
    } else if (typeof current === 'object' && current !== null) {
      const record = current as Record<string, unknown>
      let next = readKey(record, segment)
      // Documents also spell pointer segments in the RFC 6901 URI-fragment
      // form; when the raw segment misses, its percent-decoded form gets a try.
      if (next === undefined && segment.includes('%')) {
        try {
          next = readKey(record, decodeURIComponent(segment))
        } catch {
          // Not a valid percent sequence — the miss stands.
        }
      }
      if (next === undefined) return undefined
      current = next
    } else {
      return undefined
    }
  }
  return current
}

/**
 * Dereferences a document node that may be a Reference Object, following
 * chained `$ref`s until an object without one (or a failure) is reached.
 *
 * Only same-document `#/...` pointers are followed: by the time extraction
 * runs, cross-file and remote references are the loader's job
 * (`@amritk/resolve-refs` inlines them), so one still standing here is
 * reported rather than fetched. Failures — an external ref, a dangling
 * pointer, a `$ref` cycle, a non-object target — land on `issues` and resolve
 * to `undefined` so a single broken reference skips one node, not the run.
 */
export const resolveNode = (
  document: unknown,
  node: unknown,
  issues: ExtractionIssue[],
  path: string,
): Record<string, unknown> | undefined => {
  const seen = new Set<string>()
  let current = node
  while (typeof current === 'object' && current !== null && !Array.isArray(current)) {
    const ref = readKey(current as Record<string, unknown>, '$ref')
    if (typeof ref !== 'string') return current as Record<string, unknown>
    if (!ref.startsWith('#')) {
      issues.push({ path, message: `external $ref "${ref}" was not resolved before extraction; node skipped` })
      return undefined
    }
    if (seen.has(ref)) {
      issues.push({ path, message: `$ref cycle through "${ref}"; node skipped` })
      return undefined
    }
    seen.add(ref)
    current = getByPointer(document, ref)
    if (current === undefined) {
      issues.push({ path, message: `$ref "${ref}" does not resolve; node skipped` })
      return undefined
    }
  }
  issues.push({ path, message: 'expected an object node; node skipped' })
  return undefined
}
