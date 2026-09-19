import { regexFlagsFor } from '@amritk/helpers/escape-regex-pattern'
import { declaresKey, readKey } from '@amritk/helpers/read-key'
import { refToName } from '@amritk/helpers/ref-to-name'
import { isSchemaObject } from '@amritk/helpers/schema-guards'
import type { JSONSchema } from 'json-schema-typed/draft-2020-12'

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
}

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
 * Every scalar type a node offers, when *all* it offers are scalars — an
 * array-form `type`, or a union whose branches each declare one.
 *
 * A union is not a reason to give up on coercing: `string | { … }` is the
 * commonest shape in a hand-written config schema, and a number written where
 * the short form goes has exactly one sensible reading. What matters is that the
 * reading is forced rather than picked, which is what `coerceUnion` decides at
 * runtime — it needs the candidates, not a choice made here.
 *
 * A branch that is not a plain scalar type (an object, a `$ref`, another
 * combinator) contributes no candidate but does not disqualify the union: it
 * simply cannot take a scalar, so it never competes for one.
 */
const unionScalarTypes = (schema: Record<string, unknown>): readonly string[] | null => {
  const declared = readKey(schema, 'type')
  if (Array.isArray(declared)) {
    const types = declared.filter((entry): entry is string => typeof entry === 'string')
    return types.length > 0 && types.every((type) => COERCIBLE_TYPES.has(type)) ? types : null
  }

  // A union node that says nothing else about the value itself. `type` alongside
  // the branches would narrow them, and reading the branches without it would
  // ignore what the node said.
  if (declared !== undefined) return null
  const branches = readKey(schema, 'anyOf') ?? readKey(schema, 'oneOf')
  if (!Array.isArray(branches) || branches.length === 0) return null

  const types: string[] = []
  for (const branch of branches) {
    if (!isSchemaObject(branch as JSONSchema)) return null
    const type = soleScalarType(branch as Record<string, unknown>)
    // Only a *bare* scalar branch offers a candidate. One carrying constraints
    // (`{ type: 'string', pattern: … }`) still does — the coercion makes it a
    // string and the validator judges the rest — but one carrying a `$ref` or a
    // nested combinator is a shape this cannot reason about.
    if (type !== null) types.push(type)
    else if (
      declaresObjectKeys(branch as Record<string, unknown>) ||
      declaresArrayItems(branch as Record<string, unknown>)
    )
      continue
    else if (readKey(branch as Record<string, unknown>, 'type') === 'object') continue
    else if (readKey(branch as Record<string, unknown>, 'type') === 'array') continue
    else return null
  }
  return types.length > 0 ? types : null
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
 * Only the positions where the schema says exactly one thing about the value are
 * coerced. A combinator does not: `anyOf: [{ type: 'string' }, { type: 'number' }]`
 * gives two answers and no way to choose between them, and a coercion pass that
 * guesses is worse than one that declines — it turns a value the caller wrote
 * into a different one and reports nothing. Those positions are left exactly as
 * they arrived, and the validator that runs next judges them as it always has.
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

  const union = unionScalarTypes(node)
  if (union !== null) return (valueExpr) => `coerceUnion(${valueExpr}, ${JSON.stringify(union)})`

  const type = readKey(node, 'type')
  if (type === 'object' || (type === undefined && declaresObjectKeys(node))) return emitObjectCoercer(node, ctx)
  if (type === 'array' || (type === undefined && declaresArrayItems(node))) return emitArrayCoercer(node, ctx)

  return null
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
): { code: string; usesCoerceScalar: boolean } => {
  const helpers: string[] = []
  const hoisted: string[] = []
  let counter = 0
  const ctx: CoerceContext = { typeSuffix, helpers, hoisted, next: () => counter++ }

  const coerce = coercerFor(schema, ctx)
  const valueName = `coerce${typeName}Value`
  const body = coerce === null ? 'input' : coerce('input')

  const parts = [...hoisted, ...helpers]
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
