import { FORMAT_CHECKS, NUMBER_FORMAT_CHECKS } from '@/interpreter/format-checks'
import { DATA_KEYWORDS, SCHEMA_MAPS } from '@/interpreter/keywords'

/**
 * A problem found in a *schema* — as opposed to in the data a schema describes.
 *
 * The interpreter is deliberately permissive about these at runtime, because
 * JSON Schema says to be: an unknown keyword is an annotation, and a keyword
 * whose value is the wrong shape is not an assertion. Both readings are correct
 * and both are silent, which is the problem — `{ required: 'name' }` and
 * `{ maxlength: 5 }` assert nothing at all, and a caller who wrote them believes
 * otherwise.
 *
 * So the permissiveness stays and the silence goes: {@link checkSchema} reports
 * what a schema fails to say, and `strict` turns that into a refusal to build.
 */
export type SchemaIssue = {
  /** JSON Pointer to the offending keyword inside the schema document. */
  readonly path: string
  /** The keyword at fault. */
  readonly keyword: string
  /** What is wrong with it, and what it costs. */
  readonly message: string
}

/** What a keyword's value has to be for the interpreter to act on it. */
type ValueKind =
  | 'string'
  | 'number'
  | 'boolean'
  | 'schema'
  | 'schema-map'
  | 'schema-array'
  | 'string-array'
  | 'array'
  | 'object'
  | 'any'

/** The JSON type a keyword constrains, for the keywords that constrain exactly one. */
type Family = 'string' | 'number' | 'array' | 'object'

type KeywordSpec = {
  readonly kind: ValueKind
  /** Also accepted, for a keyword whose draft-07 and 2020-12 spellings differ in shape. */
  readonly orKind?: ValueKind
  readonly family?: Family
  /** Whether the value must be a non-negative integer (the count and length bounds). */
  readonly nonNegativeInteger?: boolean
  /** Whether the value must be strictly positive (`multipleOf`). */
  readonly positive?: boolean
  /** Whether an empty array makes the keyword meaningless (`enum`). */
  readonly nonEmpty?: boolean
}

/**
 * Every keyword the interpreter reads, plus the annotations it deliberately
 * ignores, with the value each must carry.
 *
 * Kept in step by hand with the `switch` in `node-meta.ts`, which is where a
 * wrong-typed keyword is actually dropped: `check-schema.test.ts` holds the two
 * to each other by asserting that a keyword this table knows about and
 * `node-meta` narrows is reported when its value is wrong.
 */
const KEYWORDS: Readonly<Record<string, KeywordSpec>> = {
  // Core and identity.
  $schema: { kind: 'string' },
  $id: { kind: 'string' },
  $anchor: { kind: 'string' },
  $dynamicAnchor: { kind: 'string' },
  $recursiveAnchor: { kind: 'boolean' },
  $ref: { kind: 'string' },
  $dynamicRef: { kind: 'string' },
  $recursiveRef: { kind: 'string' },
  $vocabulary: { kind: 'object' },
  $comment: { kind: 'string' },
  $defs: { kind: 'schema-map' },
  definitions: { kind: 'schema-map' },

  // Annotations. Listed rather than left unknown so a typo of one is still caught.
  title: { kind: 'string' },
  description: { kind: 'string' },
  default: { kind: 'any' },
  deprecated: { kind: 'boolean' },
  readOnly: { kind: 'boolean' },
  writeOnly: { kind: 'boolean' },
  examples: { kind: 'array' },
  example: { kind: 'any' },
  format: { kind: 'string' },
  contentEncoding: { kind: 'string' },
  contentMediaType: { kind: 'string' },
  contentSchema: { kind: 'schema' },

  // OpenAPI's additions, which this interpreter either honours (`nullable`) or
  // carries as annotations.
  nullable: { kind: 'boolean' },
  discriminator: { kind: 'object' },
  xml: { kind: 'object' },
  externalDocs: { kind: 'object' },

  // Applicators.
  allOf: { kind: 'schema-array' },
  anyOf: { kind: 'schema-array' },
  oneOf: { kind: 'schema-array' },
  not: { kind: 'schema' },
  if: { kind: 'schema' },
  then: { kind: 'schema' },
  else: { kind: 'schema' },
  // 2020-12 makes `items` a single schema; draft-07 made it a schema or a tuple.
  items: { kind: 'schema', orKind: 'schema-array', family: 'array' },
  prefixItems: { kind: 'schema-array', family: 'array' },
  additionalItems: { kind: 'schema', family: 'array' },
  contains: { kind: 'schema', family: 'array' },
  unevaluatedItems: { kind: 'schema', family: 'array' },
  properties: { kind: 'schema-map', family: 'object' },
  patternProperties: { kind: 'schema-map', family: 'object' },
  additionalProperties: { kind: 'schema', family: 'object' },
  propertyNames: { kind: 'schema', family: 'object' },
  unevaluatedProperties: { kind: 'schema', family: 'object' },
  dependentSchemas: { kind: 'schema-map', family: 'object' },
  dependencies: { kind: 'object', family: 'object' },

  // Validation.
  type: { kind: 'string', orKind: 'string-array' },
  enum: { kind: 'array', nonEmpty: true },
  const: { kind: 'any' },
  multipleOf: { kind: 'number', family: 'number', positive: true },
  maximum: { kind: 'number', family: 'number' },
  minimum: { kind: 'number', family: 'number' },
  // The draft-04 spelling is a boolean modifier on a sibling bound, and the
  // interpreter honours both, so either shape is legitimate here.
  exclusiveMaximum: { kind: 'number', orKind: 'boolean', family: 'number' },
  exclusiveMinimum: { kind: 'number', orKind: 'boolean', family: 'number' },
  maxLength: { kind: 'number', family: 'string', nonNegativeInteger: true },
  minLength: { kind: 'number', family: 'string', nonNegativeInteger: true },
  pattern: { kind: 'string', family: 'string' },
  maxItems: { kind: 'number', family: 'array', nonNegativeInteger: true },
  minItems: { kind: 'number', family: 'array', nonNegativeInteger: true },
  maxContains: { kind: 'number', family: 'array', nonNegativeInteger: true },
  minContains: { kind: 'number', family: 'array', nonNegativeInteger: true },
  uniqueItems: { kind: 'boolean', family: 'array' },
  maxProperties: { kind: 'number', family: 'object', nonNegativeInteger: true },
  minProperties: { kind: 'number', family: 'object', nonNegativeInteger: true },
  required: { kind: 'string-array', family: 'object' },
  dependentRequired: { kind: 'object', family: 'object' },
}

/** The seven JSON type names, plus the `integer` refinement `type` also accepts. */
const TYPE_NAMES = new Set(['string', 'number', 'integer', 'boolean', 'null', 'object', 'array'])

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** A schema is an object or a boolean — both are legal subschemas in 2020-12. */
const isSchema = (value: unknown): boolean => isPlainObject(value) || typeof value === 'boolean'

const matchesKind = (value: unknown, kind: ValueKind): boolean => {
  switch (kind) {
    case 'any':
      return true
    case 'string':
      return typeof value === 'string'
    case 'number':
      return typeof value === 'number'
    case 'boolean':
      return typeof value === 'boolean'
    case 'array':
      return Array.isArray(value)
    case 'object':
      return isPlainObject(value)
    case 'schema':
      return isSchema(value)
    case 'schema-map':
      return isPlainObject(value) && Object.values(value).every(isSchema)
    case 'schema-array':
      return Array.isArray(value) && value.every(isSchema)
    case 'string-array':
      return Array.isArray(value) && value.every((entry) => typeof entry === 'string')
  }
}

/** A readable name for what a keyword should have been given. */
const KIND_NAMES: Readonly<Record<ValueKind, string>> = {
  any: 'any value',
  string: 'a string',
  number: 'a number',
  boolean: 'a boolean',
  array: 'an array',
  object: 'an object',
  schema: 'a schema (an object or a boolean)',
  'schema-map': 'an object whose values are schemas',
  'schema-array': 'an array of schemas',
  'string-array': 'an array of strings',
}

/** What the value actually is, for the other half of the message. */
const describe = (value: unknown): string => {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'an array'
  const type = typeof value
  return `${type === 'object' || type === 'undefined' ? 'an' : 'a'} ${type}`
}

/**
 * The types a node's `type` admits, or `null` when it declares none — in which
 * case every keyword is live and none is dead.
 */
const declaredTypes = (schema: Record<string, unknown>): Set<string> | null => {
  const type = schema['type']
  if (typeof type === 'string') return new Set([type])
  if (Array.isArray(type) && type.every((entry) => typeof entry === 'string')) return new Set(type as string[])
  return null
}

/** Whether a node whose `type` is `types` can ever be of the family `family` constrains. */
const familyIsLive = (types: Set<string>, family: Family): boolean => {
  if (family === 'number') return types.has('number') || types.has('integer')
  return types.has(family)
}

const escapePointer = (segment: string): string => segment.replace(/~/g, '~0').replace(/\//g, '~1')

/**
 * Reports what a schema fails to say.
 *
 * Four kinds of problem, all of which the interpreter otherwise passes over in
 * silence — which is correct per the specification and unhelpful in practice:
 *
 *  - **A keyword carrying the wrong kind of value.** `{ required: 'name' }`,
 *    `{ minLength: '5' }`, `{ properties: 'nope' }`. None of these is an
 *    assertion, so the schema enforces nothing where its author expected a
 *    constraint. This is the one that costs the most and shows the least.
 *  - **A keyword nobody recognizes.** `maxlength`, `requred`, `mincontains`.
 *    Unknown keywords are annotations by design, so a typo validates happily.
 *    Anything beginning `x-` is left alone: that is the extension convention,
 *    and flagging it would make the check unusable on an OpenAPI document.
 *  - **A value that makes the keyword meaningless.** `enum: []` matches nothing,
 *    `multipleOf: 0` divides by zero, a negative `minLength` bounds nothing.
 *  - **A constraint the node's own `type` has already ruled out.**
 *    `{ type: 'string', minimum: 3 }` — `minimum` says nothing about a string, so
 *    the bound never runs. Either the `type` or the keyword is wrong.
 *
 * Every subschema is walked, including through `$defs` and the schema maps.
 * `enum`, `const`, `default` and `examples` are not: their contents are instance
 * data, where a key called `properties` is a property name and not a keyword.
 *
 * The document is not resolved and no `$ref` is followed — this reads the schema
 * as written, which is what makes it a useful thing to run over one you are
 * *authoring*.
 */
export const checkSchema = (schema: unknown, options?: CheckSchemaOptions): SchemaIssue[] => {
  const issues: SchemaIssue[] = []
  const known =
    options?.extraFormats === undefined
      ? new Set(BUILT_IN_FORMATS)
      : new Set([...BUILT_IN_FORMATS, ...options.extraFormats])
  walk(schema, '', issues, known)
  return issues
}

/** Options for {@link checkSchema}. */
export type CheckSchemaOptions = {
  /**
   * `format` names to accept *in addition to* the built-ins — the names you have
   * registered as `customFormats`, or that another tool downstream will enforce.
   *
   * A built-in name is always accepted, whether or not this validator was asked
   * to check it: naming a format it does not enforce is a legitimate annotation,
   * while naming one nobody has ever heard of is a typo.
   */
  readonly extraFormats?: Iterable<string>
}

const BUILT_IN_FORMATS: readonly string[] = [...Object.keys(FORMAT_CHECKS), ...Object.keys(NUMBER_FORMAT_CHECKS)]

const walk = (schema: unknown, path: string, issues: SchemaIssue[], knownFormats: ReadonlySet<string>): void => {
  if (!isPlainObject(schema)) return

  const types = declaredTypes(schema)

  for (const keyword of Object.keys(schema)) {
    const value = schema[keyword]
    const keywordPath = `${path}/${escapePointer(keyword)}`
    const spec = Object.hasOwn(KEYWORDS, keyword) ? KEYWORDS[keyword] : undefined

    if (spec === undefined) {
      // `x-` is the extension convention; anything under it is the author's own.
      if (!keyword.startsWith('x-')) {
        issues.push({
          path: keywordPath,
          keyword,
          message: `Unknown keyword "${keyword}". It is treated as an annotation, so it constrains nothing — check the spelling.`,
        })
      }
      continue
    }

    if (!matchesKind(value, spec.kind) && (spec.orKind === undefined || !matchesKind(value, spec.orKind))) {
      const expected =
        spec.orKind === undefined
          ? KIND_NAMES[spec.kind]
          : `${KIND_NAMES[spec.kind]} or ${KIND_NAMES[spec.orKind as ValueKind]}`
      issues.push({
        path: keywordPath,
        keyword,
        message: `"${keyword}" must be ${expected}, but it is ${describe(value)}. A keyword the interpreter cannot read is not an assertion, so this constrains nothing.`,
      })
      continue
    }

    issues.push(...valueIssues(keyword, value, keywordPath, spec))

    // A `format` nobody defines is an annotation, exactly like an unknown
    // keyword, and just as silent — the field it was meant to constrain accepts
    // anything.
    if (keyword === 'format' && !knownFormats.has(value as string)) {
      issues.push({
        path: keywordPath,
        keyword,
        message: `Unknown format "${value as string}". Nothing defines it, so it constrains nothing — check the spelling, or register a checker for it with \`customFormats\`.`,
      })
    }

    if (types !== null && spec.family !== undefined && !familyIsLive(types, spec.family)) {
      issues.push({
        path: keywordPath,
        keyword,
        message: `"${keyword}" constrains ${spec.family === 'number' ? 'numbers' : `${spec.family}s`}, but this schema's "type" is ${JSON.stringify(schema['type'])}, so it can never apply.`,
      })
    }

    descend(keyword, value, keywordPath, issues, knownFormats)
  }

  issues.push(...nodeIssues(schema, path))
}

/**
 * The checks that need the whole node rather than one keyword: a keyword whose
 * *sibling* makes it inert, or a pair that cannot both be satisfied.
 */
const nodeIssues = (schema: Record<string, unknown>, path: string): SchemaIssue[] => {
  const issues: SchemaIssue[] = []

  // Draft-07's `additionalItems` describes the tail past an array-form `items`.
  // With no such sibling there are no positions for it to be the tail of, so it
  // is inert — and a `prefixItems` alongside it means the schema was half-ported
  // to 2020-12, where `items` is the tail keyword.
  if (Object.hasOwn(schema, 'additionalItems') && !Array.isArray(schema['items'])) {
    issues.push({
      path: `${path}/additionalItems`,
      keyword: 'additionalItems',
      message: Object.hasOwn(schema, 'prefixItems')
        ? '"additionalItems" is draft-07\'s tail keyword and needs an array-form "items" to be the tail of. Alongside "prefixItems" this is a half-ported schema: in 2020-12 the tail is "items".'
        : '"additionalItems" describes the items past an array-form "items", and there is no array-form "items" here, so it constrains nothing.',
    })
  }

  // A closed object cannot hold a property it does not declare, so requiring one
  // is a schema nothing satisfies.
  const required = schema['required']
  const properties = schema['properties']
  if (
    schema['additionalProperties'] === false &&
    Array.isArray(required) &&
    isPlainObject(properties) &&
    !isPlainObject(schema['patternProperties'])
  ) {
    for (const name of required) {
      if (typeof name === 'string' && !Object.hasOwn(properties, name)) {
        issues.push({
          path: `${path}/required`,
          keyword: 'required',
          message: `"${name}" is required but not declared in "properties", and "additionalProperties" is false — so no value can ever satisfy this schema.`,
        })
      }
    }
  }

  return issues
}

/** The per-keyword value checks that a kind alone does not cover. */
const valueIssues = (keyword: string, value: unknown, path: string, spec: KeywordSpec): SchemaIssue[] => {
  const issues: SchemaIssue[] = []

  if (spec.nonNegativeInteger && typeof value === 'number' && (!Number.isInteger(value) || value < 0)) {
    issues.push({ path, keyword, message: `"${keyword}" must be a non-negative integer, but it is ${value}.` })
  }
  if (spec.positive && typeof value === 'number' && !(value > 0)) {
    issues.push({ path, keyword, message: `"${keyword}" must be greater than 0, but it is ${value}.` })
  }
  if (spec.nonEmpty && Array.isArray(value) && value.length === 0) {
    issues.push({ path, keyword, message: `"${keyword}" is empty, so nothing can ever satisfy it.` })
  }
  if (keyword === 'type') {
    for (const name of typeof value === 'string' ? [value] : (value as string[])) {
      if (!TYPE_NAMES.has(name)) {
        issues.push({
          path,
          keyword,
          message: `"${name}" is not a JSON Schema type. Expected one of: ${[...TYPE_NAMES].join(', ')}.`,
        })
      }
    }
  }

  return issues
}

/**
 * Keywords whose value holds no subschema anywhere, so the walk stops at them.
 *
 * Each is a map or object with *author-chosen* or specification-chosen keys —
 * `$vocabulary` is keyed by vocabulary URI, `dependentRequired` by property name,
 * the OpenAPI objects by their own fields — and reading those keys as keywords
 * reports every one of them as unknown. The dialect metaschema is the proof: it
 * declares seven vocabularies, and the check flagged all seven.
 */
const OPAQUE_KEYWORDS = new Set(['$vocabulary', 'dependentRequired', 'discriminator', 'xml', 'externalDocs'])

/** Walks into whatever subschemas a keyword's value holds. */
const descend = (
  keyword: string,
  value: unknown,
  path: string,
  issues: SchemaIssue[],
  knownFormats: ReadonlySet<string>,
): void => {
  // `enum`, `const`, `default` and `examples` hold instance data, where a key
  // named `properties` is a property name rather than a keyword.
  if (DATA_KEYWORDS.has(keyword) || OPAQUE_KEYWORDS.has(keyword)) return

  // Draft-07 `dependencies` is a map whose values are *either* a schema or a
  // list of property names, so only the schema half is walked.
  if (keyword === 'dependencies' && isPlainObject(value)) {
    for (const name of Object.keys(value)) {
      const entry = value[name]
      if (!Array.isArray(entry)) walk(entry, `${path}/${escapePointer(name)}`, issues, knownFormats)
    }
    return
  }

  if (SCHEMA_MAPS.has(keyword) && isPlainObject(value)) {
    for (const name of Object.keys(value)) walk(value[name], `${path}/${escapePointer(name)}`, issues, knownFormats)
    return
  }

  if (Array.isArray(value)) {
    for (const [index, entry] of value.entries()) walk(entry, `${path}/${index}`, issues, knownFormats)
    return
  }

  walk(value, path, issues, knownFormats)
}

const SCHEMA_ERROR_NAME = 'SchemaError'

/**
 * The error `strict` throws when a schema does not say what its author meant.
 *
 * A plain `Error` with a recognizable `name` — so `instanceof Error` and
 * ordinary logging work — carrying the structured findings on `issues` for a
 * caller who wants to render them rather than read the message.
 */
export type SchemaError = Error & { readonly issues: readonly SchemaIssue[] }

/** Builds the error `strict` throws, listing every issue found. */
export const schemaError = (issues: readonly SchemaIssue[]): SchemaError => {
  const lines = issues.map(({ path, message }) => `  - ${path === '' ? '<root>' : path}: ${message}`)
  const error = new Error(`Schema has ${issues.length} problem${issues.length === 1 ? '' : 's'}:\n${lines.join('\n')}`)
  error.name = SCHEMA_ERROR_NAME
  return Object.assign(error, { issues })
}

/** Whether `value` is the error thrown for a schema that fails the `strict` check. */
export const isSchemaError = (value: unknown): value is SchemaError =>
  value instanceof Error && value.name === SCHEMA_ERROR_NAME
