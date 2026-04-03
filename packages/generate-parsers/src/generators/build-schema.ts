import { join } from 'node:path'
import type { JSONSchema } from 'json-schema-typed/draft-2020-12'
import { applySchemaExtensions } from '#helpers/apply-schema-extensions'
import { buildDynamicRefMap } from '#helpers/build-dynamic-ref-map'
import { extractRefs } from '#helpers/extract-refs'
import { refToFilename } from '#helpers/ref-to-filename'
import { refToName } from '#helpers/ref-to-name'
import { resolveDynamicRefs } from '#helpers/resolve-dynamic-refs'
import { resolveRef } from '#helpers/resolve-ref'
import type { SchemaExtensions } from '#types/schema-extensions'

import { generateFile } from './generate-files'

/**
 * Checks whether a resolved schema is a pure property-mixin: it only contributes
 * `properties` (and optionally `not`/`required`) with no structural keywords like
 * `type`, `if`, `then`, `else`, `additionalProperties`, `$ref`, or `allOf`.
 * These schemas are safe to inline into the parent's `properties` rather than
 * being referenced as a typed field.
 */
const isPropertyMixin = (schema: Record<string, unknown>): boolean => {
  const structuralKeys = ['type', 'if', 'then', 'else', 'additionalProperties', '$ref', 'allOf', 'oneOf', 'anyOf']
  for (const key of structuralKeys) {
    if (key in schema) return false
  }
  return 'properties' in schema
}

/**
 * Merges properties from `allOf` $ref entries that are pure property-mixin schemas
 * into the schema's own `properties`. This handles the OpenAPI pattern where shared
 * fields (e.g. `example`/`examples`) are factored out into a helper definition and
 * included via `allOf` rather than being declared directly on the object.
 *
 * Only refs that resolve to a property-mixin (no structural keywords) are merged.
 * Refs like `specification-extensions` are skipped since they are already inlined
 * as `Record<\`x-\${string}\`, unknown>` by the type generator.
 */
const mergeAllOfMixins = (schema: JSONSchema, rootSchema: Record<string, unknown>): JSONSchema => {
  if (typeof schema !== 'object' || schema === null) return schema
  if (!('allOf' in schema) || !Array.isArray(schema.allOf)) return schema

  const mixinProperties: Record<string, JSONSchema> = {}

  for (const entry of schema.allOf) {
    if (typeof entry !== 'object' || entry === null || !('$ref' in entry)) continue
    const ref = (entry as { $ref: string }).$ref
    if (ref === '#/$defs/specification-extensions') continue

    const resolved = resolveRef(ref, rootSchema)
    if (!resolved || !isPropertyMixin(resolved)) continue

    const props = resolved.properties as Record<string, JSONSchema> | undefined
    if (!props) continue

    for (const key in props) {
      mixinProperties[key] = props[key] as JSONSchema
    }
  }

  if (Object.keys(mixinProperties).length === 0) return schema

  const existingProperties =
    'properties' in schema && typeof schema.properties === 'object' && schema.properties !== null
      ? (schema.properties as Record<string, JSONSchema>)
      : {}

  // Remove merged mixin refs from allOf so collectImports doesn't emit dead imports for them
  const remainingAllOf = (schema.allOf as JSONSchema[]).filter((entry) => {
    if (typeof entry !== 'object' || entry === null || !('$ref' in entry)) return true
    const ref = (entry as { $ref: string }).$ref
    if (ref === '#/$defs/specification-extensions') return true
    const resolved = resolveRef(ref, rootSchema)
    return !resolved || !isPropertyMixin(resolved)
  })

  return {
    ...schema,
    ...(remainingAllOf.length > 0 ? { allOf: remainingAllOf } : { allOf: undefined }),
    properties: {
      ...mixinProperties,
      ...existingProperties,
    },
  }
}

/**
 * Represents a generated file with its filename and content.
 */
export type GeneratedFile = {
  filename: string
  content: string
}

/**
 * Extracts all definitions from $defs that have a $dynamicAnchor.
 * These definitions need to be generated even if not directly referenced by $ref.
 */
const extractDynamicAnchorDefs = (schema: JSONSchema): string[] => {
  const refs: string[] = []

  if (typeof schema !== 'object' || schema === null) {
    return refs
  }

  // Check if schema has $defs
  if (!('$defs' in schema) || typeof schema['$defs'] !== 'object' || schema['$defs'] === null) {
    return refs
  }

  const defs = schema['$defs']

  // Find all definitions with $dynamicAnchor
  for (const [key, value] of Object.entries(defs)) {
    if (typeof value === 'object' && value !== null) {
      const defSchema = value as Record<string, unknown>
      if ('$dynamicAnchor' in defSchema) {
        // Convert to a $ref-style path
        refs.push(`#/$defs/${key}`)
      }
    }
  }

  return refs
}

/**
 * Builds all TypeScript files from a JSON Schema by traversing
 * all $ref references recursively.
 *
 * Starting from the root schema, this function:
 * 1. Generates a TypeScript file for the root type
 * 2. Extracts all $ref references from the schema
 * 3. Extracts all definitions with $dynamicAnchor (JSON Schema 2020-12 feature)
 * 4. Resolves each ref and generates a TypeScript file for it
 * 5. Recursively processes nested refs until all are handled
 *
 * @param rootSchema - The root JSON Schema to build from
 * @param rootTypeName - The name for the root type (e.g., "Document")
 * @param markdownDocumentation - Optional markdown documentation for enhanced comments
 * @param extensions - Optional map of custom extension properties to add to specific definitions.
 *   Keys are definition names (matching $defs keys), values are records of extension property
 *   names to their JSON Schema definitions. Extensions are merged as optional properties before
 *   type and parser generation.
 * @param typesOnly - When true, only generate TypeScript type definitions without parser functions.
 *   Runtime helper files (validators, isObject) are also omitted since they are only needed for parsers.
 * @returns An array of generated TypeScript files
 *
 * @example
 * ```typescript
 * const schema = {
 *   type: "object",
 *   properties: {
 *     info: { $ref: "#/$defs/info" }
 *   },
 *   $defs: {
 *     info: {
 *       type: "object",
 *       properties: {
 *         title: { type: "string" }
 *       }
 *     }
 *   }
 * };
 *
 * const files = buildSchema(schema, "Document");
 *
 * // Types-only mode — no parser functions or runtime helpers included:
 * const typesFiles = buildSchema(schema, "Document", undefined, undefined, true);
 *
 * // With extensions:
 * const filesWithExtensions = buildSchema(schema, "Document", undefined, {
 *   info: {
 *     'x-internal': { type: 'boolean' },
 *   },
 * });
 * ```
 */
export const buildSchema = async (
  rootSchema: JSONSchema,
  rootTypeName: string,
  markdownDocumentation?: string,
  extensions?: SchemaExtensions,
  typesOnly?: boolean,
): Promise<GeneratedFile[]> => {
  const files: GeneratedFile[] = []
  const processedRefs = new Set<string>()
  const refsToProcess: string[] = []

  // Build a map of $dynamicRef anchors to their $ref paths so we can
  // convert $dynamicRef: "#meta" to $ref: "#/$defs/schema" before generating
  const dynamicRefMap = buildDynamicRefMap(rootSchema)

  // Generate file for the root schema, applying any matching extensions
  const processedRootSchema = resolveDynamicRefs(rootSchema, dynamicRefMap)
  const mixinMergedRootSchema = mergeAllOfMixins(processedRootSchema, rootSchema as Record<string, unknown>)
  const extendedRootSchema = extensions
    ? applySchemaExtensions(mixinMergedRootSchema, rootTypeName.toLowerCase(), extensions)
    : mixinMergedRootSchema
  const rootContent = generateFile(extendedRootSchema, rootTypeName, markdownDocumentation, {
    typesOnly: typesOnly ?? false,
  })
  const rootFilename = rootTypeName.toLowerCase()

  if (rootFilename !== 'schema') {
    files.push({
      filename: `${rootFilename}.ts`,
      content: rootContent,
    })
  }

  // Extract all refs from the root schema
  const rootRefs = extractRefs(rootSchema)
  refsToProcess.push(...rootRefs)

  // Extract all definitions with $dynamicAnchor
  const dynamicAnchorRefs = extractDynamicAnchorDefs(rootSchema)
  refsToProcess.push(...dynamicAnchorRefs)

  // Process refs until none remain
  while (refsToProcess.length > 0) {
    const ref = refsToProcess.shift()

    // Skip if already processed
    if (!ref || processedRefs.has(ref)) {
      continue
    }

    processedRefs.add(ref)

    // Resolve the ref to get the actual schema
    const resolvedSchema = resolveRef(ref, rootSchema as Record<string, unknown>)

    if (!resolvedSchema) {
      console.warn(`Warning: Could not resolve ref: ${ref}`)
      continue
    }

    // Skip -or-reference defs — they are if/then/else unions (e.g. Parameter | Reference)
    // that are inlined at usage sites. Generating a file for them would collide with the
    // canonical def that shares the same filename after the suffix is stripped.
    if (ref.endsWith('-or-reference')) {
      // Still extract nested refs so the canonical def (e.g. #/$defs/parameter) gets queued
      const nestedRefs = extractRefs(resolvedSchema as JSONSchema)
      for (const nestedRef of nestedRefs) {
        if (!processedRefs.has(nestedRef)) {
          refsToProcess.push(nestedRef)
        }
      }
      continue
    }

    // Generate file for this ref, resolving any $dynamicRef to $ref first
    // and applying any matching extensions for this definition
    const typeName = refToName(ref)
    const filename = refToFilename(ref)
    const processedSchema = resolveDynamicRefs(resolvedSchema as JSONSchema, dynamicRefMap)
    const mixinMergedSchema = mergeAllOfMixins(processedSchema, rootSchema as Record<string, unknown>)
    const extendedSchema = extensions ? applySchemaExtensions(mixinMergedSchema, filename, extensions) : mixinMergedSchema
    const content = generateFile(extendedSchema, typeName, markdownDocumentation, { typesOnly: typesOnly ?? false })

    if (filename !== 'schema') {
      files.push({
        filename: `${filename}.ts`,
        content,
      })
    }

    // Extract refs from this schema and add to queue
    const nestedRefs = extractRefs(resolvedSchema as JSONSchema)
    for (const nestedRef of nestedRefs) {
      if (!processedRefs.has(nestedRef)) {
        refsToProcess.push(nestedRef)
      }
    }
  }

  // In types-only mode, emit a lightweight schema.ts with only the SchemaObject type
  // definitions (no runtime parser code or mjst-helpers imports). The full template
  // is only needed when parsers are generated.
  if (typesOnly) {
    const schemaTypesTemplatePath = join(import.meta.dir, '../templates/schema-types.ts')
    const schemaTypesTemplateContent = await Bun.file(schemaTypesTemplatePath).text()

    files.push({
      filename: 'schema.ts',
      content: schemaTypesTemplateContent,
    })
  } else {
    const schemaTemplatePath = join(import.meta.dir, '../templates/schema.ts')
    const schemaTemplateContent = await Bun.file(schemaTemplatePath).text()

    files.push({
      filename: 'schema.ts',
      content: schemaTemplateContent,
    })
  }

  return files
}
