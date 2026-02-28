import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { JSONSchema } from 'json-schema-typed/draft-2020-12'
import { applySchemaExtensions } from '../helpers/apply-schema-extensions'
import { buildDynamicRefMap } from '../helpers/build-dynamic-ref-map'
import { extractRefs } from '../helpers/extract-refs'
import { refToFilename } from '../helpers/ref-to-filename'
import { refToName } from '../helpers/ref-to-name'
import { resolveDynamicRefs } from '../helpers/resolve-dynamic-refs'
import { resolveRef } from '../helpers/resolve-ref'
import type { SchemaExtensions } from '../types/schema-extensions'
import { generateFile } from './generate-files'

const __dirname = fileURLToPath(new URL('.', import.meta.url))

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
  const extendedRootSchema = extensions
    ? applySchemaExtensions(processedRootSchema, rootTypeName.toLowerCase(), extensions)
    : processedRootSchema
  const rootContent = generateFile(extendedRootSchema, rootTypeName, markdownDocumentation, { typesOnly })
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

    // Generate file for this ref, resolving any $dynamicRef to $ref first
    // and applying any matching extensions for this definition
    const typeName = refToName(ref)
    const filename = refToFilename(ref)
    const processedSchema = resolveDynamicRefs(resolvedSchema as JSONSchema, dynamicRefMap)
    const extendedSchema = extensions ? applySchemaExtensions(processedSchema, filename, extensions) : processedSchema
    const content = generateFile(extendedSchema, typeName, markdownDocumentation, { typesOnly })

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

  // Runtime helper files are only needed when parsers are generated.
  // In types-only mode, skip them entirely since there is no runtime validation code.
  if (!typesOnly) {
    const validateArrayPath = join(__dirname, '../validators/validate-array.ts')
    const validateRecordPath = join(__dirname, '../validators/validate-record.ts')
    const isObjectPath = join(__dirname, '../helpers/is-object.ts')
    const schemaTemplatePath = join(__dirname, '../templates/schema.ts')

    const validateArrayContent = await readFile(validateArrayPath, 'utf-8')
    const validateRecordContent = await readFile(validateRecordPath, 'utf-8')
    const isObjectContent = await readFile(isObjectPath, 'utf-8')
    const schemaTemplateContent = await readFile(schemaTemplatePath, 'utf-8')

    files.push({
      filename: 'validators/validate-array.ts',
      content: validateArrayContent,
    })

    files.push({
      filename: 'helpers/is-object.ts',
      content: isObjectContent,
    })

    files.push({
      filename: 'validators/validate-record.ts',
      content: validateRecordContent,
    })

    // Fix import paths in schema template for output directory structure
    const adjustedSchemaContent = schemaTemplateContent.replace(
      "import { isObject } from '../helpers/is-object'",
      "import { isObject } from './helpers/is-object'",
    )

    files.push({
      filename: 'schema.ts',
      content: adjustedSchemaContent,
    })
  }

  return files
}
