import type { JSONSchema } from 'json-schema-typed/draft-2020-12'
import { hasAdditionalProperties, hasAllOf, hasAnyOf, hasItems, hasOneOf, hasRef } from '#type-guards/schema-guards'
import { refToFilename } from './ref-to-filename'
import { refToName } from './ref-to-name'
import { resolveRef } from './resolve-ref'

const getImportPathForFilename = (filename: string): string => `./${filename}`

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
  readonly selfRef?: string
  /**
   * The root schema document. When provided, URI refs that cannot be resolved
   * within the root schema's $defs are excluded from the import list, preventing
   * imports for external schemas that were never generated as files.
   */
  readonly rootSchema?: Record<string, unknown>
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
  const selfFilename = options?.selfRef ? refToFilename(options.selfRef) : undefined
  const rootSchema = options?.rootSchema
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
    // - specification-extensions, whose semantics are inlined as Record<`x-${string}`, unknown>
    // - Relative path refs (e.g. /components/messages/foo) which point into example data
    // - URI refs with fragments pointing into `properties` (not standalone definitions)
    if (hasRef(record)) {
      const ref = record.$ref
      const isInternal = ref.startsWith('#') && ref !== '#/$defs/specification-extensions'
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

    // Traverse non-extension patternProperties. The ^x- vendor extension pattern is
    // inlined as Record<`x-${string}`, unknown> and does not produce a named import.
    if (
      'patternProperties' in record &&
      typeof record.patternProperties === 'object' &&
      record.patternProperties !== null
    ) {
      const patternProps = record.patternProperties as Record<string, unknown>
      for (const key in patternProps) {
        if (key.startsWith('^x-') || key === '^x-') continue
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

  // Collect refs from root-level $ref, skipping:
  // - specification-extensions, whose semantics are inlined as Record<`x-${string}`, unknown>
  // - Relative path refs (e.g. /components/messages/foo) which point into example data
  if (typeof schema === 'object' && schema !== null && hasRef(schema)) {
    const ref = schema.$ref
    const isInternal = ref.startsWith('#') && ref !== '#/$defs/specification-extensions'
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

  // Collect refs from root-level non-extension patternProperties.
  // The ^x- vendor extension pattern is inlined and does not produce a named import.
  if (typeof schema === 'object' && schema !== null && 'patternProperties' in schema) {
    const patternProps = schema.patternProperties as Record<string, unknown>
    for (const key in patternProps) {
      if (key.startsWith('^x-') || key === '^x-') continue
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
  // OpenAPI uses if/then fragments in several helper definitions (e.g. security-scheme variants),
  // and those branches can contain $ref properties that the generated parser/type depends on.
  if (typeof schema === 'object' && schema !== null && 'if' in schema) {
    collectRefsFromValue(schema.if)
  }
  if (typeof schema === 'object' && schema !== null && 'then' in schema) {
    collectRefsFromValue(schema.then)
  }
  if (typeof schema === 'object' && schema !== null && 'else' in schema) {
    collectRefsFromValue(schema.else)
  }

  // Convert refs to combined import statements, deduplicating by filename
  const importMap = new Map<string, string>()
  let needsReferenceImport = false

  for (const ref of refs) {
    // For URI refs, skip if the base URI is not resolvable in the root schema.
    // This prevents generating imports for external schemas that were never generated as files.
    if (rootSchema !== undefined && (ref.startsWith('http://') || ref.startsWith('https://'))) {
      if (!resolveRef(ref, rootSchema)) continue
    }

    const typeName = refToName(ref)
    const filename = refToFilename(ref)

    // Skip self-referential imports — a file must not import from itself
    if (selfFilename !== undefined && filename === selfFilename) {
      continue
    }

    const importPath = getImportPathForFilename(filename)

    // Check if this is a -or-reference ref
    if (ref.includes('-or-reference')) {
      needsReferenceImport = true
    }

    // In types-only mode, omit the parser function import since there is no parser to call
    const importStatement = typesOnly
      ? `import type { ${typeName} } from '${importPath}';`
      : `import { type ${typeName}, parse${typeName} } from '${importPath}';`
    // Use filename as key to deduplicate (e.g., callbacks-or-reference and callbacks both map to callbacks)
    importMap.set(filename, importStatement)
  }

  const imports = Array.from(importMap.values()).sort()

  // Add Reference import at the beginning if needed
  if (needsReferenceImport) {
    imports.unshift("import type { ReferenceObject } from './reference';")
  }

  return imports
}
