import { identifierMentions } from '@amritk/helpers/identifier-mentions'
import { readKey } from '@amritk/helpers/read-key'
import { refToFilename } from '@amritk/helpers/ref-to-filename'
import { refToName } from '@amritk/helpers/ref-to-name'
import { referencedConditional } from '@amritk/helpers/referenced-conditional'
import { resolveRef } from '@amritk/helpers/resolve-ref'
import {
  hasAdditionalProperties,
  hasAllOf,
  hasAnyOf,
  hasItems,
  hasOneOf,
  hasRef,
  isSchemaObject,
} from '@amritk/helpers/schema-guards'
import type { JSONSchema } from 'json-schema-typed/draft-2020-12'

/** Extension emitted on every relative import specifier in generated code. */
export type ImportExtension = 'js' | 'ts'

// Emit an explicit extension on the relative specifier. Node's ESM resolver
// requires one (extensionless relative imports only work under a bundler or
// Bun). `./x.js` pointing at a sibling `x.ts` is the standard TS NodeNext form
// — accepted by Bun, esbuild, webpack, and tsc alike — while `./x.ts` is the
// literal on-disk path Node's type stripping needs to run the sources directly.
const getImportPathForFilename = (filename: string, ext: ImportExtension): string => `./${filename}.${ext}`

/**
 * Options for controlling how imports are collected.
 */
type CollectImportsOptions = {
  /**
   * When true, only generate type-only imports (no parser function imports).
   * Use this when generating types-only files that do not include parser functions.
   */
  readonly typesOnly?: boolean
  /**
   * The $ref path of the schema being generated (e.g. `#/$defs/encoding`).
   * When provided, any $ref that resolves to the same filename is excluded from
   * the import list, preventing a file from importing itself.
   */
  readonly selfRef?: string | undefined
  /**
   * The filename this file is being written as, without extension. Takes
   * precedence over `selfRef` for self-import detection, and covers the case
   * `selfRef` cannot: the root document has no ref of its own, so a definition
   * whose name collides with the root type name (root `Contact` + `$defs.contact`)
   * used to make the root file import its own type from itself.
   */
  readonly selfFilename?: string | undefined
  /**
   * The root schema document. When provided, URI refs that cannot be resolved
   * within the root schema's $defs are excluded from the import list, preventing
   * imports for external schemas that were never generated as files.
   */
  readonly rootSchema?: Record<string, unknown> | undefined
  /**
   * Suffix appended to every type name derived from a `$ref`. Must match the
   * suffix used when generating the referenced files so imports resolve.
   * Defaults to `''` (no suffix).
   */
  readonly typeSuffix?: string
  /**
   * Extension used on every relative import specifier. Defaults to `'js'`
   * (the TS NodeNext form); `'ts'` makes the output runnable under Node's
   * type stripping.
   */
  readonly importExt?: ImportExtension
  /**
   * The file body this import list is being written above. When given, only the
   * `$ref` imports whose names the body actually spells are emitted, and one
   * whose parser is never called is narrowed to a type-only import.
   *
   * The walk below can only approximate what the emitters wrote: it stops at a
   * `$ref` the type emitter inlines *through*, and it cannot see a branch that
   * folded away. Asking the emitted text settles both directions, the way
   * `collectHelpers` already settles which runtime helpers a file needs.
   */
  readonly usedIn?: string | undefined
}

/**
 * Collects all import statements needed for a schema by finding $ref references
 * that are directly used in the type definition (from properties, items, etc.).
 * Does not include refs from nested schema definitions.
 *
 * Generates both type imports and parser function imports for each $ref.
 * The parser imports allow validators to delegate validation to the referenced
 * schema's parser instead of inlining the validation logic.
 *
 * Also detects when helper functions (isObject) and validators (validateRecord,
 * validateArray) are needed based on the schema structure.
 *
 * @param schema - The JSON Schema to collect imports from
 * @param options - Optional settings to control import generation
 * @returns An array of import statements
 *
 * @example
 * ```ts
 * const schema = {
 *   type: 'object',
 *   properties: {
 *     contact: { $ref: '#/$defs/contact' },
 *     server: { $ref: '#/$defs/server' }
 *   }
 * }
 * const imports = collectImports(schema)
 * // imports = [
 * //   "import { type Contact, parseContact } from './contact';",
 * //   "import { type Server, parseServer } from './server';"
 * // ]
 *
 * // With typesOnly, only type imports are generated:
 * const typeImports = collectImports(schema, { typesOnly: true })
 * // typeImports = [
 * //   "import type { Contact } from './contact';",
 * //   "import type { Server } from './server';"
 * // ]
 * ```
 */
export const collectImports = (schema: JSONSchema, options?: CollectImportsOptions): string[] => {
  const typesOnly = options?.typesOnly === true
  const importExt = options?.importExt ?? 'js'
  const importMap = new Map<string, string>()
  // Without a body to read, every target stands — the behaviour every caller had
  // before the question could be asked.
  const mentions = options?.usedIn === undefined ? () => true : identifierMentions(options.usedIn)

  for (const [filename, { typeName, typeOnly }] of collectImportTargets(schema, options)) {
    const importPath = getImportPathForFilename(filename, importExt)
    // In types-only mode there is no parser to call, and `typeOnly` is the same
    // conclusion reached per ref. Beyond those two, each binding is kept only
    // where the body spells it: they come apart in practice, since a
    // `$ref`-discriminated union calls `parseX` and never the shape guard, and a
    // ref the type emitter inlined through is named without either. Any binding
    // nothing reads is `TS6133` in the consumer's build.
    const values =
      typesOnly || typeOnly ? [] : [`parse${typeName}`, `validate${typeName}Shape`].filter((name) => mentions(name))
    const named = mentions(typeName)
    if (values.length === 0) {
      if (!named) continue
      importMap.set(filename, `import type { ${typeName} } from '${importPath}';`)
      continue
    }
    const specifiers = named ? [`type ${typeName}`, ...values] : values
    importMap.set(filename, `import { ${specifiers.join(', ')} } from '${importPath}';`)
  }

  return Array.from(importMap.values()).sort()
}

/**
 * The type names a generated file will import for its `$ref`s — the same
 * dedup/skip rules as {@link collectImports}. Generators seed their private
 * sub-type naming with this set so a synthesized name (e.g. a root array's
 * `FooItem`) can never shadow an imported identifier.
 */
export const collectImportTypeNames = (schema: JSONSchema, options?: CollectImportsOptions): Set<string> => {
  const names = new Set<string>()
  for (const [, target] of collectImportTargets(schema, options)) names.add(target.typeName)
  return names
}

/**
 * Shared `$ref` walk: filename → its derived type name and whether the ref was
 * only ever reached from a position the emitters use the *type* of.
 *
 * A tuple position is the only such place today: the type emitter renders it as
 * the referenced type name, but the parser emitter passes the element through
 * untouched, so `parseX`/`validateXShape` would be imported and never called —
 * an unused binding, which `noUnusedLocals` makes a compile error in the
 * consumer's build. A ref reached from anywhere else wins: the flag is cleared
 * the first time one is.
 */
const collectImportTargets = (
  schema: JSONSchema,
  options?: CollectImportsOptions,
): Map<string, { typeName: string; typeOnly: boolean }> => {
  const selfFilename = options?.selfFilename ?? (options?.selfRef ? refToFilename(options.selfRef) : undefined)
  const rootSchema = options?.rootSchema
  const typeSuffix = options?.typeSuffix
  const refs = new Set<string>()
  // Refs reached from a position whose emitted code uses the value, not just
  // the type. A ref in both kinds of position belongs here.
  const valueRefs = new Set<string>()
  let typeOnlyDepth = 0
  // Conditional definitions already inlined, so a cycle through one terminates.
  const inlinedRefs = new Set<string>()

  /**
   * One `allOf` member, plus whatever the type emitter inlines *through* it.
   *
   * A member that is a local `$ref` to a conditional definition is not just
   * named: `referencedConditional` reads the definition and renders its arms
   * into this file, so a `$ref` inside those arms is a type name here even
   * though the walk stops at the member. Rendered, never called — the emitted
   * arm is a type — so the arms are walked as type-only positions.
   */
  const collectRefsFromAllOfMember = (entry: unknown): void => {
    collectRefsFromValue(entry)
    const ref = isSchemaObject(entry as JSONSchema) ? readKey(entry as Record<string, unknown>, '$ref') : undefined
    // Resolving a ref and walking into it is how this walk reaches a cycle: a
    // conditional whose own `then` composes it again recursed until the stack
    // ran out, where stopping at every `$ref` (what this did before) could not.
    // Each definition is inlined once — a second reach adds no ref the first did
    // not already collect.
    if (typeof ref === 'string' && inlinedRefs.has(ref)) return
    const inlined = referencedConditional(entry as JSONSchema, rootSchema)
    if (inlined === undefined) return
    if (typeof ref === 'string') inlinedRefs.add(ref)
    typeOnlyDepth++
    for (const arm of ['if', 'then', 'else'] as const) {
      if (Object.hasOwn(inlined, arm)) collectRefsFromValue(readKey(inlined, arm))
    }
    typeOnlyDepth--
  }

  const collectRefsFromValue = (value: unknown): void => {
    if (typeof value !== 'object' || value === null) {
      return
    }

    if (Array.isArray(value)) {
      for (const item of value) {
        collectRefsFromValue(item)
      }
      return
    }

    const record = value as Record<string, unknown>

    // If this is a $ref, add it — but skip:
    // - Relative path refs (e.g. /components/messages/foo) which point into example data
    // - URI refs with fragments pointing into `properties` (not standalone definitions)
    if (hasRef(record)) {
      const ref = record.$ref
      const isInternal = ref.startsWith('#')
      const isUri = ref.startsWith('http://') || ref.startsWith('https://')
      const isPropertyFragment = isUri && ref.includes('#/properties/')
      if (isInternal || (isUri && !isPropertyFragment)) {
        refs.add(ref)
        if (typeOnlyDepth === 0) valueRefs.add(ref)
      }
      return // Don't traverse further into a $ref
    }

    // Tuple positions, walked before the `additionalProperties`/`items` branches
    // below because those `return` early: a tuple with a `$ref` rest element
    // would otherwise never reach this. The type emitter renders a
    // `prefixItems` `$ref` as the referenced type name, so missing it produced
    // a file naming `Contact` with no import — output that does not compile.
    // Both tuple spellings: 2020-12 `prefixItems` and draft-07's array-valued
    // `items`. The type emitter renders each position as the referenced type
    // name while the parser emitter passes the element through untouched, so
    // these are type-only positions (see `typeOnlyDepth`).
    for (const keyword of ['prefixItems', 'items'] as const) {
      // Own key only — a polluted `Object.prototype.prefixItems` would
      // otherwise make every node look like a tuple.
      const positions = Object.hasOwn(record, keyword) ? record[keyword] : undefined
      if (!Array.isArray(positions)) continue
      typeOnlyDepth++
      for (const item of positions) {
        collectRefsFromValue(item)
      }
      // Draft-07's rest element. The type emitter renders it as `...Contact[]`,
      // so a `$ref` there needs its import exactly as a fixed position does.
      if (Object.hasOwn(record, 'additionalItems')) collectRefsFromValue(record['additionalItems'])
      typeOnlyDepth--
    }

    // Check if this is an object type with additionalProperties that has a $ref
    // This pattern requires validateRecord
    if (hasAdditionalProperties(record) && hasRef(record.additionalProperties)) {
      collectRefsFromValue(record.additionalProperties)
      return
    }

    // Check if this is an array type with items that has a $ref
    // This pattern requires validateArray. An array-valued `items` is the
    // draft-07 tuple spelling, handled with `prefixItems` above, not here.
    if (record.type === 'array' && hasItems(record) && !Array.isArray(record.items) && hasRef(record.items)) {
      collectRefsFromValue(record.items)
      return
    }

    // Traverse nested properties regardless of whether `type` is explicitly set.
    // `Object.hasOwn`, not `in`: `in` walks the prototype chain, so a polluted
    // `Object.prototype.properties` had every node read as if the document
    // declared it — and the import that followed named a module never emitted.
    if (Object.hasOwn(record, 'properties') && typeof record.properties === 'object' && record.properties !== null) {
      // `Object.values`, not `for…in`: these are author-chosen names, and a
      // bare `for…in` walks the prototype chain — so a polluted
      // `Object.prototype` had this collecting a ref for a definition the
      // document never declared.
      for (const value of Object.values(record.properties as Record<string, unknown>)) {
        collectRefsFromValue(value)
      }
    }

    // Traverse into type composition keywords
    if (hasOneOf(record)) {
      for (const item of record.oneOf) {
        collectRefsFromValue(item)
      }
    }
    if (hasAnyOf(record)) {
      for (const item of record.anyOf) {
        collectRefsFromValue(item)
      }
    }
    if (hasAllOf(record)) {
      for (const item of record.allOf) {
        collectRefsFromAllOfMember(item)
      }
    }

    // Traverse into array items — the single-schema form only; the array form
    // is a tuple and was walked above.
    if (hasItems(record) && !Array.isArray(record.items)) {
      collectRefsFromValue(record.items)
    }

    // Traverse into additionalProperties
    if (hasAdditionalProperties(record)) {
      collectRefsFromValue(record.additionalProperties)
    }

    // Traverse all patternProperties
    if (
      Object.hasOwn(record, 'patternProperties') &&
      typeof record.patternProperties === 'object' &&
      record.patternProperties !== null
    ) {
      for (const value of Object.values(record.patternProperties as Record<string, unknown>)) {
        collectRefsFromValue(value)
      }
    }

    // Traverse into if/then/else branches. `if` belongs here as much as the
    // other two — the root walk already lists it, and the two lists disagreeing
    // is what let a tuple position go unimported.
    // `Object.hasOwn`, not `in`, for the reason the `Object.values` switch above
    // gives: `in` walks the prototype chain, so a polluted `Object.prototype.if`
    // would have this descend into an inherited value.
    if (Object.hasOwn(record, 'if')) {
      collectRefsFromValue(record.if)
    }
    if (Object.hasOwn(record, 'then')) {
      collectRefsFromValue(record.then)
    }
    if (Object.hasOwn(record, 'else')) {
      collectRefsFromValue(record.else)
    }
  }

  // Collect refs from root-level $ref
  if (typeof schema === 'object' && schema !== null && hasRef(schema)) {
    const ref = schema.$ref
    const isInternal = ref.startsWith('#')
    const isUri = ref.startsWith('http://') || ref.startsWith('https://')
    const isPropertyFragment = isUri && ref.includes('#/properties/')
    if (isInternal || (isUri && !isPropertyFragment)) {
      refs.add(ref)
      // The root's own `$ref` is emitted as a value, like every position other
      // than a tuple element.
      valueRefs.add(ref)
    }
  }

  // Collect refs from properties
  if (
    typeof schema === 'object' &&
    schema !== null &&
    Object.hasOwn(schema, 'properties') &&
    typeof schema.properties === 'object' &&
    schema.properties !== null
  ) {
    // The null check the nested branch carries: `properties: null` is malformed
    // but was tolerated (a `for…in` over null is a no-op), and `Object.values`
    // throws on it — turning a bad schema into a crash out of the generator.
    for (const value of Object.values(schema.properties as Record<string, unknown>)) {
      collectRefsFromValue(value)
    }
  }

  // Collect refs from root-level additionalProperties
  if (typeof schema === 'object' && schema !== null && Object.hasOwn(schema, 'additionalProperties')) {
    collectRefsFromValue(schema.additionalProperties)
  }

  // Collect refs from root-level patternProperties
  if (
    typeof schema === 'object' &&
    schema !== null &&
    Object.hasOwn(schema, 'patternProperties') &&
    typeof schema.patternProperties === 'object' &&
    schema.patternProperties !== null
  ) {
    for (const value of Object.values(schema.patternProperties as Record<string, unknown>)) {
      collectRefsFromValue(value)
    }
  }

  // Collect refs from root-level items (when the schema itself is an array type)
  if (typeof schema === 'object' && schema !== null && hasItems(schema) && !Array.isArray(schema.items)) {
    collectRefsFromValue(schema.items)
  }

  // …and from a root-level tuple, in either spelling. The root enumerates its
  // keys by hand rather than going through `collectRefsFromValue`, so a
  // keyword missing from this list is simply never walked: a schema that *is*
  // a tuple emitted a type naming `Contact` with no import for it at all.
  if (typeof schema === 'object' && schema !== null) {
    const record = schema as Record<string, unknown>
    for (const keyword of ['prefixItems', 'items'] as const) {
      const positions = Object.hasOwn(record, keyword) ? record[keyword] : undefined
      if (!Array.isArray(positions)) continue
      typeOnlyDepth++
      for (const item of positions) collectRefsFromValue(item)
      if (Object.hasOwn(record, 'additionalItems')) collectRefsFromValue(record['additionalItems'])
      typeOnlyDepth--
    }
  }

  // Collect refs from root-level composition keywords.
  if (typeof schema === 'object' && schema !== null && hasOneOf(schema)) {
    for (const item of schema.oneOf) {
      collectRefsFromValue(item)
    }
  }
  if (typeof schema === 'object' && schema !== null && hasAnyOf(schema)) {
    for (const item of schema.anyOf) {
      collectRefsFromValue(item)
    }
  }
  if (typeof schema === 'object' && schema !== null && hasAllOf(schema)) {
    for (const item of schema.allOf) {
      collectRefsFromAllOfMember(item)
    }
  }

  // Collect refs from root-level conditional branches.
  if (typeof schema === 'object' && schema !== null && Object.hasOwn(schema, 'if')) {
    collectRefsFromValue(schema.if)
  }
  if (typeof schema === 'object' && schema !== null && Object.hasOwn(schema, 'then')) {
    collectRefsFromValue(schema.then)
  }
  if (typeof schema === 'object' && schema !== null && Object.hasOwn(schema, 'else')) {
    collectRefsFromValue(schema.else)
  }

  // Convert refs to import targets, deduplicating by filename.
  const targets = new Map<string, { typeName: string; typeOnly: boolean }>()

  for (const ref of refs) {
    // For URI refs, skip if the base URI is not resolvable in the root schema.
    // This prevents generating imports for external schemas that were never generated as files.
    if (rootSchema !== undefined && (ref.startsWith('http://') || ref.startsWith('https://'))) {
      if (!resolveRef(ref, rootSchema)) continue
    }

    const typeName = refToName(ref, typeSuffix)
    const filename = refToFilename(ref)

    // Skip self-referential imports — a file must not import from itself
    if (selfFilename !== undefined && filename === selfFilename) {
      continue
    }

    // Two refs can share a filename (`#/$defs/x` and a URI spelling of it); the
    // import is a value import if any of them needs the value.
    const typeOnly = !valueRefs.has(ref) && (targets.get(filename)?.typeOnly ?? true)
    targets.set(filename, { typeName, typeOnly })
  }

  return targets
}
