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
/** Options for {@link asyncApiHeadersObject}. */
export type IAsyncApiHeadersOptions = {
  /**
   * Whether `headers` may be a Multi Format Schema Object (`{ schemaFormat,
   * schema }`). That shape is 3.0 only — in 2.x `headers` is a Schema Object and
   * nothing else, so accepting the wrapper there let a `schema` key switch the
   * check off entirely on a document that never had one.
   */
  multiFormat?: boolean
}

export const asyncApiHeadersObject: RulesetFunction<unknown, IAsyncApiHeadersOptions | undefined> = (
  headers,
  options,
  context,
): IFunctionResult[] => {
  // A boolean is a valid JSON Schema — and `false` rejects every message that
  // carries headers at all, which is never what an author meant. The structural
  // meta-schema accepts it, so this rule is the only thing that reports it.
  if (typeof headers === 'boolean') return [{ message: MESSAGE, path: [...context.path] }]
  if (!isObject(headers)) return []
  // A Reference Object reaches here only when no resolver was injected; the
  // target is where the type lives, so there is nothing to judge.
  if (typeof headers['$ref'] === 'string') return []

  if (options?.multiFormat === true && Object.hasOwn(headers, 'schema')) {
    if (!isAsyncApiSchemaFormat(headers['schemaFormat'])) return []
    const inner = headers['schema']
    if (!isObject(inner)) return [{ message: MESSAGE, path: [...context.path, 'schema'] }]
    // The wrapped schema can be a reference for the same reason the unwrapped one
    // can; the target is where the type lives.
    if (typeof inner['$ref'] === 'string' || inner['type'] === 'object') return []
    return [{ message: MESSAGE, path: [...context.path, 'schema'] }]
  }

  return headers['type'] === 'object' ? [] : [{ message: MESSAGE, path: [...context.path] }]
}
