import { escapeRegexPattern } from '@amritk/helpers/escape-regex-pattern'
import { multipleOfPassExpr } from '@amritk/helpers/multiple-of-check'
import { resolveRef } from '@amritk/helpers/resolve-ref'
import { safeAccessor } from '@amritk/helpers/safe-accessor'
import {
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
import { maxLengthPassExpr, minLengthPassExpr } from '@amritk/helpers/string-length-check'
import type { JSONSchema } from 'json-schema-typed/draft-2020-12'

import { generateDeepEqualCheck } from './generate-deep-equal-check'
import { generateEnumCheck } from './generate-enum-check'
import { generateUniqueItemsCheck } from './generate-unique-items-check'
import { unevaluatedItemsExpr, unevaluatedPropertiesExpr } from './unevaluated-match'

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
  'prefixItems',
  'additionalItems',
  'contains',
  'minContains',
  'maxContains',
  'required',
  'properties',
  'patternProperties',
  'propertyNames',
  'dependentRequired',
  'dependentSchemas',
  'minProperties',
  'maxProperties',
  'additionalProperties',
  'unevaluatedProperties',
  'unevaluatedItems',
  '$ref',
  'allOf',
  'anyOf',
  'oneOf',
  'not',
  'if',
  'then',
  'else',
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
  '$dynamicAnchor',
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

/**
 * What the matcher needs beyond the schema node itself: the root document (to
 * resolve `$ref`), the recursion depth (which seeds collision-free loop variable
 * names and caps expression growth), and the `$ref` pointers already open on this
 * path (a cycle cannot be inlined, so it bails rather than recursing forever).
 */
export type MatchContext = {
  readonly rootSchema?: Record<string, unknown>
  readonly depth?: number
  readonly seen?: ReadonlySet<string>
}

const depthOf = (ctx: MatchContext): number => ctx.depth ?? 0

/** One level deeper: same document and open-ref set, next variable generation. */
const nest = (ctx: MatchContext): MatchContext => ({ ...ctx, depth: depthOf(ctx) + 1 })

const isObjectExpr = (acc: string): string => `typeof ${acc} === "object" && ${acc} !== null && !Array.isArray(${acc})`

/** The `Record` view of an accessor an object check has already proven. */
const recordOf = (acc: string): string => `(${acc} as Record<string, unknown>)`

/** The `patternProperties` map, or `null` when the schema declares none. */
const patternEntriesOf = (schema: JSONSchema): [string, JSONSchema][] | null => {
  const source = (schema as Record<string, unknown>)['patternProperties']
  if (typeof source !== 'object' || source === null || Array.isArray(source)) return null
  return Object.entries(source as Record<string, JSONSchema>)
}

/**
 * String-family constraint checks (no type assertion). Every JSON Schema string
 * keyword only asserts on string instances, so these are combined with a
 * `typeof === "string"` — either as the assertion (a `type: 'string'` schema) or
 * as a guard (`typeof !== "string" || …` for a type-less schema).
 */
const stringConstraints = (acc: string, schema: JSONSchema): string[] => {
  const c: string[] = []
  if (hasPattern(schema)) c.push(`/${escapeRegexPattern(schema.pattern)}/.test(${acc})`)
  // Lengths are code-point counts, not UTF-16 units (see string-length-check):
  // `"💩".length` is 2, so a raw `.length` accepted it against `minLength: 2` —
  // a value Ajv rejects — and rejected `"💩💩"` against `maxLength: 2`.
  if (hasMinLength(schema)) c.push(minLengthPassExpr(acc, schema.minLength))
  if (hasMaxLength(schema)) c.push(maxLengthPassExpr(acc, schema.maxLength))
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

/**
 * The positional `prefixItems` (or its draft-07 array-`items` spelling) plus the
 * tail schema that applies from `prefixItems.length` onward — `items` in
 * 2020-12, `additionalItems` in draft-07. Kept together because reading one
 * without the other is exactly how a tuple's tail went unchecked.
 */
const tupleShape = (schema: JSONSchema): { prefix: readonly JSONSchema[] | null; tail: unknown } => {
  const s = schema as Record<string, unknown>
  const declared = s['prefixItems']
  if (Array.isArray(declared)) return { prefix: declared as JSONSchema[], tail: s['items'] }
  if (Array.isArray(s['items'])) return { prefix: s['items'] as JSONSchema[], tail: s['additionalItems'] }
  return { prefix: null, tail: undefined }
}

/** Array-family constraint checks (no `Array.isArray` assertion). `null` when an item schema is unprovable. */
const arrayConstraints = (acc: string, schema: JSONSchema, ctx: MatchContext): string[] | null => {
  const c: string[] = []
  const d = depthOf(ctx)
  const elements = `(${acc} as unknown[])`

  if (hasMinItems(schema)) c.push(`${acc}.length >= ${schema.minItems}`)
  if (hasMaxItems(schema)) c.push(`${acc}.length <= ${schema.maxItems}`)
  if (hasUniqueItems(schema) && schema.uniqueItems === true) {
    // A raw `JSON.stringify` key is key-order sensitive, so `[{a:1,b:2},{b:2,a:1}]`
    // read as distinct — the exact bug generateUniqueItemsCheck exists to fix, and
    // this matcher promises soundness in *both* directions.
    c.push(generateUniqueItemsCheck(acc, schema))
  }

  const { prefix, tail } = tupleShape(schema)
  if (prefix) {
    // A tuple position constrains only the element that exists there —
    // `prefixItems` never requires presence (that is `minItems`' job).
    for (let i = 0; i < prefix.length; i++) {
      const positional = subschemaMatchExpr(`${elements}[${i}]`, prefix[i] as JSONSchema, nest(ctx))
      if (positional === null) return null
      if (positional === 'true') continue
      c.push(`(${acc}.length <= ${i} || ${positional})`)
    }
    if (tail === false) {
      c.push(`${acc}.length <= ${prefix.length}`)
    } else if (tail !== undefined && tail !== true) {
      const el = `_i${d}`
      const tailMatch = subschemaMatchExpr(el, tail as JSONSchema, nest(ctx))
      if (tailMatch === null) return null
      if (tailMatch !== 'true')
        c.push(`${elements}.every((${el}, _x${d}) => _x${d} < ${prefix.length} || ${tailMatch})`)
    }
  } else if ('items' in (schema as Record<string, unknown>)) {
    // `items: false` with no tuple positions admits only the empty array. The
    // `hasItems` guard is false for a boolean `items`, so reading it through that
    // guard (as this did) left `[1]` matching `{ type: 'array', items: false }`.
    if ((schema as Record<string, unknown>)['items'] === false) {
      c.push(`${acc}.length === 0`)
    } else if (hasItems(schema)) {
      const el = `_i${d}`
      const itemMatch = subschemaMatchExpr(el, schema.items, nest(ctx))
      if (itemMatch === null) return null
      if (itemMatch !== 'true') c.push(`${elements}.every((${el}) => ${itemMatch})`)
    }
  }

  const contains = containsConstraint(acc, schema, ctx)
  if (contains === null) return null
  c.push(...contains)

  const unevaluated = unevaluatedItemsExpr(acc, schema, ctx, subschemaMatchExpr)
  if (unevaluated === null) return null
  if (unevaluated !== undefined) c.push(unevaluated)

  return c
}

/**
 * `contains` with its `minContains` / `maxContains` bounds, counted over the
 * array. `minContains: 0` with no `maxContains` constrains nothing (every array
 * satisfies it), which is why the count is skipped entirely there rather than
 * emitted as a tautology.
 */
const containsConstraint = (acc: string, schema: JSONSchema, ctx: MatchContext): string[] | null => {
  const s = schema as Record<string, unknown>
  if (!('contains' in s)) return []
  const d = depthOf(ctx)
  const min = typeof s['minContains'] === 'number' ? (s['minContains'] as number) : 1
  const max = typeof s['maxContains'] === 'number' ? (s['maxContains'] as number) : undefined
  if (min === 0 && max === undefined) return []

  const el = `_c${d}`
  const match = subschemaMatchExpr(el, s['contains'] as JSONSchema, nest(ctx))
  if (match === null) return null
  const count = `(${acc} as unknown[]).filter((${el}) => ${match}).length`
  const bounds: string[] = []
  if (min > 0) bounds.push(`${count} >= ${min}`)
  if (max !== undefined) bounds.push(`${count} <= ${max}`)
  return bounds
}

/** Object-family constraint checks (no object-type assertion). `null` when a property schema is unprovable. */
const objectConstraints = (acc: string, schema: JSONSchema, ctx: MatchContext): string[] | null => {
  const c: string[] = []
  const d = depthOf(ctx)
  const required = new Set<string>(hasRequired(schema) ? schema.required : [])
  // Every accessor here is guarded by an object test that runs first (either the
  // `type: 'object'` assertion or the type-less `!isObject(x) || …` shape), but
  // TypeScript cannot see that through the emitted `&&` chain: reading a property
  // off an `unknown` — or off the `object` a nullable-object property narrows to
  // — is a compile error in the generated file. The cast states what the guard
  // already proved.
  const rec = recordOf(acc)

  if (hasProperties(schema)) {
    for (const [key, propSchema] of Object.entries(schema.properties)) {
      const propAcc = safeAccessor(rec, key)
      const propMatch = subschemaMatchExpr(propAcc, propSchema as JSONSchema, nest(ctx))
      if (propMatch === null) return null
      if (required.has(key)) {
        c.push(
          propMatch === 'true'
            ? `${JSON.stringify(key)} in ${rec}`
            : `(${JSON.stringify(key)} in ${rec} && ${propMatch})`,
        )
      } else if (propMatch !== 'true') {
        c.push(`(${propAcc} === undefined || ${propMatch})`)
      }
      required.delete(key)
    }
  }
  for (const key of required) c.push(`${JSON.stringify(key)} in ${rec}`)

  if (hasMinProperties(schema)) c.push(`Object.keys(${rec}).length >= ${schema.minProperties}`)
  if (hasMaxProperties(schema)) c.push(`Object.keys(${rec}).length <= ${schema.maxProperties}`)

  // The by-key-name keywords (`patternProperties`, `additionalProperties`,
  // `propertyNames`) all walk the same key list, so they share one `.every`.
  const keyTerms = keyWalkTerms(`_k${d}`, `_v${d}`, schema, ctx)
  if (keyTerms === null) return null
  if (keyTerms.length > 0) {
    const needsValue = keyTerms.some((term) => term.usesValue)
    const body = keyTerms.map((term) => term.expr).join(' && ')
    c.push(
      needsValue
        ? `Object.keys(${rec}).every((_k${d}) => { const _v${d} = ${rec}[_k${d}]; return ${body}; })`
        : `Object.keys(${rec}).every((_k${d}) => ${body})`,
    )
  }

  const dependent = dependentTerms(rec, acc, schema, ctx)
  if (dependent === null) return null
  c.push(...dependent)

  const unevaluated = unevaluatedPropertiesExpr(acc, schema, ctx, subschemaMatchExpr)
  if (unevaluated === null) return null
  if (unevaluated !== undefined) c.push(unevaluated)

  return c
}

/**
 * The per-key terms of the object key walk: every `patternProperties` entry the
 * key matches, the `additionalProperties` fallback for keys no `properties` name
 * and no pattern claims, and `propertyNames` (which constrains the key itself,
 * not its value). `usesValue` tells the caller whether the shared loop has to
 * bind the value at all — `propertyNames` alone does not.
 */
const keyWalkTerms = (
  keyVar: string,
  valueVar: string,
  schema: JSONSchema,
  ctx: MatchContext,
): { expr: string; usesValue: boolean }[] | null => {
  const terms: { expr: string; usesValue: boolean }[] = []
  const patterns = patternEntriesOf(schema)
  const declared = hasProperties(schema) ? Object.keys(schema.properties as Record<string, unknown>) : []

  if (patterns) {
    for (const [pattern, sub] of patterns) {
      const match = subschemaMatchExpr(valueVar, sub, nest(ctx))
      if (match === null) return null
      if (match === 'true') continue
      terms.push({ expr: `(!/${escapeRegexPattern(pattern)}/.test(${keyVar}) || ${match})`, usesValue: true })
    }
  }

  const additional = (schema as Record<string, unknown>)['additionalProperties']
  if (additional !== undefined && additional !== true) {
    // `additionalProperties` owns exactly the keys no `properties` name and no
    // `patternProperties` regex claims — policing more would reject values the
    // schema allows, policing fewer would accept ones it forbids.
    const guards: string[] = []
    if (declared.length > 0) guards.push(`!${JSON.stringify(declared)}.includes(${keyVar})`)
    if (patterns) for (const [pattern] of patterns) guards.push(`!/${escapeRegexPattern(pattern)}/.test(${keyVar})`)
    const unclaimed = guards.length > 0 ? guards.join(' && ') : null

    if (additional === false) {
      terms.push({ expr: unclaimed === null ? 'false' : `!(${unclaimed})`, usesValue: false })
    } else {
      const match = subschemaMatchExpr(valueVar, additional as JSONSchema, nest(ctx))
      if (match === null) return null
      if (match !== 'true') {
        terms.push({ expr: unclaimed === null ? match : `(!(${unclaimed}) || ${match})`, usesValue: true })
      }
    }
  }

  const names = (schema as Record<string, unknown>)['propertyNames']
  if (names !== undefined) {
    // Keys are always strings, so the name subschema is matched against the key.
    const match = subschemaMatchExpr(keyVar, names as JSONSchema, nest(ctx))
    if (match === null) return null
    if (match !== 'true') terms.push({ expr: match, usesValue: false })
  }

  return terms
}

/**
 * `dependentRequired` (a present trigger key demands its dependencies) and
 * `dependentSchemas` (a present trigger key subjects the *whole object* to
 * another schema).
 */
const dependentTerms = (rec: string, acc: string, schema: JSONSchema, ctx: MatchContext): string[] | null => {
  const s = schema as Record<string, unknown>
  const terms: string[] = []

  const dependentRequired = s['dependentRequired']
  if (typeof dependentRequired === 'object' && dependentRequired !== null && !Array.isArray(dependentRequired)) {
    for (const [trigger, deps] of Object.entries(dependentRequired as Record<string, unknown>)) {
      if (!Array.isArray(deps) || deps.length === 0) continue
      const present = deps.map((dep) => `${JSON.stringify(dep)} in ${rec}`).join(' && ')
      terms.push(`(!(${JSON.stringify(trigger)} in ${rec}) || ${deps.length === 1 ? present : `(${present})`})`)
    }
  }

  const dependentSchemas = s['dependentSchemas']
  if (typeof dependentSchemas === 'object' && dependentSchemas !== null && !Array.isArray(dependentSchemas)) {
    for (const [trigger, sub] of Object.entries(dependentSchemas as Record<string, unknown>)) {
      const match = subschemaMatchExpr(acc, sub as JSONSchema, nest(ctx))
      if (match === null) return null
      if (match === 'true') continue
      terms.push(`(!(${JSON.stringify(trigger)} in ${rec}) || ${match})`)
    }
  }

  return terms
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
 * `ctx.depth` seeds the loop variable names so nested walks never shadow one
 * another, and caps how far the expression may grow.
 */
export const subschemaMatchExpr = (accessor: string, schema: JSONSchema, ctx: MatchContext = {}): string | null => {
  // Boolean schemas: `true` matches everything, `false` matches nothing.
  if (schema === true) return 'true'
  if (schema === false) return 'false'
  if (!isSchemaObject(schema)) return null

  // Any keyword we neither handle nor know to be a pure annotation could narrow
  // the value set; matching would then be unsound, so bail.
  for (const key of Object.keys(schema)) {
    if (!HANDLED_KEYWORDS.has(key) && !ANNOTATION_KEYWORDS.has(key)) return null
  }

  // Runaway guard: each combinator level multiplies the emitted expression, and
  // a pathological schema could otherwise blow the generated file up.
  if (depthOf(ctx) > 8) return null

  const checks: string[] = []

  // `$ref` applies *alongside* its siblings in 2020-12 (draft-07's "a $ref wins
  // and its siblings are ignored" rule is gone), so the target's match is one
  // more conjunct — not a replacement for the rest of this node.
  const refCheck = refMatch(accessor, schema, ctx)
  if (refCheck === null) return null
  if (refCheck !== 'true') checks.push(refCheck)

  // Combinators. Each is exact when its members are, so they compose without
  // weakening the both-directions guarantee this matcher promises — and that is
  // what lets `items`, `contains`, `not`, `patternProperties` and friends handle
  // a union instead of silently skipping it.
  const combinators = combinatorChecks(accessor, schema, ctx)
  if (combinators === null) return null
  checks.push(...combinators)

  // `const` — a single exact value, compared structurally so an object/array
  // const (which no `===` could ever match) is proven rather than declined.
  if (hasConst(schema)) checks.push(`(${generateDeepEqualCheck(accessor, schema.const)})`)

  // `enum` — membership in a fixed set (generateEnumCheck is exact). An empty
  // enum admits no value at all.
  if (hasEnum(schema)) {
    if (schema.enum.length === 0) return 'false'
    checks.push(generateEnumCheck(accessor, schema.enum))
  }

  if (hasType(schema)) {
    const typeChecks = buildTypedChecks(accessor, schema, ctx)
    if (typeChecks === null) return null
    checks.push(...typeChecks)
  } else if (Array.isArray(schema.type)) {
    // An array-form `type` is a disjunction, and each member carries only its own
    // family's constraints (`{ type: ['string','number'], minLength: 2 }` bounds
    // the string branch, not the number one). Bailing here — the old behaviour —
    // left every nullable subschema unprovable.
    const branches: string[] = []
    for (const type of schema.type as string[]) {
      const branch = buildTypedChecks(accessor, { ...schema, type } as JSONSchema & { type: string }, ctx)
      if (branch === null) return null
      branches.push(branch.length === 1 ? (branch[0] as string) : `(${branch.join(' && ')})`)
    }
    // No type at all admits no value; every other keyword still has to hold.
    checks.push(
      branches.length === 0 ? 'false' : branches.length === 1 ? (branches[0] as string) : `(${branches.join(' || ')})`,
    )
  } else {
    const typeless = buildTypelessChecks(accessor, schema, ctx)
    if (typeless === null) return null
    checks.push(...typeless)
  }

  // A schema with no proven constraint matches every value.
  if (checks.length === 0) return 'true'
  return checks.length === 1 ? (checks[0] as string) : `(${checks.join(' && ')})`
}

/**
 * The `$ref` target's match, `'true'` when the node carries no `$ref`, or `null`
 * when the reference cannot be inlined: no root document to resolve against, a
 * target that does not exist, or a cycle (a recursive definition would expand
 * forever, so the caller falls back to whatever it does for unprovable schemas).
 */
const refMatch = (accessor: string, schema: JSONSchema, ctx: MatchContext): string | null => {
  const ref = (schema as Record<string, unknown>)['$ref']
  if (typeof ref !== 'string') return 'true'
  if (ctx.rootSchema === undefined) return null
  if (ctx.seen?.has(ref)) return null

  const target = resolveRef(ref, ctx.rootSchema)
  if (target === undefined) return null

  const seen = new Set(ctx.seen ?? [])
  seen.add(ref)
  return subschemaMatchExpr(accessor, target as JSONSchema, { ...nest(ctx), seen })
}

/**
 * `allOf` (every member matches), `anyOf` (at least one), `oneOf` (exactly one)
 * and `not` (none), or `null` when any member is beyond this matcher. Each is
 * built from member matches that are already exact in both directions, so the
 * combination is too.
 */
const combinatorChecks = (accessor: string, schema: JSONSchema, ctx: MatchContext): string[] | null => {
  const record = schema as Record<string, unknown>
  const checks: string[] = []

  for (const keyword of ['allOf', 'anyOf', 'oneOf'] as const) {
    const members = record[keyword]
    if (members === undefined) continue
    if (!Array.isArray(members) || members.length === 0) return null
    const matches: string[] = []
    for (const member of members) {
      const match = subschemaMatchExpr(accessor, member as JSONSchema, nest(ctx))
      if (match === null) return null
      matches.push(match)
    }
    if (keyword === 'allOf') {
      const constraining = matches.filter((match) => match !== 'true')
      if (constraining.length > 0) checks.push(joinAnd(constraining))
    } else if (keyword === 'anyOf') {
      if (matches.some((match) => match === 'true')) continue
      checks.push(matches.length === 1 ? (matches[0] as string) : `(${matches.join(' || ')})`)
    } else {
      // `oneOf` counts matches — a value matching two branches is invalid — so a
      // trivially-true branch cannot be dropped the way an `anyOf` one can.
      checks.push(
        matches.length === 1
          ? (matches[0] as string)
          : `((${matches.map((match) => `(${match} ? 1 : 0)`).join(' + ')}) === 1)`,
      )
    }
  }

  if ('not' in record) {
    const match = subschemaMatchExpr(accessor, record['not'] as JSONSchema, nest(ctx))
    if (match === null) return null
    if (match !== 'false') checks.push(`!(${match})`)
  }

  // `if` / `then` / `else`. Per 2020-12 a bare `then` or `else` with no `if`
  // asserts nothing, which is why they are readable keywords here at all: a
  // schema carrying one used to bail the matcher outright even though it
  // constrained nothing.
  if ('if' in record) {
    const ifMatch = subschemaMatchExpr(accessor, record['if'] as JSONSchema, nest(ctx))
    if (ifMatch === null) return null
    const branch = (keyword: 'then' | 'else'): string | null | undefined =>
      keyword in record ? subschemaMatchExpr(accessor, record[keyword] as JSONSchema, nest(ctx)) : undefined
    const thenMatch = branch('then')
    const elseMatch = branch('else')
    if (thenMatch === null || elseMatch === null) return null
    if (thenMatch !== undefined && thenMatch !== 'true') checks.push(`(!(${ifMatch}) || ${thenMatch})`)
    if (elseMatch !== undefined && elseMatch !== 'true') checks.push(`((${ifMatch}) || ${elseMatch})`)
  }

  return checks
}

/** Type assertion plus that type's constraints, for a single-`type` schema. */
const buildTypedChecks = (
  accessor: string,
  schema: JSONSchema & { type: string },
  ctx: MatchContext,
): string[] | null => {
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
      const constraints = arrayConstraints(accessor, schema, ctx)
      if (constraints === null) return null
      return [`Array.isArray(${accessor})`, ...constraints]
    }
    case 'object': {
      const constraints = objectConstraints(accessor, schema, ctx)
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
const buildTypelessChecks = (accessor: string, schema: JSONSchema, ctx: MatchContext): string[] | null => {
  const checks: string[] = []

  const strChecks = stringConstraints(accessor, schema)
  if (strChecks.length > 0) checks.push(`(typeof ${accessor} !== "string" || ${joinAnd(strChecks)})`)

  const numChecks = numberConstraints(accessor, schema, false)
  if (numChecks.length > 0) checks.push(`(typeof ${accessor} !== "number" || ${joinAnd(numChecks)})`)

  const arrChecks = arrayConstraints(accessor, schema, ctx)
  if (arrChecks === null) return null
  if (arrChecks.length > 0) checks.push(`(!Array.isArray(${accessor}) || ${joinAnd(arrChecks)})`)

  const objChecks = objectConstraints(accessor, schema, ctx)
  if (objChecks === null) return null
  if (objChecks.length > 0) checks.push(`(!(${isObjectExpr(accessor)}) || ${joinAnd(objChecks)})`)

  return checks
}

const joinAnd = (checks: string[]): string => (checks.length === 1 ? (checks[0] as string) : `(${checks.join(' && ')})`)

/**
 * True when a `$ref` node carries a keyword that constrains the value on its own.
 * 2020-12 applies a `$ref`'s siblings alongside the target, so delegating the
 * whole node to the referenced parser (which knows nothing about them) drops
 * every one of them — and a fast path built from the target's shape validator
 * skips them too.
 */
export const hasConstrainingRefSibling = (schema: JSONSchema): boolean => {
  if (!isSchemaObject(schema) || !('$ref' in (schema as Record<string, unknown>))) return false
  return Object.keys(schema as Record<string, unknown>).some((key) => key !== '$ref' && !ANNOTATION_KEYWORDS.has(key))
}

/**
 * Whether {@link subschemaMatchExpr} can build an exact matcher for `schema`.
 * The generation-time guard uses this to decide whether a `contains`,
 * `propertyNames`, or `dependentSchemas` subschema is enforceable.
 */
export const canMatchSubschema = (schema: JSONSchema, rootSchema?: Record<string, unknown>): boolean =>
  subschemaMatchExpr('_x', schema, rootSchema ? { rootSchema } : {}) !== null
