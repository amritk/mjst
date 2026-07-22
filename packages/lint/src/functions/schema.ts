import { validate as buildValidator } from '@amritk/runtime-validators'

import type { IFunctionResult, JsonPath, RulesetFunction } from '../core/types'

type RuntimeValidator = (input: unknown) => true | { valid: false; errors: { message: string; path: string }[] }

// The rule's `options.schema` is a stable object, so cache the prepared
// validator by identity. `@amritk/runtime-validators` interprets the schema at
// runtime (no `new Function`), keeping this eval-free and dependency-light.
const validators = new WeakMap<object, RuntimeValidator>()

const getValidator = (schema: object): RuntimeValidator => {
  let validator = validators.get(schema)
  if (!validator) {
    // The `schema` built-in historically enforced string formats (ajv
    // `validateFormats: true`); keep that by opting into all formats here.
    validator = buildValidator(schema, { formats: 'all' }) as RuntimeValidator
    validators.set(schema, validator)
  }
  return validator
}

const KNOWN_TYPES = new Set(['string', 'number', 'integer', 'boolean', 'null', 'object', 'array'])

// Keywords whose value is itself a schema, a list of schemas, or a map of
// schemas. We recurse through them to reach every `type` a schema declares.
const SCHEMA_VALUE_KEYS = ['additionalProperties', 'not', 'if', 'then', 'else', 'propertyNames', 'contains'] as const
const SCHEMA_ITEMS_KEYS = ['items', 'additionalItems'] as const
const SCHEMA_LIST_KEYS = ['allOf', 'anyOf', 'oneOf'] as const
const SCHEMA_MAP_KEYS = ['properties', 'patternProperties', 'definitions', '$defs', 'dependencies'] as const

/**
 * Walks a schema looking for a `type` keyword whose value is not a JSON Schema
 * type. `@amritk/runtime-validators` treats an unknown `type` as "always
 * matches" (so it never rejects data it does not model), which means a typo like
 * `type: "Pascal"` would silently disable the rule. Finding it up front lets us
 * report it instead. Returns the offending type, or `undefined` when the schema
 * only uses known types.
 */
const findInvalidType = (node: unknown): string | undefined => {
  if (Array.isArray(node) || typeof node !== 'object' || node === null) return undefined
  const schema = node as Record<string, unknown>

  const declared = schema['type']
  if (declared !== undefined) {
    const types = Array.isArray(declared) ? declared : [declared]
    for (const type of types) {
      if (typeof type !== 'string' || !KNOWN_TYPES.has(type)) {
        return typeof type === 'string' ? type : String(type)
      }
    }
  }

  for (const key of SCHEMA_VALUE_KEYS) {
    const found = findInvalidType(schema[key])
    if (found !== undefined) return found
  }
  for (const key of SCHEMA_ITEMS_KEYS) {
    const value = schema[key]
    const list = Array.isArray(value) ? value : [value]
    for (const item of list) {
      const found = findInvalidType(item)
      if (found !== undefined) return found
    }
  }
  for (const key of SCHEMA_LIST_KEYS) {
    const value = schema[key]
    if (Array.isArray(value)) {
      for (const item of value) {
        const found = findInvalidType(item)
        if (found !== undefined) return found
      }
    }
  }
  for (const key of SCHEMA_MAP_KEYS) {
    const value = schema[key]
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      for (const item of Object.values(value)) {
        const found = findInvalidType(item)
        if (found !== undefined) return found
      }
    }
  }
  return undefined
}

const pointerToPath = (pointer: string): JsonPath =>
  pointer
    .split('/')
    .slice(1)
    .map((segment) => segment.replace(/~1/g, '/').replace(/~0/g, '~'))
    .map((segment) => (/^\d+$/.test(segment) ? Number(segment) : segment))

const formatError = (error: { message: string; path: string }): string => {
  const location = error.path || 'value'
  return `${location} ${error.message}`.trim()
}

/** Options for {@link schema}. */
export type ISchemaOptions = {
  /** The JSON Schema to validate the matched value against. */
  schema: object
  /**
   * Report every validation error rather than stopping at the first. Defaults to
   * `false`, matching Spectral (whose underlying ajv instance runs with
   * `allErrors: false` unless told otherwise).
   */
  allErrors?: boolean
  /**
   * Accepted for Spectral compatibility but intentionally ignored. The draft is
   * auto-detected by `@amritk/runtime-validators`, so both draft-4 constructs
   * (boolean `exclusiveMinimum`) and draft-7 ones (tuple `items`) validate
   * without the caller naming a dialect.
   */
  dialect?: string
}

/** Validates a value against a JSON Schema supplied in the rule's options. */
export const schema: RulesetFunction<unknown, ISchemaOptions> = (input, options, context) => {
  if (!options?.schema) return []

  // A malformed schema would otherwise validate everything and silently disable
  // the rule. Surface it as a finding, the way Spectral reports schema compile
  // errors as results, so the ruleset author notices the mistake.
  const invalidType = findInvalidType(options.schema)
  if (invalidType !== undefined) {
    return [
      {
        message: `Invalid schema: unknown type "${invalidType}". Valid types are: ${[...KNOWN_TYPES].join(', ')}`,
        path: [...context.path],
      },
    ]
  }

  let result: ReturnType<RuntimeValidator>
  try {
    result = getValidator(options.schema)(input)
  } catch (error) {
    // Preparing or running the validator can throw on a schema shape we cannot
    // interpret. Report it rather than letting it bubble up and crash the run.
    return [
      {
        message: `Invalid schema: ${error instanceof Error ? error.message : String(error)}`,
        path: [...context.path],
      },
    ]
  }

  if (result === true) return []
  // Spectral's ajv defaults to `allErrors: false`, reporting only the first
  // failure. Honor the same default and only expand to the full list when the
  // caller opts in.
  const errors = options.allErrors ? result.errors : result.errors.slice(0, 1)
  return errors.map(
    (error): IFunctionResult => ({
      message: formatError(error),
      path: [...context.path, ...pointerToPath(error.path)],
    }),
  )
}
