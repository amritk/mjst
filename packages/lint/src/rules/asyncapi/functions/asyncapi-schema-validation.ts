import type { IFunctionResult, JsonPath, RulesetFunction } from '../../../core/types'
import { schema as schemaFunction } from '../../../functions'
import { isObject } from './helpers'
import { type MultiFormatSchema, splitMultiFormatSchema } from './multi-format-schema'
import { isAsyncApiSchemaFormat } from './schema-format'

/** Options for {@link asyncApiSchemaValidation}: which sibling of the schema to check, and how the schema is wrapped. */
export type IAsyncApiSchemaValidationOptions = {
  type: 'default' | 'examples'
  /**
   * Whether the matched node may be a Multi Format Schema Object (`{
   * schemaFormat, schema }`) rather than a bare Schema Object. That shape is 3.0
   * only, where a payload — and a `components.schemas` entry — can be written in
   * Avro or Protobuf. A `default` under one of those is not JSON Schema data and
   * cannot be judged, so it is left to
   * `asyncapi-3-payload-unsupported-schemaFormat` to mention the format at all.
   */
  multiFormat?: boolean
}

/**
 * Validates a Schema Object's own `default` or `examples` against that same
 * schema. In 2.x the rule targets the schema through a `^` parent selector, so
 * the input is the schema and the values under test sit inside it; in 3.0 the
 * rule targets the payload (or `components.schemas` entry) directly, because the
 * wrapper has to be unwrapped before either can be found.
 */
export const asyncApiSchemaValidation: RulesetFunction<unknown, IAsyncApiSchemaValidationOptions> = (
  input,
  options,
  context,
): IFunctionResult[] => {
  if (options?.type === undefined) return []

  const source: MultiFormatSchema =
    options.multiFormat === true ? splitMultiFormatSchema(input) : { schemaFormat: undefined, schema: input, path: [] }
  if (!isAsyncApiSchemaFormat(source.schemaFormat)) return []
  const schema = source.schema
  if (!isObject(schema)) return []

  // The 2.x givens end in `.default^` / `.examples^`, so the keyword is there by
  // construction; the 3.0 ones match the schema itself and most schemas carry
  // neither. Validating an absent `default` would judge `undefined` against the
  // schema and report a mistake nobody made.
  const targets: { path: JsonPath; value: unknown }[] =
    options.type === 'default'
      ? Object.hasOwn(schema, 'default')
        ? [{ path: ['default'], value: schema['default'] }]
        : []
      : Array.isArray(schema['examples'])
        ? schema['examples'].map((value, index) => ({ path: ['examples', index], value }))
        : []

  const results: IFunctionResult[] = []
  for (const target of targets) {
    const findings = schemaFunction(
      target.value,
      { schema, allErrors: true, skipUnusableSchema: true },
      { ...context, path: [...context.path, ...source.path, ...target.path] },
    )
    if (findings) results.push(...findings)
  }
  return results
}
