import type { IFunctionResult, JsonPath, RulesetFunction } from '../../../core/types'
import { schema as schemaFunction } from '../../../functions'
import { isObject, mergeTraits } from './helpers'
import { splitMultiFormatSchema } from './multi-format-schema'
import { isAsyncApiSchemaFormat } from './schema-format'

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

/** Options for {@link asyncApiMessageExamples}. */
export type IAsyncApiMessageExamplesOptions = {
  /**
   * Whether `payload` and `headers` may each be a Multi Format Schema Object
   * (`{ schemaFormat, schema }`). That shape is 3.0 only, and it is also where
   * that major states the schema language — 2.x states it once, on the message.
   */
  multiFormat?: boolean
}

/** The two halves of a message an example can pin values to. */
const PARTS = ['payload', 'headers'] as const

/**
 * Checks every entry of a Message Object's `examples` against the message's own
 * `payload` and `headers` schemas. Traits are folded in first, so an example is
 * judged against the message a tool would actually assemble rather than against
 * the half of it written inline.
 */
export const asyncApiMessageExamples: RulesetFunction<unknown, IAsyncApiMessageExamplesOptions | undefined> = (
  input,
  options,
  context,
): IFunctionResult[] => {
  if (!isObject(input)) return []
  const message = mergeTraits(input)
  const examples = message['examples']
  if (!Array.isArray(examples)) return []
  const origin = examplesOrigin(input)

  /**
   * The Schema Object an example's `payload` or `headers` is judged against, or
   * `undefined` when that half is written in a language this package cannot
   * validate.
   *
   * A payload in Avro or Protobuf is not a JSON Schema, so an example cannot be
   * judged against it. Checking anyway compiled the foreign schema and surfaced
   * the validator's own complaints ("unknown type \"record\"") as error-level
   * findings on a valid document. In 2.x one `schemaFormat` on the message says
   * so, and it governs the payload alone — headers there are always an AsyncAPI
   * Schema Object. 3.0 wraps each half separately, so each is asked in turn.
   */
  const schemaOf = (part: (typeof PARTS)[number]): unknown => {
    if (options?.multiFormat !== true) {
      return part === 'headers' || isAsyncApiSchemaFormat(message['schemaFormat']) ? message[part] : undefined
    }
    const { schemaFormat, schema } = splitMultiFormatSchema(message[part])
    return isAsyncApiSchemaFormat(schemaFormat) ? schema : undefined
  }
  const schemas = { payload: schemaOf('payload'), headers: schemaOf('headers') }

  const results: IFunctionResult[] = []
  examples.forEach((example, index) => {
    if (!isObject(example)) return
    for (const part of PARTS) {
      const partSchema = schemas[part]
      if (example[part] === undefined || partSchema === undefined) continue
      const findings = schemaFunction(
        example[part],
        { schema: isObject(partSchema) ? partSchema : {}, allErrors: true, skipUnusableSchema: true },
        { ...context, path: [...context.path, ...origin, index, part] },
      )
      if (findings) results.push(...findings)
    }
  })
  return results
}
