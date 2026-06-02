import type { JSONSchema } from 'json-schema-typed/draft-2020-12'

import { isSchemaObject } from './schema-guards'

/**
 * Checks whether a property is required, based on the parent schema's `required`
 * array. Returns `false` for boolean schemas and for schemas without a
 * `required` array.
 *
 * @param key - The property name to inspect.
 * @param schema - The parent object schema that declares the property.
 */
export const isPropertyRequired = (key: string, schema: JSONSchema): boolean => {
  if (!isSchemaObject(schema)) {
    return false
  }

  return Array.isArray(schema.required) && schema.required.includes(key)
}
