import { getMjstInstanceOf, getMjstPrimitive } from '@amritk/helpers/mjst-extension'
import { refToName } from '@amritk/helpers/ref-to-name'
import {
  hasAnyOf,
  hasConst,
  hasEnum,
  hasExclusiveMaximum,
  hasExclusiveMinimum,
  hasFormat,
  hasItems,
  hasMaxItems,
  hasMaximum,
  hasMaxLength,
  hasMinItems,
  hasMinimum,
  hasMinLength,
  hasMultipleOf,
  hasOneOf,
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
 * Derives the arbitrary const name from a type name.
 * e.g. "User" → "UserArbitrary"
 */
const arbitraryName = (typeName: string): string => `${typeName}Arbitrary`

/** Builds a `fc.string({ ... })` expression honouring format and length constraints. */
const stringExpr = (schema: JSONSchema): string => {
  if (hasFormat(schema)) {
    switch (schema.format) {
      case 'email':
        return 'fc.emailAddress()'
      case 'uuid':
        return 'fc.uuid()'
      case 'uri':
      case 'url':
        return 'fc.webUrl()'
      case 'date-time':
        return 'fc.date({ noInvalidDate: true }).map((d) => d.toISOString())'
      case 'date':
        return 'fc.date({ noInvalidDate: true }).map((d) => d.toISOString().slice(0, 10))'
    }
  }

  if (hasPattern(schema)) return `fc.stringMatching(/${schema.pattern}/)`

  const opts: string[] = []
  if (hasMinLength(schema)) opts.push(`minLength: ${schema.minLength}`)
  if (hasMaxLength(schema)) opts.push(`maxLength: ${schema.maxLength}`)
  return opts.length > 0 ? `fc.string({ ${opts.join(', ')} })` : 'fc.string()'
}

/** Builds a `fc.integer({ ... })` expression honouring range and multiple-of constraints. */
const integerExpr = (schema: JSONSchema): string => {
  const opts: string[] = []
  if (hasMinimum(schema)) opts.push(`min: ${schema.minimum}`)
  else if (hasExclusiveMinimum(schema)) opts.push(`min: ${Number(schema.exclusiveMinimum) + 1}`)
  if (hasMaximum(schema)) opts.push(`max: ${schema.maximum}`)
  else if (hasExclusiveMaximum(schema)) opts.push(`max: ${Number(schema.exclusiveMaximum) - 1}`)

  const base = opts.length > 0 ? `fc.integer({ ${opts.join(', ')} })` : 'fc.integer()'
  return hasMultipleOf(schema) ? `${base}.filter((n) => n % ${schema.multipleOf} === 0)` : base
}

/** Builds a `fc.double({ ... })` expression honouring range and multiple-of constraints. */
const numberExpr = (schema: JSONSchema): string => {
  const opts: string[] = ['noNaN: true', 'noDefaultInfinity: true']
  if (hasMinimum(schema)) opts.push(`min: ${schema.minimum}`)
  else if (hasExclusiveMinimum(schema)) opts.push(`min: ${schema.exclusiveMinimum}`, 'minExcluded: true')
  if (hasMaximum(schema)) opts.push(`max: ${schema.maximum}`)
  else if (hasExclusiveMaximum(schema)) opts.push(`max: ${schema.exclusiveMaximum}`, 'maxExcluded: true')

  const base = `fc.double({ ${opts.join(', ')} })`
  return hasMultipleOf(schema) ? `${base}.filter((n) => n % ${schema.multipleOf} === 0)` : base
}

/** Builds a `fc.array(...)` / `fc.uniqueArray(...)` expression for an array schema. */
const arrayExpr = (schema: JSONSchema, suffix: string): string => {
  const items = hasItems(schema) && isSchemaObject(schema.items) ? arbitraryExpr(schema.items, suffix) : 'fc.anything()'

  const opts: string[] = []
  if (hasMinItems(schema)) opts.push(`minLength: ${schema.minItems}`)
  if (hasMaxItems(schema)) opts.push(`maxLength: ${schema.maxItems}`)

  const fn = hasUniqueItems(schema) && schema.uniqueItems === true ? 'fc.uniqueArray' : 'fc.array'
  return opts.length > 0 ? `${fn}(${items}, { ${opts.join(', ')} })` : `${fn}(${items})`
}

/** Builds a `fc.record(...)` expression for an object schema. */
const objectExpr = (schema: JSONSchema, suffix: string): string => {
  if (!hasProperties(schema)) return 'fc.object()'

  const required = new Set(hasRequired(schema) ? schema.required : [])
  const keys = Object.keys(schema.properties)
  const entries = Object.entries(schema.properties).map(
    ([key, propSchema]) => `${JSON.stringify(key)}: ${arbitraryExpr(propSchema, suffix)}`,
  )

  if (entries.length === 0) return 'fc.record({})'

  const model = `{ ${entries.join(', ')} }`

  // fc.record treats all keys as required by default. Only emit requiredKeys
  // when at least one property is optional.
  if (keys.every((key) => required.has(key))) return `fc.record(${model})`

  const requiredKeys = [...required].map((key) => JSON.stringify(key)).join(', ')
  return `fc.record(${model}, { requiredKeys: [${requiredKeys}] })`
}

/** Builds a `fc.oneof(...)` expression from a list of branch schemas. */
const oneofExpr = (branches: readonly JSONSchema[], suffix: string): string => {
  const exprs = branches.map((branch) => arbitraryExpr(branch, suffix))
  return `fc.oneof(${exprs.join(', ')})`
}

/** Builds the fast-check expression for a single (non-union) JSON Schema type. */
const scalarExpr = (type: string, schema: JSONSchema, suffix: string): string => {
  switch (type) {
    case 'string':
      return stringExpr(schema)
    case 'integer':
      return integerExpr(schema)
    case 'number':
      return numberExpr(schema)
    case 'boolean':
      return 'fc.boolean()'
    case 'null':
      return 'fc.constant(null)'
    case 'array':
      return arrayExpr(schema, suffix)
    case 'object':
      return objectExpr(schema, suffix)
    default:
      return 'fc.anything()'
  }
}

/**
 * Recursively builds the fast-check arbitrary expression for a schema node.
 * `$ref`s resolve to the referenced file's exported arbitrary; everything else
 * maps to the appropriate `fc.*` combinator.
 */
const arbitraryExpr = (schema: JSONSchema, suffix: string): string => {
  if (!isSchemaObject(schema)) return 'fc.anything()'

  if (hasRef(schema)) return arbitraryName(refToName(schema.$ref, suffix))

  if (hasConst(schema)) return `fc.constant(${JSON.stringify(schema.const)})`

  if (hasEnum(schema)) {
    const values = (schema.enum as unknown[]).map((value) => JSON.stringify(value)).join(', ')
    return `fc.constantFrom(${values})`
  }

  const instanceOf = getMjstInstanceOf(schema)
  if (instanceOf === 'Date') return 'fc.date({ noInvalidDate: true })'
  if (instanceOf) return 'fc.anything()'

  const primitive = getMjstPrimitive(schema)
  if (primitive === 'bigint') return 'fc.bigInt()'
  if (primitive) return 'fc.anything()'

  if (hasOneOf(schema)) return oneofExpr(schema.oneOf, suffix)
  if (hasAnyOf(schema)) return oneofExpr(schema.anyOf, suffix)

  // `hasType` only matches a single string `type`; multi-type schemas
  // (`type: ['string', 'null']`) fall through to the permissive fallback.
  if (hasType(schema)) return scalarExpr(schema.type, schema, suffix)

  return 'fc.anything()'
}

/**
 * Generates a `fast-check` arbitrary that produces schema-valid values.
 *
 * @example
 * ```typescript
 * generateArbitrary({ type: 'object', properties: { name: { type: 'string' } }, required: ['name'] }, 'Info')
 * // export const InfoArbitrary: fc.Arbitrary<Info> = fc.record({ "name": fc.string() })
 * ```
 */
export const generateArbitrary = (schema: JSONSchema, typeName: string, suffix = ''): string => {
  const expr = arbitraryExpr(schema, suffix)
  return `export const ${arbitraryName(typeName)}: fc.Arbitrary<${typeName}> = ${expr}`
}
