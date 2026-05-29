import { getMjstInstanceOf, getMjstPrimitive } from '@amritk/helpers/mjst-extension'
import { resolveRef } from '@amritk/helpers/resolve-ref'
import {
  hasAnyOf,
  hasConst,
  hasDefault,
  hasEnum,
  hasExamples,
  hasFormat,
  hasItems,
  hasMaxLength,
  hasMinItems,
  hasMinimum,
  hasMinLength,
  hasOneOf,
  hasProperties,
  hasRef,
  hasType,
  isSchemaObject,
} from '@amritk/helpers/schema-guards'
import type { JSONSchema } from 'json-schema-typed/draft-2020-12'

/** Lowercases the first character of a name. e.g. "User" → "user" */
const lowerFirst = (name: string): string => name.charAt(0).toLowerCase() + name.slice(1)

/** Derives the example const name from a type name. e.g. "User" → "userExample" */
const exampleName = (typeName: string): string => `${lowerFirst(typeName)}Example`

/** Returns a representative string honouring `format` and length constraints. */
const exampleString = (schema: JSONSchema): string => {
  if (hasFormat(schema)) {
    switch (schema.format) {
      case 'email':
        return 'user@example.com'
      case 'uuid':
        return '00000000-0000-0000-0000-000000000000'
      case 'uri':
      case 'url':
        return 'https://example.com'
      case 'date-time':
        return '1970-01-01T00:00:00.000Z'
      case 'date':
        return '1970-01-01'
    }
  }

  let value = 'string'
  if (hasMinLength(schema) && value.length < schema.minLength) value = value.padEnd(schema.minLength, 'x')
  if (hasMaxLength(schema) && value.length > schema.maxLength) value = value.slice(0, schema.maxLength)
  return value
}

/**
 * Derives a single concrete, schema-valid value from a JSON Schema.
 *
 * Prefers explicit hints in this order: `const`, `examples[0]`, `default`,
 * `enum[0]`; otherwise produces a canonical value for the declared type.
 * `$ref`s are resolved and inlined by value; recursive refs short-circuit to
 * `null` (tracked via `seen`).
 *
 * Note: values constrained only by `pattern` are not guaranteed to match the
 * pattern — use the generated arbitrary when pattern fidelity matters.
 */
export const deriveExample = (
  schema: JSONSchema,
  rootSchema?: Record<string, unknown>,
  seen: ReadonlySet<string> = new Set(),
): unknown => {
  if (!isSchemaObject(schema)) return null

  if (hasConst(schema)) return schema.const
  if (hasExamples(schema) && Array.isArray(schema.examples) && schema.examples.length > 0) return schema.examples[0]
  if (hasDefault(schema)) return schema.default
  if (hasEnum(schema) && schema.enum.length > 0) return schema.enum[0]

  if (hasRef(schema)) {
    const ref = schema.$ref
    if (seen.has(ref) || !rootSchema) return null
    const resolved = resolveRef(ref, rootSchema)
    if (!resolved) return null
    return deriveExample(resolved as JSONSchema, rootSchema, new Set([...seen, ref]))
  }

  const instanceOf = getMjstInstanceOf(schema)
  if (instanceOf === 'Date') return new Date(0)
  const primitive = getMjstPrimitive(schema)
  if (primitive === 'bigint') return 0n

  if (hasOneOf(schema) && schema.oneOf[0] !== undefined) return deriveExample(schema.oneOf[0], rootSchema, seen)
  if (hasAnyOf(schema) && schema.anyOf[0] !== undefined) return deriveExample(schema.anyOf[0], rootSchema, seen)

  // `hasType` only matches a single string `type`; multi-type schemas fall
  // through to `null`.
  if (!hasType(schema)) return null

  switch (schema.type) {
    case 'string':
      return exampleString(schema)
    case 'number':
    case 'integer':
      return hasMinimum(schema) ? schema.minimum : 0
    case 'boolean':
      return true
    case 'null':
      return null
    case 'array': {
      const item = hasItems(schema) ? deriveExample(schema.items, rootSchema, seen) : null
      const count = hasMinItems(schema) ? Math.max(schema.minItems, 1) : 1
      return Array.from({ length: count }, () => item)
    }
    case 'object': {
      const out: Record<string, unknown> = {}
      if (hasProperties(schema)) {
        for (const [key, propSchema] of Object.entries(schema.properties)) {
          out[key] = deriveExample(propSchema, rootSchema, seen)
        }
      }
      return out
    }
    default:
      return null
  }
}

/**
 * Serializes a derived value into a TypeScript source expression. Handles the
 * non-JSON values `deriveExample` can produce (`Date`, `bigint`) in addition to
 * plain JSON.
 */
export const serializeValue = (value: unknown): string => {
  if (typeof value === 'bigint') return `${value}n`
  if (value instanceof Date) return `new Date(${JSON.stringify(value.toISOString())})`
  if (Array.isArray(value)) return `[${value.map(serializeValue).join(', ')}]`
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value)
      .filter(([, v]) => v !== undefined)
      .map(([key, v]) => `${JSON.stringify(key)}: ${serializeValue(v)}`)
    return `{ ${entries.join(', ')} }`
  }
  return JSON.stringify(value)
}

/**
 * Generates an exported const holding a concrete, schema-valid example value.
 *
 * @example
 * ```typescript
 * generateExampleConst({ type: 'object', properties: { name: { type: 'string' } } }, 'Info')
 * // export const infoExample: Info = { "name": "string" }
 * ```
 */
export const generateExampleConst = (
  schema: JSONSchema,
  typeName: string,
  rootSchema?: Record<string, unknown>,
): string => {
  const value = deriveExample(schema, rootSchema)
  return `export const ${exampleName(typeName)}: ${typeName} = ${serializeValue(value)}`
}
