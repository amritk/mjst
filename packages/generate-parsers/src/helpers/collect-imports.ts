import { refToFilename } from '@amritk/helpers/ref-to-filename'
import { refToName } from '@amritk/helpers/ref-to-name'
import { resolveRef } from '@amritk/helpers/resolve-ref'
import { hasAdditionalProperties, hasAllOf, hasAnyOf, hasItems, hasOneOf, hasRef } from '@amritk/helpers/schema-guards'
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

  for (const [filename, typeName] of collectImportTargets(schema, options)) {
    const importPath = getImportPathForFilename(filename, importExt)
    // In types-only mode, omit the parser function import since there is no parser to call
    const importStatement = typesOnly
      ? `import type { ${typeName} } from '${importPath}';`
      : `import { type ${typeName}, parse${typeName}, validate${typeName}Shape } from '${importPath}';`
    importMap.set(filename, importStatement)
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
  for (const [, typeName] of collectImportTargets(schema, options)) names.add(typeName)
  return names
}

/** Shared `$ref` walk: filename → derived type name for every import target. */
const collectImportTargets = (schema: JSONSchema, options?: CollectImportsOptions): Map<string, string> => {
  const selfFilename = options?.selfRef ? refToFilename(options.selfRef) : undefined
  const rootSchema = options?.rootSchema
  const typeSuffix = options?.typeSuffix
  const refs = new Set<string>()

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
      }
      return // Don't traverse further into a $ref
    }

    // Check if this is an object type with additionalProperties that has a $ref
    // This pattern requires validateRecord
    if (hasAdditionalProperties(record) && hasRef(record.additionalProperties)) {
      collectRefsFromValue(record.additionalProperties)
      return
    }

    // Check if this is an array type with items that has a $ref
    // This pattern requires validateArray
    if (record.type === 'array' && hasItems(record) && hasRef(record.items)) {
      collectRefsFromValue(record.items)
      return
    }

    // Traverse nested properties regardless of whether `type` is explicitly set.
    if ('properties' in record && typeof record.properties === 'object' && record.properties !== null) {
      const props = record.properties as Record<string, unknown>
      for (const key in props) {
        collectRefsFromValue(props[key])
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
        collectRefsFromValue(item)
      }
    }

    // Traverse into array items
    if (hasItems(record)) {
      collectRefsFromValue(record.items)
    }

    // Traverse into additionalProperties
    if (hasAdditionalProperties(record)) {
      collectRefsFromValue(record.additionalProperties)
    }

    // Traverse all patternProperties
    if (
      'patternProperties' in record &&
      typeof record.patternProperties === 'object' &&
      record.patternProperties !== null
    ) {
      const patternProps = record.patternProperties as Record<string, unknown>
      for (const key in patternProps) {
        collectRefsFromValue(patternProps[key])
      }
    }

    // Traverse into if/then/else branches
    if ('then' in record) {
      collectRefsFromValue(record.then)
    }
    if ('else' in record) {
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
    }
  }

  // Collect refs from properties
  if (typeof schema === 'object' && schema !== null && 'properties' in schema) {
    const properties = schema.properties as Record<string, unknown>
    for (const key in properties) {
      collectRefsFromValue(properties[key])
    }
  }

  // Collect refs from root-level additionalProperties
  if (typeof schema === 'object' && schema !== null && 'additionalProperties' in schema) {
    collectRefsFromValue(schema.additionalProperties)
  }

  // Collect refs from root-level patternProperties
  if (typeof schema === 'object' && schema !== null && 'patternProperties' in schema) {
    const patternProps = schema.patternProperties as Record<string, unknown>
    for (const key in patternProps) {
      collectRefsFromValue(patternProps[key])
    }
  }

  // Collect refs from root-level items (when the schema itself is an array type)
  if (typeof schema === 'object' && schema !== null && hasItems(schema)) {
    collectRefsFromValue(schema.items)
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
      collectRefsFromValue(item)
    }
  }

  // Collect refs from root-level conditional branches.
  if (typeof schema === 'object' && schema !== null && 'if' in schema) {
    collectRefsFromValue(schema.if)
  }
  if (typeof schema === 'object' && schema !== null && 'then' in schema) {
    collectRefsFromValue(schema.then)
  }
  if (typeof schema === 'object' && schema !== null && 'else' in schema) {
    collectRefsFromValue(schema.else)
  }

  // Convert refs to import targets, deduplicating by filename.
  const targets = new Map<string, string>()

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

    targets.set(filename, typeName)
  }

  return targets
}
