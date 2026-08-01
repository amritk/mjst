import { escapeRegexPattern } from '@amritk/helpers/escape-regex-pattern'
import { getMjstInstanceOf, getMjstPrimitive } from '@amritk/helpers/mjst-extension'
import { multipleOfFailExpr } from '@amritk/helpers/multiple-of-check'
import { quoteJsString } from '@amritk/helpers/quote-js-string'
import { resolveRef } from '@amritk/helpers/resolve-ref'
import { safeAccessor } from '@amritk/helpers/safe-accessor'
import {
  hasConst,
  hasDependentRequired,
  hasEnum,
  hasExclusiveMaximum,
  hasExclusiveMinimum,
  hasItems,
  hasMaxItems,
  hasMaximum,
  hasMaxLength,
  hasMaxProperties,
  hasMinItems,
  hasMinimum,
  hasMinLength,
  hasMinProperties,
  hasMultipleOf,
  hasPattern,
  hasProperties,
  hasPropertyNames,
  hasRef,
  hasRequired,
  hasType,
  hasUniqueItems,
  isSchemaObject,
} from '@amritk/helpers/schema-guards'
import { maxLengthFailExpr, minLengthFailExpr } from '@amritk/helpers/string-length-check'
import type { JSONSchema } from 'json-schema-typed/draft-2020-12'

import { generateDeepEqualCheck } from './generate-deep-equal-check'
import { generateEnumCheck } from './generate-enum-check'
import {
  canEnforceUnion,
  generateUnionCheck,
  getUnionBranches,
  isExclusiveUnion,
  isInlineObjectProperty,
  multiTypeCheck,
} from './generate-type-checks'
import { generateUniqueItemsCheck } from './generate-unique-items-check'
import {
  everyTailItem,
  getPrefixItems,
  prefixItemsCapsLength,
  scalarItemTypeCheck,
} from './generate-validation-expression'
import { hasConstrainingRefSibling, type MatchContext, subschemaMatchExpr } from './subschema-match'

/**
 * Context for assertions that reach beyond the property's own schema: union
 * membership checks may call imported `validate{X}Shape` predicates ($ref
 * branches), which requires knowing the ref-import mode, the type-name suffix,
 * and the root document (to prove those validators are real — see
 * canEnforceUnion). `stripUnknown` disables union enforcement entirely, since
 * shape validators then treat undeclared keys as a mismatch while the
 * stripUnknown contract is to drop them.
 */
export type StrictAssertionContext = {
  readonly useRefImports?: boolean
  readonly suffix?: string
  readonly rootSchema?: Record<string, unknown>
  readonly stripUnknown?: boolean
}

/** The matcher's view of an assertion context: just the document its `$ref`s resolve against. */
const matchContext = (context: StrictAssertionContext): MatchContext =>
  context.rootSchema ? { rootSchema: context.rootSchema } : {}

/**
 * Constraint keywords that only bite when the node declares a `type` the typed
 * assertion pass recognizes. A schema carrying one *without* a `type`
 * (`{ minimum: 5 }`, `{ pattern: 'a' }`) reaches no typed pass at all, so it used
 * to be asserted by nothing — the backstop is what covers it.
 */
const TYPELESS_CONSTRAINT_KEYWORDS: readonly string[] = [
  'minimum',
  'maximum',
  'exclusiveMinimum',
  'exclusiveMaximum',
  'multipleOf',
  'minLength',
  'maxLength',
  'pattern',
  'minItems',
  'maxItems',
  'uniqueItems',
  'items',
  'prefixItems',
  'contains',
]

/**
 * The object-family counterpart. These are split out because a type-less node
 * that *does* declare `properties` is generated as an object parser, which
 * asserts them — it is only the property-less form (`{ required: ['a'] }`,
 * `{ minProperties: 2 }`) that lands on the scalar path and used to assert
 * nothing at all.
 */
const TYPELESS_OBJECT_KEYWORDS: readonly string[] = [
  'required',
  'minProperties',
  'maxProperties',
  'propertyNames',
  'patternProperties',
  'additionalProperties',
  'dependentRequired',
  'dependentSchemas',
]

/**
 * Why a node needs the whole-schema backstop, or `null` when the specialized
 * assertions above already cover it. Each reason is a keyword whose enforcement
 * no per-property / per-type check can express:
 *
 *  - `unevaluated*` depends on which *other* keywords evaluated which keys, so it
 *    can only be answered against the whole node at once.
 *  - a `$ref` is normally enforced by the parser generated for its target, but
 *    that delegation covers neither an inlined build (no ref imports) nor the
 *    2020-12 rule that a `$ref`'s *siblings* still apply.
 *  - `items: false` (with no tuple positions) admits only the empty array, and
 *    the item-check builder reads `items` through a guard that a boolean fails.
 *  - a constraint keyword with no `type` never reaches the typed constraint pass.
 */
export const backstopReason = (schema: JSONSchema, context: StrictAssertionContext): string | null => {
  if (!isSchemaObject(schema)) return null
  const record = schema as Record<string, unknown>

  if ('unevaluatedProperties' in record && record['unevaluatedProperties'] !== true) return 'unevaluatedProperties'
  if ('unevaluatedItems' in record && record['unevaluatedItems'] !== true) return 'unevaluatedItems'

  if (hasRef(schema) && (!context.useRefImports || hasConstrainingRefSibling(schema))) return '$ref'

  if (record['items'] === false && !Array.isArray(record['prefixItems'])) return 'items'

  if (!('type' in record)) {
    if (TYPELESS_CONSTRAINT_KEYWORDS.some((keyword) => keyword in record)) return 'constraints'
    if (!('properties' in record) && TYPELESS_OBJECT_KEYWORDS.some((keyword) => keyword in record)) return 'constraints'
    return null
  }

  // An array-form `type` carries each family's constraints for *its own* branch
  // (`{ type: ['string','array'], minLength: 3, minItems: 2 }` bounds the string
  // by length and the array by count). The typed pass can only fold those into a
  // single-typed view when exactly one non-null type is left, so anything wider
  // needs the matcher.
  if (Array.isArray(record['type'])) {
    const nonNull = (record['type'] as unknown[]).filter((type) => type !== 'null')
    const constrains =
      TYPELESS_CONSTRAINT_KEYWORDS.some((keyword) => keyword in record) ||
      TYPELESS_OBJECT_KEYWORDS.some((keyword) => keyword in record)
    if (nonNull.length > 1 && constrains) return 'constraints'
  }

  return null
}

/** The failure message for each backstop reason — vague beats wrong, but not by much. */
const backstopMessage = (reason: string, label: string): string => {
  switch (reason) {
    case 'unevaluatedProperties':
      return `${label} must NOT have unevaluated properties`
    case 'unevaluatedItems':
      return `${label} must NOT have unevaluated items`
    case '$ref':
      return `${label} does not satisfy the referenced schema`
    default:
      return `${label} does not satisfy the schema`
  }
}

/**
 * The strict-mode backstop: a single whole-node match, emitted only for the
 * keywords {@link backstopReason} identifies as unreachable by the specialized
 * assertions. It is the same exact matcher `contains` and `propertyNames` use, so
 * a `true` verdict means valid and a `false` one means invalid — which is what
 * lets it stand alone as the enforcement for those keywords.
 *
 * Emitting nothing here is only safe because `assertNoUnsupportedKeywords`
 * refuses generation for any node that needs a backstop the matcher cannot
 * build.
 */
export const generateBackstopAssertion = (
  acc: string,
  schema: JSONSchema,
  label: string,
  context: StrictAssertionContext,
  optional = false,
): string[] => {
  const reason = backstopReason(schema, context)
  if (reason === null) return []
  const match = subschemaMatchExpr(acc, schema, matchContext(context))
  if (match === null || match === 'true') return []
  const failure = throwError(backstopMessage(reason, label))
  return [optional ? `  if (${acc} !== undefined && !(${match})) ${failure};` : `  if (!(${match})) ${failure};`]
}

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
    case 'null':
      // Missing from this switch historically, which meant a null-typed
      // property was never enforced on the assertion path — the strict-mode
      // differential fuzzer caught non-null values sailing through.
      return `${accessor} !== null`
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
 * contain schema-controlled text (property names, patterns, enum values), so
 * it goes through the shared {@link quoteJsString} escape-or-quote decision.
 * `suffixExpr`, when given, is a runtime expression appended to the message
 * (e.g. `typeof input`).
 */
const throwError = (message: string, suffixExpr?: string): string => {
  const literal = quoteJsString(message)
  return suffixExpr ? `throw new Error(${literal} + (${suffixExpr}))` : `throw new Error(${literal})`
}

/**
 * Generates strict-mode constraint checks for a typed property
 * (pattern, length, min/max, multipleOf).
 */
const generateConstraintChecks = (
  acc: string,
  propSchema: JSONSchema,
  field: string,
  context: StrictAssertionContext = {},
): string[] => {
  if (!isSchemaObject(propSchema) || !hasType(propSchema)) return []
  const t = propSchema.type as string
  const lines: string[] = []

  if (t === 'string') {
    if (hasPattern(propSchema)) {
      const pattern = escapeRegexPattern(propSchema.pattern)
      lines.push(
        `  if (typeof ${acc} === "string" && !/${pattern}/.test(${acc})) ${throwError(`${field} must match pattern ${propSchema.pattern}`)};`,
      )
    }
    // Lengths count code points, not UTF-16 units: `"💩".length` is 2, so a raw
    // `.length` accepted it against `minLength: 2` and rejected `"💩💩"` against
    // `maxLength: 2` — both the opposite of what Ajv (and the interpreter) do.
    if (hasMinLength(propSchema)) {
      lines.push(
        `  if (typeof ${acc} === "string" && ${minLengthFailExpr(acc, propSchema.minLength)}) ${throwError(`${field} must have at least ${propSchema.minLength} characters`)};`,
      )
    }
    if (hasMaxLength(propSchema)) {
      lines.push(
        `  if (typeof ${acc} === "string" && ${maxLengthFailExpr(acc, propSchema.maxLength)}) ${throwError(`${field} must have at most ${propSchema.maxLength} characters`)};`,
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
      // Structural dedupe, matching the interpreter and Ajv: see
      // generateUniqueItemsCheck for why a raw `JSON.stringify` key (which is
      // key-order sensitive) let `[{a:1,b:2},{b:2,a:1}]` through.
      lines.push(
        `  if (Array.isArray(${acc}) && !(${generateUniqueItemsCheck(acc, propSchema)})) ${throwError(`${field} must NOT have duplicate items`)};`,
      )
    }
    // Item types: the fast path proves them via `.every`, but this slow path
    // used to check only length/uniqueness, letting e.g. a number slip into a
    // declared `string[]`. Enforce scalar and enum item schemas here; richer
    // item schemas ($refs, objects) are validated by their own parsers. The
    // `items` tail starts after the `prefixItems` positions (see everyTailItem),
    // which generatePrefixItemsAssertion asserts against their own subschemas.
    const itemCheck = generateItemCheck(propSchema, context)
    if (itemCheck) {
      lines.push(
        `  if (Array.isArray(${acc}) && !${everyTailItem(acc, itemCheck.check, propSchema)}) ${throwError(`${field} ${itemCheck.message}`)};`,
      )
    }
    // Tuple `prefixItems`: assert each position and cap length under items:false.
    lines.push(...generatePrefixItemsAssertion(acc, field, propSchema, context))
  }

  if (t === 'object') {
    lines.push(...generateObjectSizeChecks(acc, propSchema, field, true))
  }

  return lines
}

/**
 * Strict-mode `minProperties` / `maxProperties`. Both were read by the coercing
 * expression builder and the subschema matcher but by nothing on the strict
 * path, so a strict parser accepted `{}` against `{ minProperties: 2 }` — at the
 * root, on a property, and inside the empty-object/record parsers alike. `guard`
 * wraps the comparison in a runtime `isObject` for accessors whose type is
 * reported separately; callers that have already proven an object pass `false`.
 */
export const generateObjectSizeChecks = (acc: string, schema: JSONSchema, label: string, guard: boolean): string[] => {
  if (!isSchemaObject(schema)) return []
  const lines: string[] = []
  const prefix = guard ? `isObject(${acc}) && ` : ''
  if (hasMinProperties(schema)) {
    lines.push(
      `  if (${prefix}Object.keys(${acc}).length < ${schema.minProperties}) ${throwError(`${label} must have at least ${schema.minProperties} properties`)};`,
    )
  }
  if (hasMaxProperties(schema)) {
    lines.push(
      `  if (${prefix}Object.keys(${acc}).length > ${schema.maxProperties}) ${throwError(`${label} must have at most ${schema.maxProperties} properties`)};`,
    )
  }
  return lines
}

/**
 * Boolean per-item check (bound to `_it`) for an array schema's `items`, with
 * the error-message fragment describing what was expected. Scalar types and
 * enums get their direct check; anything richer that {@link subschemaMatchExpr}
 * can prove exactly (a nested array, a plain object shape, a bounded string)
 * falls back to that matcher — without it `{ items: { type: 'array', items:
 * { type: 'number' } } }` had no element check at all and a strict parser
 * accepted `[["x"]]`. Items with their own parser (`$ref`, inline objects) are
 * left out: those are validated by the parser the caller delegates to.
 */
const generateItemCheck = (
  schema: JSONSchema,
  context: StrictAssertionContext,
): { check: string; message: string } | null => {
  if (!isSchemaObject(schema) || !hasItems(schema) || Array.isArray(schema.items)) return null
  const items = schema.items

  if (isSchemaObject(items) && hasEnum(items) && items.enum.length > 0) {
    const label = (items.enum as unknown[]).map((v) => JSON.stringify(v)).join(', ')
    return { check: generateEnumCheck('_it', items.enum), message: `items must be one of: ${label}` }
  }

  const scalarCheck = scalarItemTypeCheck(items, '_it')
  if (scalarCheck !== null && isSchemaObject(items) && hasType(items)) {
    return { check: scalarCheck, message: `items expected ${typeLabel(items.type as string)}` }
  }

  // A `$ref` item is validated by the parser the caller delegates to — but only
  // when this build imports those parsers. Without ref imports nothing else
  // checks the elements, so `{ type: 'array', items: { $ref: … } }` accepted an
  // array of anything.
  if ((hasRef(items) && context.useRefImports === true) || isInlineObjectProperty(items)) return null
  const match = subschemaMatchExpr('_it', items, matchContext(context))
  if (match === null || match === 'true') return null
  return { check: match, message: 'items do not match the item schema' }
}

/**
 * A `["object", "null"]` value that is not null still has to satisfy the
 * schema's `properties` / `required` / `additionalProperties`, and nothing
 * asserted them: the multi-type branch only proves the value *is* an object and
 * {@link generateConstraintChecks} has no property pass, so
 * `{ type: ['object','null'], properties: { z: { type: 'string' } },
 * required: ['z'] }` accepted `{}` and `{ z: 1 }` alike. The single-typed view
 * goes through the exact matcher; a null value is excluded from the test since
 * the type disjunction already blessed it.
 */
const nullableObjectShapeChecks = (
  acc: string,
  schema: JSONSchema,
  type: string,
  label: string,
  optional: boolean,
  context: StrictAssertionContext,
): string[] => {
  if (type !== 'object') return []
  const match = subschemaMatchExpr(acc, { ...(schema as object), type: 'object' } as JSONSchema, matchContext(context))
  if (match === null || match === 'true') return []
  const presence = optional ? `${acc} !== undefined && ${acc} !== null` : `${acc} !== null`
  return [`  if (${presence} && !(${match})) ${throwError(`${label} does not match the declared object shape`)};`]
}

/**
 * Strict-mode `not`: the value must NOT match the excluded subschema. Enforced
 * whenever {@link subschemaMatchExpr} can prove the subschema exactly (the same
 * bar `contains` / `propertyNames` / `dependentSchemas` clear); an unprovable
 * one is rejected at generation time by the guard, so a strict parser never
 * silently drops the constraint. `not: false` excludes nothing and emits no check.
 */
const generateNotCheck = (
  acc: string,
  schema: JSONSchema,
  label: string,
  optional: boolean,
  context: StrictAssertionContext,
): string[] => {
  if (!isSchemaObject(schema) || !('not' in schema)) return []
  const match = subschemaMatchExpr(acc, (schema as Record<string, unknown>)['not'] as JSONSchema, matchContext(context))
  if (match === null || match === 'false') return []
  const failure = throwError(`${label} must NOT match the excluded schema`)
  return [optional ? `  if (${acc} !== undefined && (${match})) ${failure};` : `  if (${match}) ${failure};`]
}

/**
 * Strict-mode `allOf` members that carry constraints rather than an object
 * shape: `{ allOf: [{ minLength: 3 }] }` and `{ allOf: [{ type: 'number',
 * minimum: 5 }] }` were enforced by nothing — {@link inlineAllOfMembers} only
 * covers members with `properties`/`required` (asserted per property, with
 * better messages) and a `$ref` member is enforced by its own parser. Everything
 * else goes through the exact matcher, or is left alone when it cannot be proven
 * (the generation-time guard reports that case).
 */
const generateAllOfChecks = (
  acc: string,
  schema: JSONSchema,
  label: string,
  optional: boolean,
  context: StrictAssertionContext,
  skipInlineMembers = false,
): string[] => {
  if (!isSchemaObject(schema) || !Array.isArray(schema.allOf)) return []
  // Only the object assertion re-asserts the inline members property by property;
  // every other caller (a property, a type-less root) has no such pass, so
  // skipping them there would leave `{ allOf: [{ …object… }] }` unenforced.
  const handledInline = new Set<JSONSchema>(skipInlineMembers ? inlineAllOfMembers(schema) : [])
  const lines: string[] = []
  for (const member of schema.allOf) {
    if (handledInline.has(member)) continue
    // A `$ref` member is enforced by the parser generated for its target — but
    // only where an object parser actually spreads that parser's result, which
    // it does only for a schema with `properties`. A property-less
    // `{ allOf: [{ $ref: '#/$defs/a' }] }` lands on the empty-object parser,
    // which delegates nothing, so it accepted anything at all.
    const delegated = context.useRefImports === true && hasProperties(schema) && !hasConstrainingRefSibling(member)
    if (isSchemaObject(member) && hasRef(member) && delegated) continue
    const match = subschemaMatchExpr(acc, member, matchContext(context))
    if (match === null || match === 'true') continue
    const failure = throwError(`${label} does not satisfy all of the declared schemas`)
    lines.push(optional ? `  if (${acc} !== undefined && !(${match})) ${failure};` : `  if (!(${match})) ${failure};`)
  }
  return lines
}

/**
 * Strict-mode `if` / `then` / `else`: when the value matches `if`, it must also
 * match `then`; otherwise it must match `else`. Emitted only when every branch
 * present can be proven exactly — a half-checked conditional would be worse than
 * none, and the generation-time guard reports the unprovable case. A bare `if`
 * with neither `then` nor `else` constrains nothing.
 */
const generateConditionalChecks = (
  acc: string,
  schema: JSONSchema,
  label: string,
  context: StrictAssertionContext,
): string[] => {
  if (!isSchemaObject(schema)) return []
  const record = schema as Record<string, unknown>
  if (!('if' in record) || (!('then' in record) && !('else' in record))) return []
  const ifMatch = subschemaMatchExpr(acc, record['if'] as JSONSchema, matchContext(context))
  if (ifMatch === null) return []

  const lines: string[] = []
  if ('then' in record) {
    const thenMatch = subschemaMatchExpr(acc, record['then'] as JSONSchema, matchContext(context))
    if (thenMatch === null) return []
    if (thenMatch !== 'true') {
      lines.push(`  if ((${ifMatch}) && !(${thenMatch})) ${throwError(`${label} does not satisfy the 'then' schema`)};`)
    }
  }
  if ('else' in record) {
    const elseMatch = subschemaMatchExpr(acc, record['else'] as JSONSchema, matchContext(context))
    if (elseMatch === null) return []
    if (elseMatch !== 'true') {
      lines.push(
        `  if (!(${ifMatch}) && !(${elseMatch})) ${throwError(`${label} does not satisfy the 'else' schema`)};`,
      )
    }
  }
  return lines
}

/**
 * Strict-mode value checks for keys the schema constrains by *pattern* rather
 * than by name: `patternProperties` (every key matching the regex) and a
 * schema-valued `additionalProperties` (every key matched by neither
 * `properties` nor a pattern). Both were read only by the *building* code paths
 * — which coerce or copy — so a strict parser accepted `{ s_a: 1 }` against
 * `patternProperties: { '^s_': { type: 'string' } }`.
 *
 * One `Object.keys` walk covers both, and a term is emitted only when
 * {@link subschemaMatchExpr} proves its subschema exactly. `additionalProperties:
 * false` is not handled here — that is the unknown-key rejection the parsers
 * already emit.
 */
export const generateKeyedValueChecks = (
  obj: string,
  schema: JSONSchema,
  label: string,
  context: StrictAssertionContext = {},
): string[] => {
  if (!isSchemaObject(schema)) return []
  const record = schema as Record<string, unknown>
  const patternEntries: [string, string][] = []
  const patternSource = record['patternProperties']
  if (typeof patternSource === 'object' && patternSource !== null && !Array.isArray(patternSource)) {
    for (const [pattern, sub] of Object.entries(patternSource as Record<string, unknown>)) {
      const match = subschemaMatchExpr('_v', sub as JSONSchema, matchContext(context))
      if (match === null || match === 'true') continue
      patternEntries.push([pattern, match])
    }
  }

  // The `additionalProperties` term has to know the *whole* key vocabulary — all
  // declared names and all declared patterns, including the ones whose own
  // subschema was too complex to check above — or it would police keys that
  // another keyword owns.
  const allPatterns =
    typeof patternSource === 'object' && patternSource !== null && !Array.isArray(patternSource)
      ? Object.keys(patternSource as Record<string, unknown>)
      : []
  const additional = record['additionalProperties']
  const additionalMatch =
    additional !== undefined && typeof additional !== 'boolean'
      ? subschemaMatchExpr('_v', additional as JSONSchema, matchContext(context))
      : null

  const lines: string[] = []
  for (const [pattern, match] of patternEntries) {
    lines.push(
      `    if (/${escapeRegexPattern(pattern)}/.test(_k) && !(${match})) ${throwError(`${label} invalid value for property `, '_k')};`,
    )
  }
  if (additionalMatch !== null && additionalMatch !== 'true') {
    const declared = hasProperties(schema) ? Object.keys(schema.properties as Record<string, unknown>) : []
    const guards: string[] = []
    if (declared.length > 0) guards.push(`!${JSON.stringify(declared)}.includes(_k)`)
    for (const pattern of allPatterns) guards.push(`!/${escapeRegexPattern(pattern)}/.test(_k)`)
    const prefix = guards.length > 0 ? `${guards.join(' && ')} && ` : ''
    lines.push(`    if (${prefix}!(${additionalMatch})) ${throwError(`${label} invalid value for property `, '_k')};`)
  }

  if (lines.length === 0) return []
  return [
    `  for (const _k of Object.keys(${obj})) {`,
    `    const _v = (${obj} as Record<string, unknown>)[_k];`,
    ...lines,
    `  }`,
  ]
}

/**
 * Strict-mode `contains` / `minContains` / `maxContains`: at least `minContains`
 * (default 1) and at most `maxContains` (default ∞) items of the array must
 * match the `contains` subschema. Runtime-gated on `Array.isArray` so a
 * non-array value is left to the type check, and wrapped in a block so the
 * per-array count variable never collides with a sibling check. `minContains: 0`
 * makes the lower bound trivially satisfied. Emits nothing when there is no
 * `contains` or its subschema is not matchable inline (the generation-time guard
 * rejects the latter, so a strict parser never silently drops the constraint).
 */
export const generateContainsCheck = (
  acc: string,
  schema: JSONSchema,
  label: string,
  context: StrictAssertionContext = {},
): string[] => {
  if (!isSchemaObject(schema)) return []
  const sp = schema as Record<string, unknown>
  if (!('contains' in sp)) return []
  const match = subschemaMatchExpr('_c', sp['contains'] as JSONSchema, matchContext(context))
  if (match === null) return []
  const min = typeof sp['minContains'] === 'number' ? (sp['minContains'] as number) : 1
  const max = typeof sp['maxContains'] === 'number' ? (sp['maxContains'] as number) : undefined
  const bound = max !== undefined ? `_cn < ${min} || _cn > ${max}` : `_cn < ${min}`
  return [
    `  if (Array.isArray(${acc})) {`,
    `    const _cn = (${acc} as unknown[]).filter((_c) => ${match}).length;`,
    `    if (${bound}) ${throwError(`${label} array does not contain the required matching items`)};`,
    `  }`,
  ]
}

/**
 * Strict-mode `dependentRequired`: when a trigger key is present, every declared
 * dependency key must be present too.
 */
const generateDependentRequiredChecks = (obj: string, schema: JSONSchema, label: string): string[] => {
  if (!hasDependentRequired(schema)) return []
  const lines: string[] = []
  for (const [trigger, deps] of Object.entries(schema.dependentRequired)) {
    if (!Array.isArray(deps)) continue
    for (const dep of deps) {
      lines.push(
        `  if (${JSON.stringify(trigger)} in ${obj} && !(${JSON.stringify(dep)} in ${obj})) ${throwError(`${label} must have property '${dep}' when '${trigger}' is present`)};`,
      )
    }
  }
  return lines
}

/**
 * Strict-mode `dependentSchemas` (2020-12): when a trigger property is present,
 * the *whole object* must also match the associated subschema. A `true`
 * subschema is a no-op; a `false` subschema makes the trigger's presence always
 * invalid. Object subschemas are enforced via {@link subschemaMatchExpr}; a
 * subschema it cannot match inline is rejected at generation time by the guard.
 */
const generateDependentSchemasChecks = (
  obj: string,
  schema: JSONSchema,
  label: string,
  context: StrictAssertionContext,
): string[] => {
  const dep = (schema as Record<string, unknown>)['dependentSchemas']
  if (typeof dep !== 'object' || dep === null || Array.isArray(dep)) return []
  const lines: string[] = []
  for (const [trigger, sub] of Object.entries(dep as Record<string, unknown>)) {
    if (sub === true) continue
    if (sub === false) {
      lines.push(
        `  if (${JSON.stringify(trigger)} in ${obj}) ${throwError(`${label} must NOT have property '${trigger}'`)};`,
      )
      continue
    }
    const match = subschemaMatchExpr(obj, sub as JSONSchema, matchContext(context))
    if (match === null || match === 'true') continue
    lines.push(
      `  if (${JSON.stringify(trigger)} in ${obj} && !(${match})) ${throwError(`${label} does not satisfy the schema required when '${trigger}' is present`)};`,
    )
  }
  return lines
}

/**
 * Resolves a tuple position's schema through a single `$ref` (via `rootSchema`)
 * so the assertion can read its `type`/`enum`. A `$ref` with no resolvable target
 * (or no root document) is returned as-is, leaving the position unasserted.
 */
const resolvePositionSchema = (pos: JSONSchema, rootSchema: Record<string, unknown> | undefined): JSONSchema => {
  if (isSchemaObject(pos) && hasRef(pos) && rootSchema) {
    const resolved = resolveRef((pos as { $ref: string }).$ref, rootSchema)
    if (resolved) return resolved as JSONSchema
  }
  return pos
}

/**
 * Strict-mode assertion lines for a tuple `prefixItems`: each present position is
 * asserted against its subschema (a scalar type, an enum, or a `$ref`/inline
 * schema resolved to one via `rootSchema`), and a sibling `items: false` /
 * `additionalItems: false` rejects any extra element. `acc` is the array
 * accessor and `field` the error-message prefix (`[Type] field 'k'` or
 * `[Type]`). Mirrors the validators' tuple pass, but throws on the first
 * violation instead of collecting errors. Positions whose schema is richer than
 * a scalar/enum are left to their own downstream handling (like array `items`).
 */
const generatePrefixItemsAssertion = (
  acc: string,
  field: string,
  schema: JSONSchema,
  context: StrictAssertionContext,
): string[] => {
  const rootSchema = context.rootSchema
  const prefix = getPrefixItems(schema)
  if (!prefix) return []
  const lines: string[] = []

  for (let i = 0; i < prefix.length; i++) {
    const pos = resolvePositionSchema(prefix[i] as JSONSchema, rootSchema)
    const el = `${acc}[${i}]`
    // A shorter input simply has no element at this position — `prefixItems`
    // does not require presence (that is `minItems`' job), so guard on length.
    const present = `Array.isArray(${acc}) && ${acc}.length > ${i}`

    if (isSchemaObject(pos) && hasEnum(pos) && pos.enum.length > 0) {
      const label = (pos.enum as unknown[]).map((v) => JSON.stringify(v)).join(', ')
      lines.push(
        `  if (${present} && !${generateEnumCheck(el, pos.enum)}) ${throwError(`${field}[${i}] must be one of: ${label}`)};`,
      )
      continue
    }

    if (isSchemaObject(pos) && hasType(pos)) {
      const pt = pos.type as string
      const wrong = wrongTypeCondition(el, pt)
      if (wrong) {
        lines.push(
          `  if (${present} && (${wrong})) ${throwError(`${field}[${i}] expected ${typeLabel(pt)}, got `, `typeof ${el}`)};`,
        )
      }
    }

    // The type check above proves only the position's `type`; everything else it
    // declares (`maxLength` on a tuple's string slot, a nested object shape, a
    // `$ref` target's constraints) went unchecked. The exact matcher covers the
    // whole position — including the `$ref` the type branch could only follow one
    // level — and is skipped only when it cannot prove the subschema.
    const match = subschemaMatchExpr(el, prefix[i] as JSONSchema, matchContext(context))
    if (match !== null && match !== 'true') {
      lines.push(`  if (${present} && !(${match})) ${throwError(`${field}[${i}] does not match the tuple schema`)};`)
    }
  }

  if (prefixItemsCapsLength(schema)) {
    lines.push(
      `  if (Array.isArray(${acc}) && ${acc}.length > ${prefix.length}) ${throwError(`${field} must NOT have more than ${prefix.length} items`)};`,
    )
  }

  return lines
}

/**
 * Strict-mode `propertyNames`: every own key of the object (keys are always
 * strings) must satisfy the name subschema. A trivially-true matcher imposes no
 * constraint, so no loop is emitted; an unmatchable subschema is rejected at
 * generation time by the guard.
 */
const generatePropertyNameChecks = (
  obj: string,
  schema: JSONSchema,
  label: string,
  context: StrictAssertionContext,
): string[] => {
  if (!hasPropertyNames(schema) || !isSchemaObject(schema.propertyNames)) return []
  const match = subschemaMatchExpr('_name', schema.propertyNames, matchContext(context))
  if (match === null || match === 'true') return []
  return [
    `  for (const _name of Object.keys(${obj})) {`,
    `    if (!(${match})) ${throwError(`${label} invalid property name: `, '_name')};`,
    `  }`,
  ]
}

/**
 * The composition checks (`not`, `allOf`, `if`/`then`/`else`) for a value the
 * caller has already proven present. Exported for the specialized object parsers
 * (empty-object, pattern-properties, additionalProperties), which build their
 * result outside {@link generateObjectStrictAssertion} and so would otherwise
 * emit no composition check at all.
 */
export const generateCompositionChecks = (
  acc: string,
  schema: JSONSchema,
  label: string,
  context: StrictAssertionContext = {},
): string[] => [
  ...generateNotCheck(acc, schema, label, false, context),
  ...generateAllOfChecks(acc, schema, label, false, context),
  ...generateConditionalChecks(acc, schema, label, context),
]

/**
 * Emits the object-level keyword checks (`dependentRequired`, `dependentSchemas`,
 * `propertyNames`) for the object reached by `obj`. When `guard` is true the
 * whole block is wrapped in a runtime `isObject` check — used for object-typed
 * *properties*, whose value may be absent or a non-object (the type check
 * reports that separately). The root object and inline sub-parsers pass
 * `guard = false` because the enclosing parser has already proven the value is
 * an object.
 */
export const generateObjectKeywordChecks = (
  obj: string,
  schema: JSONSchema,
  label: string,
  guard: boolean,
  context: StrictAssertionContext = {},
): string[] => {
  if (!isSchemaObject(schema)) return []
  const inner = [
    ...generateDependentRequiredChecks(obj, schema, label),
    ...generateDependentSchemasChecks(obj, schema, label, context),
    ...generatePropertyNameChecks(obj, schema, label, context),
  ]
  if (inner.length === 0) return []
  if (!guard) return inner
  return [`  if (isObject(${obj})) {`, ...inner.map((line) => `  ${line}`), `  }`]
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
  context: StrictAssertionContext = {},
): string[] => {
  const acc = safeAccessor('input', key)
  const field = `[${typeName}] field '${key}'`
  const lines: string[] = []

  if (isRequired) {
    lines.push(
      `  if (!(${JSON.stringify(key)} in input)) ${throwError(`[${typeName}] missing required property '${key}'`)};`,
    )
  }

  // A `false` property schema admits no value at all, so the key must be absent.
  // The early return below skipped both boolean schemas, which made `false` a
  // silent no-op.
  if (propSchema === false) {
    lines.push(`  if (${JSON.stringify(key)} in input) ${throwError(`[${typeName}] must NOT have property '${key}'`)};`)
    return lines
  }
  if (!isSchemaObject(propSchema)) return lines

  // The whole-node backstop rides ahead of every branch below — including the
  // `$ref` bail — because most of them return early: a property carrying
  // `unevaluated*`, a `$ref` no imported parser enforces, or a type-less
  // constraint would otherwise leave that keyword asserted by nothing.
  lines.push(...generateBackstopAssertion(acc, propSchema, field, context, !isRequired))

  if (hasRef(propSchema)) return lines

  // Composition keywords that constrain the value alongside (or instead of) its
  // `type`. Emitted before the branches below because several of them return
  // early, and `not`/`allOf`/`if` can ride on any of those shapes.
  lines.push(...generateNotCheck(acc, propSchema, field, !isRequired, context))
  lines.push(...generateAllOfChecks(acc, propSchema, field, !isRequired, context))
  lines.push(...generateConditionalChecks(acc, propSchema, field, context))

  // Union properties: enforce membership when every branch check is
  // false-sound (canEnforceUnion), so a value matching no variant throws
  // instead of passing through untyped. Left unenforced (pass-through, the
  // historical behavior) when any branch is too complex to check safely.
  const unionBranches = getUnionBranches(propSchema)
  if (unionBranches) {
    if (!context.stripUnknown && canEnforceUnion(unionBranches, context.rootSchema)) {
      const check = generateUnionCheck(
        acc,
        unionBranches,
        context.useRefImports ?? false,
        context.suffix ?? '',
        isExclusiveUnion(propSchema),
      )
      if (check !== null) {
        const failure = throwError(`${field} does not match any allowed variant`)
        lines.push(
          isRequired ? `  if (!(${check})) ${failure};` : `  if (${acc} !== undefined && !(${check})) ${failure};`,
        )
      }
    }
    return lines
  }

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

  // `const` pins the property to one exact value. Nothing on the strict path
  // read it — only the fast-path guard did, and a guard that merely *declines*
  // sends the value here — so `{ a: { const: 'x' } }` accepted `{ a: 'y' }`.
  // Compared structurally (like the root path) so an object/array `const`,
  // which no `===` could ever match, is enforced rather than skipped.
  if (hasConst(propSchema)) {
    const equal = generateDeepEqualCheck(acc, propSchema.const)
    const failure = throwError(`${field} must be ${JSON.stringify(propSchema.const)}`)
    lines.push(isRequired ? `  if (!(${equal})) ${failure};` : `  if (${acc} !== undefined && !(${equal})) ${failure};`)
    return lines
  }

  if (hasEnum(propSchema)) {
    const member = generateEnumCheck(acc, propSchema.enum)
    const label = (propSchema.enum as unknown[]).map((v) => JSON.stringify(v)).join(', ')
    if (isRequired) {
      lines.push(`  if (!${member}) ${throwError(`${field} must be one of: ${label}`)};`)
    } else {
      lines.push(`  if (${acc} !== undefined && !${member}) ${throwError(`${field} must be one of: ${label}`)};`)
    }
    return lines
  }

  // Array-form `type` (multi-type / nullable, e.g. `["string","null"]`). `hasType`
  // is false for it, so without this branch a strict parser emitted no check at
  // all and handed back whatever it was given under a `string | null` signature.
  const multiType = multiTypeCheck(acc, propSchema, { ignoreConstraints: true })
  if (multiType !== undefined) {
    const types = propSchema.type as string[]
    if (multiType !== null) {
      const expected = throwError(`${field} expected ${types.map(typeLabel).join(' | ')}, got `, `typeof ${acc}`)
      lines.push(
        isRequired ? `  if (!${multiType}) ${expected};` : `  if (${acc} !== undefined && !${multiType}) ${expected};`,
      )
    }
    // "Nullable T" — the overwhelmingly common array-`type` shape — still carries
    // T's constraints, so run them against a single-typed view of the schema.
    // Every constraint check is already guarded on the value's runtime shape
    // (`typeof x === "string" && …`, `Array.isArray(x) && …`), so a null value
    // passes them all untouched and needs no extra guard.
    const nonNull = types.filter((type) => type !== 'null')
    if (nonNull.length === 1) {
      lines.push(...generateConstraintChecks(acc, { ...propSchema, type: nonNull[0] } as JSONSchema, field, context))
      lines.push(...nullableObjectShapeChecks(acc, propSchema, nonNull[0] as string, field, !isRequired, context))
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
    lines.push(...generateConstraintChecks(acc, propSchema, field, context))
  }

  // Type-independent constraints, each runtime-gated on the value's shape:
  //   - `contains` asserts on arrays (no-op otherwise),
  //   - the object-level keywords assert on objects.
  // Gated on a single `isSchemaObject` + a few `in` checks so a plain scalar
  // property — the common case — skips the costlier `isInlineObjectProperty`
  // probe and the check builders entirely. Inline object properties are
  // deep-validated by their own sub-parser (which runs these same object-level
  // checks), so emitting them here too would be premature and redundant.
  if (isSchemaObject(propSchema)) {
    const r = propSchema as Record<string, unknown>
    if ('contains' in r) lines.push(...generateContainsCheck(acc, propSchema, field, context))
    if (
      ('dependentRequired' in r || 'dependentSchemas' in r || 'propertyNames' in r) &&
      !isInlineObjectProperty(propSchema)
    ) {
      lines.push(...generateObjectKeywordChecks(acc, propSchema, field, true, context))
    }
    // Pattern-/additional-property value checks, guarded on the value being an
    // object (the type check reports a non-object separately). Inline object
    // properties are excluded for `patternProperties` by construction, so this
    // is the only place these reach a nested object property.
    if ('patternProperties' in r || (isSchemaObject(propSchema) && typeof r['additionalProperties'] === 'object')) {
      const keyed = generateKeyedValueChecks(acc, propSchema, field, context)
      if (keyed.length > 0) {
        lines.push(`  if (isObject(${acc})) {`, ...keyed.map((line) => `  ${line}`), `  }`)
      }
    }
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
/**
 * The `allOf` members this assertion must enforce itself: plain object schemas
 * written inline. A `$ref` member is enforced by the parser generated for its
 * target, and a member that composes further (nested `allOf`/`oneOf`/`if`) is
 * left alone rather than half-checked.
 */
export const inlineAllOfMembers = (schema: JSONSchema): JSONSchema[] => {
  if (!isSchemaObject(schema) || !Array.isArray(schema.allOf)) return []
  return schema.allOf.filter((member): member is JSONSchema => {
    if (!isSchemaObject(member) || hasRef(member)) return false
    const record = member as Record<string, unknown>
    if ('allOf' in record || 'oneOf' in record || 'anyOf' in record || 'not' in record) return false
    if ('if' in record || 'then' in record || 'else' in record) return false
    return hasProperties(member) || hasRequired(member)
  })
}

export const generateObjectStrictAssertion = (
  schema: JSONSchema,
  typeName: string,
  context: StrictAssertionContext = {},
): string[] => {
  const lines: string[] = []
  lines.push(
    `  if (!isObject(input)) ${throwError(`[${typeName}] expected object, got `, 'input === null ? "null" : typeof input')};`,
  )

  if (!isSchemaObject(schema)) return lines

  const required = new Set<string>(hasRequired(schema) ? schema.required : [])

  if (hasProperties(schema)) {
    const props = schema.properties as Record<string, JSONSchema>
    for (const key in props) {
      lines.push(...generatePropertyAssertion(key, props[key] as JSONSchema, required.has(key), typeName, context))
    }
    for (const key in props) required.delete(key)
  }

  // A `required` entry with no declared property still demands the key. Only the
  // per-property loop above emitted presence checks, so these went unenforced —
  // the inline-object union check has always covered the same case.
  for (const key of required) {
    lines.push(
      `  if (!(${JSON.stringify(key)} in input)) ${throwError(`[${typeName}] missing required property '${key}'`)};`,
    )
  }

  // `allOf` members written inline (rather than as a `$ref`, which the referenced
  // parser validates on its own) contribute properties and `required` keys just
  // like the schema's own. They were skipped entirely, so a strict parser
  // accepted documents the schema rejects — and the emitted type intersects them
  // in, so it promised fields nothing checked.
  for (const member of inlineAllOfMembers(schema)) {
    lines.push(...generateObjectStrictAssertion(member, typeName, context).slice(1))
  }

  // Object-level keywords for the object itself. `input` is already proven an
  // object above, so no runtime guard is needed. Emitted even when the schema
  // has no `properties` (e.g. a constrained-key map: `{ type: 'object',
  // propertyNames: {...} }`). Gated on a cheap presence check so a keyword-free
  // object skips the three check builders.
  const sr = schema as Record<string, unknown>
  if ('dependentRequired' in sr || 'dependentSchemas' in sr || 'propertyNames' in sr) {
    lines.push(...generateObjectKeywordChecks('input', schema, `[${typeName}]`, false, context))
  }

  // `input` is proven an object above, so these need no runtime guard.
  lines.push(...generateObjectSizeChecks('input', schema, `[${typeName}]`, false))
  lines.push(...generateNotCheck('input', schema, `[${typeName}]`, false, context))
  lines.push(...generateAllOfChecks('input', schema, `[${typeName}]`, false, context, true))
  lines.push(...generateConditionalChecks('input', schema, `[${typeName}]`, context))
  lines.push(...generateKeyedValueChecks('input', schema, `[${typeName}]`, context))
  lines.push(...generateBackstopAssertion('input', schema, `[${typeName}]`, context))

  return lines
}

/**
 * Generates the strict-mode assertion lines for a non-object (scalar, array,
 * type-less) parser. Returns null when the schema constrains nothing this
 * generator can assert on, which is the caller's cue to emit a bare cast.
 */
export const generateScalarStrictAssertion = (
  schema: JSONSchema,
  typeName: string,
  context: StrictAssertionContext = {},
): string | null => {
  // A `false` schema matches nothing, so a strict parser for it must reject
  // every value — it used to fall through to "no type information" and hand back
  // an unchecked cast. (`true` matches everything and needs no assertion.)
  if (schema === false) return `  ${throwError(`[${typeName}] schema is false: no value is valid`)};`

  const got = 'input === null ? "null" : typeof input'

  const instanceOf = getMjstInstanceOf(schema)
  if (instanceOf) {
    return `  if (!(input instanceof ${instanceOf})) ${throwError(`[${typeName}] expected ${instanceOf}, got `, got)};`
  }

  const primitive = getMjstPrimitive(schema)
  if (primitive) {
    return `  if (typeof input !== "${primitive}") ${throwError(`[${typeName}] expected ${primitive}, got `, got)};`
  }

  if (!isSchemaObject(schema)) return null

  const label = `[${typeName}]`
  const lines: string[] = []

  // `const` / `enum` apply to a root value regardless of a declared `type` — a
  // root `{ enum: [...] }` or `{ const: ... }` must reject a non-member, not
  // silently coerce it. Both compare *structurally* against the known literal:
  // `JSON.stringify(input) !== '{"a":1,"b":2}'` rejected a reordered-but-equal
  // object, and `.includes` could never match an object member at all.
  if (hasConst(schema)) {
    lines.push(
      `  if (!(${generateDeepEqualCheck('input', schema.const)})) ${throwError(`${label} must be ${JSON.stringify(schema.const)}`)};`,
    )
  } else if (hasEnum(schema)) {
    const enumLabel = (schema.enum as unknown[]).map((v) => JSON.stringify(v)).join(', ')
    lines.push(
      `  if (!${generateEnumCheck('input', schema.enum)}) ${throwError(`${label} must be one of: ${enumLabel}`)};`,
    )
  }

  // Composition at the root. A type-less `{ not: … }` / `{ allOf: […] }` /
  // `{ if: …, then: … }` root used to reach the "nothing to assert" bail below
  // and return a validation-free cast.
  lines.push(...generateNotCheck('input', schema, label, false, context))
  lines.push(...generateAllOfChecks('input', schema, label, false, context))
  lines.push(...generateConditionalChecks('input', schema, label, context))

  // Array-form `type` at the root — same gap as the property path below.
  const rootMultiType = multiTypeCheck('input', schema, { ignoreConstraints: true })
  if (rootMultiType !== undefined) {
    const types = schema.type as string[]
    if (rootMultiType !== null) {
      lines.push(
        `  if (!${rootMultiType}) ${throwError(`${label} expected ${types.map(typeLabel).join(' | ')}, got `, got)};`,
      )
    }
    const nonNull = types.filter((type) => type !== 'null')
    if (nonNull.length === 1) {
      lines.push(...generateConstraintChecks('input', { ...schema, type: nonNull[0] } as JSONSchema, label, context))
      lines.push(...nullableObjectShapeChecks('input', schema, nonNull[0] as string, label, false, context))
    }
    lines.push(...generateBackstopAssertion('input', schema, label, context))
    return lines.length > 0 ? lines.join('\n') : null
  }

  if (hasType(schema)) {
    const t = schema.type as string
    const wrongType = wrongTypeCondition('input', t)
    if (wrongType) {
      lines.push(`  if (${wrongType}) ${throwError(`${label} expected ${typeLabel(t)}, got `, got)};`)
    }

    // Root-level arrays enforce scalar/enum item types too — the same gap the
    // property path closes in generateConstraintChecks — plus `contains`.
    // Item types and tuple positions are emitted by generateConstraintChecks
    // below (shared with the property path) — emitting them here as well put
    // every check in the file twice. `contains` has no property-path equivalent
    // at the root, so it stays.
    if (t === 'array') {
      lines.push(...generateContainsCheck('input', schema, label, context))
    }

    // String (pattern, min/maxLength), number/integer (bounds, multipleOf) and
    // array (length, uniqueItems) constraints — previously enforced only for
    // named properties, so a root scalar accepted e.g. `{type:'string',minLength:5}`
    // violations.
    lines.push(...generateConstraintChecks('input', schema, label, context))
  }

  // Keywords no branch above reaches — `unevaluated*`, a `$ref` whose target (or
  // whose siblings) nothing else asserts, `items: false`, a constraint with no
  // `type` to hang it on. A type-less `{ minimum: 5 }` root used to fall all the
  // way through to "nothing to assert" and hand back an unchecked cast.
  lines.push(...generateBackstopAssertion('input', schema, label, context))

  return lines.length > 0 ? lines.join('\n') : null
}
