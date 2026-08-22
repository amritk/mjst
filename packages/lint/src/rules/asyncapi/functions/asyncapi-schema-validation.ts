import type { IFunctionResult, JsonPath, RulesetFunction } from '../../../core/types'
import { schema as schemaFunction } from '../../../functions'
import { isObject } from './helpers'

/** Options for {@link asyncApiSchemaValidation}: which sibling of the schema to check. */
export type IAsyncApiSchemaValidationOptions = {
  type: 'default' | 'examples'
}

/**
 * Validates a Schema Object's own `default` or `examples` against that same
 * schema. The rule targets the schema (via a `^` parent selector), so the input
 * here is the schema and the values under test sit inside it.
 */
export const asyncApiSchemaValidation: RulesetFunction<unknown, IAsyncApiSchemaValidationOptions> = (
  input,
  options,
  context,
): IFunctionResult[] => {
  if (!isObject(input) || options?.type === undefined) return []

  const targets: { path: JsonPath; value: unknown }[] =
    options.type === 'default'
      ? [{ path: ['default'], value: input['default'] }]
      : Array.isArray(input['examples'])
        ? input['examples'].map((value, index) => ({ path: ['examples', index], value }))
        : []

  const results: IFunctionResult[] = []
  for (const target of targets) {
    const findings = schemaFunction(
      target.value,
      { schema: input, allErrors: true, skipUnusableSchema: true },
      { ...context, path: [...context.path, ...target.path] },
    )
    if (findings) results.push(...findings)
  }
  return results
}
