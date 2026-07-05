import { escapeRegexPattern } from '@amritk/helpers/escape-regex-pattern'
import { getMjstInstanceOf, getMjstPrimitive } from '@amritk/helpers/mjst-extension'
import { multipleOfFailExpr } from '@amritk/helpers/multiple-of-check'
import { safeAccessor } from '@amritk/helpers/safe-accessor'
import {
  hasEnum,
  hasExclusiveMaximum,
  hasExclusiveMinimum,
  hasMaxItems,
  hasMaximum,
  hasMaxLength,
  hasMinItems,
  hasMinimum,
  hasMinLength,
  hasMultipleOf,
  hasPattern,
  hasProperties,
  hasRef,
  hasRequired,
  hasType,
  hasUniqueItems,
  isSchemaObject,
} from '@amritk/helpers/schema-guards'
import type { JSONSchema } from 'json-schema-typed/draft-2020-12'

/**
 * Returns the inline condition that is true when `accessor` is the wrong type
 * for the given JSON Schema primitive type.
 */
const wrongTypeCondition = (accessor: string, type: string): string | null => {
  switch (type) {
    case 'string':
      return `typeof ${accessor} !== "string"`
    case 'number':
      return `typeof ${accessor} !== "number"`
    case 'integer':
      // `integer` also rejects non-integral numbers; a bare typeof accepts `1.5`.
      return `(typeof ${accessor} !== "number" || !Number.isInteger(${accessor}))`
    case 'boolean':
      return `typeof ${accessor} !== "boolean"`
    case 'array':
      return `!Array.isArray(${accessor})`
    case 'object':
      return `!isObject(${accessor})`
    default:
      return null
  }
}

/**
 * Maps a JSON Schema type to the label used in error messages.
 * `integer` collapses to `number` since both are validated via `typeof === "number"`.
 */
const typeLabel = (type: string): string => (type === 'integer' ? 'number' : type)

/**
 * Emits `throw new Error(<message>[ + <suffixExpr>])`. The static message may
 * contain schema-controlled text (property names, patterns, enum values), so it
 * is always serialized with `JSON.stringify` — a key like `it's` or a pattern
 * containing a quote or newline can no longer break out of the string literal or
 * inject code. `suffixExpr`, when given, is a runtime expression appended to the
 * message (e.g. `typeof input`).
 */
const throwError = (message: string, suffixExpr?: string): string => {
  const literal = JSON.stringify(message)
  return suffixExpr ? `throw new Error(${literal} + (${suffixExpr}))` : `throw new Error(${literal})`
}

/**
 * Generates strict-mode constraint checks for a typed property
 * (pattern, length, min/max, multipleOf).
 */
const generateConstraintChecks = (acc: string, propSchema: JSONSchema, typeName: string, key: string): string[] => {
  if (!isSchemaObject(propSchema) || !hasType(propSchema)) return []
  const t = propSchema.type as string
  const lines: string[] = []

  const field = `[${typeName}] field '${key}'`

  if (t === 'string') {
    if (hasPattern(propSchema)) {
      const pattern = escapeRegexPattern(propSchema.pattern)
      lines.push(
        `  if (typeof ${acc} === "string" && !/${pattern}/.test(${acc})) ${throwError(`${field} must match pattern ${propSchema.pattern}`)};`,
      )
    }
    if (hasMinLength(propSchema)) {
      lines.push(
        `  if (typeof ${acc} === "string" && ${acc}.length < ${propSchema.minLength}) ${throwError(`${field} must have at least ${propSchema.minLength} characters`)};`,
      )
    }
    if (hasMaxLength(propSchema)) {
      lines.push(
        `  if (typeof ${acc} === "string" && ${acc}.length > ${propSchema.maxLength}) ${throwError(`${field} must have at most ${propSchema.maxLength} characters`)};`,
      )
    }
  }

  if (t === 'number' || t === 'integer') {
    if (hasMinimum(propSchema)) {
      lines.push(
        `  if (typeof ${acc} === "number" && ${acc} < ${propSchema.minimum}) ${throwError(`${field} must be >= ${propSchema.minimum}`)};`,
      )
    }
    if (hasMaximum(propSchema)) {
      lines.push(
        `  if (typeof ${acc} === "number" && ${acc} > ${propSchema.maximum}) ${throwError(`${field} must be <= ${propSchema.maximum}`)};`,
      )
    }
    if (hasExclusiveMinimum(propSchema)) {
      lines.push(
        `  if (typeof ${acc} === "number" && ${acc} <= ${propSchema.exclusiveMinimum}) ${throwError(`${field} must be > ${propSchema.exclusiveMinimum}`)};`,
      )
    }
    if (hasExclusiveMaximum(propSchema)) {
      lines.push(
        `  if (typeof ${acc} === "number" && ${acc} >= ${propSchema.exclusiveMaximum}) ${throwError(`${field} must be < ${propSchema.exclusiveMaximum}`)};`,
      )
    }
    if (hasMultipleOf(propSchema)) {
      lines.push(
        `  if (typeof ${acc} === "number" && ${multipleOfFailExpr(acc, propSchema.multipleOf)}) ${throwError(`${field} must be a multiple of ${propSchema.multipleOf}`)};`,
      )
    }
  }

  if (t === 'array') {
    if (hasMinItems(propSchema)) {
      lines.push(
        `  if (Array.isArray(${acc}) && ${acc}.length < ${propSchema.minItems}) ${throwError(`${field} must have at least ${propSchema.minItems} items`)};`,
      )
    }
    if (hasMaxItems(propSchema)) {
      lines.push(
        `  if (Array.isArray(${acc}) && ${acc}.length > ${propSchema.maxItems}) ${throwError(`${field} must have at most ${propSchema.maxItems} items`)};`,
      )
    }
    if (hasUniqueItems(propSchema) && propSchema.uniqueItems === true) {
      // Deep-equality dedupe via JSON keys, matching the interpreter's semantics —
      // a plain `new Set` would only catch primitive duplicates, not equal objects.
      lines.push(
        `  if (Array.isArray(${acc}) && new Set(${acc}.map((_u) => JSON.stringify(_u))).size !== ${acc}.length) ${throwError(`${field} must NOT have duplicate items`)};`,
      )
    }
  }

  return lines
}

/**
 * Generates strict-mode lines for a single property of an object schema.
 * Properties with a `$ref` are skipped here — the nested parser handles its own
 * strict check when called from the parent's slow path.
 */
const generatePropertyAssertion = (
  key: string,
  propSchema: JSONSchema,
  isRequired: boolean,
  typeName: string,
): string[] => {
  const acc = safeAccessor('input', key)
  const field = `[${typeName}] field '${key}'`
  const lines: string[] = []

  if (isRequired) {
    lines.push(
      `  if (!(${JSON.stringify(key)} in input)) ${throwError(`[${typeName}] missing required property '${key}'`)};`,
    )
  }

  if (!isSchemaObject(propSchema)) return lines
  if (hasRef(propSchema)) return lines

  const instanceOf = getMjstInstanceOf(propSchema)
  if (instanceOf) {
    if (isRequired) {
      lines.push(`  if (!(${acc} instanceof ${instanceOf})) ${throwError(`${field} must be ${instanceOf}`)};`)
    } else {
      lines.push(
        `  if (${acc} !== undefined && !(${acc} instanceof ${instanceOf})) ${throwError(`${field} must be ${instanceOf}`)};`,
      )
    }
    return lines
  }

  const primitive = getMjstPrimitive(propSchema)
  if (primitive) {
    if (isRequired) {
      lines.push(`  if (typeof ${acc} !== "${primitive}") ${throwError(`${field} must be ${primitive}`)};`)
    } else {
      lines.push(
        `  if (${acc} !== undefined && typeof ${acc} !== "${primitive}") ${throwError(`${field} must be ${primitive}`)};`,
      )
    }
    return lines
  }

  if (hasEnum(propSchema)) {
    const allowed = JSON.stringify(propSchema.enum)
    const label = (propSchema.enum as unknown[]).map((v) => JSON.stringify(v)).join(', ')
    if (isRequired) {
      lines.push(
        `  if (!(${allowed} as readonly unknown[]).includes(${acc})) ${throwError(`${field} must be one of: ${label}`)};`,
      )
    } else {
      lines.push(
        `  if (${acc} !== undefined && !(${allowed} as readonly unknown[]).includes(${acc})) ${throwError(`${field} must be one of: ${label}`)};`,
      )
    }
    return lines
  }

  if (hasType(propSchema)) {
    const t = propSchema.type as string
    const wrongType = wrongTypeCondition(acc, t)
    if (wrongType) {
      const expected = throwError(`${field} expected ${typeLabel(t)}, got `, `typeof ${acc}`)
      if (isRequired) {
        lines.push(`  if (${wrongType}) ${expected};`)
      } else {
        lines.push(`  if (${acc} !== undefined && (${wrongType})) ${expected};`)
      }
    }
    lines.push(...generateConstraintChecks(acc, propSchema, typeName, key))
  }

  return lines
}

/**
 * Generates strict-mode assertions for the body of an object parser.
 * Throws on:
 *   - non-object input
 *   - missing required property
 *   - property of the wrong primitive type
 *   - enum / pattern / length / min / max / multipleOf violations
 *
 * Properties with a `$ref` are validated by the nested parser's own strict
 * check when that parser is invoked downstream.
 */
export const generateObjectStrictAssertion = (schema: JSONSchema, typeName: string): string[] => {
  const lines: string[] = []
  lines.push(
    `  if (!isObject(input)) ${throwError(`[${typeName}] expected object, got `, 'input === null ? "null" : typeof input')};`,
  )

  if (!hasProperties(schema) || !isSchemaObject(schema)) return lines

  const required = new Set<string>(hasRequired(schema) ? schema.required : [])

  for (const [key, propSchema] of Object.entries(schema.properties)) {
    lines.push(...generatePropertyAssertion(key, propSchema, required.has(key), typeName))
  }

  return lines
}

/**
 * Generates a single strict-mode assertion line for a non-object scalar parser.
 * Returns null when the schema has no type information to assert on.
 */
export const generateScalarStrictAssertion = (schema: JSONSchema, typeName: string): string | null => {
  const got = 'input === null ? "null" : typeof input'

  const instanceOf = getMjstInstanceOf(schema)
  if (instanceOf) {
    return `  if (!(input instanceof ${instanceOf})) ${throwError(`[${typeName}] expected ${instanceOf}, got `, got)};`
  }

  const primitive = getMjstPrimitive(schema)
  if (primitive) {
    return `  if (typeof input !== "${primitive}") ${throwError(`[${typeName}] expected ${primitive}, got `, got)};`
  }

  if (!isSchemaObject(schema) || !hasType(schema)) return null
  const t = schema.type as string
  const wrongType = wrongTypeCondition('input', t)
  if (!wrongType) return null
  return `  if (${wrongType}) ${throwError(`[${typeName}] expected ${typeLabel(t)}, got `, got)};`
}
