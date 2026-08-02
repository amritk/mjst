import { escapeRegexPattern } from '@amritk/helpers/escape-regex-pattern'
import { resolveRef } from '@amritk/helpers/resolve-ref'
import { isSchemaObject } from '@amritk/helpers/schema-guards'
import type { JSONSchema } from 'json-schema-typed/draft-2020-12'

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
 * `$ref` target, a satisfied `contains` — is treated as having annotated. That is
 * sound because the emitted test is always one conjunct of a validator that
 * *also* asserts those keywords: if one of them fails the document is rejected
 * regardless of what the unevaluated term said. Only the genuinely conditional
 * applicators (`anyOf` / `oneOf` branches, `if`/`then`/`else`,
 * `dependentSchemas`) carry their condition into the expression.
 *
 * Semantics are pinned to `@amritk/runtime-validators`, which is this monorepo's
 * reference for what a schema means. The one place that visibly differs from Ajv
 * is `contains`: the interpreter publishes only the indices it actually matched,
 * where Ajv marks the whole array, and the terms below follow the interpreter.
 */

/** What a schema (and its in-place applicators) evaluates at one instance location. */
type Coverage = {
  /** Every key / index is evaluated, so an `unevaluated*` keyword has nothing left to police. */
  readonly all: boolean
  /** OR-ed boolean expressions over the key/index (and, for `contains`, the element) variable. */
  readonly terms: readonly string[]
}

const NONE: Coverage = { all: false, terms: [] }
const ALL: Coverage = { all: true, terms: [] }

/**
 * Builds the boolean expression that is TRUE when `accessor` matches `schema`.
 * Supplied by the caller so this module stays independent of how the validator
 * spells a match; `depth` lets the caller mint collision-free locals.
 */
export type UnevaluatedMatchFn = (accessor: string, schema: JSONSchema, depth: number) => string

/** How far the ref/applicator walk may recurse before it gives up and refuses. */
const MAX_COVERAGE_DEPTH = 8

/**
 * Where the walk currently is: the document `$ref`s resolve against, how deep the
 * in-place recursion has gone, and the refs already followed at this instance
 * location (so a cycle refuses instead of recursing forever).
 */
type CoverageContext = {
  readonly rootSchema: Record<string, unknown> | undefined
  readonly depth: number
  readonly seen: ReadonlySet<string>
}

/**
 * Collects the branch conditions that have to be evaluated once, before the
 * per-key loop, rather than re-run for every key. `setup` holds their `const`
 * declarations and `prefix` keeps the locals from colliding with an outer
 * unevaluated block at another nesting depth.
 */
type ConditionSink = {
  readonly setup: string[]
  readonly prefix: string
}

/** The statements to emit before {@link UnevaluatedExpression.expr}, and the test itself. */
export type UnevaluatedExpression = {
  /** `const` declarations for the branch conditions the test reads. */
  readonly setup: readonly string[]
  /** TRUE when the value has no unevaluated key / index left over. */
  readonly expr: string
}

const orJoin = (terms: readonly string[]): string =>
  terms.length === 1 ? (terms[0] as string) : `(${terms.join(' || ')})`

const nest = (ctx: CoverageContext): CoverageContext => ({ ...ctx, depth: ctx.depth + 1 })

/**
 * Binds a branch condition to a local so the per-key loop reads a boolean
 * instead of re-running a whole match expression once per key.
 */
const hoistCondition = (sink: ConditionSink, condition: string): string => {
  const name = `${sink.prefix}${sink.setup.length}`
  sink.setup.push(`const ${name} = ${condition}`)
  return name
}

/** Coverage that only counts when `condition` holds at runtime (a matched branch, a present trigger). */
const conditioned = (coverage: Coverage, condition: string): Coverage => {
  if (coverage.all) return { all: false, terms: [condition] }
  if (coverage.terms.length === 0) return NONE
  return { all: false, terms: [`(${condition} && ${orJoin(coverage.terms)})`] }
}

const merge = (into: Coverage, from: Coverage): Coverage =>
  into.all || from.all ? ALL : { all: false, terms: [...into.terms, ...from.terms] }

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
  if ('additionalProperties' in schema) return ALL
  // An `unevaluatedProperties` that is not `false` sweeps the leftovers itself,
  // so an outer one sees nothing. A `false` one sweeps nothing: it only asserts
  // that the terms below already cover every key.
  if (!ignoreOwnUnevaluated && 'unevaluatedProperties' in schema && schema['unevaluatedProperties'] !== false) {
    return ALL
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
      terms.push(`/${escapeRegexPattern(pattern)}/.test(${keyVar})`)
    }
  }
  return { all: false, terms }
}

/**
 * The index counterpart of {@link ownPropertyCoverage}. `itemVar` holds the
 * element, which only `contains` needs: a satisfied `contains` annotates exactly
 * the items it matched, so its term has to look at the value rather than the
 * position.
 */
const ownItemCoverage = (
  schema: Record<string, unknown>,
  indexVar: string,
  itemVar: string,
  ignoreOwnUnevaluated: boolean,
  ctx: CoverageContext,
  match: UnevaluatedMatchFn,
): Coverage => {
  // A tail `items` schema (2020-12) sweeps every index past the tuple, and
  // `items: false` can only succeed when there is no such index — either way the
  // array ends up fully evaluated. The draft-07 spelling puts the tail in
  // `additionalItems`, with `items` holding the tuple.
  const tupleItems = Array.isArray(schema['items'])
  if (!tupleItems && 'items' in schema) return ALL
  if (tupleItems && 'additionalItems' in schema) return ALL
  if (!ignoreOwnUnevaluated && 'unevaluatedItems' in schema && schema['unevaluatedItems'] !== false) {
    return ALL
  }

  const terms: string[] = []
  const prefix = Array.isArray(schema['prefixItems'])
    ? (schema['prefixItems'] as unknown[])
    : tupleItems
      ? (schema['items'] as unknown[])
      : null
  if (prefix && prefix.length > 0) terms.push(`${indexVar} < ${prefix.length}`)

  // `contains` publishes the indices it matched — not the whole array. That
  // distinction is the entire point of pairing `contains` with
  // `unevaluatedItems`, and it is where the interpreter (which this follows) and
  // Ajv (which marks everything) part company. When the count falls outside
  // `minContains`/`maxContains` nothing is published, but the array is invalid
  // anyway, so the term does not have to say so.
  if ('contains' in schema) {
    terms.push(match(itemVar, schema['contains'] as JSONSchema, ctx.depth))
  }

  return { all: false, terms }
}

/**
 * Coverage of `schema` and everything it applies in place, for one instance
 * location. `null` when some applicator cannot be proven inline (an unresolvable
 * or cyclic `$ref`, a `$dynamicRef`, a walk that ran too deep), which the caller
 * turns into "this `unevaluated*` cannot be enforced".
 */
const coverageOf = (
  kind: 'properties' | 'items',
  schema: JSONSchema,
  indexVar: string,
  itemVar: string,
  acc: string,
  ctx: CoverageContext,
  sink: ConditionSink,
  match: UnevaluatedMatchFn,
  ignoreOwnUnevaluated = false,
): Coverage | null => {
  // A `true` schema evaluates nothing; a `false` one never succeeds, so it can
  // contribute nothing either.
  if (typeof schema === 'boolean') return NONE
  if (!isSchemaObject(schema)) return null
  if (ctx.depth > MAX_COVERAGE_DEPTH) return null

  const s = schema as Record<string, unknown>

  // A `$dynamicRef` late-binds to whatever `$dynamicAnchor` is in the dynamic
  // scope at runtime, so there is no single target to read annotations off.
  if (typeof s['$dynamicRef'] === 'string') return null

  let coverage =
    kind === 'properties'
      ? ownPropertyCoverage(s, indexVar, ignoreOwnUnevaluated)
      : ownItemCoverage(s, indexVar, itemVar, ignoreOwnUnevaluated, ctx, match)

  // `$ref` and `allOf` must both succeed for the value to be valid, so their
  // annotations always count (see the module note).
  const ref = s['$ref']
  if (typeof ref === 'string') {
    if (ctx.rootSchema === undefined || ctx.seen.has(ref)) return null
    const target = resolveRef(ref, ctx.rootSchema)
    if (target === undefined) return null
    const seen = new Set(ctx.seen)
    seen.add(ref)
    const refCoverage = coverageOf(
      kind,
      target as JSONSchema,
      indexVar,
      itemVar,
      acc,
      { ...nest(ctx), seen },
      sink,
      match,
    )
    if (refCoverage === null) return null
    coverage = merge(coverage, refCoverage)
  }

  if (Array.isArray(s['allOf'])) {
    for (const member of s['allOf'] as JSONSchema[]) {
      const memberCoverage = coverageOf(kind, member, indexVar, itemVar, acc, nest(ctx), sink, match)
      if (memberCoverage === null) return null
      coverage = merge(coverage, memberCoverage)
    }
  }

  // A branch annotates only when it validates, so its coverage rides on its own
  // match expression.
  for (const keyword of ['anyOf', 'oneOf'] as const) {
    if (!Array.isArray(s[keyword])) continue
    for (const branch of s[keyword] as JSONSchema[]) {
      const branchCoverage = coverageOf(kind, branch, indexVar, itemVar, acc, nest(ctx), sink, match)
      if (branchCoverage === null) return null
      if (!branchCoverage.all && branchCoverage.terms.length === 0) continue
      coverage = merge(coverage, conditioned(branchCoverage, hoistCondition(sink, match(acc, branch, ctx.depth))))
    }
  }

  // `if` annotates on its own when it matches, `then` rides on the same
  // condition, and `else` on its negation. `not` is absent on purpose: a passing
  // inner schema means failure, so it never publishes anything. The condition is
  // only bound to a local once something actually depends on it, so an `if` that
  // evaluates nothing leaves no dead declaration behind.
  if ('if' in s) {
    const branches: { readonly coverage: Coverage; readonly negated: boolean }[] = []
    for (const [keyword, negated] of [
      ['if', false],
      ['then', false],
      ['else', true],
    ] as const) {
      if (!(keyword in s)) continue
      const branchCoverage = coverageOf(kind, s[keyword] as JSONSchema, indexVar, itemVar, acc, nest(ctx), sink, match)
      if (branchCoverage === null) return null
      if (!branchCoverage.all && branchCoverage.terms.length === 0) continue
      branches.push({ coverage: branchCoverage, negated })
    }
    if (branches.length > 0) {
      const ifMatch = hoistCondition(sink, match(acc, s['if'] as JSONSchema, ctx.depth))
      for (const branch of branches) {
        coverage = merge(coverage, conditioned(branch.coverage, branch.negated ? `!${ifMatch}` : ifMatch))
      }
    }
  }

  // `dependentSchemas` and the draft-07 schema form of `dependencies` apply in
  // place whenever their trigger key is present, so their coverage carries that
  // presence test.
  for (const keyword of ['dependentSchemas', 'dependencies'] as const) {
    const dependents = s[keyword]
    if (typeof dependents !== 'object' || dependents === null || Array.isArray(dependents)) continue
    for (const [trigger, sub] of Object.entries(dependents as Record<string, unknown>)) {
      // The array form of `dependencies` lists required keys — data, not a schema.
      if (Array.isArray(sub)) continue
      const subCoverage = coverageOf(kind, sub as JSONSchema, indexVar, itemVar, acc, nest(ctx), sink, match)
      if (subCoverage === null) return null
      if (!subCoverage.all && subCoverage.terms.length === 0) continue
      const present = `Object.hasOwn(${acc} as object, ${JSON.stringify(trigger)})`
      coverage = merge(coverage, conditioned(subCoverage, hoistCondition(sink, present)))
    }
  }

  return coverage
}

/**
 * The `unevaluatedProperties` test for an object accessor: every own key the
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
  rootSchema: Record<string, unknown> | undefined,
  depth: number,
  match: UnevaluatedMatchFn,
): UnevaluatedExpression | null | undefined => {
  if (!isSchemaObject(schema)) return undefined
  const s = schema as Record<string, unknown>
  if (!('unevaluatedProperties' in s)) return undefined
  const unevaluated = s['unevaluatedProperties']
  if (unevaluated === true) return undefined

  const keyVar = `_uk${depth}`
  const sink: ConditionSink = { setup: [], prefix: `_uc${depth}_` }
  const ctx: CoverageContext = { rootSchema, depth: 0, seen: new Set() }
  const coverage = coverageOf('properties', schema, keyVar, '', acc, ctx, sink, match, true)
  if (coverage === null) return null
  if (coverage.all) return undefined

  const record = `(${acc} as Record<string, unknown>)`
  const covered = coverage.terms.length > 0 ? orJoin(coverage.terms) : null

  if (unevaluated === false) {
    // No coverage at all means no key may exist.
    const expr =
      covered === null
        ? `Object.keys(${record}).length === 0`
        : `Object.keys(${record}).every((${keyVar}) => ${covered})`
    return { setup: sink.setup, expr }
  }

  const valueMatch = match(`${record}[${keyVar}]`, unevaluated as JSONSchema, depth)
  if (valueMatch === 'true') return undefined
  const expr =
    covered === null
      ? `Object.keys(${record}).every((${keyVar}) => ${valueMatch})`
      : `Object.keys(${record}).every((${keyVar}) => ${covered} || ${valueMatch})`
  return { setup: sink.setup, expr }
}

/**
 * The `unevaluatedItems` test for an array accessor — the index counterpart of
 * {@link unevaluatedPropertiesExpr}.
 */
export const unevaluatedItemsExpr = (
  acc: string,
  schema: JSONSchema,
  rootSchema: Record<string, unknown> | undefined,
  depth: number,
  match: UnevaluatedMatchFn,
): UnevaluatedExpression | null | undefined => {
  if (!isSchemaObject(schema)) return undefined
  const s = schema as Record<string, unknown>
  if (!('unevaluatedItems' in s)) return undefined
  const unevaluated = s['unevaluatedItems']
  if (unevaluated === true) return undefined

  const indexVar = `_un${depth}`
  const itemVar = `_ue${depth}`
  const sink: ConditionSink = { setup: [], prefix: `_ud${depth}_` }
  const ctx: CoverageContext = { rootSchema, depth: 0, seen: new Set() }
  const coverage = coverageOf('items', schema, indexVar, itemVar, acc, ctx, sink, match, true)
  if (coverage === null) return null
  if (coverage.all) return undefined

  const elements = `(${acc} as unknown[])`
  const covered = coverage.terms.length > 0 ? orJoin(coverage.terms) : null

  if (unevaluated === false) {
    const expr =
      covered === null ? `${elements}.length === 0` : `${elements}.every((${itemVar}, ${indexVar}) => ${covered})`
    return { setup: sink.setup, expr }
  }

  const valueMatch = match(itemVar, unevaluated as JSONSchema, depth)
  if (valueMatch === 'true') return undefined
  const expr =
    covered === null
      ? `${elements}.every((${itemVar}) => ${valueMatch})`
      : `${elements}.every((${itemVar}, ${indexVar}) => ${covered} || ${valueMatch})`
  return { setup: sink.setup, expr }
}
