export type PrimitiveSchemaType = 'null' | 'boolean' | 'string' | 'number' | 'integer' | 'object' | 'array'

export type StringFormat =
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

export type NumericFormat =
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

export type Extensions = Record<`x-${string}`, unknown>

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
  allOf?: (boolean | SchemaObject)[]
  oneOf?: (boolean | SchemaObject)[]
  anyOf?: (boolean | SchemaObject)[]
  not?: boolean | SchemaObject
  if?: boolean | SchemaObject
  then?: boolean | SchemaObject
  else?: boolean | SchemaObject
  $defs?: Record<string, boolean | SchemaObject>
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
  contentSchema?: boolean | SchemaObject
}

type ArrayKeywords = {
  items?: boolean | SchemaObject
  prefixItems?: (boolean | SchemaObject)[]
  maxItems?: number
  minItems?: number
  uniqueItems?: boolean
  contains?: boolean | SchemaObject
  maxContains?: number
  minContains?: number
  unevaluatedItems?: boolean | SchemaObject
}

type ObjectKeywords = {
  maxProperties?: number
  minProperties?: number
  required?: string[]
  properties?: Record<string, boolean | SchemaObject>
  additionalProperties?: boolean | SchemaObject
  patternProperties?: Record<string, boolean | SchemaObject>
  dependentSchemas?: Record<string, boolean | SchemaObject>
  propertyNames?: boolean | SchemaObject
  unevaluatedProperties?: boolean | SchemaObject
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

export type MultiTypeObject = SharedProperties &
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
