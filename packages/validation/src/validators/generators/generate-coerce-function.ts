import { regexFlagsFor } from '@amritk/helpers/escape-regex-pattern'
import { declaresKey, readKey } from '@amritk/helpers/read-key'
import { refToName } from '@amritk/helpers/ref-to-name'
import { isSchemaObject } from '@amritk/helpers/schema-guards'
import type { JSONSchema } from 'json-schema-typed/draft-2020-12'

import { NO_FORMATS } from './enforced-keywords'
import { createSubschemaMatcher } from './generate-validator-function'

/**
 * The scalar types `coerceScalar` knows how to move a value toward. A node
 * declaring exactly one of these is a position where the schema is unambiguous
 * about what the value should be, which is the whole precondition for coercing
 * without guessing.
 */
const COERCIBLE_TYPES = new Set(['string', 'number', 'integer', 'boolean', 'null'])

/**
 * Builds the coercion expression for a value at some position, or `null` when
 * nothing at or under that position can be coerced.
 *
 * `null` is load-bearing rather than an optimisation: a subtree that returns it
 * is emitted as nothing at all, so a schema with one coercible field does not
 * grow a walk over everything else, and a value that reaches such a position is
 * handed back by reference.
 */
type Coercer = ((valueExpr: string) => string) | null

type CoerceContext = {
  readonly typeSuffix: string
  /** Helper declarations, in the order they must appear. */
  readonly helpers: string[]
  /** Hoisted `const`s the helpers close over, such as compiled pattern lists. */
  readonly hoisted: string[]
  /** Supplies the next unique suffix for a helper or local. */
  next: () => number
  /** Builds the branch tests a union coercion asks before it coerces anything. */
  readonly matcher: ReturnType<typeof createSubschemaMatcher>
  /** The walk a `$ref` position calls — `coerceXValue` in a validator file. */
  readonly refCoercer: (ref: string) => string
}

/**
 * Keywords that say something about a schema without constraining the value. A
 * union branch carrying only these beside its `type` is a bare scalar branch, and
 * a union of nothing else is what {@link bareScalarBranches} hands to `coerceUnion`.
 */
const ANNOTATION_KEYWORDS = new Set([
  'title',
  'description',
  '$comment',
  'examples',
  'default',
  'deprecated',
  'readOnly',
  'writeOnly',
])

/** The name of the value-coercing half generated for a `$ref`'s target. */
export const coercerNameFor = (ref: string, typeSuffix: string): string => `coerce${refToName(ref, typeSuffix)}Value`

/** The keywords that make a node an object shape worth walking. */
const declaresObjectKeys = (schema: Record<string, unknown>): boolean =>
  declaresKey(schema, 'properties') ||
  declaresKey(schema, 'patternProperties') ||
  declaresKey(schema, 'additionalProperties')

/** The keywords that make a node an array shape worth walking. */
const declaresArrayItems = (schema: Record<string, unknown>): boolean =>
  declaresKey(schema, 'items') || declaresKey(schema, 'prefixItems')

/** A schema map keyword, read as own properties only. */
const schemaMap = (schema: Record<string, unknown>, key: string): Record<string, JSONSchema> | undefined => {
  const value = readKey(schema, key)
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, JSONSchema>)
    : undefined
}

/**
 * The type a node declares, when it declares exactly one and that one is a
 * scalar this can coerce toward.
 */
const soleScalarType = (schema: Record<string, unknown>): string | null => {
  const type = readKey(schema, 'type')
  return typeof type === 'string' && COERCIBLE_TYPES.has(type) ? type : null
}

/** The scalar types an array-form `type` offers, when every one is coercible. */
const typeArrayScalars = (schema: Record<string, unknown>): readonly string[] | null => {
  const declared = readKey(schema, 'type')
  if (!Array.isArray(declared)) return null
  const types = declared.filter((entry): entry is string => typeof entry === 'string')
  return types.length > 0 && types.every((type) => COERCIBLE_TYPES.has(type)) ? types : null
}

/**
 * The scalar types a union offers, when every branch is `{ type: <scalar> }` and
 * nothing more.
 *
 * Those unions go to the runtime `coerceUnion`, which needs only the list of
 * types: with nothing but a `type` in each branch, "the value already matches a
 * branch" is exactly "its type is already on the list", so there is no branch
 * body to consult. Any other union — a branch with a constraint, an object, a
 * `$ref`, a nested combinator — is {@link emitBranchCoercer}'s, which asks each
 * branch in full.
 */
const bareScalarBranches = (branches: unknown): readonly string[] | null => {
  if (!Array.isArray(branches) || branches.length === 0) return null
  const types: string[] = []
  for (const branch of branches) {
    if (!isSchemaObject(branch as JSONSchema)) return null
    const node = branch as Record<string, unknown>
    const type = soleScalarType(node)
    if (type === null) return null
    if (Object.keys(node).some((key) => key !== 'type' && !ANNOTATION_KEYWORDS.has(key))) return null
    types.push(type)
  }
  return types
}

/**
 * Emits a named yes/no test from a body {@link createSubschemaMatcher} built, and
 * returns its name.
 *
 * A `_path` is bound only when the body reads one: a check that has to fall back
 * to collecting its errors builds them at it. Nothing reads them.
 */
const emitMatcher = (body: string, ctx: CoerceContext): string => {
  const name = `_matches${ctx.next()}`
  const parameter = /\binput\b/.test(body) ? 'input' : '_input'
  const path = /\b_path\b/.test(body) ? [`  const _path = ''`] : []
  ctx.helpers.push([`const ${name} = (${parameter}: unknown): boolean => {`, ...path, body, `}`].join('\n'))
  return name
}

/**
 * The test for one branch, by name: the shared named test the validator's own
 * emitters would call for it, or — for a body only the buffered form can
 * express — one emitted here. `true`/`false` when the answer never depends on
 * the value.
 */
const branchTest = (branch: JSONSchema, ctx: CoerceContext): boolean | string => {
  const named = ctx.matcher.named(branch)
  if (named !== null) return named
  const body = ctx.matcher.test(branch)
  return typeof body === 'string' ? emitMatcher(body, ctx) : body
}

/**
 * Emits the coercion for an `anyOf` / `oneOf` whose branches are more than bare
 * scalars: `string | { enabled: boolean }`, a `$ref` beside a literal, a union
 * nested inside another one.
 *
 * The order of preference is the whole design, and it is observable:
 *
 *  1. **A branch the value already matches wins, uncoerced.** `false` against
 *     `anyOf: [{ type: 'string' }, { const: false }]` stays `false`. Ajv tries the
 *     branches in order and coerces into the first one it can, so it answers
 *     `"false"` there — the `const` branch that was written for exactly this
 *     value is never reached. Coercion is a way to rescue a value no branch takes,
 *     never a reason to move one a branch already takes.
 *  2. **Otherwise each branch coerces the value its own way**, and a result
 *     counts only if that branch then matches it. `{ enabled: "true" }` becomes
 *     `{ enabled: true }` through the object branch; the string branch cannot
 *     take an object and never competes.
 *  3. **If branches disagree, nothing is coerced.** Two branches producing
 *     different values is two readings of what the caller meant, and this pass
 *     does not pick one — the value goes to the validator as written, which
 *     reports it. That is the same rule `coerceUnion` applies to scalars, and
 *     for the same reason: the answer must not depend on the order someone wrote
 *     the branches in. Branches that land on the *same* value agree, and that
 *     value is taken.
 *
 * "Matches" is the validator's own verdict for that branch —
 * {@link createSubschemaMatcher} emits the expression the `anyOf` / `oneOf`
 * checks themselves use — so this can never steer a value into a branch
 * `validateX` then rejects. For `oneOf` the value is then held to matching
 * exactly one branch by the validator, as always.
 */
const emitBranchCoercer = (
  schema: Record<string, unknown>,
  keyword: 'anyOf' | 'oneOf',
  ctx: CoerceContext,
): Coercer => {
  const branches = readKey(schema, keyword)
  if (!Array.isArray(branches) || branches.length === 0) return null

  // Every branch is asked before anything is emitted: one that takes anything
  // means the value always matches as it is, so there is nothing to coerce, and
  // the tests already written for the branches before it would be dead code.
  const tests: (boolean | string)[] = []
  for (const branch of branches as JSONSchema[]) {
    const test = branchTest(branch, ctx)
    if (test === true) return null
    tests.push(test)
  }

  // Likewise every branch's own coercion, so a union where none has anything to
  // coerce emits nothing at all. A branch that takes nothing (`false`) can
  // neither match nor be coerced into, and drops out of both lists.
  const live = (branches as JSONSchema[])
    .map((branch, index) => ({ name: tests[index], coerce: coercerFor(branch, ctx) }))
    .filter((entry): entry is { name: string; coerce: Coercer } => typeof entry.name === 'string')
  if (live.every(({ coerce }) => coerce === null)) return null

  const names: string[] = []
  const attempts: { coerce: (expr: string) => string; test: string }[] = []
  for (const { name, coerce } of live) {
    names.push(name)
    if (coerce !== null) attempts.push({ coerce, test: name })
  }

  const id = ctx.next()
  const name = `_coerceBranches${id}`
  const lines = [
    `const ${name} = (input: unknown): unknown => {`,
    `  if (${names.map((name) => `${name}(input)`).join(' || ')}) return input`,
  ]
  if (attempts.length === 1) {
    const [only] = attempts as [(typeof attempts)[number]]
    lines.push(`  const next = ${only.coerce('input')}`, `  return next !== input && ${only.test}(next) ? next : input`)
  } else {
    lines.push(`  let out: unknown = input`)
    attempts.forEach(({ coerce, test }, index) => {
      const local = `_next${index}`
      lines.push(
        `  const ${local} = ${coerce('input')}`,
        `  if (${local} !== input && ${test}(${local})) {`,
        `    if (out === input) out = ${local}`,
        `    else if (!valuesEqual(out, ${local})) return input`,
        `  }`,
      )
    })
    lines.push(`  return out`)
  }
  lines.push(`}`)
  ctx.helpers.push(lines.join('\n'))
  return (valueExpr) => `${name}(${valueExpr})`
}

/**
 * An `anyOf` / `oneOf` stage: `coerceUnion` for a union of bare scalar types,
 * {@link emitBranchCoercer} for anything richer.
 */
const emitUnionCoercer = (schema: Record<string, unknown>, keyword: 'anyOf' | 'oneOf', ctx: CoerceContext): Coercer => {
  const scalars = bareScalarBranches(readKey(schema, keyword))
  if (scalars !== null) return (valueExpr) => `coerceUnion(${valueExpr}, ${JSON.stringify(scalars)})`
  return emitBranchCoercer(schema, keyword, ctx)
}

/**
 * An `allOf` stage: every subschema's coercion, applied in turn.
 *
 * There is no choosing to do here, unlike a union. The value has to satisfy every
 * subschema, so each one's coercion moves it toward something the validator
 * requires anyway — `allOf: [{ $ref: base }, { properties: { retries: { type:
 * 'integer' } } }]`, the usual way to extend a definition, coerces the base's
 * fields and `retries` both. Two subschemas asking for different types at one
 * position cannot both be met, and the validator reports that whatever the
 * coercion did.
 */
const emitAllOfCoercer = (schema: Record<string, unknown>, ctx: CoerceContext): Coercer => {
  const subschemas = readKey(schema, 'allOf')
  if (!Array.isArray(subschemas)) return null
  return compose((subschemas as JSONSchema[]).map((sub) => coercerFor(sub, ctx)))
}

/**
 * An `if` / `then` / `else` stage: the value is coerced toward `then` when it
 * matches `if`, and toward `else` when it does not — the same branch the validator
 * then holds it to.
 *
 * `if` is judged on the value as it stands when this stage runs, which is after
 * the node's own properties have been coerced. It is not itself coerced into:
 * coercing a value just to make it satisfy the condition would pick the branch
 * for the caller, which is the same guess {@link emitBranchCoercer} refuses to
 * make. A condition like `properties: { kind: { const: 'oauth' } }` needs nothing
 * coerced to be read, and that is the shape it almost always has.
 */
const emitConditionalCoercer = (schema: Record<string, unknown>, ctx: CoerceContext): Coercer => {
  if (!declaresKey(schema, 'if')) return null
  const thenCoercer = declaresKey(schema, 'then') ? coercerFor(readKey(schema, 'then') as JSONSchema, ctx) : null
  const elseCoercer = declaresKey(schema, 'else') ? coercerFor(readKey(schema, 'else') as JSONSchema, ctx) : null
  if (thenCoercer === null && elseCoercer === null) return null

  const test = branchTest(readKey(schema, 'if') as JSONSchema, ctx)
  if (test === true) return thenCoercer
  if (test === false) return elseCoercer

  const name = `_coerceIf${ctx.next()}`
  const whenThen = thenCoercer === null ? 'input' : thenCoercer('input')
  const whenElse = elseCoercer === null ? 'input' : elseCoercer('input')
  ctx.helpers.push(`const ${name} = (input: unknown): unknown => (${test}(input) ? ${whenThen} : ${whenElse})`)
  return (valueExpr) => `${name}(${valueExpr})`
}

/** Runs each stage over the result of the one before, or `null` when none does anything. */
const compose = (stages: readonly Coercer[]): Coercer => {
  const present = stages.filter((stage): stage is NonNullable<Coercer> => stage !== null)
  if (present.length === 0) return null
  return (valueExpr) => present.reduce((expr, stage) => stage(expr), valueExpr)
}

/**
 * Emits an object walk: each declared property, then a single pass over the
 * remaining keys for `patternProperties` / a schema-form `additionalProperties`.
 *
 * The copy is made on first write and not before — `out ??= { ...obj }` — so an
 * object nothing coerces is returned by reference, and one where a single field
 * moved shares every other value with the input.
 */
const emitObjectCoercer = (schema: Record<string, unknown>, ctx: CoerceContext): Coercer => {
  const properties = schemaMap(schema, 'properties') ?? {}
  const patternProperties = schemaMap(schema, 'patternProperties') ?? {}
  const additional = readKey(schema, 'additionalProperties')

  const declared: { key: string; coerce: (expr: string) => string }[] = []
  for (const key of Object.keys(properties)) {
    const coerce = coercerFor(readKey(properties, key) as JSONSchema, ctx)
    if (coerce !== null) declared.push({ key, coerce })
  }

  const patterns: { source: string; coerce: (expr: string) => string }[] = []
  for (const source of Object.keys(patternProperties)) {
    const coerce = coercerFor(readKey(patternProperties, source) as JSONSchema, ctx)
    if (coerce !== null) patterns.push({ source, coerce })
  }

  const additionalCoercer =
    typeof additional === 'object' && additional !== null ? coercerFor(additional as JSONSchema, ctx) : null

  if (declared.length === 0 && patterns.length === 0 && additionalCoercer === null) return null

  const id = ctx.next()
  const name = `_coerceObject${id}`
  const lines: string[] = [
    `const ${name} = (input: unknown): unknown => {`,
    `  if (typeof input !== 'object' || input === null || Array.isArray(input)) return input`,
    `  const obj = input as Record<string, unknown>`,
    `  let out: Record<string, unknown> | null = null`,
  ]

  declared.forEach(({ key, coerce }, index) => {
    const quoted = JSON.stringify(key)
    const local = `_value${id}_${index}`
    lines.push(
      // Own properties only, where it matters: at the write. A plain `obj[key]`
      // walks the prototype chain, and this pass *writes* — with
      // `Object.prototype.flag` set by any dependency, an empty object was read as
      // carrying `flag`, coerced, and handed back with `flag` as its own,
      // inventing data the caller never sent and satisfying a `required` the input
      // actually violates. Coercing an inherited value is harmless (every walk is
      // pure) as long as the result is never written, so the `Object.hasOwn` is
      // asked only of a value that moved: on V8 it is the dearest thing in the
      // walk, and most keys do not move. `{ a: undefined }` counts as absent
      // everywhere else in this package, so it counts as absent here too.
      `  const ${local} = obj[${quoted}]`,
      `  if (${local} !== undefined) {`,
      `    const next = ${coerce(local)}`,
      `    if (next !== ${local} && Object.hasOwn(obj, ${quoted})) (out ??= { ...obj })[${quoted}] = next`,
      `  }`,
    )
  })

  if (patterns.length > 0 || additionalCoercer !== null) {
    const declaredKeys = Object.keys(properties)
    const known = `_declared${id}`
    if (declaredKeys.length > 0) {
      ctx.hoisted.push(`const ${known} = new Set(${JSON.stringify(declaredKeys)})`)
    }
    // Compiled once at module load rather than per key, and by `new RegExp` for
    // the same reason the validator does it: the source is schema text, and a
    // literal would let it close a comment or start a new one.
    const patternNames = patterns.map((pattern, index) => {
      const regexName = `_pattern${id}_${index}`
      ctx.hoisted.push(
        `const ${regexName} = new RegExp(${JSON.stringify(pattern.source)}, ${JSON.stringify(regexFlagsFor(pattern.source))})`,
      )
      return regexName
    })

    lines.push(`  for (const key of Object.keys(obj)) {`)
    if (declaredKeys.length > 0) lines.push(`    if (${known}.has(key)) continue`)
    lines.push(
      `    const value = obj[key]`,
      `    if (value === undefined) continue`,
      // Annotated, not inferred: narrowing `unknown` by `!== undefined` leaves
      // `{} | null`, and a coercion returns `unknown`, so the inferred binding
      // rejected the very thing it exists to hold.
      `    let next: unknown = value`,
    )
    patterns.forEach((pattern, index) => {
      lines.push(`    if (${patternNames[index]}.test(key)) next = ${pattern.coerce('next')}`)
    })
    if (additionalCoercer !== null) {
      // `additionalProperties` reaches only the keys no pattern claimed, which is
      // the same division the validator draws.
      const guard =
        patternNames.length === 0 ? '' : `if (!(${patternNames.map((p) => `${p}.test(key)`).join(' || ')})) `
      lines.push(`    ${guard}next = ${additionalCoercer('next')}`)
    }
    lines.push(`    if (next !== value) (out ??= { ...obj })[key] = next`, `  }`)
  }

  lines.push(`  return out ?? input`, `}`)
  ctx.helpers.push(lines.join('\n'))
  return (valueExpr) => `${name}(${valueExpr})`
}

/**
 * Emits an array walk: the tuple positions `prefixItems` names, then `items`
 * for everything past them (or for the whole array when there is no tuple).
 *
 * Same copy-on-first-write rule as the object walk, and a hole stays a hole:
 * reading one gives `undefined`, which coerces to nothing and is written back to
 * nothing.
 */
const emitArrayCoercer = (schema: Record<string, unknown>, ctx: CoerceContext): Coercer => {
  const prefixItems = readKey(schema, 'prefixItems')
  const tuple = Array.isArray(prefixItems) ? (prefixItems as JSONSchema[]) : []
  const tupleCoercers = tuple.map((item) => coercerFor(item, ctx))

  const items = readKey(schema, 'items')
  const restCoercer =
    typeof items === 'object' && items !== null && !Array.isArray(items) ? coercerFor(items as JSONSchema, ctx) : null

  if (tupleCoercers.every((coerce) => coerce === null) && restCoercer === null) return null

  const id = ctx.next()
  const name = `_coerceArray${id}`
  const lines: string[] = [
    `const ${name} = (input: unknown): unknown => {`,
    `  if (!Array.isArray(input)) return input`,
    `  let out: unknown[] | null = null`,
  ]

  tupleCoercers.forEach((coerce, index) => {
    if (coerce === null) return
    const read = `input[${index}]`
    lines.push(
      // `Object.hasOwn` rather than a length test, for the same reason the object
      // walk uses it, and at the write for the same reason: a hole reads through
      // `Array.prototype`, and writing what that coerces to would turn a hole into
      // an own element.
      `  {`,
      `    const next = ${coerce(read)}`,
      `    if (next !== ${read} && Object.hasOwn(input, ${index})) (out ??= [...input])[${index}] = next`,
      `  }`,
    )
  })

  if (restCoercer !== null) {
    lines.push(
      `  for (let i = ${tuple.length}; i < input.length; i++) {`,
      `    const value = input[i]`,
      `    const next = ${restCoercer('value')}`,
      `    if (next !== value && Object.hasOwn(input, i)) (out ??= [...input])[i] = next`,
      `  }`,
    )
  }

  lines.push(`  return out ?? input`, `}`)
  ctx.helpers.push(lines.join('\n'))
  return (valueExpr) => `${name}(${valueExpr})`
}

/**
 * The coercion for one schema node, or `null` when nothing under it coerces.
 *
 * A value is coerced only where the schema forces one reading of it. A single
 * declared type does; a union does when exactly one branch can take the value
 * (see {@link emitBranchCoercer} and `coerceUnion`). Where two readings are
 * equally good — `true` against `number | string` — a coercion pass that guesses
 * is worse than one that declines: it turns a value the caller wrote into a
 * different one and reports nothing. Those positions are left exactly as they
 * arrived, and the validator that runs next judges them as it always has.
 */
const coercerFor = (schema: JSONSchema, ctx: CoerceContext): Coercer => {
  if (!isSchemaObject(schema)) return null
  const node = schema as Record<string, unknown>

  // Every keyword that says something about the value is a stage, run in this
  // order over the result of the one before: the node's own type or shape first,
  // so an `allOf`, a union or a condition judges the value its declared
  // properties were already coerced in — the value the validator judges them
  // against. Each stage only ever moves a value toward what the validator
  // requires of it, so a value that already passes comes out untouched.
  const ref = readKey(node, '$ref')
  const scalar = soleScalarType(node)
  const typeArray = typeArrayScalars(node)
  const type = readKey(node, 'type')
  return compose([
    // Whether the target coerces anything is a question about another file, and
    // following it here would have to chase cycles. The call is cheap and
    // returns its argument when there is nothing to do.
    typeof ref === 'string' ? (valueExpr) => `${ctx.refCoercer(ref)}(${valueExpr})` : null,
    scalar !== null
      ? (valueExpr) => `coerceScalar(${valueExpr}, ${JSON.stringify(scalar)})`
      : typeArray !== null
        ? (valueExpr) => `coerceUnion(${valueExpr}, ${JSON.stringify(typeArray)})`
        : type === 'object' || (type === undefined && declaresObjectKeys(node))
          ? emitObjectCoercer(node, ctx)
          : type === 'array' || (type === undefined && declaresArrayItems(node))
            ? emitArrayCoercer(node, ctx)
            : null,
    emitAllOfCoercer(node, ctx),
    emitUnionCoercer(node, 'anyOf', ctx),
    emitUnionCoercer(node, 'oneOf', ctx),
    emitConditionalCoercer(node, ctx),
  ])
}

/**
 * What {@link generateCoerceWalk} needs beyond the schema: how names are spelled
 * in the file it is writing into.
 */
export type CoerceWalkOptions = {
  readonly typeSuffix: string
  /** The whole document, for a branch test whose `unevaluated*` has to read a `$ref`'s target. */
  readonly rootSchema?: Record<string, unknown>
  /** The `format` names being enforced, so a branch test agrees with the validator. */
  readonly formats?: ReadonlySet<string>
  /** The walk a `$ref` position calls. */
  readonly refCoercer: (ref: string) => string
  /** The yes/no test a `$ref` inside a branch test calls. */
  readonly refGuard?: (typeName: string) => string
  /** Prefix for the names the branch tests hoist, kept apart from anything else in the file. */
  readonly hoistNamespace: string
  /** Also build a yes/no test for the whole schema, over the same hoisted names. */
  readonly withRootMatch?: boolean
}

/**
 * The coercion walk for `schema`, as parts a file can place wherever it likes:
 * the declarations the walk needs (hoisted constants, branch tests, walk
 * helpers), the expression that coerces `input`, and — when asked — the body of
 * a yes/no test for the whole schema.
 *
 * Two engines write this walk. The validator file wraps it in `coerceX`; the
 * coercing parser runs it ahead of its own repair, so a document `coerceX`
 * accepts comes out of `parseX` as the same value. Both get it from here, with
 * only the names a `$ref` calls told apart.
 */
export const generateCoerceWalk = (
  schema: JSONSchema,
  options: CoerceWalkOptions,
): { declarations: string[]; expression: string | null; rootMatch: boolean | string | null } => {
  const helpers: string[] = []
  const hoisted: string[] = []
  let counter = 0
  const matcher = createSubschemaMatcher(
    options.typeSuffix,
    options.rootSchema ?? (isSchemaObject(schema) ? (schema as Record<string, unknown>) : undefined),
    options.formats ?? NO_FORMATS,
    options.hoistNamespace,
    ...(options.refGuard !== undefined ? [options.refGuard] : []),
  )
  const ctx: CoerceContext = {
    typeSuffix: options.typeSuffix,
    helpers,
    hoisted,
    next: () => counter++,
    matcher,
    refCoercer: options.refCoercer,
  }

  const coerce = coercerFor(schema, ctx)
  const rootMatch = options.withRootMatch === true ? matcher.test(schema) : null
  const reads = helpers.join('\n') + (typeof rootMatch === 'string' ? `\n${rootMatch}` : '')
  return {
    declarations: [...hoisted, ...matcher.declarations(reads), ...helpers],
    expression: coerce === null ? null : coerce('input'),
    rootMatch,
  }
}

/**
 * Generates the coercing half of a validator file: a value-coercing walk, and
 * the `coerceX` that runs it and then hands the result to `validateX`.
 *
 * Coercion is a separate pass rather than something threaded through the
 * validator, which is what keeps every error identical to the one `validateX`
 * already produced — same path, same keyword, same params, same `anyOf` branch
 * selection. The validator is the only thing that decides anything; this pass
 * only moves scalars toward what the schema asked for, and where it cannot, it
 * hands the original value straight back so the validator rejects what the
 * caller actually wrote rather than something substituted for it.
 *
 * The walk is exported because a `$ref` in another generated file needs it: a
 * coercion has to cross a file boundary the same way validation does.
 */
export const generateCoerceFunction = (
  schema: JSONSchema,
  typeName: string,
  typeSuffix = '',
  options: {
    /** The whole document, for a branch test whose `unevaluated*` has to read a `$ref`'s target. */
    readonly rootSchema?: Record<string, unknown>
    /** The `format` names the validator enforces, so a branch test agrees with it. */
    readonly formats?: ReadonlySet<string>
    /**
     * Whether the file's `isX` is a real fail-fast guard rather than a call into
     * `validateX`. Only then does `coerceX` answer valid input with it first.
     */
    readonly standaloneGuard?: boolean
  } = {},
): { code: string; usesCoerceScalar: boolean } => {
  const { declarations, expression } = generateCoerceWalk(schema, {
    typeSuffix,
    ...(options.rootSchema !== undefined ? { rootSchema: options.rootSchema } : {}),
    ...(options.formats !== undefined ? { formats: options.formats } : {}),
    refCoercer: (ref) => coercerNameFor(ref, typeSuffix),
    hoistNamespace: '_coerce',
  })
  const valueName = `coerce${typeName}Value`
  const body = expression ?? 'input'

  // A document that already passes has nothing to coerce: every stage above only
  // moves a value toward what the validator requires of it, so on a valid
  // document the walk hands back the input itself (`coerced-vs-ajv` pins that
  // over random schemas). The guard therefore answers the commonest input — a
  // JSON body whose types arrived intact — without walking it at all.
  //
  // Only a guard that stands on its own, though. One that falls back to
  // `validateX` builds every error on the way to `false`, which a coercible
  // document then pays for before its walk even starts; and emitting a yes/no
  // test here instead grew a coercing build by a third on a large OpenAPI
  // document for a gain only on input that needed nothing. Without it the walk
  // runs first and `validateX` judges once — still well ahead of Ajv.
  const passes = expression !== null && options.standaloneGuard === true ? `is${typeName}` : null

  const walk = [
    ...(declarations.length > 0 ? [declarations.join('\n\n'), ''] : []),
    `export const ${valueName} = (input: unknown): unknown => ${body}`,
    '',
    `export const coerce${typeName} = (input: unknown, _path = ''): CoercionResult<${typeName}> => {`,
    ...(passes === null ? [] : [`  if (${passes}(input)) return { valid: true, value: input as ${typeName} }`]),
    `  const value = ${valueName}(input)`,
    `  const result = validate${typeName}(value, _path)`,
    `  return result === true ? { valid: true, value: value as ${typeName} } : { valid: false, errors: result.errors }`,
    `}`,
  ].join('\n')

  return { code: walk, usesCoerceScalar: walk.includes('coerceScalar(') || walk.includes('coerceUnion(') }
}
