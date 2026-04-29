import { refToFilename } from '@amritk/helpers/ref-to-filename'
import { refToName } from '@amritk/helpers/ref-to-name'
import { resolveRef } from '@amritk/helpers/resolve-ref'
import { hasAdditionalProperties, hasAllOf, hasAnyOf, hasItems, hasOneOf, hasRef } from '@amritk/helpers/schema-guards'
import type { JSONSchema } from 'json-schema-typed/draft-2020-12'

/**
 * Options for controlling how validator imports are collected.
 */
type CollectValidatorImportsOptions = {
  /**
   * The $ref path of the schema being generated (e.g. `#/$defs/encoding`).
   * Prevents a file from importing itself.
   */
  readonly selfRef?: string | undefined
  /**
   * The root schema document. URI refs that cannot be resolved within it
   * are excluded from the import list (they were never generated as files).
   */
  readonly rootSchema?: Record<string, unknown> | undefined
}

/**
 * Generates an import statement for a single $ref, importing both the type
 * and the validator function from the ref's generated file.
 */
const buildImport = (ref: string): string => {
  const filename = refToFilename(ref)
  const typeName = refToName(ref)
  const validatorName = `validate${typeName}`
  return `import { type ${typeName}, ${validatorName} } from './${filename}'`
}

/**
 * Resolves the canonical filename for a ref, stripping `-or-reference` suffixes
 * so that `#/$defs/parameter-or-reference` maps to `parameter`.
 */
const canonicalFilename = (ref: string): string => {
  const base = ref.endsWith('-or-reference') ? ref.replace('-or-reference', '') : ref
  return refToFilename(base)
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
 * Collects import statements for all $ref dependencies of a schema.
 * Each import brings in both the generated TypeScript type and validator function.
 *
 * @example
 * ```typescript
 * const schema = { properties: { contact: { $ref: '#/$defs/contact' } } }
 * collectValidatorImports(schema)
 * // ["import { type ContactObject, validateContactObject } from './contact-object'"]
 * ```
 */
export const collectValidatorImports = (schema: JSONSchema, options?: CollectValidatorImportsOptions): string[] => {
  const selfFilename = options?.selfRef ? refToFilename(options.selfRef) : null
  const rootSchema = options?.rootSchema

  const refs = collectDirectRefs(schema)
  const seen = new Set<string>()
  const imports: string[] = []

  for (const ref of refs) {
    const filename = canonicalFilename(ref)

    if (seen.has(filename)) continue
    if (selfFilename && filename === selfFilename) continue

    // Skip refs that don't resolve in this schema (external / never generated)
    if (rootSchema) {
      const resolved = resolveRef(ref, rootSchema)
      if (!resolved) continue
    }

    seen.add(filename)

    // -or-reference unions import the base type's validator
    const importRef = ref.endsWith('-or-reference') ? ref.replace('-or-reference', '') : ref
    imports.push(buildImport(importRef))
  }

  return imports
}
