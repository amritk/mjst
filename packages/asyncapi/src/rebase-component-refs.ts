import { assignKey } from '@amritk/helpers/assign-key'
import { entersSchemaMap, isDataPosition } from '@amritk/helpers/build-resource-registry'
import { assertSchemaDepth } from '@amritk/helpers/max-schema-depth'
import { readKey } from '@amritk/helpers/read-key'

import { normalizeSchema } from './normalize-schema'
import type { SchemaFormatFamily } from './schema-format'
import { classifySchemaFormat } from './schema-format'
import type { ExtractionIssue } from './types'
import { unwrapMultiFormat } from './unwrap-multi-format'

// A reference into the document's shared schema components, with an optional
// deeper pointer tail that must survive the move (`#/components/schemas/X/properties/y`).
const COMPONENT_SCHEMA_REF = /^#\/components\/schemas\/([^/]+)(\/.*)?$/

/** Unescapes one RFC 6901 pointer segment. */
const decodeSegment = (segment: string): string => segment.replace(/~1/g, '/').replace(/~0/g, '~')

/**
 * Makes an extracted schema self-contained: every `$ref` into the document's
 * `#/components/schemas/...` is rewritten to a local `#/$defs/...` entry, and
 * the referenced components — transitively, since components reference each
 * other — are copied in beside it, normalized with the same dialect rules as
 * the root.
 *
 * Copying rather than leaving document-relative pointers is what lets each
 * message's schema stand alone as a generator input; the cost is that a
 * component used by N messages appears in N output trees, the same trade
 * `--schema-dir` makes across schema files. Component names keep their exact
 * spelling as `$defs` keys so the rewritten pointers resolve; a name the root
 * schema already claims in its own `$defs` (or one needing pointer escapes) is
 * moved to a `component-` prefixed key instead, consistently across every ref
 * to it.
 *
 * A reference to a component the document does not declare becomes an empty
 * (`{}`, match-anything) definition plus an issue — one dangling pointer
 * should cost precision on one branch, not the whole message.
 */
export const rebaseComponentRefs = (
  root: Record<string, unknown>,
  document: unknown,
  family: Exclude<SchemaFormatFamily, 'unsupported'>,
  issues: ExtractionIssue[],
  path: string,
): Record<string, unknown> => {
  const componentSchemas =
    typeof document === 'object' && document !== null
      ? (readKey(
          (readKey(document as Record<string, unknown>, 'components') ?? {}) as Record<string, unknown>,
          'schemas',
        ) as Record<string, unknown> | undefined)
      : undefined

  const rootDefs = readKey(root, '$defs')
  const taken = new Set<string>(
    typeof rootDefs === 'object' && rootDefs !== null ? Object.keys(rootDefs as Record<string, unknown>) : [],
  )
  /** Component name → the `$defs` key allocated for it. */
  const keyByName = new Map<string, string>()
  const queue: string[] = []

  const allocateKey = (name: string): string => {
    const existing = keyByName.get(name)
    if (existing !== undefined) return existing
    // Prefer the component's own name; fall back to a prefixed (then numbered)
    // key when the root's own `$defs` claims it or the name needs pointer
    // escaping, which the generators' pointer lookups do not perform.
    let key = name
    if (taken.has(key) || /[~/]/.test(name)) {
      key = `component-${name.replace(/[~/]+/g, '-')}`
      for (let n = 2; taken.has(key); n++) key = `component-${name.replace(/[~/]+/g, '-')}-${n}`
    }
    taken.add(key)
    keyByName.set(name, key)
    queue.push(name)
    return key
  }

  const rewrite = (node: unknown, depth: number, inSchemaMap: boolean): unknown => {
    assertSchemaDepth(depth, 'rebaseComponentRefs')
    if (Array.isArray(node)) return node.map((item) => rewrite(item, depth + 1, inSchemaMap))
    if (typeof node !== 'object' || node === null) return node

    const record = node as Record<string, unknown>
    const result: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(record)) {
      // Instance data (`enum`, `const`, `default`, `examples`) is copied
      // verbatim: a `$ref`-shaped object there is a literal value the author
      // wrote, and rewriting it changes what the schema accepts.
      if (isDataPosition(key, inSchemaMap)) {
        assignKey(result, key, value)
      } else if (!inSchemaMap && key === '$ref' && typeof value === 'string') {
        const match = COMPONENT_SCHEMA_REF.exec(value)
        if (match) {
          const name = decodeSegment(match[1] as string)
          assignKey(result, key, `#/$defs/${allocateKey(name)}${match[2] ?? ''}`)
        } else {
          assignKey(result, key, value)
        }
      } else {
        assignKey(result, key, rewrite(value, depth + 1, entersSchemaMap(key, inSchemaMap)))
      }
    }
    return result
  }

  const rewrittenRoot = rewrite(root, 0, false) as Record<string, unknown>

  const copiedDefs: Record<string, unknown> = {}
  // `queue` grows while iterating: rewriting one component's refs can pull in
  // another. `keyByName` already de-duplicates, so each name is processed once
  // and a component cycle terminates.
  for (let i = 0; i < queue.length; i++) {
    const name = queue[i] as string
    const defsKey = keyByName.get(name) as string
    const raw = componentSchemas === undefined ? undefined : readKey(componentSchemas, name)
    if (raw === undefined) {
      issues.push({
        path,
        message: `$ref to undeclared component "#/components/schemas/${name}"; treated as an unconstrained schema`,
      })
      assignKey(copiedDefs, defsKey, {})
      continue
    }

    const { schemaFormat, schema } = unwrapMultiFormat(raw)
    const componentFamily = schemaFormat === undefined ? family : classifySchemaFormat(schemaFormat)
    if (componentFamily === 'unsupported' || typeof schema !== 'object' || schema === null || Array.isArray(schema)) {
      issues.push({
        path,
        message:
          componentFamily === 'unsupported'
            ? `component "${name}" uses unsupported schemaFormat ${JSON.stringify(schemaFormat)}; treated as an unconstrained schema`
            : `component "${name}" is not an object schema; treated as an unconstrained schema`,
      })
      assignKey(copiedDefs, defsKey, {})
      continue
    }

    const normalized = normalizeSchema(schema as Record<string, unknown>, componentFamily)
    assignKey(copiedDefs, defsKey, rewrite(normalized, 0, false))
  }

  if (Object.keys(copiedDefs).length === 0) return rewrittenRoot
  const existingDefs =
    typeof rewrittenRoot['$defs'] === 'object' && rewrittenRoot['$defs'] !== null
      ? (rewrittenRoot['$defs'] as Record<string, unknown>)
      : {}
  const mergedDefs: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(existingDefs)) assignKey(mergedDefs, key, value)
  for (const [key, value] of Object.entries(copiedDefs)) assignKey(mergedDefs, key, value)
  return { ...rewrittenRoot, $defs: mergedDefs }
}
