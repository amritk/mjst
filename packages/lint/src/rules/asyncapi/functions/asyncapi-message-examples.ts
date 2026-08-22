import type { IFunctionResult, JsonPath, RulesetFunction } from '../../../core/types'
import { schema as schemaFunction } from '../../../functions'
import { isObject, mergeTraits } from './helpers'

const validateAgainst = (
  value: unknown,
  schema: unknown,
  path: JsonPath,
  context: Parameters<RulesetFunction>[2],
): IFunctionResult[] =>
  schemaFunction(value, { schema: isObject(schema) ? schema : {}, allErrors: true }, { ...context, path }) ?? []

/**
 * Checks every entry of a Message Object's `examples` against the message's own
 * `payload` and `headers` schemas. Traits are folded in first, so an example is
 * judged against the message a tool would actually assemble rather than against
 * the half of it written inline.
 */
export const asyncApiMessageExamples: RulesetFunction = (input, _options, context): IFunctionResult[] => {
  if (!isObject(input)) return []
  const message = mergeTraits(input)
  const examples = message['examples']
  if (!Array.isArray(examples)) return []

  const results: IFunctionResult[] = []
  examples.forEach((example, index) => {
    if (!isObject(example)) return
    for (const part of ['payload', 'headers'] as const) {
      if (example[part] === undefined) continue
      results.push(
        ...validateAgainst(example[part], message[part], [...context.path, 'examples', index, part], context),
      )
    }
  })
  return results
}
