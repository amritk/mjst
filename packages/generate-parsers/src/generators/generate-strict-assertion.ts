import { escapeRegexPattern } from '@amritk/helpers/escape-regex-pattern'
import { getMjstInstanceOf, getMjstPrimitive } from '@amritk/helpers/mjst-extension'
import { multipleOfFailExpr } from '@amritk/helpers/multiple-of-check'
import { quoteJsString } from '@amritk/helpers/quote-js-string'
import { resolveRef } from '@amritk/helpers/resolve-ref'
import { safeAccessor } from '@amritk/helpers/safe-accessor'
import {
  hasEnum,
  hasExclusiveMaximum,
  hasExclusiveMinimum,
  hasItems,
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

import { generateEnumCheck } from './generate-enum-check'
import { canEnforceUnion, generateUnionCheck, getUnionBranches } from './generate-type-checks'
import { getPrefixItems, prefixItemsCapsLength, scalarItemTypeCheck } from './generate-validation-expression'

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
  typeName: string,
  key: string,
  context: StrictAssertionContext = {},
): string[] => {
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
    // Item types: the fast path proves them via `.every`, but this slow path
    // used to check only length/uniqueness, letting e.g. a number slip into a
    // declared `string[]`. Enforce scalar and enum item schemas here; richer
    // item schemas ($refs, objects) are validated by their own parsers.
    const itemCheck = generateItemCheck(propSchema)
    if (itemCheck) {
      lines.push(
        `  if (Array.isArray(${acc}) && !${acc}.every((_it) => ${itemCheck.check})) ${throwError(`${field} ${itemCheck.message}`)};`,
      )
    }
    // Tuple `prefixItems`: assert each position and cap length under items:false.
    lines.push(...generatePrefixItemsAssertion(acc, field, propSchema, context.rootSchema))
  }

  return lines
}

/**
 * Boolean per-item check (bound to `_it`) for an array schema's `items`, with
 * the error-message fragment describing what was expected. Only scalar types
 * and enums are checked — returns null for anything richer.
 */
const generateItemCheck = (schema: JSONSchema): { check: string; message: string } | null => {
  if (!isSchemaObject(schema) || !hasItems(schema) || Array.isArray(schema.items)) return null
  const items = schema.items

  if (isSchemaObject(items) && hasEnum(items) && items.enum.length > 0) {
    const label = (items.enum as unknown[]).map((v) => JSON.stringify(v)).join(', ')
    return { check: generateEnumCheck('_it', items.enum), message: `items must be one of: ${label}` }
  }

  const scalarCheck = scalarItemTypeCheck(items, '_it')
  if (scalarCheck === null || !isSchemaObject(items) || !hasType(items)) return null
  return { check: scalarCheck, message: `items expected ${typeLabel(items.type as string)}` }
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
  rootSchema: Record<string, unknown> | undefined,
): string[] => {
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
      const allowed = JSON.stringify(pos.enum)
      const label = (pos.enum as unknown[]).map((v) => JSON.stringify(v)).join(', ')
      lines.push(
        `  if (${present} && !(${allowed} as readonly unknown[]).includes(${el})) ${throwError(`${field}[${i}] must be one of: ${label}`)};`,
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
  }

  if (prefixItemsCapsLength(schema)) {
    lines.push(
      `  if (Array.isArray(${acc}) && ${acc}.length > ${prefix.length}) ${throwError(`${field} must NOT have more than ${prefix.length} items`)};`,
    )
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

  if (!isSchemaObject(propSchema)) return lines
  if (hasRef(propSchema)) return lines

  // Union properties: enforce membership when every branch check is
  // false-sound (canEnforceUnion), so a value matching no variant throws
  // instead of passing through untyped. Left unenforced (pass-through, the
  // historical behavior) when any branch is too complex to check safely.
  const unionBranches = getUnionBranches(propSchema)
  if (unionBranches) {
    if (!context.stripUnknown && canEnforceUnion(unionBranches, context.rootSchema)) {
      const check = generateUnionCheck(acc, unionBranches, context.useRefImports ?? false, context.suffix ?? '')
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
    lines.push(...generateConstraintChecks(acc, propSchema, typeName, key, context))
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
export const generateObjectStrictAssertion = (
  schema: JSONSchema,
  typeName: string,
  context: StrictAssertionContext = {},
): string[] => {
  const lines: string[] = []
  lines.push(
    `  if (!isObject(input)) ${throwError(`[${typeName}] expected object, got `, 'input === null ? "null" : typeof input')};`,
  )

  if (!hasProperties(schema) || !isSchemaObject(schema)) return lines

  const required = new Set<string>(hasRequired(schema) ? schema.required : [])

  const props = schema.properties as Record<string, JSONSchema>
  for (const key in props) {
    lines.push(...generatePropertyAssertion(key, props[key] as JSONSchema, required.has(key), typeName, context))
  }

  return lines
}

/**
 * Generates a single strict-mode assertion line for a non-object scalar parser.
 * Returns null when the schema has no type information to assert on.
 */
export const generateScalarStrictAssertion = (
  schema: JSONSchema,
  typeName: string,
  rootSchema?: Record<string, unknown>,
): string | null => {
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
  const lines = [`  if (${wrongType}) ${throwError(`[${typeName}] expected ${typeLabel(t)}, got `, got)};`]

  // Root-level arrays enforce scalar/enum item types too — the same gap the
  // property path closes in generateConstraintChecks.
  if (t === 'array') {
    const itemCheck = generateItemCheck(schema)
    if (itemCheck) {
      lines.push(
        `  if (!(input as readonly unknown[]).every((_it) => ${itemCheck.check})) ${throwError(`[${typeName}] ${itemCheck.message}`)};`,
      )
    }
    // Tuple `prefixItems`: assert each position and cap length under items:false.
    lines.push(...generatePrefixItemsAssertion('input', `[${typeName}]`, schema, rootSchema))
  }

  return lines.join('\n')
}
