import type { JSONSchema } from 'json-schema-typed/draft-2020-12'
import { collectHelpers } from '#helpers/collect-helpers'
import { collectImports } from '#helpers/collect-imports'

import { generateParserFunction } from './generate-parser-function'
import { generateTypeDefinition } from './generate-type-definition'

/**
 * Options for controlling what gets generated in a file.
 */
type GenerateFileOptions = {
  /**
   * When true, only emit the TypeScript type definition and skip the parser function.
   * Imports will be type-only as well, since there are no parsers to call.
   */
  readonly typesOnly?: boolean
  /**
   * The $ref path of the schema being generated (e.g. `#/$defs/encoding`).
   * When provided, any $ref that resolves to the same filename is excluded from
   * the import list, preventing a file from importing itself.
   */
  readonly selfRef?: string
  /**
   * The root schema document. When provided, URI refs that cannot be resolved
   * within the root schema's $defs are excluded from the import list.
   */
  readonly rootSchema?: Record<string, unknown>
}

/**
 * Generates a complete TypeScript file from a JSON Schema.
 *
 * The generated file contains imports, type definition, and parser function.
 * When typesOnly is true, only the type definition is emitted without any parser.
 *
 * @param schema - The JSON Schema to generate code from
 * @param typeName - The name to use for the generated TypeScript type
 * @param markdownDocumentation - Optional markdown documentation to enhance type comments
 * @param options - Optional settings to control what gets generated
 * @returns The complete TypeScript code
 *
 * @example
 * ```typescript
 * const schema = {
 *   type: "object",
 *   properties: {
 *     name: { type: "string" },
 *     age: { type: "number" }
 *   },
 *   required: ["name"]
 * };
 *
 * const result = generateFile(schema, "User");
 * // result contains imports, type User, and parseUser function
 *
 * const typesOnly = generateFile(schema, "User", undefined, { typesOnly: true });
 * // typesOnly contains only type-only imports and type User (no parser)
 * ```
 */
export const generateFile = (
  schema: JSONSchema,
  typeName: string,
  markdownDocumentation?: string,
  options?: GenerateFileOptions,
): string => {
  const typesOnly = options?.typesOnly === true
  const selfRef = options?.selfRef
  const rootSchema = options?.rootSchema
  const typeDefinition = generateTypeDefinition(schema, typeName, markdownDocumentation)

  if (typesOnly) {
    // In types-only mode, skip the parser function and use type-only imports
    const imports = collectImports(schema, { typesOnly: true, selfRef, rootSchema })
    let result = ''

    if (imports.length > 0) {
      result += imports[0]
      for (let i = 1; i < imports.length; i++) {
        result += '\n' + imports[i]
      }
      result += '\n\n'
    }

    return result + typeDefinition
  }

  const parserFunction = generateParserFunction(schema, typeName, { useRefImports: true })
  const imports = [...collectImports(schema, { selfRef, rootSchema }), ...collectHelpers(parserFunction)]

  // Build file output using string concatenation instead of array join for performance
  let result = ''

  if (imports.length > 0) {
    result += imports[0]
    for (let i = 1; i < imports.length; i++) {
      result += '\n' + imports[i]
    }
    result += '\n\n'
  }

  return result + typeDefinition + '\n\n' + parserFunction
}
