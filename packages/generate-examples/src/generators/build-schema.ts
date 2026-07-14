import { generateIndexBarrel } from '@amritk/helpers/generate-index-barrel'
import { walkRefGraph } from '@amritk/helpers/walk-ref-graph'
import type { JSONSchema } from 'json-schema-typed/draft-2020-12'

import { findSchemaCycles } from './find-schema-cycles'
import { generateExampleFile } from './generate-files'

/**
 * Represents a generated TypeScript file with its filename and content.
 */
export type GeneratedFile = {
  filename: string
  content: string
}

/**
 * Builds all TypeScript example files from a JSON Schema by traversing all
 * `$ref` / `$dynamicRef` references recursively (via the shared
 * `@amritk/helpers/walk-ref-graph` walker).
 *
 * Each generated file exports:
 * - A TypeScript type definition
 * - A `fast-check` arbitrary (`FooArbitrary`) that produces schema-valid values
 * - A concrete example value (`fooExample`)
 *
 * An `index.ts` re-exports everything. The generated output imports `fast-check`,
 * which consumers must install as a (dev) dependency.
 *
 * @param rootSchema - The root JSON Schema to build from
 * @param rootTypeName - The name for the root type (e.g. "Document")
 * @param typeSuffix - Suffix appended to every `$ref`-derived name (default `''`)
 * @returns An array of generated TypeScript files
 *
 * @example
 * ```typescript
 * const files = await buildExampleSchema(schema, 'Document')
 * // files → [{ filename: 'document.ts', content: '...' }, { filename: 'index.ts', ... }]
 * ```
 */
export const buildExampleSchema = async (
  rootSchema: JSONSchema,
  rootTypeName: string,
  typeSuffix = '',
): Promise<GeneratedFile[]> => {
  const files: GeneratedFile[] = []

  // Cross-file `$ref` cycles (A→B→A across modules) must emit lazy references
  // for their cycle edges; eager top-level references would crash with a
  // circular-ESM TDZ error at import. Detect the cycles up front so each file
  // knows which siblings to defer.
  const cycles = findSchemaCycles(rootSchema, rootTypeName, typeSuffix)

  walkRefGraph(rootSchema, rootTypeName, { typeSuffix }, (node) => {
    // `index` is reserved for the barrel below, so never let a definition of
    // that name overwrite it.
    if (node.filename === 'index') return

    const lazyRefFilenames = cycles.get(node.filename)
    const content = generateExampleFile(node.schema, node.typeName, {
      rootSchema: node.rootSchema,
      typeSuffix,
      ...(node.ref !== undefined ? { selfRef: node.ref } : {}),
      ...(lazyRefFilenames !== undefined ? { lazyRefFilenames } : {}),
    })
    files.push({ filename: `${node.filename}.ts`, content })
  })

  files.push({ filename: 'index.ts', content: generateIndexBarrel(files) })

  return files
}
