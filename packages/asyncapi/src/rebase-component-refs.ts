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

// A tail that dives through the component's own definitions block. Those
// entries do not stay inside the copied component — normalization renames
// `definitions` to `$defs` and this module hoists that block to the root —
// so the tail's first hop has to be re-aimed at the hoisted entry.
const TAIL_THROUGH_DEFS = /^\/(?:definitions|\$defs)\/([^/]+)(\/.*)?$/

// A component-internal reference (`#/$defs/<name>` from the draft-07 upgrade
// or a 2020-12 component's authored block, `#/definitions/<name>` in one whose
// dialect keeps the old spelling), which must follow its target when that
// block is hoisted to the root under a prefixed key.
const LOCAL_DEFS_REF = /^#\/(?:\$defs|definitions)\/([^/]+)(\/.*)?$/

// A pointer tail that dives through a *second* definitions block. The first
// hop's target is hoisted, but blocks nested inside it stay where the
// draft-07 upgrade left them (renamed, contents hoisted separately), so a
// deeper dive has no stable target — the same one-level limit the upgrade
// helper documents for its own ref rewriting.
const NESTED_DEFS_TAIL = /\/(?:definitions|\$defs)\//

/** Unescapes one RFC 6901 pointer segment. */
const decodeSegment = (segment: string): string => segment.replace(/~1/g, '/').replace(/~0/g, '~')

/**
 * Folds the characters a `$defs` key cannot carry to `-`: pointer syntax, and
 * `%` — the generators percent-decode `$ref` pointers, so a `%` surviving into
 * an emitted key makes the ref and the key disagree after decoding.
 */
const sanitizeKey = (name: string): string => name.replace(/[~/%]+/g, '-')

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
 * A copied component's own definitions cannot stay nested: normalization
 * renames a draft-07 `definitions` block to a component-root `$defs` and
 * rewrites the component's internal refs to `#/$defs/...` — pointers that,
 * embedded under the message root, would resolve against the *root's* `$defs`
 * and land on nothing (or on the wrong schema). So each copied component's
 * `$defs` entries are hoisted to the root under `<component>-<name>` keys,
 * with the component's internal refs — and any external ref whose pointer
 * tail dives through the block — re-aimed at the hoisted entries.
 *
 * A reference to a component (or a component definition) the document does
 * not declare becomes an empty (`{}`, match-anything) definition plus an
 * issue — one dangling pointer should cost precision on one branch, not the
 * whole message.
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
  /** `component\u0000definition` → the root `$defs` key its hoisted copy gets. */
  const defKeyByName = new Map<string, string>()
  /** Refs diving deeper than one definitions level, degraded to `{}` with an issue. */
  const unresolvable: { key: string; ref: string }[] = []
  const queue: string[] = []

  const claimKey = (preferred: string): string => {
    let key = preferred
    for (let n = 2; taken.has(key); n++) key = `${preferred}-${n}`
    taken.add(key)
    return key
  }

  const allocateKey = (name: string): string => {
    const existing = keyByName.get(name)
    if (existing !== undefined) return existing
    // Prefer the component's own name; fall back to a prefixed (then numbered)
    // key when the root's own `$defs` claims it or the name carries characters
    // the emitted pointer cannot (see {@link sanitizeKey}).
    const key = taken.has(name) || /[~/%]/.test(name) ? claimKey(`component-${sanitizeKey(name)}`) : claimKey(name)
    keyByName.set(name, key)
    queue.push(name)
    return key
  }

  /**
   * The components-map spelling a ref segment names. Documents write pointer
   * segments both raw and percent-encoded (the RFC 6901 URI-fragment form),
   * so when the tilde-decoded segment misses the map, its percent-decoded
   * form gets a try — whichever spelling the document declares is canonical,
   * keeping every ref to the same component on one allocated key.
   */
  const canonicalName = (segment: string): string => {
    const raw = decodeSegment(segment)
    if (componentSchemas !== undefined && readKey(componentSchemas, raw) !== undefined) return raw
    if (raw.includes('%')) {
      try {
        const decoded = decodeURIComponent(raw)
        if (componentSchemas !== undefined && readKey(componentSchemas, decoded) !== undefined) return decoded
      } catch {
        // Not a valid percent sequence — the raw spelling stands.
      }
    }
    return raw
  }

  /** Root key for one of a component's own definitions, hoisted beside it. */
  const allocateDefKey = (componentName: string, defName: string): string => {
    const mapKey = `${componentName}\u0000${defName}`
    const existing = defKeyByName.get(mapKey)
    if (existing !== undefined) return existing
    const componentKey = allocateKey(componentName)
    const key = claimKey(`${componentKey}-${sanitizeKey(defName)}`)
    defKeyByName.set(mapKey, key)
    return key
  }

  /**
   * Rewrites one `$ref` string, or returns it unchanged. `localDefs` carries
   * the component context while its body and definitions are being copied:
   * the set of definition names whose `#/$defs/...` refs must follow their
   * hoisted targets.
   */
  const rewriteRef = (ref: string, localDefs?: { component: string; names: ReadonlySet<string> }): string => {
    const component = COMPONENT_SCHEMA_REF.exec(ref)
    if (component) {
      const name = canonicalName(component[1] as string)
      const tail = component[2] ?? ''
      const throughDefs = TAIL_THROUGH_DEFS.exec(tail)
      if (throughDefs) {
        const rest = throughDefs[2] ?? ''
        if (NESTED_DEFS_TAIL.test(rest)) {
          const key = claimKey('unsupported-pointer')
          unresolvable.push({ key, ref })
          return `#/$defs/${key}`
        }
        const defName = decodeSegment(throughDefs[1] as string)
        return `#/$defs/${allocateDefKey(name, defName)}${rest}`
      }
      return `#/$defs/${allocateKey(name)}${tail}`
    }
    if (localDefs) {
      const local = LOCAL_DEFS_REF.exec(ref)
      if (local) {
        const defName = decodeSegment(local[1] as string)
        if (localDefs.names.has(defName)) {
          return `#/$defs/${allocateDefKey(localDefs.component, defName)}${local[2] ?? ''}`
        }
      }
    }
    return ref
  }

  const rewrite = (
    node: unknown,
    depth: number,
    inSchemaMap: boolean,
    localDefs?: { component: string; names: ReadonlySet<string> },
  ): unknown => {
    assertSchemaDepth(depth, 'rebaseComponentRefs')
    if (Array.isArray(node)) return node.map((item) => rewrite(item, depth + 1, inSchemaMap, localDefs))
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
        assignKey(result, key, rewriteRef(value, localDefs))
      } else {
        assignKey(result, key, rewrite(value, depth + 1, entersSchemaMap(key, inSchemaMap), localDefs))
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

    // Hoist the component's own definitions to the root and copy the body
    // without them, with every internal ref re-aimed at the hoisted entries.
    // Both spellings are collected: `$defs` (the draft-07 upgrade's output, or
    // a 2020-12 component's authored block) and a `definitions` block a
    // 2020-12/OpenAPI component keeps verbatim — normalization only renames it
    // for the draft-07 families, and pointer tails re-aim unconditionally, so
    // leaving the block behind stranded those targets as `{}`.
    const ownDefs: Record<string, unknown> = {}
    for (const blockName of ['definitions', '$defs'] as const) {
      const block = readKey(normalized, blockName)
      if (typeof block !== 'object' || block === null || Array.isArray(block)) continue
      for (const [defName, defValue] of Object.entries(block as Record<string, unknown>)) {
        assignKey(ownDefs, defName, defValue)
      }
    }
    const hasOwnDefs = Object.keys(ownDefs).length > 0
    const localDefs = hasOwnDefs ? { component: name, names: new Set(Object.keys(ownDefs)) } : undefined

    if (hasOwnDefs) {
      for (const [defName, defValue] of Object.entries(ownDefs)) {
        assignKey(copiedDefs, allocateDefKey(name, defName), rewrite(defValue, 0, false, localDefs))
      }
    }

    const { $defs: _, definitions: __, ...body } = normalized
    assignKey(copiedDefs, defsKey, rewrite(body, 0, false, localDefs))
  }

  // A pointer tail can name a definition its component never declares; the
  // allocated key would otherwise dangle, so it resolves to "anything" with
  // an issue — same posture as an undeclared component.
  for (const [mapKey, defKey] of defKeyByName) {
    if (readKey(copiedDefs, defKey) !== undefined) continue
    const [componentName, defName] = mapKey.split('\u0000') as [string, string]
    issues.push({
      path,
      message: `$ref into "#/components/schemas/${componentName}" names a definition "${defName}" it does not declare; treated as an unconstrained schema`,
    })
    assignKey(copiedDefs, defKey, {})
  }

  for (const { key, ref } of unresolvable) {
    issues.push({
      path,
      message: `$ref "${ref}" dives through nested definitions, which rebasing does not support; treated as an unconstrained schema`,
    })
    assignKey(copiedDefs, key, {})
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
