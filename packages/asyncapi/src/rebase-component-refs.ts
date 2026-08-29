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

// A tail whose first hop dives through the component's own definitions block,
// capturing which spelling it used — `definitions.x` and `$defs.x` are
// distinct entries on a component that carries both blocks, so the spelling
// picks the target. Those entries do not stay inside the copied component
// (this module hoists them to the root), so the hop is re-aimed there.
const TAIL_THROUGH_DEFS = /^\/(definitions|\$defs)\/([^/]+)(\/.*)?$/

// A component-internal reference, spelling captured for the same reason.
const LOCAL_DEFS_REF = /^#\/(\$defs|definitions)\/([^/]+)(\/.*)?$/

// The keywords whose immediate children are *names*, not schema keywords — a
// property legitimately called `definitions` must not read as a block hop.
// `dependencies` is draft-07's spelling of `dependentSchemas`, and its keys
// are author-chosen property names too.
const NAME_MAP_KEYWORDS = new Set(['properties', 'patternProperties', 'dependentSchemas', 'dependencies'])

/** Unescapes one RFC 6901 pointer segment. */
const decodeSegment = (segment: string): string => segment.replace(/~1/g, '/').replace(/~0/g, '~')

/**
 * Whether a pointer tail (relative to a schema) passes through a
 * definitions/`$defs` *block* — as opposed to merely containing a property
 * named `definitions`. Walked structurally: under `properties` (and friends)
 * the next segment is a name and carries no keyword meaning.
 */
const divesThroughDefs = (tail: string): boolean => {
  let expectName = false
  for (const rawSegment of tail.split('/').slice(1)) {
    const segment = decodeSegment(rawSegment)
    if (expectName) {
      expectName = false
      continue
    }
    if (segment === 'definitions' || segment === '$defs') return true
    if (NAME_MAP_KEYWORDS.has(segment)) expectName = true
  }
  return false
}

/**
 * Folds the characters a `$defs` key cannot carry to `-`: pointer syntax, and
 * `%` — the generators percent-decode `$ref` pointers, so a `%` surviving into
 * an emitted key makes the ref and the key disagree after decoding.
 */
const sanitizeKey = (name: string): string => name.replace(/[~/%]+/g, '-')

type DefsBlock = 'definitions' | '$defs'

/** The rewrite context: copying a component, or a hoisted document-root def. */
type RewriteScope =
  | { readonly kind: 'root' }
  | { readonly kind: 'docDef' }
  | {
      readonly kind: 'component'
      readonly component: string
      readonly blocks: Readonly<Record<DefsBlock, ReadonlySet<string>>>
    }

const ROOT_SCOPE: RewriteScope = { kind: 'root' }
const DOC_DEF_SCOPE: RewriteScope = { kind: 'docDef' }

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
 * definitions — from `$defs` *and* from a `definitions` block a
 * 2020-12/OpenAPI component keeps verbatim, each block under its own key —
 * are hoisted to the root under `<component>-<name>` keys, with the
 * component's internal refs and any external ref whose pointer tail dives
 * through a block re-aimed at the hoisted entries.
 *
 * Two more pointer shapes are handled the same way: a tail through a Multi
 * Format component's `schema` wrapper key (the copy is unwrapped, so the hop
 * is stripped), and a document-root `#/$defs/...` reference — which the
 * cross-file resolver manufactures when it hoists a reference cycle onto the
 * document root — whose target is copied in beside the components.
 *
 * A reference to anything the document does not declare becomes an empty
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
  const documentRecord =
    typeof document === 'object' && document !== null && !Array.isArray(document)
      ? (document as Record<string, unknown>)
      : undefined
  const componentSchemas = documentRecord
    ? (readKey((readKey(documentRecord, 'components') ?? {}) as Record<string, unknown>, 'schemas') as
        | Record<string, unknown>
        | undefined)
    : undefined
  const documentDefs = (() => {
    const block = documentRecord === undefined ? undefined : readKey(documentRecord, '$defs')
    return typeof block === 'object' && block !== null && !Array.isArray(block)
      ? (block as Record<string, unknown>)
      : undefined
  })()

  const rootDefs = readKey(root, '$defs')
  const rootOwnDefNames = new Set<string>(
    typeof rootDefs === 'object' && rootDefs !== null ? Object.keys(rootDefs as Record<string, unknown>) : [],
  )
  const taken = new Set<string>(rootOwnDefNames)
  /** Component name → the `$defs` key allocated for it. */
  const keyByName = new Map<string, string>()
  /** JSON-encoded `[component, block, definition]` → the root `$defs` key its hoisted copy gets. */
  const defKeyByName = new Map<string, string>()
  /** The same allocations in structured form, for the post-pass repair loop. */
  const defKeyEntries: { component: string; block: DefsBlock; defName: string; key: string }[] = []
  /** Document-root `$defs` name → the key its copy gets. */
  const docDefKeyByName = new Map<string, string>()
  /** Refs no rewrite can satisfy, degraded to `{}` with an issue. */
  const unresolvable: { key: string; ref: string; reason: string }[] = []
  const componentQueue: string[] = []
  const docDefQueue: string[] = []

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
    componentQueue.push(name)
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
  const allocateDefKey = (componentName: string, block: DefsBlock, defName: string): string => {
    // JSON-encoded triple: names may carry any character, so no separator is safe.
    const mapKey = JSON.stringify([componentName, block, defName])
    const existing = defKeyByName.get(mapKey)
    if (existing !== undefined) return existing
    const componentKey = allocateKey(componentName)
    const key = claimKey(`${componentKey}-${sanitizeKey(defName)}`)
    defKeyByName.set(mapKey, key)
    defKeyEntries.push({ component: componentName, block, defName, key })
    return key
  }

  /** Key for a copied document-root `$defs` entry (a resolver-hoisted cycle target). */
  const allocateDocDefKey = (name: string): string => {
    const existing = docDefKeyByName.get(name)
    if (existing !== undefined) return existing
    const key = /[~/%]/.test(name) ? claimKey(sanitizeKey(name)) : claimKey(name)
    docDefKeyByName.set(name, key)
    docDefQueue.push(name)
    return key
  }

  /** Whether the components map holds `name` as a Multi Format wrapper. */
  const isWrappedComponent = (name: string): boolean => {
    const raw = componentSchemas === undefined ? undefined : readKey(componentSchemas, name)
    return raw !== undefined && unwrapMultiFormat(raw).schemaFormat !== undefined
  }

  /**
   * The names in a component's definitions blocks, read off the *raw*
   * document, or `undefined` when the component cannot be copied at all
   * (missing, unsupported format, non-object). Top-level definition names
   * survive normalization (the draft-07 upgrade renames the block, not its
   * keys), so membership can be judged before the copy exists — which is what
   * lets a tailed ref know at rewrite time whether its target will be real.
   */
  const componentBlockNames = (name: string): Record<DefsBlock, ReadonlySet<string>> | undefined => {
    const raw = componentSchemas === undefined ? undefined : readKey(componentSchemas, name)
    if (raw === undefined) return undefined
    const { schemaFormat, schema } = unwrapMultiFormat(raw)
    const componentFamily = schemaFormat === undefined ? family : classifySchemaFormat(schemaFormat)
    if (componentFamily === 'unsupported' || typeof schema !== 'object' || schema === null || Array.isArray(schema)) {
      return undefined
    }
    const names: Record<DefsBlock, Set<string>> = { definitions: new Set(), $defs: new Set() }
    for (const blockName of ['definitions', '$defs'] as const) {
      const block = readKey(schema as Record<string, unknown>, blockName)
      if (typeof block !== 'object' || block === null || Array.isArray(block)) continue
      for (const key of Object.keys(block as Record<string, unknown>)) names[blockName].add(key)
    }
    return names
  }

  /**
   * A definition-name segment against a set of declared names, with the same
   * percent-decoded fallback component names get — the RFC 6901 URI-fragment
   * spelling must find the definition the document declares.
   */
  const canonicalDefName = (segment: string, declared: (name: string) => boolean): string => {
    const raw = decodeSegment(segment)
    if (declared(raw)) return raw
    if (raw.includes('%')) {
      try {
        const decoded = decodeURIComponent(raw)
        if (declared(decoded)) return decoded
      } catch {
        // Not a valid percent sequence — the raw spelling stands.
      }
    }
    return raw
  }

  const degrade = (ref: string, reason: string): string => {
    const key = claimKey('unsupported-pointer')
    unresolvable.push({ key, ref, reason })
    return `#/$defs/${key}`
  }

  /** Rewrites one `$ref` string per the current scope, or returns it unchanged. */
  const rewriteRef = (ref: string, scope: RewriteScope): string => {
    const component = COMPONENT_SCHEMA_REF.exec(ref)
    if (component) {
      const name = canonicalName(component[1] as string)
      let tail = component[2] ?? ''
      // The copy is the UNWRAPPED Multi Format schema, so a pointer-faithful
      // hop through the wrapper's `schema` key has no level to land on.
      if (tail !== '' && isWrappedComponent(name)) {
        const wrapperHop = /^\/schema(\/.*)?$/.exec(tail)
        if (wrapperHop) tail = wrapperHop[1] ?? ''
      }
      const throughDefs = TAIL_THROUGH_DEFS.exec(tail)
      if (throughDefs) {
        const rest = throughDefs[3] ?? ''
        if (divesThroughDefs(rest))
          return degrade(ref, 'dives through nested definitions, which rebasing does not support')
        const block = throughDefs[1] as DefsBlock
        const blocks = componentBlockNames(name)
        const defName = canonicalDefName(
          throughDefs[2] as string,
          (candidate) => blocks !== undefined && (blocks[block].has(candidate) || blocks.$defs.has(candidate)),
        )
        // A tail below the definition needs a real target to land in: when the
        // component (or the named definition) will degrade to `{}`, keeping the
        // tail emits a pointer into the empty object — a dangling ref the
        // generators abort on, instead of the documented one-branch degrade.
        if (rest !== '') {
          const declared =
            blocks !== undefined &&
            (blocks[block].has(defName) || blocks.$defs.has(defName) || blocks.definitions.has(defName))
          if (!declared) return degrade(ref, 'points below a definition its component does not declare')
        }
        return `#/$defs/${allocateDefKey(name, block, defName)}${rest}`
      }
      // Same rule for a plain tail: a component that will degrade to `{}`
      // cannot carry one.
      if (tail !== '' && componentBlockNames(name) === undefined)
        return degrade(ref, 'points into a component that cannot be copied')
      return `#/$defs/${allocateKey(name)}${tail}`
    }

    const local = LOCAL_DEFS_REF.exec(ref)
    if (local) {
      const block = local[1] as DefsBlock
      const tail = local[3] ?? ''
      // A hoisted definition is a normalized copy like any component — a tail
      // that dives through a *nested* definitions block dangles the same way
      // the external spelling above does, so it degrades before rebasing.
      // Refs that stand unrewritten (the message root's own `$defs`) keep
      // their tails: that block is not re-normalized here.
      const nestedTail = tail !== '' && divesThroughDefs(tail)
      const degradeNestedTail = (): string =>
        degrade(ref, 'dives through nested definitions, which rebasing does not support')
      if (scope.kind === 'component') {
        // Spelling-faithful lookup, with one fallback: a `#/definitions/...`
        // ref inside a draft-07 component targets the block normalization
        // renamed to `$defs`. A miss falls through to the document-root
        // check below — the cross-file resolver plants its `#/$defs/...`
        // cycle refs inside components too.
        const defName = canonicalDefName(
          local[2] as string,
          (candidate) => scope.blocks[block].has(candidate) || scope.blocks.$defs.has(candidate),
        )
        if (scope.blocks[block].has(defName)) {
          if (nestedTail) return degradeNestedTail()
          return `#/$defs/${allocateDefKey(scope.component, block, defName)}${tail}`
        }
        if (block === 'definitions' && scope.blocks.$defs.has(defName)) {
          if (nestedTail) return degradeNestedTail()
          return `#/$defs/${allocateDefKey(scope.component, '$defs', defName)}${tail}`
        }
      }
      if (block === '$defs') {
        // The message root keeps its own `$defs`, so those refs stand; in any
        // other scope (a copied component or document-root def, which have no
        // claim on the message root's block) a name may still live on the
        // *document* root — where the cross-file resolver hoists reference
        // cycles.
        const defName = canonicalDefName(
          local[2] as string,
          (candidate) =>
            (scope.kind === 'root' && rootOwnDefNames.has(candidate)) ||
            (documentDefs !== undefined && readKey(documentDefs, candidate) !== undefined),
        )
        if (scope.kind === 'root' && rootOwnDefNames.has(defName)) return ref
        if (documentDefs !== undefined && readKey(documentDefs, defName) !== undefined) {
          if (nestedTail) return degradeNestedTail()
          return `#/$defs/${allocateDocDefKey(defName)}${tail}`
        }
      }
    }
    return ref
  }

  const rewrite = (node: unknown, depth: number, inSchemaMap: boolean, scope: RewriteScope): unknown => {
    assertSchemaDepth(depth, 'rebaseComponentRefs')
    if (Array.isArray(node)) return node.map((item) => rewrite(item, depth + 1, inSchemaMap, scope))
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
        assignKey(result, key, rewriteRef(value, scope))
      } else {
        assignKey(result, key, rewrite(value, depth + 1, entersSchemaMap(key, inSchemaMap), scope))
      }
    }
    return result
  }

  const rewrittenRoot = rewrite(root, 0, false, ROOT_SCOPE) as Record<string, unknown>

  const copiedDefs: Record<string, unknown> = {}
  /** Which blocks each processed component actually declared, for alias repair. */
  const processedBlocks = new Map<string, Record<DefsBlock, ReadonlySet<string>>>()

  const processComponent = (name: string): void => {
    const defsKey = keyByName.get(name) as string
    const raw = componentSchemas === undefined ? undefined : readKey(componentSchemas, name)
    if (raw === undefined) {
      issues.push({
        path,
        message: `$ref to undeclared component "#/components/schemas/${name}"; treated as an unconstrained schema`,
      })
      assignKey(copiedDefs, defsKey, {})
      return
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
      return
    }

    const normalized = normalizeSchema(schema as Record<string, unknown>, componentFamily)

    // Hoist the component's own definitions to the root and copy the body
    // without them. Both block spellings are hoisted, each under its own key:
    // `$defs` (the draft-07 upgrade's output, or an authored 2020-12 block)
    // and a `definitions` block a 2020-12/OpenAPI component keeps verbatim.
    // Keeping the blocks separate matters when one component carries both —
    // `definitions.x` and `$defs.x` are different schemas, and merging them
    // silently pointed both spellings at whichever survived.
    const blocks: Record<DefsBlock, Set<string>> = { definitions: new Set(), $defs: new Set() }
    const blockValues: { block: DefsBlock; defName: string; value: unknown }[] = []
    for (const blockName of ['definitions', '$defs'] as const) {
      const block = readKey(normalized, blockName)
      if (typeof block !== 'object' || block === null || Array.isArray(block)) continue
      for (const [defName, value] of Object.entries(block as Record<string, unknown>)) {
        blocks[blockName].add(defName)
        blockValues.push({ block: blockName, defName, value })
      }
    }
    processedBlocks.set(name, blocks)
    const scope: RewriteScope = { kind: 'component', component: name, blocks }

    for (const { block, defName, value } of blockValues) {
      assignKey(copiedDefs, allocateDefKey(name, block, defName), rewrite(value, 0, false, scope))
    }

    const { $defs: _, definitions: __, ...body } = normalized
    assignKey(copiedDefs, defsKey, rewrite(body, 0, false, scope))
  }

  const processDocDef = (name: string): void => {
    const key = docDefKeyByName.get(name) as string
    const raw = documentDefs === undefined ? undefined : readKey(documentDefs, name)
    if (raw === undefined || typeof raw !== 'object' || Array.isArray(raw)) {
      issues.push({
        path,
        message: `$ref to "#/$defs/${name}" has no target on the document root; treated as an unconstrained schema`,
      })
      assignKey(copiedDefs, key, {})
      return
    }
    assignKey(
      copiedDefs,
      key,
      rewrite(normalizeSchema(raw as Record<string, unknown>, family), 0, false, DOC_DEF_SCOPE),
    )
  }

  // Both queues grow while draining: rewriting one copy can pull in another.
  // The allocation maps de-duplicate, so each entry is processed once and
  // reference cycles terminate.
  let componentIndex = 0
  let docDefIndex = 0
  while (componentIndex < componentQueue.length || docDefIndex < docDefQueue.length) {
    if (componentIndex < componentQueue.length) {
      processComponent(componentQueue[componentIndex++] as string)
    } else {
      processDocDef(docDefQueue[docDefIndex++] as string)
    }
  }

  // A pointer can name a definition its component never declares. Before
  // reporting, try the rename alias: a `/definitions/x` tail on a draft-07
  // component targets the block normalization renamed to `$defs`.
  for (const { component, block, defName, key } of defKeyEntries) {
    if (readKey(copiedDefs, key) !== undefined) continue
    const declared = processedBlocks.get(component)
    // Both alias directions: `/definitions/x` into a draft-07 component whose
    // block was renamed to `$defs`, and `/$defs/x` into a 2020-12 component
    // that only declares a verbatim `definitions` block.
    const aliasBlock: DefsBlock | undefined =
      block === 'definitions' && declared?.$defs.has(defName)
        ? '$defs'
        : block === '$defs' && declared?.definitions.has(defName)
          ? 'definitions'
          : undefined
    if (aliasBlock !== undefined) {
      const aliasKey = defKeyByName.get(JSON.stringify([component, aliasBlock, defName]))
      if (aliasKey !== undefined) {
        assignKey(copiedDefs, key, readKey(copiedDefs, aliasKey))
        continue
      }
    }
    issues.push({
      path,
      message: `$ref into "#/components/schemas/${component}" names a definition "${defName}" it does not declare; treated as an unconstrained schema`,
    })
    assignKey(copiedDefs, key, {})
  }

  for (const { key, ref, reason } of unresolvable) {
    issues.push({
      path,
      message: `$ref "${ref}" ${reason}; treated as an unconstrained schema`,
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
