import { regexFlagsFor } from '@amritk/helpers/escape-regex-pattern'
import { getDefaultValue } from '@amritk/helpers/get-default-value'
import { declaresKey, readKey } from '@amritk/helpers/read-key'
import { refToName } from '@amritk/helpers/ref-to-name'
import { isSchemaObject } from '@amritk/helpers/schema-guards'
import type { JSONSchema } from 'json-schema-typed/draft-2020-12'

import { NO_FORMATS } from './enforced-keywords'
import { emitRepairWalk, repairWalkNameFor } from './generate-repair-walk'
import { createSubschemaMatcher } from './generate-validator-function'
import { namedTest, type RepairContext, schemaMap, subschema } from './repair-context'

/**
 * The name of the position-lookup half generated for a `$ref`'s target. A repair
 * has to cross a file boundary the same way validation and coercion do.
 */
export const repairLookupNameFor = (ref: string, typeSuffix: string): string => `repair${refToName(ref, typeSuffix)}At`

/**
 * The lookup emitted for one schema node, as the name of its function, or `null`
 * when nothing at or under that node can be repaired.
 *
 * `null` is load-bearing rather than an optimisation, the same way it is in the
 * coercion pass: a subtree that offers nothing to repair toward is emitted as
 * nothing at all, so a schema with one defaulted field does not grow a lookup
 * over everything else.
 */
type Lookup = string | null

/**
 * Whether a node describes an object it can build: it says `type: object`, or
 * it says nothing about its type and only describes properties. Such a node is
 * repaired by building the object and filling what it requires, rather than by
 * a literal that leaves every nested requirement to a later pass.
 */
const isObjectish = (node: Record<string, unknown>): boolean => {
  const type = readKey(node, 'type')
  if (type === 'object') return true
  return type === undefined && (declaresKey(node, 'properties') || declaresKey(node, 'required'))
}

/** True when the schema itself names the value it wants. */
const namesItsValue = (node: Record<string, unknown>): boolean =>
  declaresKey(node, 'default') || declaresKey(node, 'const') || declaresKey(node, 'enum')

/** The `required` keys a node lists, own strings only. */
const requiredKeys = (node: Record<string, unknown>): string[] => {
  const required = readKey(node, 'required')
  return Array.isArray(required) ? required.filter((key): key is string => typeof key === 'string') : []
}

/**
 * The lookup a `false` schema answers with: the position is removed. One per
 * file, since every `false` asks the same question.
 */
const dropLookup = (ctx: RepairContext): string => {
  if (ctx.drop !== null) return ctx.drop
  ctx.drop = '_repairDrop'
  ctx.helpers.push(`const _repairDrop: RepairLookup = (segments, i) => (i === segments.length ? REPAIR_DROP : null)`)
  return ctx.drop
}

/**
 * A node's `if` and the lookups of the branches it can take, or `null` when it
 * has no `if` or neither branch offers anything. The test is settled first, so
 * a branch an `if: true` or `if: false` never takes is never emitted — it would
 * be a function nothing calls.
 */
const conditionalBranches = (
  node: Record<string, unknown>,
  ctx: RepairContext,
): { test: boolean | string; thenLookup: Lookup; elseLookup: Lookup } | null => {
  const ifSchema = subschema(node, 'if')
  if (ifSchema === undefined) return null
  const thenSchema = subschema(node, 'then')
  const elseSchema = subschema(node, 'else')
  if (thenSchema === undefined && elseSchema === undefined) return null
  const test = namedTest(ifSchema, ctx)
  const thenLookup = test !== false && thenSchema !== undefined ? emitLookup(thenSchema, ctx) : null
  const elseLookup = test !== true && elseSchema !== undefined ? emitLookup(elseSchema, ctx) : null
  return thenLookup === null && elseLookup === null ? null : { test, thenLookup, elseLookup }
}

/**
 * The conditional half of a node: what its `if`/`then`/`else` and its `allOf`
 * entries answer, as an expression over `segments`, `i` and `value`, or `null`
 * when they offer nothing.
 *
 * The `if` is evaluated against the instance the lookup was handed, so a
 * position under a union is repaired toward the branch the document takes —
 * the same branch `validateX` judged it under.
 */
const conditionalAnswer = (node: Record<string, unknown>, ctx: RepairContext): string | null => {
  const parts: string[] = []
  const call = (lookup: Lookup): string => (lookup === null ? 'null' : `${lookup}(segments, i, value)`)

  const branches = conditionalBranches(node, ctx)
  if (branches !== null) {
    const { test, thenLookup, elseLookup } = branches
    if (test === true) {
      if (thenLookup !== null) parts.push(call(thenLookup))
    } else if (test === false) {
      if (elseLookup !== null) parts.push(call(elseLookup))
    } else {
      parts.push(`(${test}(value) ? ${call(thenLookup)} : ${call(elseLookup)})`)
    }
  }

  const allOf = readKey(node, 'allOf')
  if (Array.isArray(allOf)) {
    for (const entry of allOf as JSONSchema[]) {
      const lookup = emitLookup(entry, ctx)
      if (lookup !== null) parts.push(call(lookup))
    }
  }

  return parts.length === 0 ? null : parts.join(' ?? ')
}

/**
 * Emits the function that builds a missing or wrong-typed object in one step:
 * the schema's own value (or `{}`), every required key filled through the
 * node's lookup, and then whatever the conditional branches the built object
 * takes require on top. Each child is built one level deeper, and past
 * `MAX_FILL_DEPTH` nothing more is filled, which is what bounds a definition
 * that requires itself.
 */
const emitFill = (node: Record<string, unknown>, self: string, id: number, ctx: RepairContext): string => {
  const literal = namesItsValue(node) ? getDefaultValue(node as JSONSchema) : '{}'
  const base = literal.startsWith('{') ? literal : '{}'
  const steps: string[] = requiredKeys(node).map((key) => `fillKey(o, ${JSON.stringify(key)}, ${self}, depth)`)

  // The branches are asked about the object being built, so a discriminator
  // filled above picks the branch whose requirements come next.
  const branches = conditionalBranches(node, ctx)
  if (branches !== null) {
    const { test, thenLookup, elseLookup } = branches
    const answer = (lookup: Lookup): string => (lookup === null ? 'null' : `${lookup}(NO_SEGMENTS, 0, o)`)
    if (test === true && thenLookup !== null) steps.push(`fillInto(o, ${answer(thenLookup)}, depth)`)
    else if (test === false && elseLookup !== null) steps.push(`fillInto(o, ${answer(elseLookup)}, depth)`)
    else if (typeof test === 'string') {
      steps.push(`fillInto(o, ${test}(o) ? ${answer(thenLookup)} : ${answer(elseLookup)}, depth)`)
    }
  }
  const allOf = readKey(node, 'allOf')
  if (Array.isArray(allOf)) {
    for (const entry of allOf as JSONSchema[]) {
      const lookup = emitLookup(entry, ctx)
      if (lookup !== null) steps.push(`fillInto(o, ${lookup}(NO_SEGMENTS, 0, o), depth)`)
    }
  }

  const name = `_repairFill${id}`
  const lines =
    steps.length === 0
      ? [`const ${name}: RepairThunk = (_depth, into) => into ?? ${base}`]
      : [
          `const ${name}: RepairThunk = (depth, into) => {`,
          // The outermost fill starts the budget every level of it shares.
          `  if (into === undefined && depth === 0) fillBegin()`,
          `  const o: Record<string, unknown> = into ?? ${base}`,
          `  if (depth < MAX_FILL_DEPTH) {`,
          ...steps.map((step) => `    ${step}`),
          `  }`,
          `  return o`,
          `}`,
        ]
  ctx.helpers.push(lines.join('\n'))
  return name
}

/**
 * What a node answers for its own position — the expression returned when the
 * lookup has walked every segment. `null` when the schema offers nothing.
 */
const ownAnswer = (node: Record<string, unknown>, self: string, id: number, ctx: RepairContext): string | null => {
  const marker = readKey(node, 'x-repair')
  if (marker === 'drop') return 'REPAIR_DROP'
  if (isObjectish(node)) return emitFill(node, self, id, ctx)

  // A union written as conditionals says nothing about its type itself: the
  // branch the value takes is the schema to repair toward.
  if (readKey(node, 'type') === undefined && !namesItsValue(node)) {
    const conditional = conditionalAnswer(node, ctx)
    if (conditional !== null) return conditional
  }

  const literal = getDefaultValue(node as JSONSchema)
  if (literal === 'undefined') return null
  const name = `_repairValue${id}`
  ctx.helpers.push(`const ${name}: RepairThunk = () => (${literal})`)
  return name
}

/**
 * Emits the lookup for one node: a function from a position's pointer segments
 * (read from `segments[i]` on) and the instance at this node to what that
 * position repairs to.
 *
 * Reaching the last segment means the position *is* this node, so the answer is
 * its own. Otherwise the segment picks a child — a declared property, an array
 * index, a pattern, `additionalProperties` — and the rest are handed down with
 * the child's value. Whatever the node's own keywords do not answer, its
 * conditional branches may. Children are reached through their own emitted
 * lookups rather than inlined, which is what keeps a recursive schema from
 * expanding forever — a `$ref` is a call, resolved when it is taken.
 */
const emitLookup = (schema: JSONSchema, ctx: RepairContext): Lookup => {
  if (schema === false) return dropLookup(ctx)
  if (!isSchemaObject(schema)) return null
  if (ctx.lookups.has(schema)) return ctx.lookups.get(schema) ?? null
  const node = schema as Record<string, unknown>

  const ref = readKey(node, '$ref')
  if (typeof ref === 'string') {
    const name = repairLookupNameFor(ref, ctx.typeSuffix)
    ctx.lookups.set(schema, name)
    return name
  }

  // Claimed before the children are emitted, so a node reached again while its
  // own children are being worked out answers with the same name.
  const id = ctx.next()
  const name = `_repairAt${id}`
  ctx.lookups.set(schema, name)

  const own = ownAnswer(node, name, id, ctx)
  const descent = emitDescent(node, id, ctx)
  const conditional = conditionalAnswer(node, ctx)

  if (own === null && descent === null && conditional === null) {
    ctx.lookups.set(schema, null)
    return null
  }

  // The branches answer first. A branch the instance takes constrains the same
  // value its parent's property does — a path parameter's `required` is `const:
  // true` there and a plain boolean here — and the parent's default would
  // satisfy the parent and fail the branch. A branch that says nothing about the
  // position answers `null` and the parent's own keywords decide.
  const deeper =
    descent !== null && conditional !== null
      ? `${conditional} ?? ${descent}(segments, i, value)`
      : descent !== null
        ? `${descent}(segments, i, value)`
        : (conditional ?? 'null')
  const body = [`  if (i === segments.length) return ${own ?? 'null'}`, `  return ${deeper}`]
  const parameter = body.some((line) => /\bvalue\b/.test(line)) ? 'value' : '_value'
  ctx.helpers.push([`const ${name}: RepairLookup = (segments, i, ${parameter}) => {`, ...body, `}`].join('\n'))
  return name
}

/**
 * The half of a node's lookup that steps into a child, as the name of its
 * function, or `null` when no child has anything to repair.
 */
const emitDescent = (node: Record<string, unknown>, id: number, ctx: RepairContext): string | null => {
  const properties = schemaMap(node, 'properties') ?? {}
  const children = Object.entries(properties)
    .map(([key, child]) => [key, emitLookup(child, ctx)] as const)
    .filter((entry): entry is readonly [string, string] => entry[1] !== null)

  // Map positions: a key the schema did not name is reached through the
  // `patternProperties` entry whose regex it matches, and only when none does,
  // through `additionalProperties` — a schema, or `false`, which removes the key.
  // That is the same division the validator draws, so a repair lands on the
  // subschema that produced the error. Every pattern is kept, lookup or not,
  // because a key one claims is not `additionalProperties`'s to answer.
  const patternProperties = schemaMap(node, 'patternProperties') ?? {}
  const patterns = Object.entries(patternProperties).map(([source, child]) => ({
    source,
    lookup: emitLookup(child, ctx),
  }))
  const additional = subschema(node, 'additionalProperties')
  const additionalLookup = additional === undefined ? null : emitLookup(additional, ctx)
  const mapped = additionalLookup !== null || patterns.some((pattern) => pattern.lookup !== null)

  const prefixItems = readKey(node, 'prefixItems')
  const tuple = Array.isArray(prefixItems) ? (prefixItems as JSONSchema[]) : []
  const tupleLookups = tuple.map((item) => emitLookup(item, ctx))

  const items = readKey(node, 'items')
  const itemsSchema =
    typeof items === 'boolean' || (typeof items === 'object' && items !== null && !Array.isArray(items))
  const itemsLookup = itemsSchema ? emitLookup(items as JSONSchema, ctx) : null

  const indexed = tupleLookups.some((lookup) => lookup !== null) || itemsLookup !== null
  if (children.length === 0 && !mapped && !indexed) return null

  const name = `_repairChild${id}`
  const lines: string[] = [`const ${name}: RepairLookup = (segments, i, value) => {`]
  lines.push(`  const head = segments[i] as string`)
  lines.push(`  const next = i + 1`)

  // Once a map can answer, every declared key has to be claimed here, the ones
  // with nothing to repair included: a declared property is never an
  // `additionalProperties` position, and letting it fall through would repair
  // it toward the wrong subschema.
  const declared = mapped ? Object.keys(properties) : children.map(([key]) => key)
  // A schema with no `type` can carry array and object keywords at once, and an
  // index segment says nothing about which of the two the value was. Once a map
  // can answer, an index stays with the array keywords whenever there are any.
  const arrayKeywords = tuple.length > 0 || itemsSchema
  const indexBlock = indexed || (mapped && arrayKeywords)

  // A key that fails `propertyNames` is reported at its own position, the same
  // pointer a wrong value there is reported at. Replacing the value cannot fix
  // the key, so that position is not answered at all; deeper positions are
  // about the value and stay repairable.
  const nameSchema = readKey(node, 'propertyNames')
  const keyCheck = nameSchema === undefined ? true : namedTest(nameSchema as JSONSchema, ctx)
  if (keyCheck === false) lines.push(`  if (next === segments.length) return null`)
  if (typeof keyCheck === 'string') lines.push(`  if (next === segments.length && !${keyCheck}(head)) return null`)

  const child = `childAt(value, head)`
  if (declared.length > 0) {
    const lookups = new Map(children)
    lines.push(`  switch (head) {`)
    for (const key of declared) {
      const lookup = lookups.get(key)
      lines.push(
        `    case ${JSON.stringify(key)}: return ${lookup === undefined ? 'null' : `${lookup}(segments, next, ${child})`}`,
      )
    }
    lines.push(`  }`)
  }

  // Array positions arrive as decimal index segments. The tuple positions the
  // schema named are answered by their own lookups; everything past them is
  // `items`, which is one schema for every remaining index.
  if (indexBlock) {
    lines.push(`  const index = Number(head)`)
    lines.push(`  if (Number.isInteger(index) && index >= 0) {`)
    tupleLookups.forEach((lookup, position) => {
      if (lookup === null) return
      lines.push(`    if (index === ${position}) return ${lookup}(segments, next, ${child})`)
    })
    if (itemsLookup !== null)
      lines.push(`    if (index >= ${tuple.length}) return ${itemsLookup}(segments, next, ${child})`)
    if (mapped && arrayKeywords) lines.push(`    return null`)
    lines.push(`  }`)
  }

  if (mapped && patterns.length > 0) {
    // Compiled once at module load, and by `new RegExp` for the same reason the
    // validator does it: the source is schema text, and a literal would let it
    // close a comment or start a new one.
    const regexNames = patterns.map((pattern, index) => {
      const regexName = `_repairPattern${id}_${index}`
      ctx.helpers.push(
        `const ${regexName} = new RegExp(${JSON.stringify(pattern.source)}, ${JSON.stringify(regexFlagsFor(pattern.source))})`,
      )
      return regexName
    })
    const answer = (lookup: string | null): string => (lookup === null ? 'null' : `${lookup}(segments, next, ${child})`)
    const only = patterns[0]
    if (patterns.length === 1 && only !== undefined) {
      lines.push(`  if (${regexNames[0]}.test(head)) return ${answer(only.lookup)}`)
    } else {
      // The validator applies *every* pattern a key matches, so a key two
      // patterns claim has to satisfy both, and the error says nothing about
      // which one it broke. Repairing toward either could fail the other, so
      // such a key is not answered; one pattern alone is unambiguous.
      lines.push(`  const claims = [${regexNames.join(', ')}].filter((pattern) => pattern.test(head))`)
      lines.push(`  if (claims.length > 1) return null`)
      patterns.forEach((pattern, index) => {
        lines.push(`  if (claims[0] === ${regexNames[index]}) return ${answer(pattern.lookup)}`)
      })
    }
  }

  // Every key no pattern claimed belongs to `additionalProperties`, so when there
  // is one it is the last word rather than `null`.
  lines.push(
    additionalLookup === null ? `  return null` : `  return ${additionalLookup}(segments, next, ${child})`,
    `}`,
  )
  const text = lines.join('\n')
  // A node whose only children are by index never reads the key as a key.
  ctx.helpers.push(
    /\bvalue\b/.test(text.slice(text.indexOf('\n'))) ? text : text.replace('i, value) => {', 'i, _value) => {'),
  )
  return name
}

/**
 * Generates the repairing half of a validator file: the position lookup, the
 * single-pass walk when the schema is one it covers, and the `repairX` that runs
 * one or the other.
 *
 * The lookup answers what a position repairs to, and both engines ask it, so
 * they cannot land on different values. The walk checks and repairs every
 * position in one pass; the loop — validate, repair the reported positions,
 * validate again — is what every other schema gets. Either way, what is
 * reported is the error the validator would have produced, and nothing
 * second-guesses it.
 */
export const generateRepairFunction = (
  schema: JSONSchema,
  typeName: string,
  typeSuffix = '',
  options: {
    /** The whole document, for a test that reads a `$ref`'s target. */
    readonly rootSchema?: Record<string, unknown>
    /** The `format` names the validator enforces, so a test agrees with it. */
    readonly formats?: ReadonlySet<string>
    /** Whether to emit the single-pass walk, decided over the whole schema graph. */
    readonly walk?: boolean
  } = {},
): { code: string } => {
  const helpers: string[] = []
  let counter = 0
  const rootSchema = options.rootSchema ?? (isSchemaObject(schema) ? (schema as Record<string, unknown>) : undefined)
  const matcher = createSubschemaMatcher(typeSuffix, rootSchema, options.formats ?? NO_FORMATS, '_repair')
  const ctx: RepairContext = {
    typeSuffix,
    helpers,
    next: () => counter++,
    matcher,
    lookups: new Map(),
    tests: new Map(),
    drop: null,
  }

  const lookup = emitLookup(schema, ctx)
  const lookupName = `repair${typeName}At`
  const walkName = repairWalkNameFor(typeName)
  const walker =
    options.walk === true
      ? emitRepairWalk(schema, { repair: ctx, typeName, rootSchema, lookupFor: (node) => emitLookup(node, ctx) })
      : null
  const declarations = [...matcher.declarations(helpers.join('\n')), ...helpers]

  const parts = [
    ...(declarations.length > 0 ? [declarations.join('\n\n'), ''] : []),
    `export const ${lookupName}: RepairLookup = ${lookup === null ? '() => null' : lookup}`,
    '',
    ...(options.walk === true ? [`export const ${walkName}: RepairWalk = ${walker ?? '(value) => value'}`, ''] : []),
    `export const repair${typeName} = (input: unknown, options?: RepairOptions | string): RepairResult<${typeName}> =>`,
    options.walk === true
      ? `  runRepairWalk<${typeName}>(input, options, ${walkName})`
      : `  runRepairLoop<${typeName}>(input, options, validate${typeName}, ${lookupName}, coerce${typeName}Value)`,
  ]

  return { code: parts.join('\n') }
}
