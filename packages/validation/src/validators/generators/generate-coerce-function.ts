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
}

/**
 * Keywords that say something about a schema without constraining the value. A
 * union branch carrying only these beside its `type` is a bare scalar branch, and
 * a union of nothing else is what {@link scalarUnionTypes} hands to `coerceUnion`.
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

/**
 * Every scalar type a node offers, when *all* it offers are bare scalars — an
 * array-form `type`, or a union whose every branch is `{ type: <scalar> }` and
 * nothing more.
 *
 * Those positions go to the runtime `coerceUnion`, which needs only the list of
 * types: with nothing but a `type` in each branch, "the value already matches a
 * branch" is exactly "its type is already on the list", so there is no branch
 * body to consult. Any other union — a branch with a constraint, an object, a
 * `$ref`, a nested combinator — is {@link emitBranchCoercer}'s, which asks each
 * branch in full.
 */
const scalarUnionTypes = (schema: Record<string, unknown>): readonly string[] | null => {
  const declared = readKey(schema, 'type')
  if (Array.isArray(declared)) {
    const types = declared.filter((entry): entry is string => typeof entry === 'string')
    return types.length > 0 && types.every((type) => COERCIBLE_TYPES.has(type)) ? types : null
  }

  // A union node that says nothing else about the value itself. `type` alongside
  // the branches would narrow them, and reading the branches without it would
  // ignore what the node said. Both keywords at once is two unions, which the
  // branch coercer composes.
  if (declared !== undefined) return null
  const anyOf = readKey(schema, 'anyOf')
  const oneOf = readKey(schema, 'oneOf')
  if ((anyOf === undefined) === (oneOf === undefined)) return null
  const branches = anyOf ?? oneOf
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
  const exprs: string[] = []
  for (const branch of branches as JSONSchema[]) {
    const expr = ctx.matcher.match(branch, 'input')
    if (expr === 'true') return null
    exprs.push(expr)
  }

  // Likewise every branch's own coercion, so a union where none has anything to
  // coerce emits nothing at all. A branch that takes nothing (`false`) can
  // neither match nor be coerced into, and drops out of both lists.
  const live = (branches as JSONSchema[])
    .map((branch, index) => ({ expr: exprs[index] as string, coerce: coercerFor(branch, ctx) }))
    .filter(({ expr }) => expr !== 'false')
  if (live.every(({ coerce }) => coerce === null)) return null

  const tests: string[] = []
  const attempts: { coerce: (expr: string) => string; test: string }[] = []
  for (const { expr, coerce } of live) {
    const name = `_matches${ctx.next()}`
    const parameter = /\binput\b/.test(expr) ? 'input' : '_input'
    // `_path` is there because a branch that has to fall back to collecting its
    // errors, or delegates to a `$ref`, builds them at it. Nothing reads them.
    ctx.helpers.push(`const ${name} = (${parameter}: unknown, _path = ''): boolean => ${expr}`)
    tests.push(name)
    if (coerce !== null) attempts.push({ coerce, test: name })
  }

  const id = ctx.next()
  const name = `_coerceBranches${id}`
  const lines = [
    `const ${name} = (input: unknown): unknown => {`,
    `  if (${tests.map((test) => `${test}(input)`).join(' || ')}) return input`,
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
      // Own properties only. A plain `obj[key]` walks the prototype chain, and
      // this pass *writes*: with `Object.prototype.flag` set by any dependency, an
      // empty object was read as carrying `flag`, coerced, and handed back with
      // `flag` as its own — inventing data the caller never sent, and satisfying
      // a `required` the input actually violates. An absent key is not a value to
      // coerce, and `{ a: undefined }` counts as absent everywhere else in this
      // package, so it counts as absent here too.
      `  const ${local} = Object.hasOwn(obj, ${quoted}) ? obj[${quoted}] : undefined`,
      `  if (${local} !== undefined) {`,
      `    const next = ${coerce(local)}`,
      `    if (next !== ${local}) (out ??= { ...obj })[${quoted}] = next`,
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
      // `Object.hasOwn` rather than a length test, for the same reason the
      // properties above use it: a hole reads through `Array.prototype`, and
      // coercing what it finds there would turn a hole into an own element.
      `  if (Object.hasOwn(input, ${index})) {`,
      `    const next = ${coerce(read)}`,
      `    if (next !== ${read}) (out ??= [...input])[${index}] = next`,
      `  }`,
    )
  })

  if (restCoercer !== null) {
    lines.push(
      `  for (let i = ${tuple.length}; i < input.length; i++) {`,
      `    if (!Object.hasOwn(input, i)) continue`,
      `    const value = input[i]`,
      `    const next = ${restCoercer('value')}`,
      `    if (next !== value) (out ??= [...input])[i] = next`,
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

  const ref = readKey(node, '$ref')
  if (typeof ref === 'string') {
    // Whether the target coerces anything is a question about another file, and
    // following it here would have to chase cycles. The call is cheap and
    // returns its argument when there is nothing to do.
    const name = coercerNameFor(ref, ctx.typeSuffix)
    return (valueExpr) => `${name}(${valueExpr})`
  }

  const scalar = soleScalarType(node)
  if (scalar !== null) return (valueExpr) => `coerceScalar(${valueExpr}, ${JSON.stringify(scalar)})`

  const union = scalarUnionTypes(node)
  if (union !== null) return (valueExpr) => `coerceUnion(${valueExpr}, ${JSON.stringify(union)})`

  // The node's own shape first, then each union over the result: the branches
  // of a `type: 'object'` node judge the object its properties were coerced in,
  // which is the object the validator judges them against.
  const type = readKey(node, 'type')
  const stages: Coercer[] = [
    type === 'object' || (type === undefined && declaresObjectKeys(node))
      ? emitObjectCoercer(node, ctx)
      : type === 'array' || (type === undefined && declaresArrayItems(node))
        ? emitArrayCoercer(node, ctx)
        : null,
    emitBranchCoercer(node, 'anyOf', ctx),
    emitBranchCoercer(node, 'oneOf', ctx),
  ]
  const present = stages.filter((stage): stage is NonNullable<Coercer> => stage !== null)
  if (present.length === 0) return null
  return (valueExpr) => present.reduce((expr, stage) => stage(expr), valueExpr)
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
  } = {},
): { code: string; usesCoerceScalar: boolean } => {
  const helpers: string[] = []
  const hoisted: string[] = []
  let counter = 0
  const matcher = createSubschemaMatcher(
    typeSuffix,
    options.rootSchema ?? (isSchemaObject(schema) ? (schema as Record<string, unknown>) : undefined),
    options.formats ?? NO_FORMATS,
    '_coerce',
  )
  const ctx: CoerceContext = { typeSuffix, helpers, hoisted, next: () => counter++, matcher }

  const coerce = coercerFor(schema, ctx)
  const valueName = `coerce${typeName}Value`
  const body = coerce === null ? 'input' : coerce('input')

  const parts = [...hoisted, ...matcher.declarations(helpers.join('\n')), ...helpers]
  const walk = [
    ...(parts.length > 0 ? [parts.join('\n\n'), ''] : []),
    `export const ${valueName} = (input: unknown): unknown => ${body}`,
    '',
    `export const coerce${typeName} = (input: unknown, _path = ''): CoercionResult<${typeName}> => {`,
    `  const value = ${valueName}(input)`,
    `  const result = validate${typeName}(value, _path)`,
    `  return result === true ? { valid: true, value: value as ${typeName} } : { valid: false, errors: result.errors }`,
    `}`,
  ].join('\n')

  return { code: walk, usesCoerceScalar: walk.includes('coerceScalar(') || walk.includes('coerceUnion(') }
}
