import { isObject } from 'mjst-helpers/is-object'

import type { ReferenceObject } from './reference'

/**
 * Represents an OpenAPI Reference Object.
 * Used to reference other schemas via the $ref keyword.
 */
type ReferenceObject = { $ref: string }

type PrimitiveSchemaType = 'null' | 'boolean' | 'string' | 'number' | 'integer' | 'object' | 'array'

type StringFormat =
  | 'date'
  | 'date-time'
  | 'date-time-local'
  | 'time'
  | 'time-local'
  | 'duration'
  | 'http-date'
  | 'email'
  | 'idn-email'
  | 'hostname'
  | 'idn-hostname'
  | 'ipv4'
  | 'ipv6'
  | 'uri'
  | 'uri-reference'
  | 'uri-template'
  | 'iri'
  | 'iri-reference'
  | 'uuid'
  | 'binary'
  | 'byte'
  | 'base64url'
  | 'html'
  | 'commonmark'
  | 'password'
  | 'regex'
  | 'json-pointer'
  | 'relative-json-pointer'
  | 'media-range'
  | 'char'
  | 'sf-string'
  | 'sf-token'
  | 'sf-binary'
  | 'sf-boolean'

type NumericFormat =
  | 'int8'
  | 'int16'
  | 'int32'
  | 'int64'
  | 'uint8'
  | 'uint16'
  | 'uint32'
  | 'uint64'
  | 'double-int'
  | 'float'
  | 'double'
  | 'decimal'
  | 'decimal128'
  | 'sf-integer'
  | 'sf-decimal'

export type SchemaReferenceType<Value> = Value | ReferenceObject

type Extensions = {
  [key: `x-${string}`]: unknown
}

type SharedProperties = {
  name?: string
  title?: string
  description?: string
  default?: unknown
  enum?: unknown[]
  const?: unknown
  examples?: unknown[]
  example?: unknown
  deprecated?: boolean
  discriminator?: Record<string, unknown>
  readOnly?: boolean
  writeOnly?: boolean
  xml?: Record<string, unknown>
  externalDocs?: Record<string, unknown>
  allOf?: SchemaReferenceType<SchemaObject>[]
  oneOf?: SchemaReferenceType<SchemaObject>[]
  anyOf?: SchemaReferenceType<SchemaObject>[]
  not?: SchemaReferenceType<SchemaObject>
  if?: SchemaReferenceType<SchemaObject>
  then?: SchemaReferenceType<SchemaObject>
  else?: SchemaReferenceType<SchemaObject>
  $defs?: Record<string, SchemaReferenceType<SchemaObject>>
}

type NumericKeywords = {
  multipleOf?: number
  maximum?: number
  exclusiveMaximum?: number
  minimum?: number
  exclusiveMinimum?: number
}

type StringKeywords = {
  maxLength?: number
  minLength?: number
  pattern?: string
  contentMediaType?: string
  contentEncoding?: string
  contentSchema?: SchemaReferenceType<SchemaObject>
}

type ArrayKeywords = {
  items?: SchemaReferenceType<SchemaObject>
  prefixItems?: SchemaReferenceType<SchemaObject>[]
  maxItems?: number
  minItems?: number
  uniqueItems?: boolean
  contains?: SchemaReferenceType<SchemaObject>
  maxContains?: number
  minContains?: number
  unevaluatedItems?: boolean | SchemaReferenceType<SchemaObject>
}

type ObjectKeywords = {
  maxProperties?: number
  minProperties?: number
  required?: string[]
  properties?: Record<string, SchemaReferenceType<SchemaObject>>
  additionalProperties?: boolean | SchemaReferenceType<SchemaObject>
  patternProperties?: Record<string, SchemaReferenceType<SchemaObject>>
  dependentSchemas?: Record<string, SchemaReferenceType<SchemaObject>>
  propertyNames?: SchemaReferenceType<SchemaObject>
  unevaluatedProperties?: boolean | SchemaReferenceType<SchemaObject>
}

type UntypedObject = SharedProperties & {
  type?: undefined
  format?: StringFormat | NumericFormat
} & Extensions

type OtherTypes = SharedProperties & {
  type: 'null' | 'boolean'
} & Extensions

type NumericObject = SharedProperties &
  NumericKeywords & {
    type: 'number' | 'integer'
    format?: NumericFormat
  } & Extensions

type StringObject = SharedProperties &
  StringKeywords & {
    type: 'string'
    format?: StringFormat
  } & Extensions

type ArrayObject = SharedProperties &
  ArrayKeywords & {
    type: 'array'
  } & Extensions

type ObjectObject = SharedProperties &
  ObjectKeywords & {
    type: 'object'
  } & Extensions

type MultiTypeObject = SharedProperties &
  NumericKeywords &
  StringKeywords &
  ArrayKeywords &
  ObjectKeywords & {
    type: PrimitiveSchemaType[]
    format?: StringFormat | NumericFormat
  } & Extensions

type ParsedSchemaObject = SharedProperties &
  NumericKeywords &
  StringKeywords &
  ArrayKeywords &
  ObjectKeywords & {
    type?: PrimitiveSchemaType | PrimitiveSchemaType[]
    format?: StringFormat | NumericFormat
  } & Extensions

export type SchemaObject =
  | UntypedObject
  | OtherTypes
  | NumericObject
  | StringObject
  | ObjectObject
  | ArrayObject
  | MultiTypeObject

/**
 * Pre-computed Sets for O(1) format validation.
 * Replaces linear comparison chains (~30 and ~15 === checks) with hash-based lookups.
 */
const STRING_FORMATS: ReadonlySet<string> = new Set([
  'date',
  'date-time',
  'date-time-local',
  'time',
  'time-local',
  'duration',
  'http-date',
  'email',
  'idn-email',
  'hostname',
  'idn-hostname',
  'ipv4',
  'ipv6',
  'uri',
  'uri-reference',
  'uri-template',
  'iri',
  'iri-reference',
  'uuid',
  'binary',
  'byte',
  'base64url',
  'html',
  'commonmark',
  'password',
  'regex',
  'json-pointer',
  'relative-json-pointer',
  'media-range',
  'char',
  'sf-string',
  'sf-token',
  'sf-binary',
  'sf-boolean',
])

const NUMERIC_FORMATS: ReadonlySet<string> = new Set([
  'int8',
  'int16',
  'int32',
  'int64',
  'uint8',
  'uint16',
  'uint32',
  'uint64',
  'double-int',
  'float',
  'double',
  'decimal',
  'decimal128',
  'sf-integer',
  'sf-decimal',
])

/** Subset of numeric formats that represent integer types, used for type inference. */
const INTEGER_FORMATS: ReadonlySet<string> = new Set([
  'int8',
  'int16',
  'int32',
  'int64',
  'uint8',
  'uint16',
  'uint32',
  'uint64',
  'double-int',
  'sf-integer',
])

const isNonNegativeInteger = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0

const isPrimitiveSchemaType = (value: unknown): value is PrimitiveSchemaType =>
  value === 'null' ||
  value === 'boolean' ||
  value === 'string' ||
  value === 'number' ||
  value === 'integer' ||
  value === 'object' ||
  value === 'array'

/**
 * Parses a value as either a $ref reference or a full schema node.
 * For $ref objects, returns the original object directly to avoid allocation overhead.
 * This means the caller must not mutate returned reference objects.
 */
const parseSchemaOrReference = (value: unknown): SchemaReferenceType<SchemaObject> | undefined => {
  if (!isObject(value)) return undefined

  // Checking typeof directly is faster than 'in' operator + typeof.
  // For non-$ref objects (the common case), this is a single property access returning undefined.
  if (typeof value['$ref'] === 'string') {
    return value as unknown as SchemaReferenceType<SchemaObject>
  }

  return parseSchemaNode(value)
}

/**
 * Parses an array of schema-or-reference values, filtering out invalid entries.
 */
const parseSchemaArray = (value: unknown): SchemaReferenceType<SchemaObject>[] | undefined => {
  if (!Array.isArray(value)) return undefined

  const result: SchemaReferenceType<SchemaObject>[] = []
  for (let i = 0; i < value.length; i++) {
    const parsed = parseSchemaOrReference(value[i])
    if (parsed !== undefined) result.push(parsed)
  }

  return result.length > 0 ? result : undefined
}

/**
 * Parses a record of schema-or-reference values, filtering out invalid entries.
 * Expects a pre-validated plain object (caller must verify with isObject).
 * Returns an empty object when the input is empty to preserve explicit empty properties.
 */
const parseSchemaRecord = (value: Record<string, unknown>): Record<string, SchemaReferenceType<SchemaObject>> => {
  const result: Record<string, SchemaReferenceType<SchemaObject>> = {}

  for (const key in value) {
    if (!Object.hasOwn(value, key)) continue
    const parsed = parseSchemaOrReference(value[key])
    if (parsed !== undefined) {
      result[key] = parsed
    }
  }

  return result
}

// --- Direct-access type-specific parsers ---
// These access known property names directly instead of iterating all keys,
// avoiding redundant iteration after the single-pass scoring phase.

/**
 * Parses object-specific keywords via direct property access.
 * Called only when the resolved schema type includes 'object'.
 */
const parseObjectKeywordsDirect = (value: Record<string, unknown>, result: ParsedSchemaObject): void => {
  const maxProperties = value['maxProperties']
  if (isNonNegativeInteger(maxProperties)) result.maxProperties = maxProperties

  const minProperties = value['minProperties']
  if (isNonNegativeInteger(minProperties)) result.minProperties = minProperties

  const required = value['required']
  if (Array.isArray(required)) {
    const filtered: string[] = []
    for (let i = 0; i < required.length; i++) {
      if (typeof required[i] === 'string') filtered.push(required[i] as string)
    }
    result.required = filtered
  }

  const properties = value['properties']
  if (isObject(properties)) {
    result.properties = parseSchemaRecord(properties)
  }

  const patternProperties = value['patternProperties']
  if (isObject(patternProperties)) {
    result.patternProperties = parseSchemaRecord(patternProperties)
  }

  const dependentSchemas = value['dependentSchemas']
  if (isObject(dependentSchemas)) {
    result.dependentSchemas = parseSchemaRecord(dependentSchemas)
  }

  const propertyNames = value['propertyNames']
  if (propertyNames !== undefined) {
    const parsed = parseSchemaOrReference(propertyNames)
    if (parsed !== undefined) result.propertyNames = parsed
  }

  const additionalProperties = value['additionalProperties']
  if (additionalProperties !== undefined) {
    if (typeof additionalProperties === 'boolean') {
      result.additionalProperties = additionalProperties
    } else {
      const parsed = parseSchemaOrReference(additionalProperties)
      if (parsed !== undefined) result.additionalProperties = parsed
    }
  }

  const unevaluatedProperties = value['unevaluatedProperties']
  if (unevaluatedProperties !== undefined) {
    if (typeof unevaluatedProperties === 'boolean') {
      result.unevaluatedProperties = unevaluatedProperties
    } else {
      const parsed = parseSchemaOrReference(unevaluatedProperties)
      if (parsed !== undefined) result.unevaluatedProperties = parsed
    }
  }
}

/**
 * Parses array-specific keywords via direct property access.
 * Called only when the resolved schema type includes 'array'.
 */
const parseArrayKeywordsDirect = (value: Record<string, unknown>, result: ParsedSchemaObject): void => {
  const maxItems = value['maxItems']
  if (isNonNegativeInteger(maxItems)) result.maxItems = maxItems

  const minItems = value['minItems']
  if (isNonNegativeInteger(minItems)) result.minItems = minItems

  const maxContains = value['maxContains']
  if (isNonNegativeInteger(maxContains)) result.maxContains = maxContains

  const minContains = value['minContains']
  if (isNonNegativeInteger(minContains)) result.minContains = minContains

  const uniqueItems = value['uniqueItems']
  if (typeof uniqueItems === 'boolean') result.uniqueItems = uniqueItems

  const items = value['items']
  if (items !== undefined) {
    const parsed = parseSchemaOrReference(items)
    if (parsed !== undefined) result.items = parsed
  }

  const contains = value['contains']
  if (contains !== undefined) {
    const parsed = parseSchemaOrReference(contains)
    if (parsed !== undefined) result.contains = parsed
  }

  const prefixItems = value['prefixItems']
  if (prefixItems !== undefined) {
    const parsed = parseSchemaArray(prefixItems)
    if (parsed !== undefined) result.prefixItems = parsed
  }

  const unevaluatedItems = value['unevaluatedItems']
  if (unevaluatedItems !== undefined) {
    if (typeof unevaluatedItems === 'boolean') {
      result.unevaluatedItems = unevaluatedItems
    } else {
      const parsed = parseSchemaOrReference(unevaluatedItems)
      if (parsed !== undefined) result.unevaluatedItems = parsed
    }
  }
}

/**
 * Parses string-specific keywords via direct property access.
 * Called only when the resolved schema type includes 'string'.
 */
const parseStringKeywordsDirect = (value: Record<string, unknown>, result: ParsedSchemaObject): void => {
  const maxLength = value['maxLength']
  if (isNonNegativeInteger(maxLength)) result.maxLength = maxLength

  const minLength = value['minLength']
  if (isNonNegativeInteger(minLength)) result.minLength = minLength

  const pattern = value['pattern']
  if (typeof pattern === 'string') result.pattern = pattern

  const contentMediaType = value['contentMediaType']
  if (typeof contentMediaType === 'string') result.contentMediaType = contentMediaType

  const contentEncoding = value['contentEncoding']
  if (typeof contentEncoding === 'string') result.contentEncoding = contentEncoding

  const contentSchema = value['contentSchema']
  if (contentSchema !== undefined) {
    const parsed = parseSchemaOrReference(contentSchema)
    if (parsed !== undefined) result.contentSchema = parsed
  }
}

/**
 * Parses numeric-specific keywords via direct property access.
 * Called only when the resolved schema type includes 'number' or 'integer'.
 */
const parseNumericKeywordsDirect = (value: Record<string, unknown>, result: ParsedSchemaObject): void => {
  const multipleOf = value['multipleOf']
  if (typeof multipleOf === 'number') result.multipleOf = multipleOf

  const maximum = value['maximum']
  if (typeof maximum === 'number') result.maximum = maximum

  const exclusiveMaximum = value['exclusiveMaximum']
  if (typeof exclusiveMaximum === 'number') {
    result.exclusiveMaximum = exclusiveMaximum
  } else if (exclusiveMaximum === true && typeof maximum === 'number') {
    // OpenAPI 3.0 format: exclusiveMaximum is a boolean modifier for maximum
    result.exclusiveMaximum = maximum
  }

  const minimum = value['minimum']
  if (typeof minimum === 'number') result.minimum = minimum

  const exclusiveMinimum = value['exclusiveMinimum']
  if (typeof exclusiveMinimum === 'number') {
    result.exclusiveMinimum = exclusiveMinimum
  } else if (exclusiveMinimum === true && typeof minimum === 'number') {
    // OpenAPI 3.0 format: exclusiveMinimum is a boolean modifier for minimum
    result.exclusiveMinimum = minimum
  }
}

/**
 * Infers the most likely schema type from keyword presence scores and shared keyword signals.
 * Uses normalized percentages (keyword count / total keywords per category * 100).
 * Tie-breaking follows ordered priority: object > array > string > integer > number > boolean > null.
 */
const inferSchemaType = (
  objectCount: number,
  arrayCount: number,
  stringCount: number,
  numericCount: number,
  shared: ParsedSchemaObject,
): PrimitiveSchemaType | undefined => {
  // String format is the strongest inference signal and short-circuits everything.
  if (shared.format !== undefined && STRING_FORMATS.has(shared.format)) {
    return 'string'
  }

  // Normalize raw counts to percentages for fair cross-category comparison.
  const objectScore = (objectCount / 9) * 100
  const arrayScore = (arrayCount / 9) * 100
  const stringScore = (stringCount / 6) * 100

  // Numeric format boosts the appropriate sub-type to maximum confidence.
  let integerScore = (numericCount / 5) * 100
  let numberScore = integerScore
  if (shared.format !== undefined && NUMERIC_FORMATS.has(shared.format)) {
    if (INTEGER_FORMATS.has(shared.format)) {
      integerScore = 100
    } else {
      numberScore = 100
    }
  }

  // Derive null and boolean scores from const and enum signals.
  let nullScore = 0
  let booleanScore = 0

  if (shared.const === null) {
    nullScore = 100
  } else if (typeof shared.const === 'boolean') {
    booleanScore = 100
  }

  const enumValues = shared.enum
  if (enumValues !== undefined && enumValues.length > 0) {
    const enumCount = enumValues.length
    let nullValues = 0
    let booleanValues = 0
    for (let i = 0; i < enumCount; i++) {
      const ev = enumValues[i]
      if (ev === null) nullValues++
      else if (typeof ev === 'boolean') booleanValues++
    }
    const nullPct = (nullValues / enumCount) * 100
    const boolPct = (booleanValues / enumCount) * 100
    if (nullPct > nullScore) nullScore = nullPct
    if (boolPct > booleanScore) booleanScore = boolPct
  }

  // Find the highest-scoring type. Comparison order determines tie-breaking.
  // Avoids allocating a scoredTypes array by using sequential comparisons.
  let bestType: PrimitiveSchemaType | undefined
  let bestScore = 0

  if (objectScore > bestScore) {
    bestType = 'object'
    bestScore = objectScore
  }
  if (arrayScore > bestScore) {
    bestType = 'array'
    bestScore = arrayScore
  }
  if (stringScore > bestScore) {
    bestType = 'string'
    bestScore = stringScore
  }
  if (integerScore > bestScore) {
    bestType = 'integer'
    bestScore = integerScore
  }
  if (numberScore > bestScore) {
    bestType = 'number'
    bestScore = numberScore
  }
  if (booleanScore > bestScore) {
    bestType = 'boolean'
    bestScore = booleanScore
  }
  if (nullScore > bestScore) {
    bestType = 'null'
  }

  return bestType
}

/**
 * Parses a raw schema object into a validated SchemaObject.
 *
 * Performance: this function iterates the input keys exactly once. During that single pass,
 * shared keywords are parsed directly into the result, type-specific keyword presence is
 * tallied using lightweight integer counters (no allocations), and vendor extensions are captured.
 *
 * After the pass, the type is either used as provided or inferred from the accumulated scores.
 * Type-specific keywords are then parsed via direct property access on the original input,
 * avoiding redundant iteration. This reduces the worst case from ~10 full iterations over all
 * keys down to 1 pass plus targeted property reads.
 */
const parseSchemaNode = (value: Record<string, unknown>): SchemaObject => {
  const result: ParsedSchemaObject = {}

  // Lightweight counters for type inference. Each tracks how many valid keywords
  // of that category are present, used to compute normalized scores later.
  let objectCount = 0
  let arrayCount = 0
  let stringCount = 0
  let numericCount = 0

  for (const key in value) {
    const v = value[key]

    switch (key) {
      // --- Shared: string fields ---
      case 'name':
      case 'title':
      case 'description':
        if (typeof v === 'string') result[key] = v
        break

      // --- Shared: type (inlined parseSchemaType to avoid function call) ---
      case 'type':
        if (isPrimitiveSchemaType(v)) {
          result.type = v
        } else if (Array.isArray(v)) {
          const types: PrimitiveSchemaType[] = []
          for (let i = 0; i < v.length; i++) {
            if (isPrimitiveSchemaType(v[i])) types.push(v[i] as PrimitiveSchemaType)
          }
          if (types.length > 0) result.type = types
        }
        break

      // --- Shared: format (Set-based O(1) lookup instead of ~30 comparison chains) ---
      case 'format':
        if (typeof v === 'string') {
          if (STRING_FORMATS.has(v)) result.format = v as StringFormat
          else if (NUMERIC_FORMATS.has(v)) result.format = v as NumericFormat
          else result.format = v as StringFormat // Preserve unknown formats
        }
        break

      // --- Shared: pass-through values ---
      case 'default':
      case 'const':
      case 'example':
        result[key] = v
        break

      // --- Shared: array values ---
      case 'enum':
      case 'examples':
        if (Array.isArray(v)) result[key] = v
        break

      // --- Shared: boolean flags ---
      case 'deprecated':
      case 'readOnly':
      case 'writeOnly':
        if (typeof v === 'boolean') result[key] = v
        break

      // --- Shared: plain object values ---
      case 'discriminator':
      case 'xml':
      case 'externalDocs':
        if (isObject(v)) result[key] = v
        break

      // --- Shared: single schema-or-reference ---
      case 'not':
      case 'if':
      case 'then':
      case 'else': {
        const parsed = parseSchemaOrReference(v)
        if (parsed !== undefined) result[key] = parsed
        break
      }

      // --- Shared: schema arrays ---
      case 'allOf':
      case 'oneOf':
      case 'anyOf': {
        const parsed = parseSchemaArray(v)
        if (parsed !== undefined) result[key] = parsed
        break
      }

      // --- Shared: schema record ---
      case '$defs':
        if (isObject(v)) {
          result.$defs = parseSchemaRecord(v)
        }
        break

      // --- Object keywords: lightweight scoring for inference, full parsing deferred ---
      case 'maxProperties':
      case 'minProperties':
        if (isNonNegativeInteger(v)) objectCount++
        break

      case 'required':
        if (Array.isArray(v)) objectCount++
        break

      case 'properties':
      case 'patternProperties':
      case 'dependentSchemas':
      case 'propertyNames':
        if (isObject(v)) objectCount++
        break

      case 'additionalProperties':
        if (typeof v === 'boolean' || isObject(v)) objectCount++
        break

      case 'unevaluatedProperties':
        if (typeof v === 'boolean' || isObject(v)) objectCount++
        break

      // --- Array keywords: lightweight scoring for inference, full parsing deferred ---
      case 'maxItems':
      case 'minItems':
      case 'maxContains':
      case 'minContains':
        if (isNonNegativeInteger(v)) arrayCount++
        break

      case 'uniqueItems':
        if (typeof v === 'boolean') arrayCount++
        break

      case 'items':
      case 'contains':
        if (isObject(v)) arrayCount++
        break

      case 'prefixItems':
        if (Array.isArray(v)) arrayCount++
        break

      case 'unevaluatedItems':
        if (typeof v === 'boolean' || isObject(v)) arrayCount++
        break

      // --- String keywords: lightweight scoring for inference, full parsing deferred ---
      case 'maxLength':
      case 'minLength':
        if (isNonNegativeInteger(v)) stringCount++
        break

      case 'pattern':
      case 'contentMediaType':
      case 'contentEncoding':
        if (typeof v === 'string') stringCount++
        break

      case 'contentSchema':
        if (isObject(v)) stringCount++
        break

      // --- Numeric keywords: lightweight scoring for inference, full parsing deferred ---
      case 'multipleOf':
      case 'maximum':
      case 'exclusiveMaximum':
      case 'minimum':
      case 'exclusiveMinimum':
        if (typeof v === 'number') numericCount++
        break

      // --- Vendor extensions (x-*) and unrecognized keys ---
      default:
        // charCode checks avoid string allocation from startsWith.
        // 120 = 'x', 45 = '-'
        if (key.charCodeAt(0) === 120 && key.charCodeAt(1) === 45) {
          result[key as `x-${string}`] = v
        }
        break
    }
  }

  // Determine the schema type, inferring from keyword scores if not explicitly provided.
  let parsedType = result.type

  if (parsedType === undefined) {
    const inferred = inferSchemaType(objectCount, arrayCount, stringCount, numericCount, result)
    if (inferred !== undefined) {
      result.type = inferred
      parsedType = inferred
    }
  }

  // Parse type-specific keywords via targeted direct property access.
  // Uses boolean flags to avoid duplicate parsing when multi-type arrays
  // contain overlapping categories (e.g. ['number', 'integer']).
  if (parsedType !== undefined) {
    if (Array.isArray(parsedType)) {
      let hasObject = false
      let hasArray = false
      let hasString = false
      let hasNumeric = false
      for (let i = 0; i < parsedType.length; i++) {
        switch (parsedType[i]) {
          case 'object':
            hasObject = true
            break
          case 'array':
            hasArray = true
            break
          case 'string':
            hasString = true
            break
          case 'number':
          case 'integer':
            hasNumeric = true
            break
        }
      }

      if (hasObject) parseObjectKeywordsDirect(value, result)
      if (hasArray) parseArrayKeywordsDirect(value, result)
      if (hasString) parseStringKeywordsDirect(value, result)
      if (hasNumeric) parseNumericKeywordsDirect(value, result)
    } else {
      switch (parsedType) {
        case 'object':
          parseObjectKeywordsDirect(value, result)
          break
        case 'array':
          parseArrayKeywordsDirect(value, result)
          break
        case 'string':
          parseStringKeywordsDirect(value, result)
          break
        case 'number':
        case 'integer':
          parseNumericKeywordsDirect(value, result)
          break
      }
    }
  }

  return result as SchemaObject
}

/**
 * Parses an unknown input into a validated SchemaObject.
 * Returns an empty SchemaObject for non-plain-object inputs.
 * If the input contains only a $ref property, it is returned as-is to preserve the reference.
 */
export const parseSchemaObject = (input: unknown): SchemaObject => {
  if (!isObject(input)) return {} as SchemaObject

  // If the input has a $ref property, return it as-is to preserve the reference
  if (typeof input['$ref'] === 'string') {
    return input as unknown as SchemaObject
  }

  return parseSchemaNode(input)
}
