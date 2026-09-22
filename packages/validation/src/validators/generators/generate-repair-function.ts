import { getDefaultValue } from '@amritk/helpers/get-default-value'
import { readKey } from '@amritk/helpers/read-key'
import { refToName } from '@amritk/helpers/ref-to-name'
import { isSchemaObject } from '@amritk/helpers/schema-guards'
import type { JSONSchema } from 'json-schema-typed/draft-2020-12'

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

  const prefixItems = readKey(node, 'prefixItems')
  const tuple = Array.isArray(prefixItems) ? (prefixItems as JSONSchema[]) : []
  const tupleWalkers = tuple.map((item) => emitWalker(item, ctx))

  const items = readKey(node, 'items')
  const itemsWalker =
    typeof items === 'object' && items !== null && !Array.isArray(items) ? emitWalker(items as JSONSchema, ctx) : null

  const hasChildren = children.length > 0 || itemsWalker !== null || tupleWalkers.some((walker) => walker !== null)
  if (own === null && !hasChildren) return null

  const id = ctx.next()
  const name = `_repairAt${id}`
  const lines: string[] = [
    `const ${name}: RepairLookup = (segments) => {`,
    `  if (segments.length === 0) return ${own === null ? 'null' : `() => (${own})`}`,
  ]

  if (hasChildren) {
    lines.push(`  const [head, ...rest] = segments as [string, ...string[]]`)

    if (children.length > 0) {
      lines.push(`  switch (head) {`)
      for (const [key, walker] of children) lines.push(`    case ${JSON.stringify(key)}: return ${walker}(rest)`)
      lines.push(`  }`)
    }

    // Array positions arrive as decimal index segments. The tuple positions the
    // schema named are answered by their own walkers; everything past them is
    // `items`, which is one schema for every remaining index.
    const indexed = tupleWalkers.some((walker) => walker !== null) || itemsWalker !== null
    if (indexed) {
      lines.push(`  const index = Number(head)`)
      lines.push(`  if (Number.isInteger(index) && index >= 0) {`)
      tupleWalkers.forEach((walker, position) => {
        if (walker === null) return
        lines.push(`    if (index === ${position}) return ${walker}(rest)`)
      })
      if (itemsWalker !== null) {
        lines.push(`    if (index >= ${tuple.length}) return ${itemsWalker}(rest)`)
      }
      lines.push(`  }`)
    }
  }

  lines.push(`  return null`, `}`)
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
export const generateRepairFunction = (schema: JSONSchema, typeName: string, typeSuffix = ''): { code: string } => {
  const helpers: string[] = []
  let counter = 0
  const ctx: RepairContext = { typeSuffix, helpers, next: () => counter++ }

  const walker = emitWalker(schema, ctx)
  const lookupName = `repair${typeName}At`

  const parts = [
    ...(helpers.length > 0 ? [helpers.join('\n\n'), ''] : []),
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
