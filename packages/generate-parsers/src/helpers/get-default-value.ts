import { getMjstPrimitive } from '@amritk/helpers/mjst-extension'
import {
  hasAllOf,
  hasAnyOf,
  hasConst,
  hasDefault,
  hasEnum,
  hasExamples,
  hasOneOf,
  hasPattern,
  hasProperties,
  hasRequired,
  hasType,
  isSchemaObject,
} from '@amritk/helpers/schema-guards'
import type { JSONSchema } from 'json-schema-typed/draft-2020-12'
import { generateDefaultFromPattern } from '#generators/generate-default-from-pattern'

/**
 * True when a schema's `default` is an instance of the type it declares. A
 * schema with no (or a multi-) `type` places no constraint we can check here, so
 * the default is taken at face value.
 */
const defaultMatchesType = (value: unknown, schema: JSONSchema): boolean => {
  if (!hasType(schema)) return true
  switch (schema.type) {
    case 'string':
      return typeof value === 'string'
    case 'number':
      return typeof value === 'number'
    case 'integer':
      return typeof value === 'number' && Number.isInteger(value)
    case 'boolean':
      return typeof value === 'boolean'
    case 'null':
      return value === null
    case 'array':
      return Array.isArray(value)
    case 'object':
      return typeof value === 'object' && value !== null && !Array.isArray(value)
    default:
      return true
  }
}

/**
 * How many elements a fallback array is willing to synthesize. `minItems` is
 * schema-controlled and unbounded, and a `minItems: 10000` node would otherwise
 * inline a ten-thousand-element literal into every generated file. Past this we
 * fill only the declared tuple positions, which is what the emitted type actually
 * requires; the `minItems` shortfall is a coercion imperfection, not a
 * compilation failure.
 */
const MAX_FALLBACK_ITEMS = 32

/**
 * The literal for an `array` fallback.
 *
 * A bare `[]` was wrong in two ways. It ignores `minItems`, so the "repaired"
 * value is not an instance of its own schema — and it ignores `prefixItems`,
 * whose positions below `minItems` the type generator emits as *required* tuple
 * members. `{ prefixItems: [{type:'string'},{type:'number'}], minItems: 2 }`
 * therefore produced `t: []` against a declared `[string, number]`: `TS2322`, so
 * the whole generated file failed to compile in coerce and readonly modes. This
 * mirrors the `object` case, which already fills in its required properties.
 *
 * Falls back to `[]` when a needed position has no concrete default of its own
 * (an unresolvable `$ref`, a type-less schema) — a half-filled tuple is no more
 * assignable than an empty one, so there is nothing to gain by emitting one.
 */
const arrayFallback = (schema: JSONSchema): string => {
  const record = schema as Record<string, unknown>
  // 2020-12 spells tuple positions `prefixItems`; draft-07 used an array-valued
  // `items` with the tail in `additionalItems`.
  const positions = Array.isArray(record['prefixItems'])
    ? (record['prefixItems'] as JSONSchema[])
    : Array.isArray(record['items'])
      ? (record['items'] as JSONSchema[])
      : []
  const tail = Array.isArray(record['items']) ? record['additionalItems'] : record['items']
  const minItems = typeof record['minItems'] === 'number' ? (record['minItems'] as number) : 0

  // Past the cap, fall back to what the emitted tuple type requires — positions
  // below `minItems` — which is the part that has to compile.
  const wanted = minItems > MAX_FALLBACK_ITEMS ? Math.min(minItems, positions.length) : minItems
  if (wanted === 0) return '[]'

  const elements: string[] = []
  for (let i = 0; i < wanted; i++) {
    // Past the declared positions the element schema is the `items` tail; a
    // `false` (closed tuple) or absent tail leaves nothing to build from.
    const elementSchema = i < positions.length ? positions[i] : tail
    if (elementSchema === undefined || typeof elementSchema === 'boolean') return '[]'
    const element = getDefaultValue(elementSchema as JSONSchema)
    if (element === 'undefined') return '[]'
    elements.push(element)
  }
  return `[${elements.join(', ')}]`
}

/**
 * Returns the default value for a JSON Schema property.
 * Priority order: explicit default > first enum value > first example > union first schema > pattern-based > type-based.
 * These defaults ensure that parsing never fails, even with missing data.
 */
export const getDefaultValue = (schema: JSONSchema): string => {
  if (!isSchemaObject(schema)) {
    return 'undefined'
  }

  // Explicit default takes highest priority — but only when it actually is an
  // instance of the declared type. Real-world documents carry defaults left over
  // from an earlier shape (OpenAI's `testing_criteria` declares `type: array`
  // with `default: eval`), and honouring one means a coercing parser "repairs" a
  // missing array into a string: invalid against the schema, and not even
  // assignable to the type this generator emits for the property.
  if (hasDefault(schema) && defaultMatchesType(schema.default, schema)) {
    return JSON.stringify(schema.default)
  }

  // A `const` value is the only valid value, so it is also the default.
  if (hasConst(schema)) {
    return JSON.stringify(schema.const)
  }

  // Use first enum value if available
  if (hasEnum(schema) && schema.enum.length > 0) {
    return JSON.stringify(schema.enum[0])
  }

  // Use first example if available
  if (hasExamples(schema) && schema.examples.length > 0) {
    return JSON.stringify(schema.examples[0])
  }

  // Handle union types - use first schema's default
  if (hasOneOf(schema) && schema.oneOf.length > 0) {
    const firstSchema = schema.oneOf[0]
    if (firstSchema !== undefined) {
      return getDefaultValue(firstSchema)
    }
  }

  if (hasAnyOf(schema) && schema.anyOf.length > 0) {
    const firstSchema = schema.anyOf[0]
    if (firstSchema !== undefined) {
      return getDefaultValue(firstSchema)
    }
  }

  // Handle allOf - use first schema's default
  if (hasAllOf(schema) && schema.allOf.length > 0) {
    const firstSchema = schema.allOf[0]
    if (firstSchema !== undefined) {
      return getDefaultValue(firstSchema)
    }
  }

  // x-mjst bigint has no native JSON type but a sensible zero default.
  if (getMjstPrimitive(schema) === 'bigint') {
    return '0n'
  }

  // Array-form `type` (e.g. `["string","null"]`): `hasType` is false for it, so
  // without this a required-but-missing value would default to `undefined` —
  // violating both `required` and the declared type. Derive the default from the
  // first listed type so the fallback is a valid member.
  const rawType = (schema as Record<string, unknown>)['type']
  if (Array.isArray(rawType) && rawType.length > 0 && typeof rawType[0] === 'string') {
    return getDefaultValue({ ...schema, type: rawType[0] } as JSONSchema)
  }

  if (!hasType(schema)) {
    return 'undefined'
  }

  switch (schema.type) {
    case 'string': {
      if (hasPattern(schema)) {
        const patternDefault = generateDefaultFromPattern(schema.pattern)
        if (patternDefault) {
          return patternDefault
        }
      }
      return '""'
    }
    case 'number':
    case 'integer':
      return '0'
    case 'boolean':
      return 'false'
    case 'null':
      return 'null'
    case 'array':
      return arrayFallback(schema)
    case 'object': {
      // A bare `{}` omits required properties, leaving the default invalid against
      // its own type. Populate each required property with its own default so the
      // fallback object is itself a valid instance.
      if (hasProperties(schema) && hasRequired(schema)) {
        const props = schema.properties
        const required = schema.required.filter((key) => Object.hasOwn(props, key))
        const defaults = required.map((key) => getDefaultValue(props[key] as JSONSchema))
        // A required property whose schema has no concrete default (a `$ref` we
        // can't resolve here, or a type-less schema) would otherwise emit
        // `"key": undefined` — i.e. a *missing* required key. Don't build a
        // partial object with holes; fall back to a bare `{}` for the whole node.
        if (defaults.length > 0 && !defaults.includes('undefined')) {
          return `{ ${required.map((key, i) => `${JSON.stringify(key)}: ${defaults[i]}`).join(', ')} }`
        }
      }
      return '{}'
    }
    default:
      return 'undefined'
  }
}
