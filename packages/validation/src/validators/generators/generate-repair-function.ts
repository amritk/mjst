import { regexFlagsFor } from '@amritk/helpers/escape-regex-pattern'
import { getDefaultValue } from '@amritk/helpers/get-default-value'
import { readKey } from '@amritk/helpers/read-key'
import { refToName } from '@amritk/helpers/ref-to-name'
import { isSchemaObject } from '@amritk/helpers/schema-guards'
import type { JSONSchema } from 'json-schema-typed/draft-2020-12'

import { NO_FORMATS } from './enforced-keywords'
import { createSubschemaMatcher } from './generate-validator-function'

/**
 * The name of the position-lookup half generated for a `$ref`'s target. A repair
 * has to cross a file boundary the same way validation and coercion do.
 */
export const repairLookupNameFor = (ref: string, typeSuffix: string): string => `repair${refToName(ref, typeSuffix)}At`

/**
 * The walker emitted for one schema node, as source text, or `null` when nothing
 * at or under that node can be repaired.
 *
 * `null` is load-bearing rather than an optimisation, the same way it is in the
 * coercion pass: a subtree that offers nothing to repair toward is emitted as
 * nothing at all, so a schema with one defaulted field does not grow a walk over
 * everything else.
 */
type Walker = string | null

type RepairContext = {
  readonly typeSuffix: string
  /** Walker declarations, in the order they must appear. */
  readonly helpers: string[]
  /** Supplies the next unique suffix for a walker. */
  next: () => number
  /** The validator's own yes/no test for a subschema, for `propertyNames`. */
  readonly matcher: ReturnType<typeof createSubschemaMatcher>
}

/**
 * A named test of a key against `propertyNames`, `true` when every key passes,
 * or `false` when none does.
 *
 * It is the validator's own test, so the walker and `validateX` agree on which
 * keys are wrong. A body only the buffered form can express gets a function of
 * its own here, as the coercer does it.
 */
const keyTest = (nameSchema: JSONSchema, ctx: RepairContext): boolean | string => {
  const named = ctx.matcher.named(nameSchema)
  if (named !== null) return named
  const body = ctx.matcher.test(nameSchema)
  if (typeof body !== 'string') return body
  const name = `_repairKey${ctx.next()}`
  const parameter = /\binput\b/.test(body) ? 'input' : '_input'
  const path = /\b_path\b/.test(body) ? [`  const _path = ''`] : []
  ctx.helpers.push([`const ${name} = (${parameter}: unknown): boolean => {`, ...path, body, `}`].join('\n'))
  return name
}

/**
 * The literal a position repairs to, or `null` when the schema offers nothing.
 *
 * `getDefaultValue` is the parser's own table — the single source of truth for
 * "what is a valid instance of this schema" — which is why it was hoisted into
 * `@amritk/helpers` rather than reimplemented here. A repairing validator and a
 * coercing parser landing on *different* repaired values would be far worse than
 * either one's choice of value, and sharing the table is what makes that
 * impossible rather than merely unlikely.
 */
const fallbackLiteral = (schema: JSONSchema): string | null => {
  const literal = getDefaultValue(schema)
  return literal === 'undefined' ? null : literal
}

/** A schema map keyword, read as own properties only. */
const schemaMap = (schema: Record<string, unknown>, key: string): Record<string, JSONSchema> | undefined => {
  const value = readKey(schema, key)
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, JSONSchema>)
    : undefined
}

/**
 * Emits the walker for one node: a function from the remaining pointer segments
 * to the thunk that repairs that position.
 *
 * Zero segments means the position *is* this node, so the answer is this node's
 * own fallback. Otherwise the first segment picks a child and the rest are
 * handed down. Children are reached through their own emitted walkers rather
 * than inlined, which is what keeps a recursive schema from expanding forever —
 * a `$ref` is a call, resolved when it is taken rather than when it is written.
 */
const emitWalker = (schema: JSONSchema, ctx: RepairContext): Walker => {
  if (!isSchemaObject(schema)) return null
  const node = schema as Record<string, unknown>

  const ref = readKey(node, '$ref')
  if (typeof ref === 'string') return repairLookupNameFor(ref, ctx.typeSuffix)

  const own = fallbackLiteral(schema)

  const properties = schemaMap(node, 'properties') ?? {}
  const children = Object.entries(properties)
    .map(([key, child]) => [key, emitWalker(child, ctx)] as const)
    .filter((entry): entry is readonly [string, string] => entry[1] !== null)

  // Map positions: a key the schema did not name is reached through the
  // `patternProperties` entry whose regex it matches, and only when none does,
  // through a schema-form `additionalProperties`. That is the same division the
  // validator and the coercer draw, so a repair lands on the subschema that
  // produced the error. Every pattern is kept, walker or not, because a key one
  // claims is not `additionalProperties`'s to answer even when it has nothing to
  // repair toward.
  const patternProperties = schemaMap(node, 'patternProperties') ?? {}
  const patterns = Object.entries(patternProperties).map(([source, child]) => ({
    source,
    walker: emitWalker(child, ctx),
  }))
  const additional = readKey(node, 'additionalProperties')
  const additionalWalker =
    typeof additional === 'object' && additional !== null ? emitWalker(additional as JSONSchema, ctx) : null
  const mapped = additionalWalker !== null || patterns.some((pattern) => pattern.walker !== null)

  const prefixItems = readKey(node, 'prefixItems')
  const tuple = Array.isArray(prefixItems) ? (prefixItems as JSONSchema[]) : []
  const tupleWalkers = tuple.map((item) => emitWalker(item, ctx))

  const items = readKey(node, 'items')
  const itemsWalker =
    typeof items === 'object' && items !== null && !Array.isArray(items) ? emitWalker(items as JSONSchema, ctx) : null

  const hasChildren =
    children.length > 0 || mapped || itemsWalker !== null || tupleWalkers.some((walker) => walker !== null)
  if (own === null && !hasChildren) return null

  const id = ctx.next()
  const name = `_repairAt${id}`
  const lines: string[] = [
    `const ${name}: RepairLookup = (segments) => {`,
    `  if (segments.length === 0) return ${own === null ? 'null' : `() => (${own})`}`,
  ]

  if (hasChildren) {
    // Once a map can answer, every declared key has to be claimed here, the ones
    // with nothing to repair included: a declared property is never an
    // `additionalProperties` position, and letting it fall through would repair
    // it toward the wrong subschema.
    const declared = mapped ? Object.keys(properties) : children.map(([key]) => key)
    const indexed = tupleWalkers.some((walker) => walker !== null) || itemsWalker !== null
    // A schema with no `type` can carry array and object keywords at once, and an
    // index segment says nothing about which of the two the value was. Once a map
    // can answer, an index stays with the array keywords whenever there are any,
    // which is what it did before the map existed.
    const arrayKeywords = tuple.length > 0 || (typeof items === 'object' && items !== null && !Array.isArray(items))
    const indexBlock = indexed || (mapped && arrayKeywords)

    // A key that fails `propertyNames` is reported at its own position, the same
    // pointer a wrong value there is reported at. Replacing the value cannot fix
    // the key, so that position is not answered at all: otherwise a valid value
    // was overwritten and the key's error listed as repaired. Deeper positions
    // are about the value and stay repairable.
    const nameSchema = readKey(node, 'propertyNames')
    const keyCheck = nameSchema === undefined ? true : keyTest(nameSchema as JSONSchema, ctx)

    // A bare `additionalProperties` map answers every key the same way, so the
    // key itself is never read.
    const readsHead =
      declared.length > 0 || indexBlock || (mapped && patterns.length > 0) || typeof keyCheck === 'string'
    lines.push(`  const [${readsHead ? 'head' : ''}, ...rest] = segments as [string, ...string[]]`)
    if (keyCheck === false) lines.push(`  if (rest.length === 0) return null`)
    if (typeof keyCheck === 'string') lines.push(`  if (rest.length === 0 && !${keyCheck}(head)) return null`)

    if (declared.length > 0) {
      const walkers = new Map(children)
      lines.push(`  switch (head) {`)
      for (const key of declared) {
        const walker = walkers.get(key)
        lines.push(`    case ${JSON.stringify(key)}: return ${walker === undefined ? 'null' : `${walker}(rest)`}`)
      }
      lines.push(`  }`)
    }

    // Array positions arrive as decimal index segments. The tuple positions the
    // schema named are answered by their own walkers; everything past them is
    // `items`, which is one schema for every remaining index.
    if (indexBlock) {
      lines.push(`  const index = Number(head)`)
      lines.push(`  if (Number.isInteger(index) && index >= 0) {`)
      tupleWalkers.forEach((walker, position) => {
        if (walker === null) return
        lines.push(`    if (index === ${position}) return ${walker}(rest)`)
      })
      if (itemsWalker !== null) {
        lines.push(`    if (index >= ${tuple.length}) return ${itemsWalker}(rest)`)
      }
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
      const answer = (walker: string | null): string => (walker === null ? 'null' : `${walker}(rest)`)
      const only = patterns[0]
      if (patterns.length === 1 && only !== undefined) {
        lines.push(`  if (${regexNames[0]}.test(head)) return ${answer(only.walker)}`)
      } else {
        // The validator applies *every* pattern a key matches, so a key two
        // patterns claim has to satisfy both, and the error says nothing about
        // which one it broke. Repairing toward either could fail the other, so
        // such a key is not answered; one pattern alone is unambiguous.
        lines.push(`  const claims = [${regexNames.join(', ')}].filter((pattern) => pattern.test(head))`)
        lines.push(`  if (claims.length > 1) return null`)
        patterns.forEach((pattern, index) => {
          lines.push(`  if (claims[0] === ${regexNames[index]}) return ${answer(pattern.walker)}`)
        })
      }
    }
  }

  // Every key no pattern claimed belongs to `additionalProperties`, so when there
  // is one it is the last word rather than `null`.
  lines.push(additionalWalker === null ? `  return null` : `  return ${additionalWalker}(rest)`, `}`)
  ctx.helpers.push(lines.join('\n'))
  return name
}

/**
 * Generates the repairing half of a validator file: the position lookup, and the
 * `repairX` that drives validate-repair-revalidate over it.
 *
 * The loop is the whole design. Coercion runs first, so anything that was only
 * written in the wrong type is already right and never counts as a repair. What
 * is left is judged by the very same `validateX` the package already emits, and
 * *its errors* are what drive the repair: each one names a position and a
 * reason, the lookup answers with a value for that position, and the error the
 * repair came from is what gets reported. Nothing second-guesses the validator,
 * and there is no parallel set of rules about what is wrong that could disagree
 * with it.
 *
 * Re-validating after a round is what catches the cases one pass cannot see: a
 * required object that was missing entirely is repaired into existence, and only
 * then can its own children be judged. A position is repaired at most once, so
 * the loop terminates on progress rather than on the pass cap.
 */
export const generateRepairFunction = (
  schema: JSONSchema,
  typeName: string,
  typeSuffix = '',
  options: {
    /** The whole document, for a `propertyNames` test that reads a `$ref`'s target. */
    readonly rootSchema?: Record<string, unknown>
    /** The `format` names the validator enforces, so a key test agrees with it. */
    readonly formats?: ReadonlySet<string>
  } = {},
): { code: string } => {
  const helpers: string[] = []
  let counter = 0
  const matcher = createSubschemaMatcher(
    typeSuffix,
    options.rootSchema ?? (isSchemaObject(schema) ? (schema as Record<string, unknown>) : undefined),
    options.formats ?? NO_FORMATS,
    '_repair',
  )
  const ctx: RepairContext = { typeSuffix, helpers, next: () => counter++, matcher }

  const walker = emitWalker(schema, ctx)
  const lookupName = `repair${typeName}At`
  const declarations = [...matcher.declarations(helpers.join('\n')), ...helpers]

  const parts = [
    ...(declarations.length > 0 ? [declarations.join('\n\n'), ''] : []),
    `export const ${lookupName}: RepairLookup = ${walker === null ? '() => null' : walker}`,
    '',
    `export const repair${typeName} = (input: unknown, _path = ''): RepairResult<${typeName}> => {`,
    `  let value = coerce${typeName}Value(input)`,
    `  const repairs: ValidationError[] = []`,
    `  const done = new Set<string>()`,
    ``,
    `  for (let pass = 0; pass < MAX_REPAIR_PASSES; pass++) {`,
    `    const result = validate${typeName}(value, _path)`,
    `    if (result === true) return { valid: true, value: value as ${typeName}, repairs }`,
    ``,
    `    const applied = applyRepairs(value, result.errors, ${lookupName}, done)`,
    `    // Nothing moved, so nothing on a further pass would either.`,
    `    if (applied.repaired.length === 0) return { valid: false, value, errors: result.errors, repairs }`,
    `    value = applied.value`,
    `    repairs.push(...applied.repaired)`,
    `  }`,
    ``,
    `  const final = validate${typeName}(value, _path)`,
    `  return final === true`,
    `    ? { valid: true, value: value as ${typeName}, repairs }`,
    `    : { valid: false, value, errors: final.errors, repairs }`,
    `}`,
  ]

  return { code: parts.join('\n') }
}
