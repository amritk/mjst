import { regexLiteral } from '@amritk/helpers/escape-regex-pattern'
import { resolveRef } from '@amritk/helpers/resolve-ref'
import { isSchemaObject } from '@amritk/helpers/schema-guards'
import type { JSONSchema } from 'json-schema-typed/draft-2020-12'

import type { MatchContext } from './subschema-match'

/**
 * `unevaluatedProperties` / `unevaluatedItems` (2020-12) act on whatever a
 * value's *other* keywords left untouched — including the in-place applicators
 * (`allOf`, `$ref`, a successful `anyOf`/`oneOf` branch, `if`/`then`/`else`,
 * `dependentSchemas`). The runtime interpreter answers that by collecting
 * annotations as it walks; a code generator has no walk to piggyback on, so this
 * module computes the same thing as an *expression*: for each key (or index), a
 * boolean that is true when some keyword evaluated it.
 *
 * The one simplification the generated form allows itself is that a keyword
 * which must succeed for the value to be valid at all — `allOf` members, a
 * `$ref` target — is treated as having annotated. That is sound because the
 * emitted coverage expression is always one conjunct of a chain that *also*
 * asserts those keywords: if one of them fails the whole match is false
 * regardless of what the unevaluated term said. Only the genuinely conditional
 * applicators (`anyOf` / `oneOf` branches, `if`/`then`/`else`,
 * `dependentSchemas`) carry their condition into the expression.
 *
 * `contains` is the interesting one, because it annotates *per item* rather than
 * wholesale — see {@link containsCoverage}.
 */

/** What a schema (and its in-place applicators) evaluates at one instance location. */
type Coverage = {
  /** Every key / index is evaluated, so an `unevaluated*` keyword has nothing left to police. */
  readonly all: boolean
  /** OR-ed boolean expressions over the key/index variable. */
  readonly terms: readonly string[]
}

const NONE: Coverage = { all: false, terms: [] }

type MatchFn = (accessor: string, schema: JSONSchema, ctx: MatchContext) => string | null

const orJoin = (terms: readonly string[]): string =>
  terms.length === 1 ? (terms[0] as string) : `(${terms.join(' || ')})`

const depthOf = (ctx: MatchContext): number => ctx.depth ?? 0
const nest = (ctx: MatchContext): MatchContext => ({ ...ctx, depth: depthOf(ctx) + 1 })

/** Coverage that only counts when `cond` holds at runtime (a matched branch, a present trigger). */
const conditioned = (coverage: Coverage, cond: string): Coverage => {
  if (coverage.all) return { all: false, terms: [cond] }
  if (coverage.terms.length === 0) return NONE
  return { all: false, terms: [`(${cond} && ${orJoin(coverage.terms)})`] }
}

const merge = (into: Coverage, from: Coverage): Coverage =>
  into.all || from.all ? { all: true, terms: [] } : { all: false, terms: [...into.terms, ...from.terms] }

/**
 * The keywords that annotate object keys at this node, ignoring applicators.
 * `ignoreOwnUnevaluated` is set for the node the `unevaluated*` keyword is being
 * emitted *for*: its own keyword is what consults this coverage, so counting it
 * as a sweep would make every schema-form `unevaluatedProperties` vacuous.
 */
const ownPropertyCoverage = (
  schema: Record<string, unknown>,
  keyVar: string,
  ignoreOwnUnevaluated: boolean,
): Coverage => {
  // `additionalProperties` (in any form) is the fallback for every key no
  // `properties` name and no pattern claims, so its mere presence sweeps the
  // object — the same reason the interpreter sets `allProps` for it.
  if ('additionalProperties' in schema) return { all: true, terms: [] }
  // An `unevaluatedProperties` that is not `false` sweeps the leftovers itself,
  // so an outer one sees nothing. A `false` one sweeps nothing: it only asserts
  // that the terms below already cover every key.
  if (!ignoreOwnUnevaluated && 'unevaluatedProperties' in schema && schema['unevaluatedProperties'] !== false) {
    return { all: true, terms: [] }
  }

  const terms: string[] = []
  const properties = schema['properties']
  if (typeof properties === 'object' && properties !== null && !Array.isArray(properties)) {
    const keys = Object.keys(properties as Record<string, unknown>)
    if (keys.length > 0) terms.push(`${JSON.stringify(keys)}.includes(${keyVar})`)
  }
  const patterns = schema['patternProperties']
  if (typeof patterns === 'object' && patterns !== null && !Array.isArray(patterns)) {
    for (const pattern of Object.keys(patterns as Record<string, unknown>)) {
      terms.push(`${regexLiteral(pattern)}.test(${keyVar})`)
    }
  }
  return { all: false, terms }
}

/** The index counterpart of {@link ownPropertyCoverage}. */
const ownItemCoverage = (
  schema: Record<string, unknown>,
  indexVar: string,
  ignoreOwnUnevaluated: boolean,
): Coverage => {
  // A tail `items` schema (2020-12) sweeps every index past the tuple, and
  // `items: false` can only succeed when there is no such index — either way the
  // array ends up fully evaluated. The draft-07 spelling puts the tail in
  // `additionalItems`, with `items` holding the tuple.
  const tupleItems = Array.isArray(schema['items'])
  if (!tupleItems && 'items' in schema) return { all: true, terms: [] }
  if (tupleItems && 'additionalItems' in schema) return { all: true, terms: [] }
  if (!ignoreOwnUnevaluated && 'unevaluatedItems' in schema && schema['unevaluatedItems'] !== false) {
    return { all: true, terms: [] }
  }

  const terms: string[] = []
  const prefix = Array.isArray(schema['prefixItems'])
    ? (schema['prefixItems'] as unknown[])
    : tupleItems
      ? (schema['items'] as unknown[])
      : null
  if (prefix && prefix.length > 0) terms.push(`${indexVar} < ${prefix.length}`)

  // `contains` is deliberately *not* here: it annotates per item, so it needs the
  // matcher and the array accessor. See {@link containsCoverage}.
  return { all: false, terms }
}

/**
 * What an adjacent `contains` leaves evaluated: only the items that actually
 * match its subschema, which 2020-12 is explicit about.
 *
 * Ajv — this package's differential oracle — instead marks the *whole* array
 * evaluated once `contains` is satisfied, and `unevaluated-match.ts` used to
 * follow the oracle. `@amritk/runtime-validators` has since moved to the spec,
 * and two packages in one repo disagreeing about the same schema is exactly what
 * the differential suites exist to prevent, so this follows the spec too. The
 * `parser-vocabulary-conformance.differential.test.ts` corpus excludes the
 * `contains` + `unevaluated*` pairing for that reason.
 *
 * `minContains` / `maxContains` do not enter into it. They decide whether
 * `contains` is *satisfied*, which the assertion chain checks separately; the
 * annotation is per item either way.
 */
const containsCoverage = (
  schema: Record<string, unknown>,
  indexVar: string,
  acc: string,
  ctx: MatchContext,
  match: MatchFn,
): Coverage | null => {
  if (!('contains' in schema)) return NONE
  const itemMatch = match(`(${acc} as any[])[${indexVar}]`, schema['contains'] as JSONSchema, nest(ctx))
  if (itemMatch === null) return null
  // A `contains` that matches anything evaluates every item there is.
  if (itemMatch === 'true') return { all: true, terms: [] }
  return { all: false, terms: [itemMatch] }
}

/**
 * Coverage of `schema` and everything it applies in place, for one instance
 * location. `null` when some applicator cannot be proven inline (an unresolvable
 * or cyclic `$ref`, a branch the matcher declines), which the caller turns into
 * "this `unevaluated*` cannot be enforced".
 */
const coverageOf = (
  kind: 'properties' | 'items',
  schema: JSONSchema,
  varName: string,
  acc: string,
  ctx: MatchContext,
  match: MatchFn,
  ignoreOwnUnevaluated = false,
): Coverage | null => {
  // A `true` schema evaluates nothing; a `false` one never succeeds, so it can
  // contribute nothing either.
  if (typeof schema === 'boolean') return NONE
  if (!isSchemaObject(schema)) return null
  if (depthOf(ctx) > 8) return null

  const s = schema as Record<string, unknown>
  let coverage =
    kind === 'properties'
      ? ownPropertyCoverage(s, varName, ignoreOwnUnevaluated)
      : ownItemCoverage(s, varName, ignoreOwnUnevaluated)

  if (kind === 'items') {
    const contains = containsCoverage(s, varName, acc, ctx, match)
    if (contains === null) return null
    coverage = merge(coverage, contains)
  }

  // `$ref` and `allOf` must both succeed for the value to be valid, so their
  // annotations always count (see the module note).
  const ref = s['$ref']
  if (typeof ref === 'string') {
    if (ctx.rootSchema === undefined || ctx.seen?.has(ref)) return null
    const target = resolveRef(ref, ctx.rootSchema)
    if (target === undefined) return null
    const seen = new Set(ctx.seen ?? [])
    seen.add(ref)
    const refCoverage = coverageOf(kind, target as JSONSchema, varName, acc, { ...nest(ctx), seen }, match)
    if (refCoverage === null) return null
    coverage = merge(coverage, refCoverage)
  }

  if (Array.isArray(s['allOf'])) {
    for (const member of s['allOf'] as JSONSchema[]) {
      const memberCoverage = coverageOf(kind, member, varName, acc, nest(ctx), match)
      if (memberCoverage === null) return null
      coverage = merge(coverage, memberCoverage)
    }
  }

  // A branch annotates only when it validates, so its coverage rides on its own
  // match expression.
  for (const keyword of ['anyOf', 'oneOf'] as const) {
    if (!Array.isArray(s[keyword])) continue
    for (const branch of s[keyword] as JSONSchema[]) {
      const branchCoverage = coverageOf(kind, branch, varName, acc, nest(ctx), match)
      if (branchCoverage === null) return null
      if (branchCoverage.all === false && branchCoverage.terms.length === 0) continue
      const branchMatch = match(acc, branch, nest(ctx))
      if (branchMatch === null) return null
      coverage = merge(coverage, conditioned(branchCoverage, branchMatch))
    }
  }

  if ('if' in s) {
    const ifMatch = match(acc, s['if'] as JSONSchema, nest(ctx))
    if (ifMatch === null) return null
    for (const [keyword, cond] of [
      ['if', ifMatch],
      ['then', ifMatch],
      ['else', `!(${ifMatch})`],
    ] as const) {
      if (!(keyword in s)) continue
      const branchCoverage = coverageOf(kind, s[keyword] as JSONSchema, varName, acc, nest(ctx), match)
      if (branchCoverage === null) return null
      coverage = merge(coverage, conditioned(branchCoverage, cond))
    }
  }

  const dependentSchemas = s['dependentSchemas']
  if (typeof dependentSchemas === 'object' && dependentSchemas !== null && !Array.isArray(dependentSchemas)) {
    for (const [trigger, sub] of Object.entries(dependentSchemas as Record<string, JSONSchema>)) {
      const subCoverage = coverageOf(kind, sub, varName, acc, nest(ctx), match)
      if (subCoverage === null) return null
      coverage = merge(coverage, conditioned(subCoverage, `${JSON.stringify(trigger)} in (${acc} as object)`))
    }
  }

  return coverage
}

/**
 * The `unevaluatedProperties` conjunct for an object accessor: every own key the
 * schema's other keywords did not evaluate must satisfy the unevaluated
 * subschema (and `false` means there must be no such key).
 *
 * Returns `undefined` when the keyword is absent or constrains nothing (a `true`
 * schema, or a node whose other keywords already sweep every key), and `null`
 * when it cannot be proven inline.
 */
export const unevaluatedPropertiesExpr = (
  acc: string,
  schema: JSONSchema,
  ctx: MatchContext,
  match: MatchFn,
): string | null | undefined => {
  if (!isSchemaObject(schema)) return undefined
  const s = schema as Record<string, unknown>
  if (!('unevaluatedProperties' in s)) return undefined
  const unevaluated = s['unevaluatedProperties']
  if (unevaluated === true) return undefined

  const d = depthOf(ctx)
  const keyVar = `_uk${d}`
  const coverage = coverageOf('properties', schema, keyVar, acc, ctx, match, true)
  if (coverage === null) return null
  if (coverage.all) return undefined

  const rec = `(${acc} as Record<string, unknown>)`
  const covered = coverage.terms.length > 0 ? orJoin(coverage.terms) : null

  if (unevaluated === false) {
    // No coverage at all means no key may exist.
    if (covered === null) return `Object.keys(${rec}).length === 0`
    return `Object.keys(${rec}).every((${keyVar}) => ${covered})`
  }

  const valueMatch = match(`${rec}[${keyVar}]`, unevaluated as JSONSchema, nest(ctx))
  if (valueMatch === null) return null
  if (valueMatch === 'true') return undefined
  return covered === null
    ? `Object.keys(${rec}).every((${keyVar}) => ${valueMatch})`
    : `Object.keys(${rec}).every((${keyVar}) => ${covered} || ${valueMatch})`
}

/**
 * The `unevaluatedItems` conjunct for an array accessor — the index counterpart
 * of {@link unevaluatedPropertiesExpr}.
 */
export const unevaluatedItemsExpr = (
  acc: string,
  schema: JSONSchema,
  ctx: MatchContext,
  match: MatchFn,
): string | null | undefined => {
  if (!isSchemaObject(schema)) return undefined
  const s = schema as Record<string, unknown>
  if (!('unevaluatedItems' in s)) return undefined
  const unevaluated = s['unevaluatedItems']
  if (unevaluated === true) return undefined

  const d = depthOf(ctx)
  const indexVar = `_un${d}`
  const itemVar = `_ue${d}`
  const coverage = coverageOf('items', schema, indexVar, acc, ctx, match, true)
  if (coverage === null) return null
  if (coverage.all) return undefined

  // `any[]`, not `unknown[]`, for the same reason as {@link recordOf}: a tuple
  // position is read more than once (its type test, then that type's
  // constraint) and a cast expression is not a reference, so nothing narrows
  // between the reads and `(x as unknown[])[0].length` failed to compile.
  const elements = `(${acc} as any[])`
  const covered = coverage.terms.length > 0 ? orJoin(coverage.terms) : null

  if (unevaluated === false) {
    if (covered === null) return `${acc}.length === 0`
    return `${elements}.every((_, ${indexVar}) => ${covered})`
  }

  const valueMatch = match(itemVar, unevaluated as JSONSchema, nest(ctx))
  if (valueMatch === null) return null
  if (valueMatch === 'true') return undefined
  return covered === null
    ? `${elements}.every((${itemVar}) => ${valueMatch})`
    : `${elements}.every((${itemVar}, ${indexVar}) => ${covered} || ${valueMatch})`
}
