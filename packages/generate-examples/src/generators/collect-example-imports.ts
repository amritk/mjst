import { refToFilename } from '@amritk/helpers/ref-to-filename'
import { refToName } from '@amritk/helpers/ref-to-name'
import { resolveRef } from '@amritk/helpers/resolve-ref'
import { hasAdditionalProperties, hasAllOf, hasAnyOf, hasItems, hasOneOf, hasRef } from '@amritk/helpers/schema-guards'
import type { JSONSchema } from 'json-schema-typed/draft-2020-12'

/**
 * Options for controlling how example imports are collected.
 */
type CollectExampleImportsOptions = {
  /**
   * The $ref path of the schema being generated (e.g. `#/$defs/address`).
   * Prevents a file from importing itself.
   */
  readonly selfRef?: string | undefined
  /**
   * The root schema document. URI refs that cannot be resolved within it
   * are excluded from the import list (they were never generated as files).
   */
  readonly rootSchema?: Record<string, unknown> | undefined
  /**
   * Suffix appended to every type/arbitrary name derived from a `$ref`. Must
   * match the suffix used when generating the referenced files. Defaults to `''`.
   */
  readonly typeSuffix?: string
}

/**
 * Generates an import statement for a single $ref, importing both the generated
 * type and its arbitrary from the ref's generated file.
 */
const buildImport = (ref: string, suffix: string): string => {
  const filename = refToFilename(ref)
  const typeName = refToName(ref, suffix)
  // `.js` extension so the emitted import resolves under Node ESM, not only Bun.
  return `import { type ${typeName}, ${typeName}Arbitrary } from './${filename}.js'`
}

/**
 * Walks one level of the schema and yields all direct $ref strings that should
 * become imports: properties, additionalProperties, items, and union branches.
 */
const collectDirectRefs = (schema: JSONSchema): string[] => {
  if (typeof schema === 'boolean' || schema === null) return []

  const refs: string[] = []

  if (hasRef(schema)) {
    refs.push(schema.$ref)
    return refs
  }

  const propSchemas =
    'properties' in schema && typeof schema.properties === 'object' && schema.properties !== null
      ? Object.values(schema.properties as Record<string, JSONSchema>)
      : []

  for (const prop of propSchemas) {
    if (hasRef(prop)) refs.push((prop as { $ref: string }).$ref)
    if (hasItems(prop) && hasRef(prop.items)) refs.push((prop.items as { $ref: string }).$ref)
    if (hasAdditionalProperties(prop) && hasRef(prop.additionalProperties as JSONSchema)) {
      refs.push((prop.additionalProperties as { $ref: string }).$ref)
    }
  }

  if (hasItems(schema) && hasRef(schema.items)) {
    refs.push((schema.items as { $ref: string }).$ref)
  }

  if (hasAdditionalProperties(schema) && hasRef(schema.additionalProperties as JSONSchema)) {
    refs.push((schema.additionalProperties as { $ref: string }).$ref)
  }

  for (const branch of [
    ...(hasOneOf(schema) ? schema.oneOf : []),
    ...(hasAnyOf(schema) ? schema.anyOf : []),
    ...(hasAllOf(schema) ? schema.allOf : []),
  ]) {
    if (hasRef(branch)) refs.push((branch as { $ref: string }).$ref)
  }

  return refs
}

/**
 * Collects import statements for all $ref dependencies of a schema. Each import
 * brings in both the generated TypeScript type and the arbitrary for that ref.
 *
 * @example
 * ```typescript
 * const schema = { properties: { address: { $ref: '#/$defs/address' } } }
 * collectExampleImports(schema)
 * // ["import { type Address, AddressArbitrary } from './address'"]
 * ```
 */
export const collectExampleImports = (schema: JSONSchema, options?: CollectExampleImportsOptions): string[] => {
  const selfFilename = options?.selfRef ? refToFilename(options.selfRef) : null
  const rootSchema = options?.rootSchema
  const typeSuffix = options?.typeSuffix ?? ''

  const refs = collectDirectRefs(schema)
  const seen = new Set<string>()
  const imports: string[] = []

  for (const ref of refs) {
    const filename = refToFilename(ref)

    if (seen.has(filename)) continue
    if (selfFilename && filename === selfFilename) continue

    // Skip refs that don't resolve in this schema (external / never generated)
    if (rootSchema) {
      const resolved = resolveRef(ref, rootSchema)
      if (!resolved) continue
    }

    seen.add(filename)
    imports.push(buildImport(ref, typeSuffix))
  }

  return imports
}
