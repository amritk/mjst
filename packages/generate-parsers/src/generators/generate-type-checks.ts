import { escapeRegexPattern } from '@amritk/helpers/escape-regex-pattern'
import { multipleOfPassExpr } from '@amritk/helpers/multiple-of-check'
import { refToName } from '@amritk/helpers/ref-to-name'
import { resolveRef } from '@amritk/helpers/resolve-ref'
import { safeAccessor } from '@amritk/helpers/safe-accessor'
import {
  hasAdditionalProperties,
  hasAllOf,
  hasAnyOf,
  hasConst,
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
  hasOneOf,
  hasPattern,
  hasProperties,
  hasRef,
  hasType,
  hasUniqueItems,
  isObjectSchema,
  isSchemaObject,
} from '@amritk/helpers/schema-guards'
import type { JSONSchema } from 'json-schema-typed/draft-2020-12'

import { generateEnumCheck } from './generate-enum-check'
import { getPrefixItems, prefixItemsCapsLength, scalarItemTypeCheck } from './generate-validation-expression'

/**
 * Boolean type-check expression builders shared by the shape validators, the
 * parsers' fast paths, and the strict-mode assertions. They live in their own
 * module (rather than generate-parser-function) so generate-strict-assertion
 * can use them without an import cycle.
 *
 * Every expression built here is *true-sound*: when it evaluates to true the
 * value definitely matches the schema fragment. That is all a fast path needs.
 * The reverse direction — false definitely means invalid — only holds when
 * {@link canEnforceUnion} approves the schema, because a check may call an
 * imported `validate{X}Shape` that was generated as a conservative `=> false`
 * stub. Strict-mode code that *throws* on a false check must gate on it.
 */

/**
 * Returns the shape-predicate function name for a given type name.
 * The predicate is generated alongside each parser and tells callers
 * whether `input` is already in the shape produced by the parser's fast path.
 */
export const shapeValidatorName = (typeName: string): string => `validate${typeName}Shape`

/**
 * Matches an inline nested object property — an object schema written directly
 * under `properties` with its own `properties`, rather than referenced via
 * `$ref`. These get a private sub-parser (and shape predicate) in the same
 * generated file so their fields are actually parsed; anything involving
 * composition, conditionals, enums, or record semantics keeps the existing
 * code paths.
 */
export const isInlineObjectProperty = (propSchema: JSONSchema): propSchema is JSONSchema.Object => {
  if (!isSchemaObject(propSchema)) return false
  if (hasRef(propSchema) || hasEnum(propSchema) || hasConst(propSchema)) return false
  if (hasOneOf(propSchema) || hasAnyOf(propSchema) || hasAllOf(propSchema)) return false
  // `then`/`else` must be excluded even without `if`: generateShapeValidator
  // stubs any schema carrying them, so admitting one here would wire an
  // always-false predicate into parent guards — and into validators the
  // strict-union trust walk treats as false-sound, making a strict union
  // reject valid input.
  if ('patternProperties' in propSchema || 'not' in propSchema) return false
  if ('if' in propSchema || 'then' in propSchema || 'else' in propSchema) return false
  // additionalProperties-as-schema records go through the record paths instead
  if (hasAdditionalProperties(propSchema) && typeof propSchema.additionalProperties !== 'boolean') return false
  return isObjectSchema(propSchema) && hasProperties(propSchema)
}

/**
 * Matches an array property whose `items` is an inline object schema — the
 * array-items analogue of {@link isInlineObjectProperty}. These get a private
 * item sub-parser (and shape predicate) so element values — including nested
 * enums and `$ref`s — are actually validated instead of only passing an
 * `Array.isArray` check.
 */
export const isInlineObjectArrayProperty = (propSchema: JSONSchema): boolean => {
  if (!isSchemaObject(propSchema)) return false
  if (!('type' in propSchema) || propSchema.type !== 'array') return false
  if (!hasItems(propSchema) || Array.isArray(propSchema.items)) return false
  return isInlineObjectProperty(propSchema.items)
}

/**
 * Extracts the branch list of a `oneOf`/`anyOf` union, or `null` when the
 * schema is not a union (or mixes in other composition keywords we cannot
 * turn into a membership check).
 */
export const getUnionBranches = (schema: JSONSchema): readonly JSONSchema[] | null => {
  if (!isSchemaObject(schema)) return null
  if (hasAllOf(schema) || 'not' in schema) return null
  if (hasOneOf(schema) && schema.oneOf.length > 0) return schema.oneOf
  if (hasAnyOf(schema) && schema.anyOf.length > 0) return schema.anyOf
  return null
}

/**
 * Generates a fast-path type check expression for a property.
 * Returns null if the schema is too complex for a simple type check.
 *
 * When `useRefImports` is true, $ref properties (and arrays of $refs) are
 * checked by calling the imported shape predicate, allowing parent parsers
 * to fast-path through nested ref types without recursing into their parsers.
 */
export const generatePropertyTypeCheck = (
  varName: string,
  schema: JSONSchema,
  useRefImports: boolean,
  suffix: string,
): string | null => {
  if (!isSchemaObject(schema)) return null

  // $ref via shape predicate (deep fast-path through nested types).
  if (useRefImports && hasRef(schema)) {
    const refName = refToName((schema as { $ref: string }).$ref, suffix)
    return `${shapeValidatorName(refName)}(${varName})`
  }
  if (hasRef(schema)) return null

  // A fixed member set is directly predicable regardless of `type` — this is
  // what lets a nested object carrying an enum property (e.g. `axiom.kind`)
  // keep a real shape validator instead of the `=> false` stub.
  if (hasEnum(schema)) {
    return schema.enum.length > 0 ? generateEnumCheck(varName, schema.enum) : null
  }

  // A union property is predicable when every branch is: membership is the
  // disjunction of the branch checks.
  const branches = getUnionBranches(schema)
  if (branches) {
    return generateUnionCheck(varName, branches, useRefImports, suffix)
  }

  // Remaining composition (allOf, not, or a union mixed with them) cannot be
  // expressed as a simple boolean check.
  if (hasOneOf(schema) || hasAnyOf(schema) || hasAllOf(schema) || 'not' in schema) {
    return null
  }

  // A `const` property (the usual discriminated-union tag, e.g. `kind: "lit"`) has
  // no `type`, but is fast-path predicable via strict equality. Handling it here is
  // what lets a discriminated branch's shape validator be a real predicate instead
  // of the `=> false` stub. Structural consts need deep equality, so skip those.
  if (hasConst(schema)) {
    const c = schema.const
    return c === null || typeof c !== 'object' ? `${varName} === ${JSON.stringify(c)}` : null
  }

  if (!hasType(schema)) return null

  // Array of $refs: each item must satisfy the imported shape predicate.
  if (
    useRefImports &&
    schema.type === 'array' &&
    hasItems(schema) &&
    isSchemaObject(schema.items) &&
    hasRef(schema.items)
  ) {
    const refName = refToName((schema.items as { $ref: string }).$ref, suffix)
    return `Array.isArray(${varName}) && ${varName}.every(${shapeValidatorName(refName)})`
  }

  const checks: string[] = []

  switch (schema.type) {
    case 'string': {
      checks.push(`typeof ${varName} === "string"`)
      if (hasPattern(schema)) checks.push(`/${escapeRegexPattern(schema.pattern)}/.test(${varName})`)
      if (hasMinLength(schema)) checks.push(`${varName}.length >= ${schema.minLength}`)
      if (hasMaxLength(schema)) checks.push(`${varName}.length <= ${schema.maxLength}`)
      break
    }
    case 'number':
    case 'integer': {
      checks.push(`typeof ${varName} === "number"`)
      // `integer` must reject non-integral numbers on the fast path too, otherwise
      // `1.5` would pass through uncoerced.
      if (schema.type === 'integer') checks.push(`Number.isInteger(${varName})`)
      if (hasMinimum(schema)) checks.push(`${varName} >= ${schema.minimum}`)
      if (hasMaximum(schema)) checks.push(`${varName} <= ${schema.maximum}`)
      if (hasExclusiveMinimum(schema)) checks.push(`${varName} > ${schema.exclusiveMinimum}`)
      if (hasExclusiveMaximum(schema)) checks.push(`${varName} < ${schema.exclusiveMaximum}`)
      if (hasMultipleOf(schema)) checks.push(multipleOfPassExpr(varName, schema.multipleOf))
      break
    }
    case 'boolean':
      checks.push(`typeof ${varName} === "boolean"`)
      break
    case 'array': {
      checks.push(`Array.isArray(${varName})`)
      if (hasMinItems(schema)) checks.push(`${varName}.length >= ${schema.minItems}`)
      if (hasMaxItems(schema)) checks.push(`${varName}.length <= ${schema.maxItems}`)
      if (hasUniqueItems(schema) && schema.uniqueItems === true) {
        checks.push(`new Set(${varName}).size === ${varName}.length`)
      }
      // For a scalar or enum item type, every element must already be well-typed
      // to take the fast path; a mismatched element routes the array to the slow
      // path where each element is coerced (or, in strict mode, throws).
      if (hasItems(schema) && !Array.isArray(schema.items)) {
        const items = schema.items
        const itemCheck =
          scalarItemTypeCheck(items, '_it') ??
          (isSchemaObject(items) && hasEnum(items) && items.enum.length > 0
            ? generateEnumCheck('_it', items.enum)
            : null)
        if (itemCheck) checks.push(`${varName}.every((_it) => ${itemCheck})`)
      }
      // Tuple `prefixItems`: every present position must already match its
      // subschema, and a sibling `items: false` bars extra elements. Positions
      // are checked with ref imports disabled, so no imported shape-validator
      // call is introduced here — a position needing one returns null and simply
      // disables the fast path, keeping the union trust-walk sound without a
      // mirrored prefixItems traversal. A mistyped tuple then routes to the slow
      // path (coerced) or the strict assertion (thrown).
      const prefix = getPrefixItems(schema)
      if (prefix) {
        for (let i = 0; i < prefix.length; i++) {
          const posCheck = generatePropertyTypeCheck(`${varName}[${i}]`, prefix[i] as JSONSchema, false, suffix)
          if (posCheck === null) return null
          checks.push(`(${varName}.length <= ${i} || (${posCheck}))`)
        }
        if (prefixItemsCapsLength(schema)) checks.push(`${varName}.length <= ${prefix.length}`)
      }
      break
    }
    case 'object':
      checks.push(`isObject(${varName})`)
      break
    default:
      return null
  }

  if (checks.length === 0) return null
  // checks[0] is safe: we guard with checks.length === 0 above
  let result = checks[0] as string
  for (let i = 1; i < checks.length; i++) {
    result += ' && ' + checks[i]
  }
  return result
}

/**
 * Generates a boolean check that `varName` matches an inline object schema —
 * `isObject` plus a per-property check for every declared property (and a
 * presence check for `required` keys without a declared schema). Used for
 * union branches written inline, where no named shape validator exists to
 * call. Returns null when any property is too complex to check.
 */
export const generateInlineObjectCheck = (
  varName: string,
  schema: JSONSchema,
  useRefImports: boolean,
  suffix: string,
): string | null => {
  if (!isSchemaObject(schema) || !isObjectSchema(schema) || !hasProperties(schema)) return null
  if (hasAllOf(schema) || hasOneOf(schema) || hasAnyOf(schema) || 'not' in schema) return null
  if ('patternProperties' in schema || 'if' in schema) return null
  // additionalProperties-as-schema (records) would leave the record values
  // unchecked, breaking the "true means valid" guarantee.
  if (hasAdditionalProperties(schema) && typeof schema.additionalProperties !== 'boolean') return null

  const required = new Set<string>(Array.isArray(schema.required) ? (schema.required as string[]) : [])
  const checks: string[] = [`isObject(${varName})`]

  for (const [key, propSchema] of Object.entries(schema.properties)) {
    const acc = safeAccessor(varName, key)
    const check = generatePropertyTypeCheck(acc, propSchema, useRefImports, suffix)
    if (check === null) return null
    checks.push(required.has(key) ? check : `(${acc} === undefined || ${check})`)
    required.delete(key)
  }

  // `required` keys without a declared property schema still need a presence check.
  for (const key of required) {
    checks.push(`${JSON.stringify(key)} in ${varName}`)
  }

  // additionalProperties: false — extras make the value invalid for this branch.
  if (hasAdditionalProperties(schema) && schema.additionalProperties === false) {
    const allowedKeys = JSON.stringify(Object.keys(schema.properties))
    checks.push(`Object.keys(${varName}).every((_k) => ${allowedKeys}.includes(_k))`)
  }

  return checks.join(' && ')
}

/**
 * Generates a union membership check: true when `varName` matches at least one
 * branch of a `oneOf`/`anyOf`. Inline object branches get a per-property check;
 * everything else goes through {@link generatePropertyTypeCheck} ($refs call
 * the imported shape validator, consts/enums/scalars check directly). Returns
 * null when any branch cannot be checked.
 */
export const generateUnionCheck = (
  varName: string,
  branches: readonly JSONSchema[],
  useRefImports: boolean,
  suffix: string,
): string | null => {
  if (branches.length === 0) return null

  const parts: string[] = []
  for (const branch of branches) {
    if (!isSchemaObject(branch)) return null
    const check =
      isObjectSchema(branch) && hasProperties(branch) && !hasRef(branch)
        ? generateInlineObjectCheck(varName, branch, useRefImports, suffix)
        : generatePropertyTypeCheck(varName, branch, useRefImports, suffix)
    if (check === null) return null
    parts.push(`(${check})`)
  }
  // Callers conjoin this with other checks, so a multi-branch disjunction must
  // carry its own parentheses — `a || b && c` binds the wrong way without them.
  return parts.length === 1 ? (parts[0] as string) : `(${parts.join(' || ')})`
}

/**
 * True when the union membership check emitted by {@link generateUnionCheck}
 * is also *false-sound* — a false result definitely means the value is invalid
 * — so strict mode may throw on it.
 *
 * The risk is `$ref`s: a branch (or a property inside one) whose check calls
 * an imported `validate{X}Shape` is only trustworthy when that validator was
 * generated as a real predicate. This walks every reachable ref (mirroring
 * generateShapeValidator's stub conditions) and rejects the union when any of
 * them would have produced the conservative `=> false` stub, or is itself
 * built on one. Cycles (e.g. a recursive `expr` union) are assumed sound —
 * the recursion bottoms out on the data, not the schema.
 */
export const canEnforceUnion = (
  branches: readonly JSONSchema[],
  rootSchema: Record<string, unknown> | undefined,
): boolean => {
  const visiting = new Set<string>()
  return (
    branches.length > 0 &&
    branches.every((branch) => {
      if (!isSchemaObject(branch)) return false
      return isObjectSchema(branch) && hasProperties(branch) && !hasRef(branch)
        ? canTrustInlineObjectCheck(branch, rootSchema, visiting)
        : canTrustPropertyCheck(branch, rootSchema, visiting)
    })
  )
}

/** Mirrors {@link generatePropertyTypeCheck}: non-null AND every embedded validator call is real. */
const canTrustPropertyCheck = (
  schema: JSONSchema,
  rootSchema: Record<string, unknown> | undefined,
  visiting: Set<string>,
): boolean => {
  if (!isSchemaObject(schema)) return false

  if (hasRef(schema)) {
    return canTrustReferencedValidator((schema as { $ref: string }).$ref, rootSchema, visiting)
  }

  if (hasEnum(schema)) return schema.enum.length > 0

  const branches = getUnionBranches(schema)
  if (branches) {
    return branches.every((branch) => {
      if (!isSchemaObject(branch)) return false
      return isObjectSchema(branch) && hasProperties(branch) && !hasRef(branch)
        ? canTrustInlineObjectCheck(branch, rootSchema, visiting)
        : canTrustPropertyCheck(branch, rootSchema, visiting)
    })
  }

  if (hasOneOf(schema) || hasAnyOf(schema) || hasAllOf(schema) || 'not' in schema) return false

  if (hasConst(schema)) return schema.const === null || typeof schema.const !== 'object'

  if (!hasType(schema)) return false

  if (schema.type === 'array' && hasItems(schema) && isSchemaObject(schema.items) && hasRef(schema.items)) {
    return canTrustReferencedValidator((schema.items as { $ref: string }).$ref, rootSchema, visiting)
  }

  switch (schema.type) {
    case 'string':
    case 'number':
    case 'integer':
    case 'boolean':
    case 'array':
    case 'object':
      return true
    default:
      return false
  }
}

/**
 * Mirrors the per-property check {@link generateShapeValidator} emits for a
 * generated file's exported validator, which is *deeper* than
 * {@link generatePropertyTypeCheck}: inline object properties and arrays of
 * inline object items are checked through private sub-predicates generated
 * from the same schema, and a sub-predicate is a conservative `=> false` stub
 * whenever some nested property check cannot be built. A validator built on a
 * stub returns false on *valid* input, so trusting it requires every reachable
 * sub-predicate to be a real check, recursively.
 */
const canTrustShapeProperty = (
  propSchema: JSONSchema,
  rootSchema: Record<string, unknown> | undefined,
  visiting: Set<string>,
): boolean => {
  if (!isSchemaObject(propSchema)) return false

  // Record-valued additionalProperties: records of refs stub the validator;
  // stay conservative for any schema-valued record, matching the historical
  // bail in canTrustReferencedValidator.
  if (hasAdditionalProperties(propSchema) && typeof propSchema.additionalProperties !== 'boolean') return false

  if (isInlineObjectProperty(propSchema)) {
    return Object.values(propSchema.properties ?? {}).every((sub) => canTrustShapeProperty(sub, rootSchema, visiting))
  }

  if (isInlineObjectArrayProperty(propSchema)) {
    const items = (propSchema as { items: JSONSchema.Object }).items
    return Object.values(items.properties ?? {}).every((sub) => canTrustShapeProperty(sub, rootSchema, visiting))
  }

  return canTrustPropertyCheck(propSchema, rootSchema, visiting)
}

/** Mirrors {@link generateInlineObjectCheck}: non-null AND every property check is trustworthy. */
const canTrustInlineObjectCheck = (
  schema: JSONSchema,
  rootSchema: Record<string, unknown> | undefined,
  visiting: Set<string>,
): boolean => {
  if (!isSchemaObject(schema) || !isObjectSchema(schema) || !hasProperties(schema)) return false
  if (hasAllOf(schema) || hasOneOf(schema) || hasAnyOf(schema) || 'not' in schema) return false
  if ('patternProperties' in schema || 'if' in schema) return false
  if (hasAdditionalProperties(schema) && typeof schema.additionalProperties !== 'boolean') return false

  return Object.values(schema.properties).every((propSchema) => canTrustPropertyCheck(propSchema, rootSchema, visiting))
}

/**
 * True when the file generated for `ref`'s target carries a *real* (non-stub)
 * shape validator whose result can be trusted in both directions. Mirrors the
 * schema classes generateShapeValidator (and its new union/alias paths) turns
 * into real predicates, recursing into every reachable ref.
 */
const canTrustReferencedValidator = (
  ref: string,
  rootSchema: Record<string, unknown> | undefined,
  visiting: Set<string>,
): boolean => {
  if (visiting.has(ref)) return true
  if (!rootSchema) return false

  const resolved = resolveRef(ref, rootSchema) as JSONSchema | undefined
  if (!resolved || !isSchemaObject(resolved)) return false

  visiting.add(ref)
  try {
    // Alias definition (bare $ref): its validator delegates to the target's.
    if (hasRef(resolved) && !hasProperties(resolved)) {
      return canTrustReferencedValidator((resolved as { $ref: string }).$ref, rootSchema, visiting)
    }

    // Pure union definition: real when the membership check is enforceable.
    if (!hasProperties(resolved)) {
      const branches = getUnionBranches(resolved)
      if (!branches) return false
      if ('patternProperties' in resolved || 'if' in resolved) return false
      return branches.every((branch) => {
        if (!isSchemaObject(branch)) return false
        return isObjectSchema(branch) && hasProperties(branch) && !hasRef(branch)
          ? canTrustInlineObjectCheck(branch, rootSchema, visiting)
          : canTrustPropertyCheck(branch, rootSchema, visiting)
      })
    }

    // Object definition: real when generateShapeValidator emits a predicate —
    // no composition/conditional keywords, and every property check resolves.
    if (
      hasOneOf(resolved) ||
      hasAnyOf(resolved) ||
      hasAllOf(resolved) ||
      'not' in resolved ||
      'patternProperties' in resolved ||
      'if' in resolved ||
      'then' in resolved ||
      'else' in resolved
    ) {
      return false
    }
    // Walk with the deep shape-validator mirror: the emitted validator routes
    // inline object properties (and arrays of inline object items) through
    // private sub-predicates, so trust must recurse the same way instead of
    // stopping at a shallow isObject/Array.isArray reading.
    return Object.values(resolved.properties).every((propSchema) =>
      canTrustShapeProperty(propSchema, rootSchema, visiting),
    )
  } finally {
    visiting.delete(ref)
  }
}
