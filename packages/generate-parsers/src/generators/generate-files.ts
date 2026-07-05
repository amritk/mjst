import { generateTypeDefinition } from '@amritk/helpers/generate-type-definition'
import type { JSONSchema } from 'json-schema-typed/draft-2020-12'
import {
  type CollectedHelpers,
  collectHelpers,
  type HelpersMode,
  type RuntimeHelperName,
} from '#helpers/collect-helpers'
import { collectImports, type ImportExtension } from '#helpers/collect-imports'

import { generateParserFunction, generateShapeValidator } from './generate-parser-function'

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
  /**
   * When true, the generated parser emits a console.warn for every input key
   * that is not declared in the schema's properties.
   */
  readonly logWarnings?: boolean
  /**
   * When true, the generated parser throws on type/shape mismatches instead
   * of coercing invalid input to default values.
   */
  readonly strict?: boolean
  /**
   * When true, the generated parser builds its result from declared properties
   * only, silently dropping undeclared input keys at every nesting level (zod's
   * `.strip()`), without treating extras as a validation error. Composes with
   * `strict` (still throws on wrong types / missing required properties) and
   * yields to `additionalProperties: false` (which rejects rather than strips in
   * strict mode).
   */
  readonly stripUnknown?: boolean
  /**
   * Controls how runtime helpers are referenced.
   * - `'package'` (default): emit imports from `@amritk/helpers/...`.
   * - `'embedded'`: emit imports from `./_helpers/...` so the helper sources can
   *   be shipped alongside the generated files.
   */
  readonly helpersMode?: HelpersMode
  /**
   * Relative path prefix to the shared `_helpers/` directory in embedded mode.
   * Defaults to `'./'`. The recursive multi-schema build passes `'../'`,
   * `'../../'`, etc. so a nested parser can reach a single `_helpers/` directory
   * at the output root.
   */
  readonly helpersImportPrefix?: string
  /**
   * When true, every property, array, and record in the generated type
   * definitions is emitted as `readonly`.
   */
  readonly readonly?: boolean
  /**
   * Suffix appended to every type/parser name derived from a `$ref`.
   * Defaults to `''` (no suffix). Set to e.g. `'Object'` to emit `ContactObject`.
   */
  readonly typeSuffix?: string
  /**
   * Extension used on every relative import specifier (cross-file `$ref`
   * imports and embedded-helper imports). Defaults to `'js'` (the TS NodeNext
   * form); `'ts'` makes the generated sources runnable under Node's type
   * stripping.
   */
  readonly importExt?: ImportExtension
}

/** Result of generating a single parser file. */
export type GeneratedFileContent = {
  readonly content: string
  readonly usedHelpers: ReadonlySet<RuntimeHelperName>
}

/**
 * Generates a complete TypeScript file from a JSON Schema.
 *
 * The generated file contains imports, type definition, and parser function.
 * When typesOnly is true, only the type definition is emitted without any parser.
 *
 * @param schema - The JSON Schema to generate code from
 * @param typeName - The name to use for the generated TypeScript type
 * @param options - Optional settings to control what gets generated
 * @returns The generated file content and the set of runtime helpers it references
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
 * const typesOnly = generateFile(schema, "User", { typesOnly: true });
 * // typesOnly contains only type-only imports and type User (no parser)
 * ```
 */
export const generateFile = (
  schema: JSONSchema,
  typeName: string,
  options?: GenerateFileOptions,
): GeneratedFileContent => {
  const typesOnly = options?.typesOnly === true
  const selfRef = options?.selfRef
  const rootSchema = options?.rootSchema
  const helpersMode: HelpersMode = options?.helpersMode ?? 'package'
  const typeSuffix = options?.typeSuffix ?? ''
  const importExt: ImportExtension = options?.importExt ?? 'js'
  const typeDefinition = generateTypeDefinition(schema, typeName, { readonly: options?.readonly ?? false, typeSuffix })

  if (typesOnly) {
    // In types-only mode, skip the parser function and use type-only imports
    const imports = collectImports(schema, { typesOnly: true, selfRef, rootSchema, typeSuffix, importExt })
    let result = ''

    if (imports.length > 0) {
      result += imports[0]
      for (let i = 1; i < imports.length; i++) {
        result += '\n' + imports[i]
      }
      result += '\n\n'
    }

    return { content: result + typeDefinition, usedHelpers: new Set() }
  }

  const stripUnknown = options?.stripUnknown ?? false
  const parserFunction = generateParserFunction(schema, typeName, {
    useRefImports: true,
    typeSuffix,
    ...(rootSchema !== undefined ? { rootSchema } : {}),
    ...(options?.logWarnings !== undefined ? { logWarnings: options.logWarnings } : {}),
    ...(options?.strict !== undefined ? { strict: options.strict } : {}),
    ...(options?.stripUnknown !== undefined ? { stripUnknown: options.stripUnknown } : {}),
  })
  const shapeValidator = generateShapeValidator(schema, typeName, true, typeSuffix, true, stripUnknown)
  const combinedFunctions = `${shapeValidator}\n\n${parserFunction}`
  const helpers: CollectedHelpers = collectHelpers(
    combinedFunctions,
    helpersMode,
    options?.helpersImportPrefix,
    importExt,
  )
  const imports = [...collectImports(schema, { selfRef, rootSchema, typeSuffix, importExt }), ...helpers.imports]

  // Build file output using string concatenation instead of array join for performance
  let result = ''

  if (imports.length > 0) {
    result += imports[0]
    for (let i = 1; i < imports.length; i++) {
      result += '\n' + imports[i]
    }
    result += '\n\n'
  }

  return { content: result + typeDefinition + '\n\n' + combinedFunctions, usedHelpers: helpers.used }
}
