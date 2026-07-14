import { getMjstInstanceOf, getMjstPrimitive } from '@amritk/helpers/mjst-extension'
import { refToFilename } from '@amritk/helpers/ref-to-filename'
import { refToName } from '@amritk/helpers/ref-to-name'
import {
  hasAdditionalProperties,
  hasAllOf,
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

import { mergeAllOf } from './derive-example'

/**
 * Derives the arbitrary const name from a type name.
 * e.g. "User" → "UserArbitrary"
 */
const arbitraryName = (typeName: string): string => `${typeName}Arbitrary`

/**
 * Threaded through `arbitraryExpr` while building one type's arbitrary.
 * `selfArbName` is the arbitrary name of the type currently being generated; a
 * `$ref` resolving to it is a *self*-reference which must be tied lazily (via
 * `fc.letrec`'s `tie`) rather than emitted as a bare identifier — the eager
 * identifier would reference a `const` mid-initialization and throw a TDZ
 * `ReferenceError` at import. `usedTie` records whether that happened so the
 * caller knows to wrap the expression in `fc.letrec`.
 *
 * `lazyRefFilenames` holds the filenames of *other* types this one shares a
 * cross-file `$ref` cycle with (A→B→A across modules). A reference to one of
 * them must be emitted lazily too — an eager top-level identifier would read a
 * still-uninitialized `const` from the sibling module (circular-ESM TDZ) at
 * import. Unlike a self-reference, these live in another file, so `fc.letrec`'s
 * `tie` cannot reach them; they are deferred at generation time instead.
 */
type ExprCtx = {
  readonly suffix: string
  readonly selfArbName: string
  readonly usedTie: { value: boolean }
  readonly lazyRefFilenames: ReadonlySet<string>
}

/**
 * Wraps a cross-module arbitrary reference so the imported binding is read at
 * generation time rather than at module-init time. `fc.constant(null).chain`
 * stores the thunk and only invokes it when a value is generated — by which
 * point every module in the cycle has finished initializing — so the otherwise
 * eager identifier never touches a `const` in its TDZ.
 */
const lazyRef = (arbName: string): string => `fc.constant(null).chain(() => ${arbName})`

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

/**
 * Builds a multiple-of-respecting number arbitrary analytically: pick an integer
 * `k` whose multiple `k * multipleOf` lands inside the (possibly exclusive)
 * bounds, then emit that product. Random doubles essentially never satisfy
 * `n % m === 0`, so a `.filter` here starves fast-check ("too many filtered
 * values") at sample time; deriving the multiple directly cannot fail. This
 * mirrors the static path's `deriveNumber`.
 *
 * The trailing `.map` clamps `k * m` back inside the finite bounds to absorb
 * floating-point drift (e.g. `3 * 0.1 === 0.30000000000000004`, which would
 * otherwise slip just past a `maximum` of `0.3`).
 */
const numberMultipleOfExpr = (schema: JSONSchema & { multipleOf: number }): string => {
  const m = Number(schema.multipleOf)
  const EPS = 1e-9

  // Effective lower bound: the tighter (larger) of minimum / exclusiveMinimum,
  // tracking whether the binding bound is exclusive.
  let lo = Number.NEGATIVE_INFINITY
  let loExclusive = false
  if (hasMinimum(schema)) lo = Number(schema.minimum)
  if (hasExclusiveMinimum(schema) && Number(schema.exclusiveMinimum) >= lo) {
    lo = Number(schema.exclusiveMinimum)
    loExclusive = true
  }

  // Effective upper bound: the tighter (smaller) of maximum / exclusiveMaximum.
  let hi = Number.POSITIVE_INFINITY
  let hiExclusive = false
  if (hasMaximum(schema)) hi = Number(schema.maximum)
  if (hasExclusiveMaximum(schema) && Number(schema.exclusiveMaximum) <= hi) {
    hi = Number(schema.exclusiveMaximum)
    hiExclusive = true
  }

  // Translate value bounds into integer-`k` bounds, where the emitted value is
  // `k * m`. An exclusive bound must be strictly cleared, so a `k` landing exactly
  // on it is nudged one step inward; `EPS` keeps a mathematically-integer ratio
  // (e.g. `0.3 / 0.1`) from being mis-rounded by floating-point error.
  let kMin: number | undefined
  let kMax: number | undefined
  if (Number.isFinite(lo)) {
    const raw = lo / m
    kMin = loExclusive ? Math.floor(raw + EPS) + 1 : Math.ceil(raw - EPS)
  }
  if (Number.isFinite(hi)) {
    const raw = hi / m
    kMax = hiExclusive ? Math.ceil(raw - EPS) - 1 : Math.floor(raw + EPS)
  }
  // An unsatisfiable range (no multiple fits) would make `fc.integer` throw on
  // `min > max`; collapse to a single best-effort value instead.
  if (kMin !== undefined && kMax !== undefined && kMin > kMax) kMax = kMin

  const kOpts: string[] = []
  if (kMin !== undefined) kOpts.push(`min: ${kMin}`)
  if (kMax !== undefined) kOpts.push(`max: ${kMax}`)
  const k = kOpts.length > 0 ? `fc.integer({ ${kOpts.join(', ')} })` : 'fc.integer()'

  let value = `k * ${m}`
  if (Number.isFinite(lo)) value = `Math.max(${value}, ${lo})`
  if (Number.isFinite(hi)) value = `Math.min(${value}, ${hi})`

  return `${k}.map((k) => ${value})`
}

/** Builds a `fc.double({ ... })` expression honouring range and multiple-of constraints. */
const numberExpr = (schema: JSONSchema): string => {
  // A positive `multipleOf` is satisfied analytically rather than by filtering
  // random doubles, which would starve fast-check at sample time.
  if (hasMultipleOf(schema) && schema.multipleOf > 0) return numberMultipleOfExpr(schema)

  const opts: string[] = ['noNaN: true', 'noDefaultInfinity: true']
  if (hasMinimum(schema)) opts.push(`min: ${schema.minimum}`)
  else if (hasExclusiveMinimum(schema)) opts.push(`min: ${schema.exclusiveMinimum}`, 'minExcluded: true')
  if (hasMaximum(schema)) opts.push(`max: ${schema.maximum}`)
  else if (hasExclusiveMaximum(schema)) opts.push(`max: ${schema.exclusiveMaximum}`, 'maxExcluded: true')

  return `fc.double({ ${opts.join(', ')} })`
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

  const items = hasItems(schema) && isSchemaObject(schema.items) ? arbitraryExpr(schema.items, ctx) : 'fc.anything()'

  const opts: string[] = []
  if (hasMinItems(schema)) opts.push(`minLength: ${schema.minItems}`)
  if (hasMaxItems(schema)) opts.push(`maxLength: ${schema.maxItems}`)

  const fn = hasUniqueItems(schema) && schema.uniqueItems === true ? 'fc.uniqueArray' : 'fc.array'
  return opts.length > 0 ? `${fn}(${items}, { ${opts.join(', ')} })` : `${fn}(${items})`
}

/** Builds a `fc.record(...)` / `fc.dictionary(...)` expression for an object schema. */
const objectExpr = (schema: JSONSchema, ctx: ExprCtx): string => {
  // The `additionalProperties` value schema (when it constrains extra keys with a
  // real subschema rather than the boolean true/false form).
  const additional = hasAdditionalProperties(schema) ? schema.additionalProperties : false
  const additionalArb = isSchemaObject(additional) ? arbitraryExpr(additional, ctx) : undefined

  if (!hasProperties(schema)) {
    // A map-style object (no declared properties) with a typed `additionalProperties`
    // is a dictionary of that value type; otherwise fall back to a free-form object.
    return additionalArb ? `fc.dictionary(fc.string(), ${additionalArb})` : 'fc.object()'
  }

  const required = new Set(hasRequired(schema) ? schema.required : [])
  const keys = Object.keys(schema.properties)
  const entries = Object.entries(schema.properties).map(
    ([key, propSchema]) => `${JSON.stringify(key)}: ${arbitraryExpr(propSchema, ctx)}`,
  )

  if (entries.length === 0) return 'fc.record({})'

  const model = `{ ${entries.join(', ')} }`

  // fc.record treats all keys as required by default. Only emit requiredKeys
  // when at least one property is optional.
  const record = keys.every((key) => required.has(key))
    ? `fc.record(${model})`
    : `fc.record(${model}, { requiredKeys: [${[...required].map((key) => JSON.stringify(key)).join(', ')}] })`

  // When both declared properties and a typed `additionalProperties` are present,
  // fold in a dictionary of extra keys so the value exercises the open-map part of
  // the schema too. The declared keys win on collision (merged last).
  if (additionalArb) {
    return `fc.tuple(${record}, fc.dictionary(fc.string(), ${additionalArb})).map(([base, extra]) => ({ ...extra, ...base }))`
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
    // A reference to a sibling this type shares a cross-file cycle with is the
    // same TDZ hazard one module over, and `tie` cannot reach across modules —
    // defer the imported binding until generation time instead.
    if (ctx.lazyRefFilenames.has(refToFilename(schema.$ref))) {
      return lazyRef(name)
    }
    return name
  }

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
 * `lazyRefFilenames` names the sibling files this type shares a cross-file `$ref`
 * cycle with; references to those are deferred so mutually recursive modules do
 * not read each other's `const` before it is initialized (see {@link ExprCtx}).
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
  lazyRefFilenames: ReadonlySet<string> = new Set(),
): string => {
  const selfArbName = arbitraryName(typeName)
  const ctx: ExprCtx = { suffix, selfArbName, usedTie: { value: false }, lazyRefFilenames }
  const expr = arbitraryExpr(schema, ctx)

  if (ctx.usedTie.value) {
    return `export const ${selfArbName}: fc.Arbitrary<${typeName}> = fc.letrec<{ ${SELF_KEY}: ${typeName} }>((tie) => ({\n  ${SELF_KEY}: ${expr},\n})).${SELF_KEY}`
  }

  return `export const ${selfArbName}: fc.Arbitrary<${typeName}> = ${expr}`
}
