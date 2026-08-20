import { getMjstInstanceOf, getMjstPrimitive } from '@amritk/helpers/mjst-extension'
import { refToFilename } from '@amritk/helpers/ref-to-filename'
import { refToName } from '@amritk/helpers/ref-to-name'
import { resolveRef } from '@amritk/helpers/resolve-ref'
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

import { assertGeneratorDepth } from './assert-generator-depth'

/** A schema node that is not a boolean shorthand — what the depth guard has already proved. */
type SchemaObject = Exclude<JSONSchema, boolean>

import { closedValueSet } from './closed-value-set'
import { mergeAllOf } from './derive-example'
import { declaresOwnShape, isObjectLike, typesConflict } from './is-object-like'
import { satisfiesScalarConstraints } from './satisfies-scalar-constraints'
import { canBuildGuard, needsValidationFilter, withResolvableDefs } from './schema-validation'

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
  /** Current nesting of the `arbitraryExpr` recursion; see the depth guard there. */
  readonly depth: { value: number }
  /** The root document, used to tell a resolvable `$ref` from a dangling one. */
  readonly rootSchema: Record<string, unknown> | undefined
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

/**
 * Object-literal key form that survives the one runtime-dangerous name,
 * `__proto__`. Even quoted, `{ "__proto__": v }` is the prototype-*setter*
 * syntax rather than a property definition: the key never appears on the object
 * (`Object.keys({ "__proto__": 1 })` is `[]`) and the object's prototype becomes
 * `v` — here, an `Arbitrary` instance. So a schema with a `__proto__` property
 * used to emit a corrupt `fc.record` config that silently dropped the key the
 * generated type still promises. The computed form `{ ["__proto__"]: v }`
 * defines a normal own property. `generate-parsers` solves this the same way.
 */
const safeLiteralKey = (key: string): string => (key === '__proto__' ? '["__proto__"]' : JSON.stringify(key))

/**
 * A numeric keyword's value, or `undefined` when it is not a finite number.
 *
 * `1e999` is legal JSON, and `JSON.parse` turns it into `Infinity` — which the
 * `typeof value === 'number'` guards happily accept. Interpolated into an
 * option, `{ min: Infinity }` (or a `NaN` from a programmatic schema) makes the
 * `fc.*` combinator throw the moment the generated module is imported, so the
 * whole file's exports go down over one absurd bound. A bound nothing can
 * satisfy tells us nothing, so drop it and generate as if it were absent.
 */
const finiteNumber = (value: number | undefined): number | undefined =>
  value !== undefined && Number.isFinite(value) ? value : undefined

/**
 * A length/count keyword normalized into something `fc.*` will accept: a
 * non-negative integer, or `undefined` when there is no usable bound.
 *
 * `minLength`, `maxItems` and friends are schema input, so nothing stops a
 * document carrying `maxLength: -5` or `minItems: 1.5`. Every counted `fc.*`
 * option demands a non-negative integer and throws otherwise, at *import* of the
 * generated module. Rounding toward the satisfiable side keeps the bound as
 * close to what the schema asked for as an integer can be — the smallest integer
 * that still clears a lower bound, the largest that still fits under an upper —
 * and a negative count floors at zero, which is the tightest bound that has any
 * instances at all.
 */
const countBound = (value: number | undefined, side: 'lower' | 'upper'): number | undefined => {
  const finite = finiteNumber(value)
  if (finite === undefined) return undefined
  return Math.max(0, side === 'lower' ? Math.ceil(finite) : Math.floor(finite))
}

/**
 * A positive, finite `multipleOf`, or `undefined`. Anything else — zero, a
 * negative step, `Infinity` — is not a constraint any value can be measured
 * against, and every attempt to honour it produced an arbitrary that throws or
 * starves at sample time.
 */
const usableMultipleOf = (schema: JSONSchema): number | undefined =>
  hasMultipleOf(schema) && Number.isFinite(schema.multipleOf) && schema.multipleOf > 0 ? schema.multipleOf : undefined

/**
 * Clamps a lower bound down to its upper bound when the two cross.
 *
 * An unsatisfiable range (`minLength: 10, maxLength: 2`) has no value to
 * generate — but every bounded `fc.*` combinator *asserts* `min <= max` and
 * throws the moment the generated module is imported, taking down the whole
 * file's exports, including the arbitraries that were perfectly fine. Emitting
 * the degenerate-but-constructible range keeps the module usable; the schema
 * itself is what the example's own validity check reports.
 */
const clampLow = (low: number | undefined, high: number | undefined): number | undefined =>
  low !== undefined && high !== undefined && low > high ? high : low

/**
 * Assertions `fc.stringMatching` cannot generate from. fast-check builds a value
 * by walking the pattern, and a lookahead or lookbehind is a constraint on text
 * it has not produced yet — it throws "Assertions of kind Lookahead not
 * implemented yet!" the first time a value is drawn. Real specifications use
 * these constantly (password rules, "must contain a digit"), so the arbitrary
 * falls back to a plain string rather than shipping a module that dies on use.
 */
const UNSUPPORTED_ASSERTION = /\(\?<?[=!]/

/**
 * A `pattern` that `fc.stringMatching` can actually be handed, or `undefined`.
 *
 * The emitted `new RegExp(<pattern>)` runs at module scope, so a pattern that is
 * not valid JavaScript regex syntax (`"["`) threw a `SyntaxError` at *import* of
 * the generated file and took every export in it down — including the arbitraries
 * that were fine. `deriveObject` and `matchesPattern` already treat an
 * uncompilable pattern as simply not applying; this brings the arbitrary in line.
 */
const usablePattern = (pattern: string): string | undefined => {
  if (UNSUPPORTED_ASSERTION.test(pattern)) return undefined
  try {
    new RegExp(pattern)
    return pattern
  } catch {
    return undefined
  }
}

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

  const maxLength = countBound(hasMaxLength(schema) ? schema.maxLength : undefined, 'upper')
  const minLength = clampLow(countBound(hasMinLength(schema) ? schema.minLength : undefined, 'lower'), maxLength)

  const pattern = hasPattern(schema) ? usablePattern(schema.pattern) : undefined
  if (pattern !== undefined) {
    // Build the regex via `new RegExp(<json-string>)` rather than inlining the
    // pattern into a `/.../ ` literal: a pattern containing `/` (e.g. `^/api/v\d+$`)
    // would otherwise close the literal early and emit invalid TypeScript.
    const base = `fc.stringMatching(new RegExp(${JSON.stringify(pattern)}))`
    // `stringMatching` takes no length bounds, so honour any min/maxLength with a
    // filter instead of silently dropping them. Only emit it when a bound exists.
    const checks: string[] = []
    if (minLength !== undefined) checks.push(`s.length >= ${minLength}`)
    if (maxLength !== undefined) checks.push(`s.length <= ${maxLength}`)
    return checks.length > 0 ? `${base}.filter((s) => ${checks.join(' && ')})` : base
  }

  const opts: string[] = []
  if (minLength !== undefined) opts.push(`minLength: ${minLength}`)
  if (maxLength !== undefined) opts.push(`maxLength: ${maxLength}`)
  return opts.length > 0 ? `fc.string({ ${opts.join(', ')} })` : 'fc.string()'
}

/**
 * The effective integer bounds of a numeric schema, rounded toward the
 * satisfiable side.
 *
 * With both `minimum` and `exclusiveMinimum` present the effective lower bound is
 * the tighter (larger) of the two, so they combine rather than one shadowing the
 * other via else-if. `fc.integer` also requires integral bounds, but the schema
 * keywords may be fractional (`minimum: 2.5`, `exclusiveMinimum: 5.5`), so each
 * rounds inward: the smallest integer that still meets the lower bound, and the
 * largest that still meets the upper. `Math.floor(x) + 1` is the smallest integer
 * strictly greater than `x` (so it also handles integral exclusives);
 * `Math.ceil(x) - 1` is the largest strictly less.
 */
const integerBounds = (schema: JSONSchema): { min: number | undefined; max: number | undefined } => {
  const minimum = finiteNumber(hasMinimum(schema) ? Number(schema.minimum) : undefined)
  const exclusiveMinimum = finiteNumber(hasExclusiveMinimum(schema) ? Number(schema.exclusiveMinimum) : undefined)
  const maximum = finiteNumber(hasMaximum(schema) ? Number(schema.maximum) : undefined)
  const exclusiveMaximum = finiteNumber(hasExclusiveMaximum(schema) ? Number(schema.exclusiveMaximum) : undefined)

  const mins: number[] = []
  if (minimum !== undefined) mins.push(Math.ceil(minimum))
  if (exclusiveMinimum !== undefined) mins.push(Math.floor(exclusiveMinimum) + 1)

  const maxs: number[] = []
  if (maximum !== undefined) maxs.push(Math.floor(maximum))
  if (exclusiveMaximum !== undefined) maxs.push(Math.ceil(exclusiveMaximum) - 1)

  const max = clampIntegerBound(maxs.length > 0 ? Math.min(...maxs) : undefined)
  const min = clampIntegerBound(mins.length > 0 ? Math.max(...mins) : undefined)
  return { min: clampLow(min, max), max }
}

/**
 * The magnitude an unbounded generated value is allowed to reach, matching
 * `fc.integer()`'s own default range. The analytic `multipleOf` path picks an
 * integer `k` and emits `k * m`, so `k` has to be bounded by `2 ** 31 / m` — an
 * unbounded `k` would multiply straight past `Number.MAX_SAFE_INTEGER` for a
 * large `m` and emit values that are not exact integers at all.
 */
const DEFAULT_INTEGER_MAGNITUDE = 2 ** 31

/**
 * Confines an integer bound to the range `fc.integer` actually supports.
 *
 * fast-check clamps its own defaults to 32 bits, so a bound beyond that is not
 * merely large — it is *inconsistent*: `{ min: 1e30 }` leaves fast-check with a
 * minimum above its own maximum and it throws at import, "maximum value should
 * be equal or greater than the minimum one". The upper end is one below the
 * magnitude, matching `fc.integer`'s own inclusive default of `2 ** 31 - 1`. A bound past the representable
 * range cannot be honoured either way; clamping keeps the module loadable, and
 * the example's own validity check is what reports the schema.
 */
const clampIntegerBound = (value: number | undefined): number | undefined =>
  value === undefined ? undefined : Math.max(-DEFAULT_INTEGER_MAGNITUDE, Math.min(DEFAULT_INTEGER_MAGNITUDE - 1, value))

/**
 * Builds an integer arbitrary whose values are multiples of `m`, analytically:
 * pick the integer `k` and emit `k * m`.
 *
 * The obvious `fc.integer().filter((n) => n % m === 0)` starves fast-check
 * ("too many filtered values") the moment `m` is large — only one integer in `m`
 * survives, so a `multipleOf: 1000000` rejected essentially every candidate —
 * and for `m` of `0` it rejects *every* value, since `n % 0` is `NaN`. Deriving
 * the multiple cannot fail. This mirrors {@link numberMultipleOfExpr}.
 */
const integerMultipleOfExpr = (m: number, min: number | undefined, max: number | undefined): string => {
  // `DEFAULT_INTEGER_MAGNITUDE - 1` because `fc.integer`'s default maximum is
  // inclusive: for a `multipleOf` of 1 the whole magnitude gave `max: 2147483648`,
  // one past what it accepts.
  const bound = Math.max(1, Math.floor((DEFAULT_INTEGER_MAGNITUDE - 1) / m))
  const kMin = min !== undefined ? Math.ceil(min / m) : -bound
  // An unsatisfiable range (no multiple fits between the bounds) would make
  // `fc.integer` throw on `min > max`; collapse to a single best-effort value.
  const kMax = Math.max(kMin, max !== undefined ? Math.floor(max / m) : bound)
  return `fc.integer({ min: ${kMin}, max: ${kMax} }).map((k) => k * ${m})`
}

/** Builds a `fc.integer({ ... })` expression honouring range and multiple-of constraints. */
const integerExpr = (schema: JSONSchema): string => {
  const { min, max } = integerBounds(schema)

  const multipleOf = usableMultipleOf(schema)

  // A positive integral `multipleOf` is satisfied analytically rather than by
  // filtering, which starves at anything but the smallest steps.
  if (multipleOf !== undefined && Number.isInteger(multipleOf)) {
    return integerMultipleOfExpr(multipleOf, min, max)
  }

  const opts: string[] = []
  if (min !== undefined) opts.push(`min: ${min}`)
  if (max !== undefined) opts.push(`max: ${max}`)
  const base = opts.length > 0 ? `fc.integer({ ${opts.join(', ')} })` : 'fc.integer()'

  // A fractional `multipleOf` on an integer type admits only the integers that
  // are whole multiples of it, which no simple `k * m` form picks out, so it
  // keeps the filter. An unusable step is dropped rather than emitted — see
  // {@link usableMultipleOf}.
  return multipleOf !== undefined ? `${base}.filter((n) => n % ${multipleOf} === 0)` : base
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
const numberMultipleOfExpr = (schema: JSONSchema, m: number): string => {
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
  const multipleOf = usableMultipleOf(schema)
  if (multipleOf !== undefined) return numberMultipleOfExpr(schema, multipleOf)

  const opts: string[] = ['noNaN: true', 'noDefaultInfinity: true']
  // With both an inclusive and an exclusive bound on the same side, honour the
  // tighter one instead of letting `minimum`/`maximum` shadow the exclusive via
  // else-if (which would emit values that violate the exclusive bound). The
  // exclusive bound wins ties, since it additionally excludes the endpoint.
  const minimum = finiteNumber(hasMinimum(schema) ? Number(schema.minimum) : undefined)
  const exclusiveMinimum = finiteNumber(hasExclusiveMinimum(schema) ? Number(schema.exclusiveMinimum) : undefined)
  const maximum = finiteNumber(hasMaximum(schema) ? Number(schema.maximum) : undefined)
  const exclusiveMaximum = finiteNumber(hasExclusiveMaximum(schema) ? Number(schema.exclusiveMaximum) : undefined)

  let low: number | undefined
  let lowExcluded = false
  if (minimum !== undefined && (exclusiveMinimum === undefined || minimum > exclusiveMinimum)) {
    low = minimum
  } else if (exclusiveMinimum !== undefined) {
    low = exclusiveMinimum
    lowExcluded = true
  }

  let high: number | undefined
  let highExcluded = false
  if (maximum !== undefined && (exclusiveMaximum === undefined || maximum < exclusiveMaximum)) {
    high = maximum
  } else if (exclusiveMaximum !== undefined) {
    high = exclusiveMaximum
    highExcluded = true
  }

  // `fc.double` asserts `min <= max`, so a crossed range has to collapse rather
  // than throw at import — see {@link clampLow}.
  low = clampLow(low, high)

  // Once the two bounds meet, the single value they admit is the only one left,
  // so any exclusion on either side empties the range entirely — and an empty
  // range is exactly what `fc.double` refuses. `{ exclusiveMinimum: 5, maximum: 5 }`
  // reached the output as `min: 5, minExcluded: true, max: 5`. Keeping the
  // endpoint is the best-effort answer; the example's own validity check reports
  // the schema.
  if (low !== undefined && low === high) {
    lowExcluded = false
    highExcluded = false
  }

  if (low !== undefined) opts.push(`min: ${low}`, ...(lowExcluded ? ['minExcluded: true'] : []))
  if (high !== undefined) opts.push(`max: ${high}`, ...(highExcluded ? ['maxExcluded: true'] : []))

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

  // With no `items`, a `contains` subschema is the only element constraint, so
  // generate from it (and guarantee at least one such element via `minLength`) —
  // otherwise an empty array would fail `contains`.
  const containsSchema = hasContains(schema) && isSchemaObject(schema.contains) ? schema.contains : undefined
  const unique = hasUniqueItems(schema) && schema.uniqueItems === true

  // Under `uniqueItems` the `contains` schema alone is not enough to draw from:
  // `contains` asks that *some* element match, so a closed one (a `const`, a
  // short `enum`) cannot fill more than a slot or two, and
  // `{ contains: { const: 'x' }, minItems: 5, uniqueItems: true }` had no way to
  // reach five distinct elements — fast-check retried forever. Widening to "that
  // value, or anything" restores the freedom the schema actually grants (every
  // element but one is unconstrained), and a draw of several almost always
  // includes the one that counts.
  const containsExpr = containsSchema !== undefined ? arbitraryExpr(containsSchema, ctx) : undefined
  const items =
    hasItems(schema) && isSchemaObject(schema.items)
      ? arbitraryExpr(schema.items, ctx)
      : containsExpr === undefined
        ? 'fc.anything()'
        : unique
          ? `fc.oneof(${containsExpr}, fc.anything())`
          : containsExpr

  const minContains = countBound(typeof raw['minContains'] === 'number' ? raw['minContains'] : undefined, 'lower') ?? 1
  const minLength = Math.max(
    countBound(hasMinItems(schema) ? schema.minItems : undefined, 'lower') ?? 0,
    containsSchema !== undefined ? Math.max(1, minContains) : 0,
  )

  // A `uniqueArray` cannot fill more slots than its item schema has distinct
  // values, and fast-check retries forever rather than reporting it — so
  // `{ items: { type: 'boolean' }, minItems: 5, uniqueItems: true }` produced an
  // arbitrary that hung the moment it was sampled. Cap both bounds at the size of
  // that set; the schema has no instance either way, and the example's own
  // validity check is what reports it. Only `items` counts here: `contains`
  // constrains some element rather than every one, so its value set says nothing
  // about how long the array may be, and capping on it shrank a legitimate array
  // to a single element. `deriveArray` draws the same distinction.
  const distinctCap =
    unique && containsSchema === undefined
      ? closedValueSet(hasItems(schema) && isSchemaObject(schema.items) ? schema.items : undefined)?.length
      : undefined

  const declaredMax = countBound(hasMaxItems(schema) ? schema.maxItems : undefined, 'upper')
  const maxLength = distinctCap !== undefined ? Math.min(declaredMax ?? distinctCap, distinctCap) : declaredMax
  const clampedMin = clampLow(minLength, maxLength) ?? minLength

  const opts: string[] = []
  if (clampedMin > 0) opts.push(`minLength: ${clampedMin}`)
  if (maxLength !== undefined) opts.push(`maxLength: ${maxLength}`)

  const fn = unique ? 'fc.uniqueArray' : 'fc.array'
  return opts.length > 0 ? `${fn}(${items}, { ${opts.join(', ')} })` : `${fn}(${items})`
}

/** The arbitrary for keys of the open-map (extra-property) part of an object. */
const extraKeyArb = (schema: JSONSchema, firstPatternSource: string | undefined): string => {
  // Keys must satisfy `patternProperties` (so the value schema applies) or, failing
  // that, a `propertyNames` pattern. Both map onto `fc.stringMatching` — but only
  // a pattern fast-check can use; see {@link usablePattern}.
  const fromPattern = firstPatternSource !== undefined ? usablePattern(firstPatternSource) : undefined
  if (fromPattern !== undefined) return `fc.stringMatching(new RegExp(${JSON.stringify(fromPattern)}))`
  const propertyNames = hasPropertyNames(schema) ? schema.propertyNames : undefined
  if (propertyNames !== undefined && isSchemaObject(propertyNames) && hasPattern(propertyNames)) {
    const fromNames = usablePattern(propertyNames.pattern)
    if (fromNames !== undefined) return `fc.stringMatching(new RegExp(${JSON.stringify(fromNames)}))`
  }
  return 'fc.string()'
}

/**
 * The `required` entries that name an actual property.
 *
 * JSON Schema says `required` is an array of strings, but it is untrusted input
 * and a malformed document can put anything there. A number leaked all the way
 * into the generated `fc.record(…, { requiredKeys: [1] })`, where fast-check
 * expects a key of the model and TypeScript rejects the whole file.
 */
const requiredKeyNames = (schema: JSONSchema): string[] =>
  hasRequired(schema) ? schema.required.filter((key): key is string => typeof key === 'string') : []

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

  const minProps = countBound(hasMinProperties(schema) ? schema.minProperties : undefined, 'lower')
  const maxProps = countBound(hasMaxProperties(schema) ? schema.maxProperties : undefined, 'upper')
  const dictKeyOpts = (minKeys?: number, maxKeys?: number): string => {
    const low = clampLow(minKeys, maxKeys)
    const opts: string[] = []
    if (low !== undefined && low > 0) opts.push(`minKeys: ${low}`)
    if (maxKeys !== undefined) opts.push(`maxKeys: ${maxKeys}`)
    return opts.length > 0 ? `, { ${opts.join(', ')} }` : ''
  }

  // Each declared key maps to the arbitrary that generates its value.
  const propArbs = new Map<string, string>()
  if (hasProperties(schema)) {
    for (const [key, propSchema] of Object.entries(schema.properties)) propArbs.set(key, arbitraryExpr(propSchema, ctx))
  }
  const required = new Set(requiredKeyNames(schema))
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
      for (const key of requiredKeyNames(sub)) required.add(key)
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

  const entries = keys.map((key) => `${safeLiteralKey(key)}: ${propArbs.get(key)}`)

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

/**
 * Builds a `fc.oneof(...)` expression from a list of branch schemas.
 *
 * `fc.oneof` needs at least one branch and throws on none, so an empty
 * `oneOf`/`anyOf`/`type: []` degrades to `fc.anything()` the way every other
 * keyword this generator cannot honour does — rather than emitting a module that
 * throws the moment it is imported. A lone branch is emitted directly: wrapping
 * one arbitrary in a choice between it and nothing else only adds noise.
 */
const oneofExpr = (branches: readonly JSONSchema[], ctx: ExprCtx): string =>
  chooseExpr(branches.map((branch) => arbitraryExpr(branch, ctx)))

/** Combines already-built branch expressions into a single choice. */
const chooseExpr = (exprs: readonly string[]): string => {
  if (exprs.length === 0) return 'fc.anything()'
  if (exprs.length === 1) return exprs[0] as string
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
  // Same guard, and same reason, as `deriveExample`'s: a deeply nested document
  // otherwise dies with a bare `RangeError` naming nothing about the input. The
  // counter rides on the context since this is the one recursive entry point.
  assertGeneratorDepth(ctx.depth.value, 'generateArbitrary')
  if (!isSchemaObject(schema)) return 'fc.anything()'

  ctx.depth.value++
  try {
    return arbitraryExprAtDepth(schema, ctx)
  } finally {
    ctx.depth.value--
  }
}

/** The body of {@link arbitraryExpr}, once its depth guard has admitted the node. */
const arbitraryExprAtDepth = (schema: SchemaObject, ctx: ExprCtx): string => {
  if (hasRef(schema)) {
    // A ref that resolves nowhere in this document was never generated as a file,
    // so `collectExampleImports` deliberately skips it — and emitting its name
    // anyway left a bare identifier nothing imports (`Cannot find name 'Nope'`).
    // An external `#/components/schemas/…` pointer in a bare fragment is the
    // usual way this arrives. Degrade instead, as every unhonourable keyword does.
    if (ctx.rootSchema !== undefined && !resolveRef(schema.$ref, ctx.rootSchema)) return 'fc.anything()'
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
    // Drop enum members that violate a sibling length/range/pattern constraint so
    // the arbitrary never emits an out-of-range member. Keep all when none fit
    // (an unsatisfiable schema) rather than emitting an empty `constantFrom`.
    const members = schema.enum as unknown[]
    const fitting = members.filter((value) => satisfiesScalarConstraints(schema, value))
    const chosen = fitting.length > 0 ? fitting : members
    // `fc.constantFrom` needs at least one value and throws on none, so an empty
    // `enum` — a schema no value satisfies — degrades rather than emitting a
    // module that throws at import.
    if (chosen.length === 0) return 'fc.anything()'
    const values = chosen.map((value) => JSON.stringify(value)).join(', ')
    // Spread a `const`-asserted tuple instead of passing the members directly.
    // `fc.constantFrom("a", "b")` infers its overload's `T` from a *mutable*
    // `T[]` rest parameter, so the literals widen and the whole arbitrary types
    // as `Arbitrary<string>` — which does not fit the `"a" | "b"` the generated
    // type declares, and fails to compile for every consumer on a strict
    // tsconfig. A readonly tuple keeps the literal types intact.
    //
    // Only scalar members get the assertion: `as const` also makes any array
    // member a `readonly` tuple, and *that* is the assignment TypeScript really
    // does refuse (`readonly ["a"]` → `["a"]`). Object and array members never
    // had the widening problem in the first place, since the generated type for
    // them is a structural type, not a literal.
    const literalSafe = chosen.every((value) => value === null || typeof value !== 'object')
    return literalSafe ? `fc.constantFrom(...([${values}] as const))` : `fc.constantFrom(${values})`
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

  // A `oneOf`/`anyOf` branch constrains the node *alongside* its own keywords, not
  // instead of them, so a node that declares its own shape is merged into every
  // branch. Reading the branches alone dropped the node's `type` and
  // `properties` and answered `fc.anything()` against an object type.
  const branches = hasOneOf(schema) ? schema.oneOf : hasAnyOf(schema) ? schema.anyOf : undefined
  if (branches !== undefined) {
    const rest = withoutCombinators(schema)
    if (!declaresOwnShape(rest)) return oneofExpr(branches, ctx)
    // Keep every branch when they all clash, rather than emitting no choice at
    // all: an unsatisfiable schema still has to produce *something*.
    const viable = branches.filter((branch) => !typesConflict(rest, branch))
    const kept = viable.length > 0 ? viable : branches
    return chooseExpr(kept.map((branch) => arbitraryExpr({ allOf: [rest, branch] } as JSONSchema, ctx)))
  }

  // Object-likeness is settled *before* `type` is dispatched on, because the type
  // generator settles it first too: it calls anything carrying `properties` an
  // object whatever `type` says. Answering `type` first emitted `fc.string()`
  // against an object type.
  if (isObjectLike(schema)) return objectExpr(schema, ctx)

  if (hasType(schema)) return scalarExpr(schema.type, schema, ctx)

  // Multi-type schemas (`type: ['string', 'null']`) become a oneof over each
  // member type; `hasType` only matches a single string `type`. An empty
  // `type: []` falls through to `fc.anything()` inside `chooseExpr`.
  if (Array.isArray(schema.type)) {
    return chooseExpr(schema.type.map((type) => scalarExpr(type, schema, ctx)))
  }

  return 'fc.anything()'
}

/** A shallow copy of `schema` with `oneOf`/`anyOf` removed, leaving what the node says on its own. */
const withoutCombinators = (schema: JSONSchema): JSONSchema => {
  const rest = { ...(schema as Record<string, unknown>) }
  delete rest['oneOf']
  delete rest['anyOf']
  return rest as JSONSchema
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
  rootSchema?: Record<string, unknown>,
): string => {
  const selfArbName = arbitraryName(typeName)
  const ctx: ExprCtx = {
    suffix,
    selfArbName,
    usedTie: { value: false },
    lazyRefFilenames,
    depth: { value: 0 },
    rootSchema,
  }
  const expr = arbitraryExpr(schema, ctx)

  const body = ctx.usedTie.value
    ? `fc.letrec<{ ${SELF_KEY}: ${typeName} }>((tie) => ({\n  ${SELF_KEY}: ${expr},\n})).${SELF_KEY}`
    : expr

  // Keywords no `fc.*` combinator captures on its own (`if`/`then`/`else`, `not`,
  // `oneOf` exclusivity, the presence-gated object keywords) are enforced by a
  // post-generation filter: the arbitrary samples a candidate and rejects it
  // unless a runtime validator built from the same schema accepts it.
  // A filter is only worth emitting when the validator behind it can actually be
  // built. The generated file calls `__mjstValidate(<schema>)` at module scope
  // with nothing to catch it, so a schema the interpreter refuses — an
  // uncompilable `pattern`, a `$ref` leading outside the fragment — threw at
  // *import* and took every export in the file down with it. Ask here, where the
  // failure is a warning and the arbitrary simply goes unfiltered.
  if (needsValidationFilter(schema) && canBuildGuard(schema, rootSchema)) {
    const validatorName = `${selfArbName}Validator`
    const embedded = JSON.stringify(withResolvableDefs(schema, rootSchema))
    // The predicate is a type guard, not a plain boolean callback. A filtered
    // arbitrary deliberately generates a *superset* — the combinators cannot
    // express `if`/`then`, `not`, or `oneOf` exclusivity, so the validator is
    // what narrows the samples down to the declared type. Written as
    // `(value) => …` the filter returns the wide type and the assignment fails
    // to compile; `value is T` says out loud what the runtime check does.
    //
    // The base is widened to `Arbitrary<unknown>` first. `filter`'s refinement
    // overload is `filter<U extends T>`, so the guard only type-checks when the
    // declared type extends what the base expression happens to infer — and the
    // base is not always a supertype. It is a *different* shape: `contains`
    // generates `number[]` for a declared `unknown[]`, `dependentRequired`
    // promotes an optional key to required, `dependentSchemas` adds one the type
    // never declared. Each of those raised TS2677 and broke the file. Widening
    // says the honest thing — the combinators produce something we cannot name,
    // and the validator is the only reason the result is a `T`.
    return (
      `const ${validatorName} = ${VALIDATE_IMPORT_NAME}(${embedded})\n` +
      `export const ${selfArbName}: fc.Arbitrary<${typeName}> = ` +
      `(${body} as fc.Arbitrary<unknown>).filter(` +
      `(value): value is ${typeName} => ${validatorName}(value) === true)`
    )
  }

  // The boolean `false` schema admits no value, so its generated type is `never`
  // and no arbitrary can be assigned to it without saying so out loud.
  if (schema === false) {
    return `export const ${selfArbName}: fc.Arbitrary<${typeName}> = ${body} as fc.Arbitrary<${typeName}>`
  }

  return `export const ${selfArbName}: fc.Arbitrary<${typeName}> = ${body}`
}
