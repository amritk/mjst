import { generateTypeDefinition } from '@amritk/helpers/generate-type-definition'
import type { JSONSchema } from 'json-schema-typed/draft-2020-12'

import { collectExampleImports } from './collect-example-imports'
import { generateExampleConst } from './derive-example'
import { generateArbitrary, VALIDATE_IMPORT_NAME, VALIDATE_IMPORT_STATEMENT } from './generate-arbitrary'

/**
 * Options for controlling what gets generated in an example file.
 */
type GenerateExampleFileOptions = {
  /**
   * The $ref path of the schema being generated (e.g. `#/$defs/address`).
   * Prevents the file from importing itself.
   */
  readonly selfRef?: string
  /**
   * The root schema document. Used to resolve `$ref`s when deriving a concrete
   * example value, and to filter out unresolvable refs from the import list.
   */
  readonly rootSchema?: Record<string, unknown>
  /**
   * Suffix appended to every type/arbitrary name derived from a `$ref`.
   * Defaults to `''` (no suffix).
   */
  readonly typeSuffix?: string
  /**
   * Filenames of the other types this file shares a cross-file `$ref` cycle
   * with. References to them are emitted lazily so mutually recursive modules
   * do not crash with a circular-ESM TDZ error at import. Defaults to empty.
   */
  readonly lazyRefFilenames?: ReadonlySet<string>
}

/**
 * Generates a complete TypeScript example file from a JSON Schema.
 *
 * The file contains:
 * - An import of `fast-check` and imports for any `$ref` types and arbitraries
 * - The exported TypeScript type definition
 * - An exported `fast-check` arbitrary (`FooArbitrary`)
 * - An exported concrete example value (`fooExample`)
 *
 * @example
 * ```typescript
 * const schema = { type: 'object', properties: { title: { type: 'string' } }, required: ['title'] }
 * generateExampleFile(schema, 'Info')
 * // import * as fc from 'fast-check'
 * // export type Info = { title: string }
 * // export const InfoArbitrary: fc.Arbitrary<Info> = fc.record({ "title": fc.string() })
 * // export const infoExample: Info = { "title": "string" }
 * ```
 */
export const generateExampleFile = (
  schema: JSONSchema,
  typeName: string,
  options?: GenerateExampleFileOptions,
): string => {
  const typeSuffix = options?.typeSuffix ?? ''
  const refImports = collectExampleImports(schema, {
    selfRef: options?.selfRef,
    rootSchema: options?.rootSchema,
    typeSuffix,
  })

  const typeDefinition = generateTypeDefinition(schema, typeName, { typeSuffix })
  const arbitrary = generateArbitrary(schema, typeName, typeSuffix, options?.lazyRefFilenames, options?.rootSchema)
  const example = generateExampleConst(schema, typeName, options?.rootSchema)

  let result = `import * as fc from 'fast-check'\n`

  // The arbitrary embeds a runtime validator only for schemas whose keywords no
  // `fc.*` combinator captures; import it just for those files.
  if (arbitrary.includes(`${VALIDATE_IMPORT_NAME}(`)) {
    result += VALIDATE_IMPORT_STATEMENT + '\n'
  }

  for (const imp of refImports) {
    result += imp + '\n'
  }

  result += '\n'
  result += typeDefinition + '\n\n' + arbitrary + '\n\n' + example + '\n'

  return result
}
