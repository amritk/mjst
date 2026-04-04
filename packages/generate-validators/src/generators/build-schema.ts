import { join } from 'node:path'
import type { JSONSchema } from 'json-schema-typed/draft-2020-12'
import { buildDynamicRefMap } from 'mjst-helpers/build-dynamic-ref-map'
import { extractRefs } from 'mjst-helpers/extract-refs'
import { refToFilename } from 'mjst-helpers/ref-to-filename'
import { refToName } from 'mjst-helpers/ref-to-name'
import { resolveDynamicRefs } from 'mjst-helpers/resolve-dynamic-refs'
import { resolveRef } from 'mjst-helpers/resolve-ref'
import { upgradeDraft07Schema } from 'mjst-helpers/upgrade-draft07-schema'

import { generateValidatorFile } from './generate-files'

/**
 * Represents a generated TypeScript file with its filename and content.
 */
export type GeneratedFile = {
  filename: string
  content: string
}

/**
 * Builds all TypeScript validator files from a JSON Schema by traversing
 * all $ref references recursively, mirroring the generate-parsers pipeline.
 *
 * Each generated file exports:
 * - A TypeScript type definition
 * - A `validateFoo(input: unknown, _path?: string): ValidationResult` function
 *
 * A `validation-result.ts` template is always included. An `index.ts` re-exports
 * everything from all generated files.
 *
 * @param rootSchema - The root JSON Schema to build from
 * @param rootTypeName - The name for the root type (e.g. "Document")
 * @param markdownDocumentation - Optional markdown documentation for comments
 * @returns An array of generated TypeScript files
 *
 * @example
 * ```typescript
 * const files = await buildValidatorSchema(schema, 'Document')
 * // files → [{ filename: 'document.ts', content: '...' }, { filename: 'info.ts', ... }, ...]
 * ```
 */
export const buildValidatorSchema = async (
  rootSchema: JSONSchema,
  rootTypeName: string,
  markdownDocumentation?: string,
): Promise<GeneratedFile[]> => {
  rootSchema = upgradeDraft07Schema(rootSchema as Record<string, unknown>) as JSONSchema

  const files: GeneratedFile[] = []
  const processedRefs = new Set<string>()
  const processedFilenames = new Set<string>()
  const refsToProcess: string[] = []

  const dynamicRefMap = buildDynamicRefMap(rootSchema)

  // Root schema
  const processedRootSchema = resolveDynamicRefs(rootSchema, dynamicRefMap)
  const rootContent = generateValidatorFile(
    processedRootSchema,
    rootTypeName,
    markdownDocumentation,
    { rootSchema: rootSchema as Record<string, unknown> },
  )
  const rootFilename = rootTypeName.toLowerCase()

  if (rootFilename !== 'validation-result') {
    processedFilenames.add(rootFilename)
    files.push({ filename: `${rootFilename}.ts`, content: rootContent })
  }

  const rootRefs = extractRefs(rootSchema)
  refsToProcess.push(...rootRefs)

  while (refsToProcess.length > 0) {
    const ref = refsToProcess.shift()
    if (!ref || processedRefs.has(ref)) continue
    processedRefs.add(ref)

    const resolvedSchema = resolveRef(ref, rootSchema as Record<string, unknown>)
    if (!resolvedSchema) {
      console.warn(`Warning: Could not resolve ref: ${ref}`)
      continue
    }

    // -or-reference unions are inlined at usage sites; skip file generation
    // but still queue nested refs so the canonical def gets processed.
    if (ref.endsWith('-or-reference')) {
      for (const nestedRef of extractRefs(resolvedSchema as JSONSchema)) {
        if (!processedRefs.has(nestedRef)) refsToProcess.push(nestedRef)
      }
      continue
    }

    const typeName = refToName(ref)
    const filename = refToFilename(ref)
    const processedSchema = resolveDynamicRefs(resolvedSchema as JSONSchema, dynamicRefMap)
    const content = generateValidatorFile(processedSchema, typeName, markdownDocumentation, {
      selfRef: ref,
      rootSchema: rootSchema as Record<string, unknown>,
    })

    if (filename !== 'validation-result' && !processedFilenames.has(filename)) {
      processedFilenames.add(filename)
      files.push({ filename: `${filename}.ts`, content })
    }

    for (const nestedRef of extractRefs(resolvedSchema as JSONSchema)) {
      if (!processedRefs.has(nestedRef)) refsToProcess.push(nestedRef)
    }
  }

  // Include the validation-result template
  const templatePath = join(import.meta.dir, '../templates/validation-result.ts')
  const templateContent = await Bun.file(templatePath).text()
  files.push({ filename: 'validation-result.ts', content: templateContent })

  // Generate index.ts
  const TYPE_EXPORT_RE = /^export type (\w+)/gm
  const CONST_EXPORT_RE = /^export const (\w+)/gm

  const sortedFiles = [...files].sort((a, b) => a.filename.localeCompare(b.filename))
  let indexContent = ''

  for (const file of sortedFiles) {
    const moduleName = file.filename.replace(/\.ts$/, '')
    const typeNames: string[] = []
    const constNames: string[] = []

    for (const match of file.content.matchAll(TYPE_EXPORT_RE)) typeNames.push(match[1] as string)
    for (const match of file.content.matchAll(CONST_EXPORT_RE)) constNames.push(match[1] as string)

    if (typeNames.length === 0 && constNames.length === 0) continue

    const typeExports = typeNames.map((n) => `type ${n}`)
    indexContent += `export { ${[...typeExports, ...constNames].join(', ')} } from './${moduleName}';\n`
  }

  files.push({ filename: 'index.ts', content: indexContent })

  return files
}
