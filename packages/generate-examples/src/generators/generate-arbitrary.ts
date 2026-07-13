import { getMjstInstanceOf, getMjstPrimitive } from '@amritk/helpers/mjst-extension'
import { refToName } from '@amritk/helpers/ref-to-name'
import {
  hasAdditionalProperties,
  hasAllOf,
  hasAnyOf,
  hasConst,
  hasContains,
  hasDependentRequired,
  hasDependentSchemas,
  hasEnum,
  hasExclusiveMaximum,
  hasExclusiveMinimum,
  hasFormat,
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
  hasOneOf,
  hasPattern,
  hasPatternProperties,
  hasProperties,
  hasPropertyNames,
  hasRef,
  hasRequired,
  hasType,
  hasUniqueItems,
  isSchemaObject,
} from '@amritk/helpers/schema-guards'
import type { JSONSchema } from 'json-schema-typed/draft-2020-12'

import { mergeAllOf } from './derive-example'
import { needsValidationFilter, withResolvableDefs } from './schema-validation'

/**
 * Derives the arbitrary const name from a type name.
 * e.g. "User" → "UserArbitrary"
 */
const arbitraryName = (typeName: string): string => `${typeName}Arbitrary`

/**
 * Local alias the generated file binds `@amritk/runtime-validators`' `validate`
 * to. Namespaced (leading underscores) so it can't collide with a schema-derived
 * type name. {@link generateArbitrary} emits references to it; the file assembler
 * adds the matching import when any arbitrary uses it.
 */
export const VALIDATE_IMPORT_NAME = '__mjstValidate'

/**
 * The import line the generated file needs when an arbitrary embeds a validating
 * filter. Emitted by the file assembler only when {@link VALIDATE_IMPORT_NAME}
 * appears in the generated source.
 */
export const VALIDATE_IMPORT_STATEMENT = `import { validate as ${VALIDATE_IMPORT_NAME} } from '@amritk/runtime-validators'`

/**
 * Threaded through `arbitraryExpr` while building one type's arbitrary.
 * `selfArbName` is the arbitrary name of the type currently being generated; a
 * `$ref` resolving to it is a *self*-reference which must be tied lazily (via
 * `fc.letrec`'s `tie`) rather than emitted as a bare identifier — the eager
 * identifier would reference a `const` mid-initialization and throw a TDZ
 * `ReferenceError` at import. `usedTie` records whether that happened so the
 * caller knows to wrap the expression in `fc.letrec`.
 */
type ExprCtx = {
  readonly suffix: string
  readonly selfArbName: string
  readonly usedTie: { value: boolean }
}

/** The letrec key used for a type's own (self-referential) arbitrary. */
const SELF_KEY = 'self'

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
      case 'time':
        return 'fc.date({ noInvalidDate: true }).map((d) => d.toISOString().slice(11))'
      case 'hostname':
        return 'fc.domain()'
      case 'ipv4':
        return 'fc.ipV4()'
      case 'ipv6':
        return 'fc.ipV6()'
    }
  }

  if (hasPattern(schema)) {
    // Build the regex via `new RegExp(<json-string>)` rather than inlining the
    // pattern into a `/.../ ` literal: a pattern containing `/` (e.g. `^/api/v\d+$`)
    // would otherwise close the literal early and emit invalid TypeScript.
    const base = `fc.stringMatching(new RegExp(${JSON.stringify(schema.pattern)}))`
    // `stringMatching` takes no length bounds, so honour any min/maxLength with a
    // filter instead of silently dropping them. Only emit it when a bound exists.
    const checks: string[] = []
    if (hasMinLength(schema)) checks.push(`s.length >= ${schema.minLength}`)
    if (hasMaxLength(schema)) checks.push(`s.length <= ${schema.maxLength}`)
    return checks.length > 0 ? `${base}.filter((s) => ${checks.join(' && ')})` : base
  }

  const opts: string[] = []
  if (hasMinLength(schema)) opts.push(`minLength: ${schema.minLength}`)
  if (hasMaxLength(schema)) opts.push(`maxLength: ${schema.maxLength}`)
  return opts.length > 0 ? `fc.string({ ${opts.join(', ')} })` : 'fc.string()'
}

/** Builds a `fc.integer({ ... })` expression honouring range and multiple-of constraints. */
const integerExpr = (schema: JSONSchema): string => {
  const opts: string[] = []
  // With both `minimum` and `exclusiveMinimum` present the effective lower bound
  // is the tighter (larger) of the two, so combine them rather than letting one
  // shadow the other via else-if.
  const mins: number[] = []
  if (hasMinimum(schema)) mins.push(Number(schema.minimum))
  if (hasExclusiveMinimum(schema)) mins.push(Number(schema.exclusiveMinimum) + 1)
  if (mins.length > 0) opts.push(`min: ${Math.max(...mins)}`)

  const maxs: number[] = []
  if (hasMaximum(schema)) maxs.push(Number(schema.maximum))
  if (hasExclusiveMaximum(schema)) maxs.push(Number(schema.exclusiveMaximum) - 1)
  if (maxs.length > 0) opts.push(`max: ${Math.min(...maxs)}`)

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

/** Builds a `fc.array(...)` / `fc.uniqueArray(...)` / `fc.tuple(...)` expression for an array schema. */
const arrayExpr = (schema: JSONSchema, ctx: ExprCtx): string => {
  const raw = schema as Record<string, unknown>
  // A tuple is `prefixItems` (2020-12) or the draft-07 array-form `items`. Both
  // describe one schema per position, so map them to `fc.tuple(...)`. Extra items
  // beyond the prefix are unconstrained (or forbidden by `items: false`); the
  // minimal tuple is schema-valid either way.
  const prefixItems = raw['prefixItems']
  const tuple = Array.isArray(prefixItems)
    ? (prefixItems as JSONSchema[])
    : Array.isArray(raw['items'])
      ? (raw['items'] as JSONSchema[])
      : undefined
  if (tuple) {
    const exprs = tuple.map((item) => arbitraryExpr(item, ctx))
    return `fc.tuple(${exprs.join(', ')})`
  }

  // With no `items`, a `contains` subschema is the only element constraint, so
  // generate from it (and guarantee at least one such element via `minLength`) —
  // otherwise an empty array would fail `contains`.
  const containsSchema = hasContains(schema) && isSchemaObject(schema.contains) ? schema.contains : undefined
  const items =
    hasItems(schema) && isSchemaObject(schema.items)
      ? arbitraryExpr(schema.items, ctx)
      : containsSchema
        ? arbitraryExpr(containsSchema, ctx)
        : 'fc.anything()'

  const minContains =
    containsSchema !== undefined && typeof raw['minContains'] === 'number' ? (raw['minContains'] as number) : 1
  const minLength = Math.max(
    hasMinItems(schema) ? schema.minItems : 0,
    containsSchema !== undefined ? Math.max(1, minContains) : 0,
  )

  const opts: string[] = []
  if (minLength > 0) opts.push(`minLength: ${minLength}`)
  if (hasMaxItems(schema)) opts.push(`maxLength: ${schema.maxItems}`)

  const fn = hasUniqueItems(schema) && schema.uniqueItems === true ? 'fc.uniqueArray' : 'fc.array'
  return opts.length > 0 ? `${fn}(${items}, { ${opts.join(', ')} })` : `${fn}(${items})`
}

/** The arbitrary for keys of the open-map (extra-property) part of an object. */
const extraKeyArb = (schema: JSONSchema, firstPatternSource: string | undefined): string => {
  // Keys must satisfy `patternProperties` (so the value schema applies) or, failing
  // that, a `propertyNames` pattern. Both map onto `fc.stringMatching`.
  if (firstPatternSource !== undefined) return `fc.stringMatching(new RegExp(${JSON.stringify(firstPatternSource)}))`
  const propertyNames = hasPropertyNames(schema) ? schema.propertyNames : undefined
  if (propertyNames !== undefined && isSchemaObject(propertyNames) && hasPattern(propertyNames)) {
    return `fc.stringMatching(new RegExp(${JSON.stringify(propertyNames.pattern)}))`
  }
  return 'fc.string()'
}

/** Builds a `fc.record(...)` / `fc.dictionary(...)` expression for an object schema. */
const objectExpr = (schema: JSONSchema, ctx: ExprCtx): string => {
  // The `additionalProperties` value schema (when it constrains extra keys with a
  // real subschema rather than the boolean true/false form).
  const additional = hasAdditionalProperties(schema) ? schema.additionalProperties : false
  const additionalArb = isSchemaObject(additional) ? arbitraryExpr(additional, ctx) : undefined
  const additionalClosed = hasAdditionalProperties(schema) && schema.additionalProperties === false

  // The first `patternProperties` entry drives the open-map value/key shape.
  const patternEntries = hasPatternProperties(schema) ? Object.entries(schema.patternProperties) : []
  const firstPattern = patternEntries[0]
  const patternValueArb =
    firstPattern && isSchemaObject(firstPattern[1]) ? arbitraryExpr(firstPattern[1], ctx) : undefined
  // Extra keys are allowed unless a fully closed object (no `additionalProperties`
  // and no `patternProperties` outlet) forbids them.
  const extrasAllowed = !additionalClosed || patternEntries.length > 0
  const extraValueArb = additionalArb ?? patternValueArb
  const keyArb = extraKeyArb(schema, firstPattern?.[0])

  const minProps = hasMinProperties(schema) ? schema.minProperties : undefined
  const maxProps = hasMaxProperties(schema) ? schema.maxProperties : undefined
  const dictKeyOpts = (minKeys?: number, maxKeys?: number): string => {
    const opts: string[] = []
    if (minKeys !== undefined && minKeys > 0) opts.push(`minKeys: ${minKeys}`)
    if (maxKeys !== undefined) opts.push(`maxKeys: ${maxKeys}`)
    return opts.length > 0 ? `, { ${opts.join(', ')} }` : ''
  }

  // Each declared key maps to the arbitrary that generates its value.
  const propArbs = new Map<string, string>()
  if (hasProperties(schema)) {
    for (const [key, propSchema] of Object.entries(schema.properties)) propArbs.set(key, arbitraryExpr(propSchema, ctx))
  }
  const required = new Set(hasRequired(schema) ? schema.required : [])
  // The value arbitrary for a key not declared in `properties` (a dependency key).
  const openValueArb = extraValueArb ?? 'fc.anything()'

  // Fold presence-gated dependency keywords into the always-present set. Requiring
  // a dependency (or a `dependentSchemas` shape) unconditionally is stricter than
  // the keyword — but a value that always carries the dependency is always valid,
  // and it keeps the generated candidate from being rejected by the filter.
  if (hasDependentRequired(schema)) {
    for (const [, deps] of Object.entries(schema.dependentRequired)) {
      for (const dep of deps) {
        if (!propArbs.has(dep)) propArbs.set(dep, openValueArb)
        required.add(dep)
      }
    }
  }
  if (hasDependentSchemas(schema)) {
    for (const [, sub] of Object.entries(schema.dependentSchemas)) {
      if (!isSchemaObject(sub)) continue
      if (hasProperties(sub)) {
        for (const [key, propSchema] of Object.entries(sub.properties)) {
          if (!propArbs.has(key)) propArbs.set(key, arbitraryExpr(propSchema, ctx))
        }
      }
      if (hasRequired(sub)) for (const key of sub.required) required.add(key)
    }
  }
  // A `dependentSchemas`/`dependentRequired` key may be required without a declared
  // value schema; give it the open-map value arbitrary.
  for (const key of required) if (!propArbs.has(key)) propArbs.set(key, openValueArb)

  const keys = [...propArbs.keys()]

  // A map-style object (no declared keys) is a dictionary; its bounds come from
  // `min`/`maxProperties` and its value/key shape from `additionalProperties` /
  // `patternProperties` / `propertyNames`.
  if (keys.length === 0) {
    if (extraValueArb) return `fc.dictionary(${keyArb}, ${extraValueArb}${dictKeyOpts(minProps, maxProps)})`
    if (minProps !== undefined || maxProps !== undefined) {
      return `fc.dictionary(${keyArb}, fc.anything()${dictKeyOpts(minProps, maxProps)})`
    }
    return 'fc.object()'
  }

  const entries = keys.map((key) => `${JSON.stringify(key)}: ${propArbs.get(key)}`)

  const model = `{ ${entries.join(', ')} }`
  // fc.record treats all keys as required by default. Only emit requiredKeys
  // when at least one property is optional.
  const record = keys.every((key) => required.has(key))
    ? `fc.record(${model})`
    : `fc.record(${model}, { requiredKeys: [${[...required].map((key) => JSON.stringify(key)).join(', ')}] })`

  // Fold in a dictionary of extra keys when the open-map part is typed, or when
  // `minProperties` needs more keys than the declared set guarantees. `minKeys`
  // fills only the gap above the always-present (required) keys so the floor is met
  // without overshooting. Declared keys win on collision (merged last).
  const needExtras =
    extrasAllowed && (extraValueArb !== undefined || (minProps !== undefined && minProps > required.size))
  if (needExtras) {
    const valueArb = extraValueArb ?? 'fc.anything()'
    const minKeys = minProps !== undefined ? Math.max(0, minProps - required.size) : undefined
    return `fc.tuple(${record}, fc.dictionary(${keyArb}, ${valueArb}${dictKeyOpts(minKeys, undefined)})).map(([base, extra]) => ({ ...extra, ...base }))`
  }
  return record
}

/** Builds a `fc.oneof(...)` expression from a list of branch schemas. */
const oneofExpr = (branches: readonly JSONSchema[], ctx: ExprCtx): string => {
  const exprs = branches.map((branch) => arbitraryExpr(branch, ctx))
  return `fc.oneof(${exprs.join(', ')})`
}

/** Builds the fast-check expression for a single (non-union) JSON Schema type. */
const scalarExpr = (type: string, schema: JSONSchema, ctx: ExprCtx): string => {
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
      return arrayExpr(schema, ctx)
    case 'object':
      return objectExpr(schema, ctx)
    default:
      return 'fc.anything()'
  }
}

/** True when an `enum` member satisfies the node's sibling length/range/pattern constraints. */
const enumMemberFits = (schema: JSONSchema, value: unknown): boolean => {
  if (typeof value === 'string') {
    if (hasMinLength(schema) && value.length < schema.minLength) return false
    if (hasMaxLength(schema) && value.length > schema.maxLength) return false
    if (hasPattern(schema)) {
      try {
        if (!new RegExp(schema.pattern).test(value)) return false
      } catch {
        // An invalid pattern can't reject anything.
      }
    }
  } else if (typeof value === 'number') {
    if (hasMinimum(schema) && value < schema.minimum) return false
    if (hasMaximum(schema) && value > schema.maximum) return false
    if (hasExclusiveMinimum(schema) && value <= schema.exclusiveMinimum) return false
    if (hasExclusiveMaximum(schema) && value >= schema.exclusiveMaximum) return false
    if (hasMultipleOf(schema) && schema.multipleOf > 0 && value % schema.multipleOf !== 0) return false
  }
  return true
}

/**
 * Recursively builds the fast-check arbitrary expression for a schema node.
 * `$ref`s resolve to the referenced file's exported arbitrary; a self-`$ref`
 * resolves to `tie('self')` so recursive schemas tie lazily via `fc.letrec`.
 * Everything else maps to the appropriate `fc.*` combinator.
 */
const arbitraryExpr = (schema: JSONSchema, ctx: ExprCtx): string => {
  if (!isSchemaObject(schema)) return 'fc.anything()'

  if (hasRef(schema)) {
    const name = arbitraryName(refToName(schema.$ref, ctx.suffix))
    // A reference back to the type being generated must be tied lazily; an eager
    // identifier would touch a still-uninitialized const (TDZ) at import time.
    if (name === ctx.selfArbName) {
      ctx.usedTie.value = true
      return `tie(${JSON.stringify(SELF_KEY)})`
    }
    return name
  }

  if (hasConst(schema)) return `fc.constant(${JSON.stringify(schema.const)})`

  if (hasEnum(schema)) {
    // Drop enum members that violate a sibling length/range/pattern constraint so
    // the arbitrary never emits an out-of-range member. Keep all when none fit
    // (an unsatisfiable schema) rather than emitting an empty `constantFrom`.
    const members = schema.enum as unknown[]
    const fitting = members.filter((value) => enumMemberFits(schema, value))
    const chosen = fitting.length > 0 ? fitting : members
    const values = chosen.map((value) => JSON.stringify(value)).join(', ')
    return `fc.constantFrom(${values})`
  }

  const instanceOf = getMjstInstanceOf(schema)
  if (instanceOf === 'Date') return 'fc.date({ noInvalidDate: true })'
  if (instanceOf) return 'fc.anything()'

  const primitive = getMjstPrimitive(schema)
  if (primitive === 'bigint') return 'fc.bigInt()'
  if (primitive) return 'fc.anything()'

  // `allOf` must satisfy every branch at once. fast-check has no generic
  // intersection combinator, so flatten the branches into one merged schema
  // (tightest bounds, unioned required, merged properties) and generate from it.
  if (hasAllOf(schema)) return arbitraryExpr(mergeAllOf(schema), ctx)

  if (hasOneOf(schema)) return oneofExpr(schema.oneOf, ctx)
  if (hasAnyOf(schema)) return oneofExpr(schema.anyOf, ctx)

  if (hasType(schema)) return scalarExpr(schema.type, schema, ctx)

  // Multi-type schemas (`type: ['string', 'null']`) become a oneof over each
  // member type; `hasType` only matches a single string `type`.
  if (Array.isArray(schema.type)) {
    const exprs = schema.type.map((type) => scalarExpr(type, schema, ctx))
    return exprs.length === 1 ? (exprs[0] as string) : `fc.oneof(${exprs.join(', ')})`
  }

  return 'fc.anything()'
}

/**
 * Generates a `fast-check` arbitrary that produces schema-valid values.
 *
 * A schema that references itself is wrapped in `fc.letrec` so the recursion is
 * tied lazily — a plain `const NodeArbitrary = fc.record({ next: NodeArbitrary })`
 * would throw a TDZ `ReferenceError` the moment the module is imported.
 *
 * @example
 * ```typescript
 * generateArbitrary({ type: 'object', properties: { name: { type: 'string' } }, required: ['name'] }, 'Info')
 * // export const InfoArbitrary: fc.Arbitrary<Info> = fc.record({ "name": fc.string() })
 * ```
 */
export const generateArbitrary = (
  schema: JSONSchema,
  typeName: string,
  suffix = '',
  rootSchema?: Record<string, unknown>,
): string => {
  const selfArbName = arbitraryName(typeName)
  const ctx: ExprCtx = { suffix, selfArbName, usedTie: { value: false } }
  const expr = arbitraryExpr(schema, ctx)

  const body = ctx.usedTie.value
    ? `fc.letrec<{ ${SELF_KEY}: ${typeName} }>((tie) => ({\n  ${SELF_KEY}: ${expr},\n})).${SELF_KEY}`
    : expr

  // Keywords no `fc.*` combinator captures on its own (`if`/`then`/`else`, `not`,
  // `oneOf` exclusivity, the presence-gated object keywords) are enforced by a
  // post-generation filter: the arbitrary samples a candidate and rejects it
  // unless a runtime validator built from the same schema accepts it.
  if (needsValidationFilter(schema)) {
    const validatorName = `${selfArbName}Validator`
    const embedded = JSON.stringify(withResolvableDefs(schema, rootSchema))
    return (
      `const ${validatorName} = ${VALIDATE_IMPORT_NAME}(${embedded})\n` +
      `export const ${selfArbName}: fc.Arbitrary<${typeName}> = (${body}).filter((value) => ${validatorName}(value) === true)`
    )
  }

  return `export const ${selfArbName}: fc.Arbitrary<${typeName}> = ${body}`
}
