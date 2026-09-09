import type { JsonPath } from '../../../core/types'
import { isObject } from './helpers'

/** An AsyncAPI 3.0 payload or headers node, split into the schema it holds and the language that schema is written in. */
export type MultiFormatSchema = {
  /** The wrapper's `schemaFormat`, or `undefined` when the node is a bare Schema Object. */
  schemaFormat: unknown
  /** The Schema Object itself: the wrapper's `schema`, or the whole node when it is bare. */
  schema: unknown
  /** How to get from the matched node down to `schema` — `['schema']` when wrapped, empty when bare. */
  path: JsonPath
}

/**
 * Splits an AsyncAPI 3.0 Multi Format Schema Object (`{ schemaFormat, schema }`)
 * into its parts, passing a bare Schema Object through untouched.
 *
 * 3.0 moved `schemaFormat` off the message and onto the payload/headers wrapper,
 * so this is where "is this even an AsyncAPI Schema Object?" gets answered for
 * that major — the question 2.x answers once, on the message.
 *
 * An own `schema` key is what makes it a wrapper, which is exactly how the
 * bundled 3.0 meta-schema decides (`anySchema.json`: `if: { required: ['schema']
 * }`). `schemaFormat` is optional on the wrapper and defaults to the AsyncAPI
 * dialect, so demanding it too would leave a plain `{ schema: … }` judged as a
 * schema whose only keyword is one no dialect defines.
 */
export const splitMultiFormatSchema = (node: unknown): MultiFormatSchema =>
  isObject(node) && Object.hasOwn(node, 'schema')
    ? { schemaFormat: node['schemaFormat'], schema: node['schema'], path: ['schema'] }
    : { schemaFormat: undefined, schema: node, path: [] }
