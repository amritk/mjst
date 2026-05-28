import { generateTypeDefinition } from '@amritk/helpers/generate-type-definition'
import type { JSONSchema } from 'json-schema-typed/draft-2020-12'

import { collectValidatorImports } from './collect-validator-imports'
import { generateValidatorFunction } from './generate-validator-function'

/**
 * Options for controlling what gets generated in a validator file.
 */
type GenerateValidatorFileOptions = {
  /**
   * The $ref path of the schema being generated (e.g. `#/$defs/info`).
   * Prevents the file from importing itself.
   */
  readonly selfRef?: string
  /**
   * The root schema document. Used to filter out unresolvable refs.
   */
  readonly rootSchema?: Record<string, unknown>
  /**
   * Suffix appended to every type/validator name derived from a `$ref`.
   * Defaults to `''` (no suffix).
   */
  readonly typeSuffix?: string
}

/**
 * Generates a complete TypeScript validator file from a JSON Schema.
 *
 * The file contains:
 * - Imports for the ValidationResult/ValidationError types
 * - Imports for any $ref types and their validator functions
 * - The exported TypeScript type definition
 * - The exported validator function
 *
 * @example
 * ```typescript
 * const schema = {
 *   type: 'object',
 *   properties: { title: { type: 'string' } },
 *   required: ['title'],
 * }
 * generateValidatorFile(schema, 'Info')
 * // import type { ValidationResult, ValidationError } from './validation-result'
 * // export type Info = { title: string }
 * // export const validateInfo = (input: unknown, _path = ''): ValidationResult => { ... }
 * ```
 */
export const generateValidatorFile = (
  schema: JSONSchema,
  typeName: string,
  options?: GenerateValidatorFileOptions,
): string => {
  const typeSuffix = options?.typeSuffix ?? ''
  const refImports = collectValidatorImports(schema, {
    selfRef: options?.selfRef,
    rootSchema: options?.rootSchema,
    typeSuffix,
  })

  const typeDefinition = generateTypeDefinition(schema, typeName, { typeSuffix })
  const validatorFunction = generateValidatorFunction(schema, typeName, typeSuffix)

  let result = `import type { ValidationResult, ValidationError } from './validation-result'\n`

  for (const imp of refImports) {
    result += imp + '\n'
  }

  if (refImports.length > 0) {
    result += '\n'
  } else {
    result += '\n'
  }

  result += typeDefinition + '\n\n' + validatorFunction

  return result
}
