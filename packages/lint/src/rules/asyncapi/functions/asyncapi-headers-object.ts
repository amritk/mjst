import type { IFunctionResult, RulesetFunction } from '../../../core/types'
import { isObject } from './helpers'
import { isAsyncApiSchemaFormat } from './schema-format'

const MESSAGE = 'Headers schema type must be "object"'

/**
 * A message's `headers` must describe an object — headers are name/value pairs,
 * so any other type is a mistake.
 *
 * 3.0 lets `headers` be either a Schema Object or a Multi Format Schema Object
 * (`{ schemaFormat, schema }`), and a plain `type: object` check rejected the
 * second form outright — flagging documents the bundled meta-schema accepts, so
 * the ruleset contradicted its own structural rule. When the headers are wrapped
 * that way the check moves inside `schema`, and headers written in some other
 * schema language are left alone, exactly as a non-AsyncAPI payload is.
 */
export const asyncApiHeadersObject: RulesetFunction = (headers, _options, context): IFunctionResult[] => {
  if (!isObject(headers)) return []

  if (Object.hasOwn(headers, 'schema')) {
    if (!isAsyncApiSchemaFormat(headers['schemaFormat'])) return []
    const inner = headers['schema']
    if (isObject(inner) && inner['type'] === 'object') return []
    return [{ message: MESSAGE, path: [...context.path, 'schema'] }]
  }

  return headers['type'] === 'object' ? [] : [{ message: MESSAGE, path: [...context.path] }]
}
