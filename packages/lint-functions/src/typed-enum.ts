import type { IFunctionResult, RulesetFunction } from '@amritk/lint-core'

const JS_TYPES: Record<string, (value: unknown) => boolean> = {
  string: (v) => typeof v === 'string',
  number: (v) => typeof v === 'number',
  integer: (v) => typeof v === 'number' && Number.isInteger(v),
  boolean: (v) => typeof v === 'boolean',
  null: (v) => v === null,
  array: (v) => Array.isArray(v),
  object: (v) => typeof v === 'object' && v !== null && !Array.isArray(v),
}

/** Validates that each `enum` entry matches the schema's declared `type`. */
export const typedEnum: RulesetFunction<Record<string, unknown>, never> = (input, _options, context) => {
  if (typeof input !== 'object' || input === null) return []
  const declaredType = input['type']
  const values = input['enum']
  if (declaredType === undefined || !Array.isArray(values)) return []

  const types = Array.isArray(declaredType) ? declaredType : [declaredType]
  const checkers = types
    .map((type) => JS_TYPES[String(type)])
    .filter((fn): fn is (v: unknown) => boolean => Boolean(fn))
  if (checkers.length === 0) return []

  const results: IFunctionResult[] = []
  values.forEach((value, index) => {
    if (!checkers.some((check) => check(value))) {
      results.push({
        message: `Enum value \`${JSON.stringify(value)}\` must be of type "${types.join(' | ')}"`,
        path: [...context.path, 'enum', index],
      })
    }
  })
  return results
}
