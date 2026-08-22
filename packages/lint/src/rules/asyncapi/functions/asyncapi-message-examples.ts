import type { IFunctionResult, JsonPath, RulesetFunction } from '../../../core/types'
import { schema as schemaFunction } from '../../../functions'
import { isObject, mergeTraits } from './helpers'

/**
 * Where the message's effective `examples` array was actually written.
 *
 * Traits are applied as JSON Merge Patch, which replaces an array wholesale
 * rather than concatenating, so the effective array belongs to the *last* trait
 * that declares one — or to the message itself when no trait does. Index `i` of
 * the merged array has no relationship to index `i` of the message's own array,
 * so reporting against `context.path` blamed a bystander example (and, when the
 * message declared none of its own, a path with no node at all, which the source
 * map then collapsed onto the enclosing message).
 */
const examplesOrigin = (message: Record<string, unknown>): JsonPath => {
  const traits = message['traits']
  if (Array.isArray(traits)) {
    for (let index = traits.length - 1; index >= 0; index--) {
      const trait = traits[index]
      if (isObject(trait) && Array.isArray(trait['examples'])) return ['traits', index, 'examples']
    }
  }
  return ['examples']
}

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
  const origin = examplesOrigin(input)

  const results: IFunctionResult[] = []
  examples.forEach((example, index) => {
    if (!isObject(example)) return
    for (const part of ['payload', 'headers'] as const) {
      if (example[part] === undefined) continue
      const findings = schemaFunction(
        example[part],
        { schema: isObject(message[part]) ? message[part] : {}, allErrors: true },
        { ...context, path: [...context.path, ...origin, index, part] },
      )
      if (findings) results.push(...findings)
    }
  })
  return results
}
