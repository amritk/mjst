import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, resolve as resolvePath } from 'node:path'
import { buildDynamicRefMap } from '@amritk/helpers/build-dynamic-ref-map'
import { extractRefs } from '@amritk/helpers/extract-refs'
import { refToFilename } from '@amritk/helpers/ref-to-filename'
import { refToName } from '@amritk/helpers/ref-to-name'
import { resolveDynamicRefs } from '@amritk/helpers/resolve-dynamic-refs'
import { resolveRef } from '@amritk/helpers/resolve-ref'
import { upgradeDraft07Schema } from '@amritk/helpers/upgrade-draft07-schema'
import type { JSONSchema } from 'json-schema-typed/draft-2020-12'
import { applySchemaExtensions } from '#helpers/apply-schema-extensions'
import type { HelpersMode, RuntimeHelperName } from '#helpers/collect-helpers'
import type { SchemaExtensions } from '#types/schema-extensions'

import { generateFile } from './generate-files'

/** Locate the @amritk/helpers package on disk so we can copy its runtime
 * helper source files into the generated output when in embedded mode. */
const readHelperSource = async (helper: RuntimeHelperName): Promise<string> => {
  const require = createRequire(import.meta.url)
  const helpersPkgPath = require.resolve('@amritk/helpers/package.json')
  const helpersRoot = dirname(helpersPkgPath)
  return readFile(resolvePath(helpersRoot, 'src', `${helper}.ts`), 'utf-8')
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
 * @param extensions - Optional map of custom extension properties to add to specific definitions.
 *   Keys are definition names (matching $defs keys), values are records of extension property
 *   names to their JSON Schema definitions. Extensions are merged as optional properties before
 *   type and parser generation.
 * @param typesOnly - When true, only generate TypeScript type definitions without parser functions.
 * @param logWarnings - When true, the generated parsers emit a console.warn for every input key
 *   that is not declared in the schema's properties.
 * @param strict - When true, the generated parsers throw on type/shape mismatches
 *   (wrong type, missing required property, enum/pattern/min/max violations) instead
 *   of coercing invalid input to default values.
 * @param helpersMode - `'package'` (default) emits `import ... from '@amritk/helpers/...'`.
 *   `'embedded'` emits `import ... from './_helpers/...'` and appends the helper sources
 *   as additional `GeneratedFile` entries so the output directory is self-contained.
 * @param helpersImportPrefix - Relative path prefix to the `_helpers/` directory in
 *   embedded mode. Defaults to `'./'`. The recursive multi-schema build passes `'../'`,
 *   `'../../'`, etc. so nested parsers can import from a single shared `_helpers/`
 *   directory while the helper sources are emitted once at the output root.
 * @param readonly - When true, every property, array, and record in the generated type
 *   definitions is emitted as `readonly`.
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
 * const typesFiles = buildSchema(schema, "Document", undefined, true);
 *
 * // With extensions:
 * const filesWithExtensions = buildSchema(schema, "Document", {
 *   info: {
 *     'x-internal': { type: 'boolean' },
 *   },
 * });
 * ```
 */
export const buildSchema = async (
  rootSchema: JSONSchema,
  rootTypeName: string,
  extensions?: SchemaExtensions,
  typesOnly?: boolean,
  logWarnings?: boolean,
  strict?: boolean,
  helpersMode: HelpersMode = 'package',
  helpersImportPrefix = './',
  readonly = false,
): Promise<GeneratedFile[]> => {
  // Upgrade draft-07 schemas to 2020-12 conventions before processing.
  // This renames `definitions` → `$defs` recursively so the rest of the
  // pipeline can resolve both short-name and URI-keyed refs uniformly.
  rootSchema = upgradeDraft07Schema(rootSchema as Record<string, unknown>) as JSONSchema

  const files: GeneratedFile[] = []
  const processedRefs = new Set<string>()
  const processedFilenames = new Set<string>()
  const refsToProcess: string[] = []
  const usedHelpers = new Set<RuntimeHelperName>()

  // Build a map of $dynamicRef anchors to their $ref paths so we can
  // convert $dynamicRef: "#meta" to $ref: "#/$defs/schema" before generating
  const dynamicRefMap = buildDynamicRefMap(rootSchema)

  // Generate file for the root schema, applying any matching extensions
  const processedRootSchema = resolveDynamicRefs(rootSchema, dynamicRefMap)
  const extendedRootSchema = extensions
    ? applySchemaExtensions(processedRootSchema, rootTypeName.toLowerCase(), extensions)
    : processedRootSchema
  const rootResult = generateFile(extendedRootSchema, rootTypeName, {
    typesOnly: typesOnly ?? false,
    rootSchema: rootSchema as Record<string, unknown>,
    helpersMode,
    helpersImportPrefix,
    readonly,
    ...(logWarnings !== undefined ? { logWarnings } : {}),
    ...(strict !== undefined ? { strict } : {}),
  })
  const rootFilename = rootTypeName.toLowerCase()

  processedFilenames.add(rootFilename)
  files.push({
    filename: `${rootFilename}.ts`,
    content: rootResult.content,
  })
  for (const helper of rootResult.usedHelpers) usedHelpers.add(helper)

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
    const fileResult = generateFile(extendedSchema, typeName, {
      typesOnly: typesOnly ?? false,
      selfRef: ref,
      rootSchema: rootSchema as Record<string, unknown>,
      helpersMode,
      helpersImportPrefix,
      readonly,
      ...(logWarnings !== undefined ? { logWarnings } : {}),
      ...(strict !== undefined ? { strict } : {}),
    })

    if (!processedFilenames.has(filename)) {
      processedFilenames.add(filename)
      files.push({
        filename: `${filename}.ts`,
        content: fileResult.content,
      })
    }
    for (const helper of fileResult.usedHelpers) usedHelpers.add(helper)

    // Extract refs from this schema and add to queue
    const nestedRefs = extractRefs(resolvedSchema as JSONSchema)
    for (const nestedRef of nestedRefs) {
      if (!processedRefs.has(nestedRef)) {
        refsToProcess.push(nestedRef)
      }
    }
  }

  // In embedded mode, ship the runtime helper source files alongside the parsers so
  // the output directory is self-contained (no `@amritk/helpers` install required).
  // typesOnly skips parser generation entirely, so no runtime helpers are needed.
  if (helpersMode === 'embedded' && !typesOnly) {
    for (const helper of usedHelpers) {
      const source = await readHelperSource(helper)
      files.push({ filename: `_helpers/${helper}.ts`, content: source })
    }
  }

  // Generate index.ts with named re-exports extracted from each generated file's content.
  // Regex matches `export type Foo` and `export const foo` declarations.
  const TYPE_EXPORT_RE = /^export type (\w+)/gm
  const CONST_EXPORT_RE = /^export const (\w+)/gm

  // _helpers/ is an internal directory; never re-export from it.
  const sortedFiles = [...files]
    .filter((f) => !f.filename.startsWith('_helpers/'))
    .sort((a, b) => a.filename.localeCompare(b.filename))

  let indexContent = ''
  for (const file of sortedFiles) {
    const moduleName = file.filename.replace(/\.ts$/, '')
    const typeNames: string[] = []
    const constNames: string[] = []

    for (const match of file.content.matchAll(TYPE_EXPORT_RE)) {
      typeNames.push(match[1] as string)
    }
    for (const match of file.content.matchAll(CONST_EXPORT_RE)) {
      constNames.push(match[1] as string)
    }

    if (typeNames.length === 0 && constNames.length === 0) continue

    if (typesOnly) {
      indexContent += `export type { ${typeNames.join(', ')} } from './${moduleName}';\n`
    } else {
      const typeExports = typeNames.map((n) => `type ${n}`)
      const allExports = [...typeExports, ...constNames]
      indexContent += `export { ${allExports.join(', ')} } from './${moduleName}';\n`
    }
  }

  files.push({
    filename: 'index.ts',
    content: indexContent,
  })

  return files
}
