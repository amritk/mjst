import { generateTypeDefinition } from '@amritk/helpers/generate-type-definition'
import { identifierMentions } from '@amritk/helpers/identifier-mentions'
import { DEFAULT_UNKNOWN_KEYS, type UnknownKeysStrategy } from '@amritk/helpers/unknown-keys-strategy'
import type { JSONSchema } from 'json-schema-typed/draft-2020-12'

import { collectValidatorImports } from './collect-validator-imports'
import { formatCheckName } from './emit-format-checks'
import { NO_FORMATS } from './enforced-keywords'
import { generateCoerceFunction } from './generate-coerce-function'
import { generateRepairFunction } from './generate-repair-function'
import { generateBooleanGuard, generateCheckFunction, generateValidatorFunction } from './generate-validator-function'

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
  /**
   * How the fast paths prove a closed object carries no undeclared key —
   * `Object.keys(obj).length` (the default) or a `for…in` count. See
   * {@link UnknownKeysStrategy} for the trade-off between the two.
   */
  readonly unknownKeys?: UnknownKeysStrategy
  /**
   * The `format` names this build enforces. Empty (the default) leaves `format`
   * an annotation, as 2020-12 reads it; a name here makes the generated
   * `validateX` and `isX` both check it, against a `formats.ts` emitted
   * alongside.
   */
  readonly formats?: ReadonlySet<string>
  /**
   * Whether to emit the fail-fast half — `checkX`, which answers with the same
   * `ValidationResult` as `validateX` but stops at the first violation, so its
   * `errors` array holds exactly one error. Off by default: a caller who wants
   * every error should not carry a second body, and `validateX` / `isX` are
   * byte-for-byte the same either way.
   */
  readonly check?: boolean
  /**
   * Whether to emit the coercing half — `coerceX`, and the value walk a `$ref`
   * in another file calls. Off by default: a caller who does not coerce should
   * not carry the code, and `validateX` / `isX` are byte-for-byte the same
   * either way.
   */
  readonly coerce?: boolean
  /**
   * Whether to emit the repairing half — `repairX`, and the position lookup a
   * `$ref` in another file calls. Implies {@link coerce}: `repairX` coerces
   * first, so anything merely written in the wrong type is right before the
   * validator ever sees it, and never shows up as a repair.
   */
  readonly repair?: boolean
  /** Extension on every emitted relative specifier: `'js'` (default) or `'ts'`. */
  readonly importExt?: 'js' | 'ts'
  /**
   * Whether a failing `anyOf` / `oneOf` also reports the errors of the branch it
   * meant. Off by default, and off is free — the emitted text is exactly what it
   * was before the option existed.
   */
  readonly branchErrors?: boolean
}

/**
 * Generates a complete TypeScript validator file from a JSON Schema.
 *
 * The file contains:
 * - Imports for the ValidationResult/ValidationError types
 * - Imports for any $ref types and their validator functions
 * - The exported TypeScript type definition
 * - The exported validator function (`validateX`, rich `ValidationResult`)
 * - The exported boolean type-guard (`isX`, a flat `input is X` predicate)
 * - Optionally the fail-fast validator (`checkX`, the same `ValidationResult`
 *   carrying only the first error)
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
  const unknownKeys = options?.unknownKeys ?? DEFAULT_UNKNOWN_KEYS
  const importExt = options?.importExt ?? 'js'
  const formats = options?.formats ?? NO_FORMATS
  const validatorFunction = generateValidatorFunction(
    schema,
    typeName,
    typeSuffix,
    options?.rootSchema,
    unknownKeys,
    formats,
    options?.branchErrors === true,
  )
  const booleanGuard = generateBooleanGuard(schema, typeName, typeSuffix, unknownKeys, formats)
  // Emitted from the same generator as `validateX`, off the same schema, so the
  // two can only disagree about how far they looked — never about the verdict.
  const checker =
    options?.check === true
      ? generateCheckFunction(schema, typeName, typeSuffix, options?.rootSchema, unknownKeys, formats)
      : ''
  // Appended rather than woven in: `coerceX` runs the walk and then calls the
  // very same `validateX`, so every error it reports is the one the validator
  // already produced and the two can never drift apart.
  // Repair builds on coercion rather than beside it, so asking for one asks for
  // both. Keeping them separate halves would mean two passes disagreeing about
  // what a scalar written in the wrong type is — the exact drift this package
  // avoids by having `coerceX` and `validateX` share one answer.
  const wantsCoerce = options?.coerce === true || options?.repair === true
  const coercer = wantsCoerce
    ? generateCoerceFunction(schema, typeName, typeSuffix, {
        ...(options?.rootSchema !== undefined ? { rootSchema: options.rootSchema } : {}),
        formats,
      }).code
    : ''
  const repairer = options?.repair === true ? generateRepairFunction(schema, typeName, typeSuffix).code : ''

  const appended = [checker, coercer, repairer].filter((part) => part !== '')
  const body = validatorFunction + booleanGuard + (appended.length === 0 ? '' : '\n\n' + appended.join('\n\n'))

  // The imports are collected last because which halves of a `$ref`'s import are
  // needed is a question about the text that was just emitted. A `$ref` in a
  // position the type generator does not read — an `if` arm, whose whole node it
  // types `unknown` — is called and never named; one in a position only the type
  // reads is named and never called; and a ref inside a branch that folded away
  // is neither. Every half nothing reads is `TS6133` for a consumer with
  // `noUnusedLocals`, which is this repo and anything inheriting its flags.
  // Asking the emitted text keeps the import in step with whatever the two
  // generators decided to write. `identifierMentions` reads the code only —
  // comments and quoted strings carry schema text, and a `description` or an
  // error message naming a definition is not a use of it.
  const mentions = identifierMentions(typeDefinition + body)
  const refImports = collectValidatorImports(schema, {
    selfRef: options?.selfRef,
    rootSchema: options?.rootSchema,
    typeSuffix,
    importExt,
    reads: ({ typeName: name, validatorName, checkerName, coercerName, repairerName }) => ({
      type: mentions(name),
      validator: mentions(validatorName),
      checker: mentions(checkerName),
      coercer: mentions(coercerName),
      repairer: mentions(repairerName),
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
  const resultTypes = [
    'ValidationResult',
    ...(/\bValidationError\b/.test(body) ? ['ValidationError'] : []),
    ...(/\bCoercionResult\b/.test(body) ? ['CoercionResult'] : []),
    ...(/\bRepairResult\b/.test(body) ? ['RepairResult'] : []),
    ...(/\bRepairLookup\b/.test(body) ? ['RepairLookup'] : []),
  ]

  // `.js` extension so the relative import resolves under Node ESM, not only Bun.
  let result = `import type { ${resultTypes.join(', ')} } from './validation-result.${importExt}'\n`

  // Structural `const` checks call the runtime `valuesEqual` helper; structural
  // `uniqueItems` checks call `allUnique`; error paths built from a runtime key
  // call `escapePointer`; the boolean guard's item loop calls `everyItem`; a
  // failing `anyOf`/`oneOf` calls `selectBranchErrors` to say which branch it
  // means. All live in `validation-result.js`; import each only when the
  // generated body (validator or boolean guard) uses it, so files that need none
  // carry no unused import.
  const runtimeHelpers: string[] = (
    [
      'valuesEqual',
      'allUnique',
      'escapePointer',
      'everyItem',
      'selectBranchErrors',
      'coerceScalar',
      'coerceUnion',
      'applyRepairs',
    ] as const
  ).filter((name) => body.includes(`${name}(`))
  // `MAX_REPAIR_PASSES` is a bound the repair loop reads as a bare identifier
  // rather than calls, so the "is it invoked" test that finds every other helper
  // does not see it.
  if (body.includes('MAX_REPAIR_PASSES')) runtimeHelpers.push('MAX_REPAIR_PASSES')
  if (runtimeHelpers.length > 0) {
    result += `import { ${runtimeHelpers.join(', ')} } from './validation-result.${importExt}'\n`
  }

  // The `format` checks live in their own generated module, and only the ones
  // this file calls are imported — asked of the emitted text for the same reason
  // the runtime helpers above are.
  const formatChecks = [...formats]
    .map(formatCheckName)
    .filter((name) => body.includes(`${name}(`))
    .sort()
  if (formatChecks.length > 0) {
    result += `import { ${formatChecks.join(', ')} } from './formats.${importExt}'\n`
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
  for (const part of appended) result += '\n\n' + part

  return result
}
