import type { IFunctionResult, JsonPath, RulesetFunction } from '@amritk/lint-core'
import { validate as buildValidator } from '@amritk/runtime-validators'

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
  schema: object
  allErrors?: boolean
}

/** Validates a value against a JSON Schema supplied in the rule's options. */
export const schema: RulesetFunction<unknown, ISchemaOptions> = (input, options, context) => {
  if (!options?.schema) return []
  const result = getValidator(options.schema)(input)
  if (result === true) return []
  return result.errors.map(
    (error): IFunctionResult => ({
      message: formatError(error),
      path: [...context.path, ...pointerToPath(error.path)],
    }),
  )
}
