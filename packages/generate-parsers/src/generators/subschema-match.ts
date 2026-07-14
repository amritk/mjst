import { escapeRegexPattern } from '@amritk/helpers/escape-regex-pattern'
import { multipleOfPassExpr } from '@amritk/helpers/multiple-of-check'
import { safeAccessor } from '@amritk/helpers/safe-accessor'
import {
  hasAdditionalProperties,
  hasConst,
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
  hasRequired,
  hasType,
  hasUniqueItems,
  isSchemaObject,
} from '@amritk/helpers/schema-guards'
import type { JSONSchema } from 'json-schema-typed/draft-2020-12'

import { generateEnumCheck } from './generate-enum-check'

/**
 * Keywords `subschemaMatchExpr` reads and enforces. A subschema carrying any
 * keyword outside this set (and the annotation set below) cannot be matched
 * *exactly*, so the matcher bails to `null` and the generation-time guard turns
 * that into a hard error rather than a permissive parser.
 */
const HANDLED_KEYWORDS: ReadonlySet<string> = new Set([
  'type',
  'enum',
  'const',
  'pattern',
  'minLength',
  'maxLength',
  'minimum',
  'maximum',
  'exclusiveMinimum',
  'exclusiveMaximum',
  'multipleOf',
  'minItems',
  'maxItems',
  'uniqueItems',
  'items',
  'required',
  'properties',
  'minProperties',
  'maxProperties',
  'additionalProperties',
])

/**
 * Keywords that only annotate (Ajv, our differential oracle, does not assert on
 * them under `strict: false`), so their presence never blocks an exact match.
 * `format` is annotation-only in 2020-12 by default, matching the oracle.
 */
const ANNOTATION_KEYWORDS: ReadonlySet<string> = new Set([
  'title',
  'description',
  '$comment',
  '$id',
  '$schema',
  '$anchor',
  '$vocabulary',
  '$defs',
  'definitions',
  'examples',
  'default',
  'deprecated',
  'readOnly',
  'writeOnly',
  'format',
  'contentMediaType',
  'contentEncoding',
  'contentSchema',
])

const isObjectExpr = (acc: string): string => `typeof ${acc} === "object" && ${acc} !== null && !Array.isArray(${acc})`

/** True when `additionalProperties` is a constraining (non-boolean) schema. */
const hasSchemaAdditionalProperties = (schema: JSONSchema): boolean =>
  hasAdditionalProperties(schema) &&
  typeof (schema as { additionalProperties: unknown }).additionalProperties !== 'boolean'

/**
 * String-family constraint checks (no type assertion). Every JSON Schema string
 * keyword only asserts on string instances, so these are combined with a
 * `typeof === "string"` — either as the assertion (a `type: 'string'` schema) or
 * as a guard (`typeof !== "string" || …` for a type-less schema).
 */
const stringConstraints = (acc: string, schema: JSONSchema): string[] => {
  const c: string[] = []
  if (hasPattern(schema)) c.push(`/${escapeRegexPattern(schema.pattern)}/.test(${acc})`)
  if (hasMinLength(schema)) c.push(`${acc}.length >= ${schema.minLength}`)
  if (hasMaxLength(schema)) c.push(`${acc}.length <= ${schema.maxLength}`)
  return c
}

/** Number-family constraint checks (no type assertion). `integer` requires an explicit type. */
const numberConstraints = (acc: string, schema: JSONSchema, integer: boolean): string[] => {
  const c: string[] = []
  if (integer) c.push(`Number.isInteger(${acc})`)
  if (hasMinimum(schema)) c.push(`${acc} >= ${schema.minimum}`)
  if (hasMaximum(schema)) c.push(`${acc} <= ${schema.maximum}`)
  if (hasExclusiveMinimum(schema)) c.push(`${acc} > ${schema.exclusiveMinimum}`)
  if (hasExclusiveMaximum(schema)) c.push(`${acc} < ${schema.exclusiveMaximum}`)
  if (hasMultipleOf(schema)) c.push(multipleOfPassExpr(acc, schema.multipleOf))
  return c
}

/** Array-family constraint checks (no `Array.isArray` assertion). `null` when an item schema is unprovable. */
const arrayConstraints = (acc: string, schema: JSONSchema, depth: number): string[] | null => {
  const c: string[] = []
  if (hasMinItems(schema)) c.push(`${acc}.length >= ${schema.minItems}`)
  if (hasMaxItems(schema)) c.push(`${acc}.length <= ${schema.maxItems}`)
  if (hasUniqueItems(schema) && schema.uniqueItems === true) {
    c.push(`new Set((${acc} as unknown[]).map((_u) => JSON.stringify(_u))).size === ${acc}.length`)
  }
  if (hasItems(schema)) {
    if (Array.isArray(schema.items)) return null
    const el = `_i${depth}`
    const itemMatch = subschemaMatchExpr(el, schema.items, depth + 1)
    if (itemMatch === null) return null
    if (itemMatch !== 'true') c.push(`(${acc} as unknown[]).every((${el}) => ${itemMatch})`)
  }
  return c
}

/** Object-family constraint checks (no object-type assertion). `null` when a property schema is unprovable. */
const objectConstraints = (acc: string, schema: JSONSchema, depth: number): string[] | null => {
  // A schema-valued additionalProperties record would leave record values unproven.
  if (hasSchemaAdditionalProperties(schema)) return null

  const c: string[] = []
  const required = new Set<string>(hasRequired(schema) ? schema.required : [])

  if (hasProperties(schema)) {
    for (const [key, propSchema] of Object.entries(schema.properties)) {
      const propAcc = safeAccessor(acc, key)
      const propMatch = subschemaMatchExpr(propAcc, propSchema as JSONSchema, depth + 1)
      if (propMatch === null) return null
      if (required.has(key)) {
        c.push(
          propMatch === 'true'
            ? `${JSON.stringify(key)} in ${acc}`
            : `(${JSON.stringify(key)} in ${acc} && ${propMatch})`,
        )
      } else if (propMatch !== 'true') {
        c.push(`(${propAcc} === undefined || ${propMatch})`)
      }
      required.delete(key)
    }
  }
  for (const key of required) c.push(`${JSON.stringify(key)} in ${acc}`)

  if (hasMinProperties(schema)) c.push(`Object.keys(${acc}).length >= ${schema.minProperties}`)
  if (hasMaxProperties(schema)) c.push(`Object.keys(${acc}).length <= ${schema.maxProperties}`)

  if (hasAdditionalProperties(schema) && (schema as { additionalProperties: unknown }).additionalProperties === false) {
    const allowed = JSON.stringify(hasProperties(schema) ? Object.keys(schema.properties) : [])
    c.push(`Object.keys(${acc}).every((_k) => ${allowed}.includes(_k))`)
  }

  return c
}

/**
 * Builds a boolean expression that is `true` *exactly* when `accessor` matches
 * `schema` — sound in **both** directions (true ⇒ valid, false ⇒ invalid) — or
 * `null` when the schema uses a form this generator cannot prove inline.
 *
 * This is deliberately self-contained: it never emits a `$ref` shape-validator
 * call (those can be conservative `=> false` stubs, which would break false-
 * soundness) and never touches combinators. That keeps the expression usable
 * both for *counting* matches (`contains`) and for *rejecting* non-matches
 * (`propertyNames`, `dependentSchemas`) in strict mode, where a wrong verdict
 * would silently accept or reject a document. Anything richer returns `null`,
 * and `assertNoUnsupportedKeywords` turns that into a generation-time error.
 *
 * Constraint keywords apply per JSON Schema semantics: a `pattern`/`maxLength`
 * with no `type` still constrains string instances (and is a no-op for other
 * types), so a type-less schema guards each family by its runtime type rather
 * than ignoring it — the subtlety `propertyNames: { maxLength: 3 }` depends on.
 *
 * `depth` seeds the `.every` element variable so nested array matches never
 * shadow one another.
 */
export const subschemaMatchExpr = (accessor: string, schema: JSONSchema, depth = 0): string | null => {
  // Boolean schemas: `true` matches everything, `false` matches nothing.
  if (schema === true) return 'true'
  if (schema === false) return 'false'
  if (!isSchemaObject(schema)) return null

  // Any keyword we neither handle nor know to be a pure annotation could narrow
  // the value set; matching would then be unsound, so bail.
  for (const key of Object.keys(schema)) {
    if (!HANDLED_KEYWORDS.has(key) && !ANNOTATION_KEYWORDS.has(key)) return null
  }

  // An array-form `type` (multi-type / nullable) is a disjunction we do not
  // prove inline here; `hasType` is false for it, so without this it would fall
  // through to a permissive result.
  if ('type' in schema && typeof schema.type !== 'string') return null

  const checks: string[] = []

  // `const` — a single exact value. Primitives compare with `===`; a structural
  // const would need deep equality, which this flat matcher does not attempt.
  if (hasConst(schema)) {
    const c = schema.const
    if (c !== null && typeof c === 'object') return null
    checks.push(`${accessor} === ${JSON.stringify(c)}`)
  }

  // `enum` — membership in a fixed set (generateEnumCheck is exact).
  if (hasEnum(schema)) {
    if (schema.enum.length === 0) return null
    checks.push(generateEnumCheck(accessor, schema.enum))
  }

  if (hasType(schema)) {
    const typeChecks = buildTypedChecks(accessor, schema, depth)
    if (typeChecks === null) return null
    checks.push(...typeChecks)
  } else {
    const typeless = buildTypelessChecks(accessor, schema, depth)
    if (typeless === null) return null
    checks.push(...typeless)
  }

  // A schema with no proven constraint matches every value.
  if (checks.length === 0) return 'true'
  return checks.length === 1 ? (checks[0] as string) : `(${checks.join(' && ')})`
}

/** Type assertion plus that type's constraints, for a single-`type` schema. */
const buildTypedChecks = (accessor: string, schema: JSONSchema & { type: string }, depth: number): string[] | null => {
  switch (schema.type) {
    case 'string':
      return [`typeof ${accessor} === "string"`, ...stringConstraints(accessor, schema)]
    case 'number':
      return [`typeof ${accessor} === "number"`, ...numberConstraints(accessor, schema, false)]
    case 'integer':
      return [`typeof ${accessor} === "number"`, ...numberConstraints(accessor, schema, true)]
    case 'boolean':
      return [`typeof ${accessor} === "boolean"`]
    case 'null':
      return [`${accessor} === null`]
    case 'array': {
      const constraints = arrayConstraints(accessor, schema, depth)
      if (constraints === null) return null
      return [`Array.isArray(${accessor})`, ...constraints]
    }
    case 'object': {
      const constraints = objectConstraints(accessor, schema, depth)
      if (constraints === null) return null
      return [isObjectExpr(accessor), ...constraints]
    }
    default:
      return null
  }
}

/**
 * Constraints on a schema with no `type`: each family only asserts on instances
 * of its type, so guard each present family by its runtime type. A value of a
 * different type satisfies the family vacuously.
 */
const buildTypelessChecks = (accessor: string, schema: JSONSchema, depth: number): string[] | null => {
  const checks: string[] = []

  const strChecks = stringConstraints(accessor, schema)
  if (strChecks.length > 0) checks.push(`(typeof ${accessor} !== "string" || ${joinAnd(strChecks)})`)

  const numChecks = numberConstraints(accessor, schema, false)
  if (numChecks.length > 0) checks.push(`(typeof ${accessor} !== "number" || ${joinAnd(numChecks)})`)

  const arrChecks = arrayConstraints(accessor, schema, depth)
  if (arrChecks === null) return null
  if (arrChecks.length > 0) checks.push(`(!Array.isArray(${accessor}) || ${joinAnd(arrChecks)})`)

  const objChecks = objectConstraints(accessor, schema, depth)
  if (objChecks === null) return null
  if (objChecks.length > 0) checks.push(`(!(${isObjectExpr(accessor)}) || ${joinAnd(objChecks)})`)

  return checks
}

const joinAnd = (checks: string[]): string => (checks.length === 1 ? (checks[0] as string) : `(${checks.join(' && ')})`)

/**
 * Whether {@link subschemaMatchExpr} can build an exact matcher for `schema`.
 * The generation-time guard uses this to decide whether a `contains`,
 * `propertyNames`, or `dependentSchemas` subschema is enforceable.
 */
export const canMatchSubschema = (schema: JSONSchema): boolean => subschemaMatchExpr('_x', schema) !== null
