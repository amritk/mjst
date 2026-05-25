import type { JSONSchema } from 'json-schema-typed/draft-2020-12'

import { isSchemaObject } from './schema-guards'

/**
 * Vendor extension keyword carrying mjst-specific runtime hints that plain JSON
 * Schema cannot express on its own. Adapters (TypeBox, Zod, ...) emit it when a
 * source construct has no native JSON Schema equivalent, and the generators read
 * it to produce the right TypeScript type and runtime checks.
 */
export const MJST_EXTENSION_KEY = 'x-mjst'

/**
 * The shape of the `x-mjst` extension object.
 *
 * `instanceOf` names a JavaScript class the value must be an instance of at
 * runtime (e.g. `'Date'`). It is how we round-trip constructs like TypeBox's
 * `Type.Date()` that JSON Schema's core vocabulary has no keyword for.
 */
export type MjstExtension = {
  readonly instanceOf?: string
}

// Only identifier-safe class names are honoured, so a malicious or malformed
// schema cannot inject arbitrary code into the generated output.
const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/

/**
 * Reads the `instanceOf` class name from a schema's `x-mjst` extension, when it
 * is present and a safe identifier. Returns undefined otherwise so callers fall
 * back to ordinary type handling.
 */
export const getMjstInstanceOf = (schema: JSONSchema): string | undefined => {
  if (!isSchemaObject(schema)) return undefined

  const extension = (schema as Record<string, unknown>)[MJST_EXTENSION_KEY]
  if (typeof extension !== 'object' || extension === null) return undefined

  const instanceOf = (extension as Record<string, unknown>)['instanceOf']
  if (typeof instanceOf === 'string' && IDENTIFIER.test(instanceOf)) return instanceOf

  return undefined
}
