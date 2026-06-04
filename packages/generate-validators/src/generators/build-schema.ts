import { generateIndexBarrel } from '@amritk/helpers/generate-index-barrel'
import { walkRefGraph } from '@amritk/helpers/walk-ref-graph'
import type { JSONSchema } from 'json-schema-typed/draft-2020-12'

import { generateValidatorFile } from './generate-files'

/**
 * Represents a generated TypeScript file with its filename and content.
 */
export type GeneratedFile = {
  filename: string
  content: string
}

const VALIDATION_RESULT_CONTENT = `/**
 * A single validation error with a human-readable message and a JSON Pointer
 * path indicating where in the document the error occurred.
 */
export type ValidationError = {
  message: string
  path: string
}

/**
 * The result of a generated validator function.
 * Returns \`true\` when the input is valid, or an object with \`valid: false\`
 * and a list of errors when it is not.
 */
export type ValidationResult = true | { valid: false; errors: ValidationError[] }

/**
 * Structural deep equality used by generated \`const\` checks. Objects compare by
 * their key sets rather than serialization, so \`{ a: 1, b: 2 }\` and
 * \`{ b: 2, a: 1 }\` are equal — unlike \`JSON.stringify\`, which is key-order
 * sensitive and would reject a reordered-but-equal value.
 */
export const valuesEqual = (a: unknown, b: unknown): boolean => {
  if (a === b) return true
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false
  const aArray = Array.isArray(a)
  const bArray = Array.isArray(b)
  if (aArray !== bArray) return false
  if (aArray) {
    const aa = a as unknown[]
    const bb = b as unknown[]
    if (aa.length !== bb.length) return false
    for (let i = 0; i < aa.length; i++) if (!valuesEqual(aa[i], bb[i])) return false
    return true
  }
  const ao = a as Record<string, unknown>
  const bo = b as Record<string, unknown>
  const keys = Object.keys(ao)
  if (keys.length !== Object.keys(bo).length) return false
  for (const key of keys) {
    if (!Object.hasOwn(bo, key) || !valuesEqual(ao[key], bo[key])) return false
  }
  return true
}
`

/**
 * Builds all TypeScript validator files from a JSON Schema by traversing all
 * `$ref` / `$dynamicRef` references recursively (via the shared
 * `@amritk/helpers/walk-ref-graph` walker).
 *
 * Each generated file exports:
 * - A TypeScript type definition
 * - A `validateFoo(input: unknown, _path?: string): ValidationResult` function
 *
 * A `validation-result.ts` file containing the `ValidationResult` and `ValidationError`
 * runtime contract is always emitted. An `index.ts` re-exports everything.
 *
 * @param rootSchema - The root JSON Schema to build from
 * @param rootTypeName - The name for the root type (e.g. "Document")
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
  typeSuffix = '',
): Promise<GeneratedFile[]> => {
  const files: GeneratedFile[] = []

  walkRefGraph(rootSchema, rootTypeName, { typeSuffix }, (node) => {
    // `validation-result` and `index` are reserved output filenames, so never
    // let a definition of either name overwrite them.
    if (node.filename === 'validation-result' || node.filename === 'index') return

    const content = generateValidatorFile(node.schema, node.typeName, {
      rootSchema: node.rootSchema,
      typeSuffix,
      ...(node.ref !== undefined ? { selfRef: node.ref } : {}),
    })
    files.push({ filename: `${node.filename}.ts`, content })
  })

  // Emit the runtime contract for validators. ValidationResult is mjst-defined
  // (not derived from the input schema), so its content is fixed.
  files.push({ filename: 'validation-result.ts', content: VALIDATION_RESULT_CONTENT })

  files.push({ filename: 'index.ts', content: generateIndexBarrel(files) })

  return files
}
