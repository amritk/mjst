import { generateTypeDefinition } from '@amritk/helpers/generate-type-definition'
import type { JSONSchema } from 'json-schema-typed/draft-2020-12'

import { collectValidatorImports } from './collect-validator-imports'
import { generateBooleanGuard, generateValidatorFunction } from './generate-validator-function'

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
 * Escapes a derived type name for use inside a `RegExp`.
 *
 * The names `refToName` builds are identifier characters and whatever the
 * caller's `typeSuffix` adds, and that suffix is a plain string nobody validates
 * — a `.` or a `+` in one would otherwise be read as regex syntax and match the
 * wrong text.
 */
const escapeForWordMatch = (name: string): string => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * Generates a complete TypeScript validator file from a JSON Schema.
 *
 * The file contains:
 * - Imports for the ValidationResult/ValidationError types
 * - Imports for any $ref types and their validator functions
 * - The exported TypeScript type definition
 * - The exported validator function (`validateX`, rich `ValidationResult`)
 * - The exported boolean type-guard (`isX`, a flat `input is X` predicate)
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
 * // export const isInfo = (input: unknown): input is Info => { ... }
 * ```
 */
export const generateValidatorFile = (
  schema: JSONSchema,
  typeName: string,
  options?: GenerateValidatorFileOptions,
): string => {
  const typeSuffix = options?.typeSuffix ?? ''

  // `rootSchema` lets the type generator name a URI `$ref` that resolves inside
  // the document — the same rule the import collector below uses — instead of
  // typing it `unknown` while this file imports the generated type.
  const typeDefinition = generateTypeDefinition(schema, typeName, {
    typeSuffix,
    ...(options?.rootSchema !== undefined ? { rootSchema: options.rootSchema } : {}),
  })
  const validatorFunction = generateValidatorFunction(schema, typeName, typeSuffix, options?.rootSchema)
  const booleanGuard = generateBooleanGuard(schema, typeName, typeSuffix)

  const body = validatorFunction + booleanGuard

  // The imports are collected last because which halves of a `$ref`'s import are
  // needed is a question about the text that was just emitted. A `$ref` in a
  // position the type generator does not read — an `if` arm, whose whole node it
  // types `unknown` — is called and never named; one in a position only the type
  // reads is named and never called; and a ref inside a branch that folded away
  // is neither. Every half nothing reads is `TS6133` for a consumer with
  // `noUnusedLocals`, which is this repo and anything inheriting its flags.
  // Asking the emitted text keeps the import in step with whatever the two
  // generators decided to write. The inexact direction is the harmless one: a
  // schema string that happens to spell one of the names keeps a half that could
  // have gone, which is what was emitted before anyone asked.
  const emitted = typeDefinition + body
  const mentions = (name: string): boolean => new RegExp(`\\b${escapeForWordMatch(name)}\\b`).test(emitted)
  const refImports = collectValidatorImports(schema, {
    selfRef: options?.selfRef,
    rootSchema: options?.rootSchema,
    typeSuffix,
    reads: ({ typeName: name, validatorName }) => ({
      type: mentions(name),
      validator: mentions(validatorName),
    }),
  })

  // `ValidationResult` is every validator's return type, so it is always read.
  // `ValidationError` is only named by a body that *accumulates* errors — a
  // validator whose whole answer is one early `return { valid: false, errors: [
  // … ] }` never declares the array, and a plain scalar root is exactly that
  // shape. Importing it regardless left `TS6196` in the emitted file for any
  // consumer with `noUnusedLocals`, which is most of the corpus: `{ "type":
  // "string" }` is the commonest schema an OpenAPI document has. The name can
  // only appear as a type annotation, so its absence from the body is
  // conclusive; schema text mentioning it merely keeps the import, which is what
  // was emitted before.
  const resultTypes = ['ValidationResult', ...(/\bValidationError\b/.test(body) ? ['ValidationError'] : [])]

  // `.js` extension so the relative import resolves under Node ESM, not only Bun.
  let result = `import type { ${resultTypes.join(', ')} } from './validation-result.js'\n`

  // Structural `const` checks call the runtime `valuesEqual` helper; structural
  // `uniqueItems` checks call `allUnique`; error paths built from a runtime key
  // call `escapePointer`. All live in `validation-result.js`; import each only
  // when the generated body (validator or boolean guard) uses it, so files that
  // need none carry no unused import.
  const runtimeHelpers = (['valuesEqual', 'allUnique', 'escapePointer'] as const).filter((name) =>
    body.includes(`${name}(`),
  )
  if (runtimeHelpers.length > 0) {
    result += `import { ${runtimeHelpers.join(', ')} } from './validation-result.js'\n`
  }

  for (const imp of refImports) {
    result += imp + '\n'
  }

  if (refImports.length > 0) {
    result += '\n'
  } else {
    result += '\n'
  }

  result += typeDefinition + '\n\n' + validatorFunction + '\n\n' + booleanGuard

  return result
}
