import { regexFlagsFor } from '@amritk/helpers/escape-regex-pattern'
import { readKey } from '@amritk/helpers/read-key'
import { refToName } from '@amritk/helpers/ref-to-name'
import { isSchemaObject } from '@amritk/helpers/schema-guards'
import type { JSONSchema } from 'json-schema-typed/draft-2020-12'

import { namedTest, type RepairContext, schemaMap, subschema } from './repair-context'
import { isReferenceSchema, leafKeywords } from './repair-walkable'

/**
 * The name of the walk a file exports for its definition. Not `repairXWalk`:
 * that is the `repairX` of a definition named `XWalk`, and the barrel would
 * export one name twice.
 */
export const repairWalkNameFor = (typeName: string): string => `walk${typeName}Repair`

type WalkContext = {
  /** The lookup's context: declarations, numbering and the shared tests. */
  readonly repair: RepairContext
  /** The definition this file is for, which names the type of its root position. */
  readonly typeName: string
  /** The whole document, to see through a `$ref` to a Reference schema. */
  readonly rootSchema: Record<string, unknown> | undefined
  /** The lookup for a node — the one `repairXAt` reaches it through. */
  readonly lookupFor: (schema: JSONSchema) => string | null
}

/** The walker emitted for each node already, by identity. */
type Walkers = Map<unknown, string | null>

/** The scalar types `coerceScalar` moves a value toward. */
const SCALAR_TYPES = new Set(['string', 'number', 'integer', 'boolean', 'null'])

/**
 * The condition that is true when `v` is an instance of `type`. Read off the
 * same table `validateX` negates, plus the two run options only the walk has.
 */
const typeCondition = (type: string): string => {
  switch (type) {
    case 'string':
      return `typeof v === 'string'`
    case 'number':
      return `(typeof v === 'number' && (!run.finite || Number.isFinite(v)))`
    case 'integer':
      return `Number.isInteger(v)`
    case 'boolean':
      return `typeof v === 'boolean'`
    case 'null':
      return `v === null`
    case 'array':
      return `Array.isArray(v)`
    default:
      return `(typeof v === 'object' && v !== null && !Array.isArray(v) && (!run.plain || isPlainObject(v)))`
  }
}

/**
 * One member of an `enum` or a `const`, compared the way the validator compares
 * it. Read through a cast: after a `typeof` test TypeScript would call a member
 * of another type an impossible comparison, and an unsatisfiable schema still
 * has to compile.
 */
const equalsCondition = (value: unknown): string => {
  if (typeof value === 'number' && Number.isNaN(value)) return `Number.isNaN(v)`
  if (value !== null && typeof value === 'object') return `valuesEqual(v, ${JSON.stringify(value)})`
  return `(v as unknown) === ${JSON.stringify(value)}`
}

/** A position's own checks: the conditions, and the error each one reports. */
type OwnCheck = { readonly condition: string; readonly report: string }

/**
 * The checks a node makes of the value at its own position — `type`, `enum`,
 * `const`, and the assertions the validator's own test answers — each with the
 * error `validateX` reports for it.
 */
const ownChecks = (node: Record<string, unknown>, ctx: WalkContext): OwnCheck[] => {
  const checks: OwnCheck[] = []
  const type = readKey(node, 'type')
  if (typeof type === 'string') {
    checks.push({
      condition: typeCondition(type),
      report: `found.push(walkError(run, 'type', ${JSON.stringify(`must be ${type}`)}, ${JSON.stringify({ type })}))`,
    })
  } else if (Array.isArray(type)) {
    const types = type as string[]
    checks.push({
      condition: `(${types.map(typeCondition).join(' || ')})`,
      report: `found.push(walkError(run, 'type', ${JSON.stringify(`must be ${types.join(' or ')}`)}, ${JSON.stringify({ type })}))`,
    })
  }

  const values = readKey(node, 'enum')
  if (Array.isArray(values)) {
    const label = values.map((value) => JSON.stringify(value)).join(', ')
    checks.push({
      condition: values.length === 0 ? 'false' : `(${values.map(equalsCondition).join(' || ')})`,
      report: `found.push(walkError(run, 'enum', ${JSON.stringify(`must be one of: ${label}`)}, ${JSON.stringify({ allowedValues: values })}))`,
    })
  }

  if (Object.hasOwn(node, 'const')) {
    const value = node['const']
    checks.push({
      condition: equalsCondition(value),
      report: `found.push(walkError(run, 'const', ${JSON.stringify(`must be ${JSON.stringify(value)}`)}, ${JSON.stringify({ allowedValue: value })}))`,
    })
  }

  // Everything else a position asserts about itself is asked of the validator's
  // own test, and explained by the validator's own errors once it fails.
  const leaf = leafKeywords(node)
  if (leaf !== null) {
    const test = namedTest(leaf as JSONSchema, ctx.repair)
    if (test !== true) {
      const explain = ctx.repair.matcher.explain(leaf as JSONSchema)
      checks.push({
        condition: test === false ? 'false' : `${test}(v)`,
        report:
          explain === null
            ? `found.push(walkError(run, 'false schema', 'boolean schema is false', {}))`
            : `for (const error of ${explain}(v, walkPath(run))) found.push(error)`,
      })
    }
  }
  return checks
}

/** The scalar types a node's `type` names, when every one of them is a scalar. */
const coercibleTypes = (node: Record<string, unknown>): string | null => {
  const type = readKey(node, 'type')
  const types = typeof type === 'string' ? [type] : Array.isArray(type) ? (type as string[]) : []
  return types.length > 0 && types.every((entry) => SCALAR_TYPES.has(entry)) ? JSON.stringify(types) : null
}

/**
 * The statements that walk one child: the path grows by its segment for exactly
 * as long as the child is walked, and the result is written back only when it
 * differs.
 */
const walkChild = (walker: string, key: string, write: string): string[] => [
  `run.path.push(${key})`,
  `const n = ${walker}(c, run)`,
  `run.path.pop()`,
  `if (n !== c) ${write}`,
]

/**
 * The id an inline position's type goes by, for the `$ref` targets walked under
 * it and for `onRef`.
 *
 * Derived from the schema rather than from where it was written, so the same
 * union spelled out at many positions — `{ if, then: Reference, else: Schema }`
 * under every `properties` and `items` — is one type, and a target two of them
 * reference is walked once. The id is a hash of the schema's text, prefixed for
 * the Reference-or-T shape with its branches: `Reference|Schema#1a2b3c4d`.
 */
const inlineTypeId = (node: Record<string, unknown>, typeSuffix: string): string => {
  const branchName = (key: string): string | null => {
    const branch = readKey(node, key)
    if (typeof branch !== 'object' || branch === null) return null
    const ref = readKey(branch as Record<string, unknown>, '$ref')
    return typeof ref === 'string' && Object.keys(branch).length === 1 ? refToName(ref, typeSuffix) : null
  }
  const thenName = branchName('then')
  const elseName = branchName('else')
  // The hash covers the whole node, so two positions that share their branches
  // but differ anywhere else — another `if`, a sibling `required` — are two types.
  const text = JSON.stringify(node)
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 0x01000193)
  const digest = (hash >>> 0).toString(16).padStart(8, '0')
  return thenName !== null && elseName !== null ? `${thenName}|${elseName}#${digest}` : `inline#${digest}`
}

/** The walker a `false` schema gets: the position is reported and removed. */
const falseWalker = (ctx: WalkContext, walkers: Walkers): string => {
  const existing = walkers.get(false)
  if (existing) return existing
  const drop = ctx.lookupFor(false)
  const name = '_walkFalse'
  walkers.set(false, name)
  ctx.repair.helpers.push(
    [
      `const ${name}: RepairWalk = (v, run) =>`,
      `  walkRepair(run, v, [walkError(run, 'false schema', 'boolean schema is false', {})], ${drop}, () => false, null)`,
    ].join('\n'),
  )
  return name
}

/**
 * Emits the walk for one node, as the name of its function, or `null` when
 * nothing at or under it is checked.
 *
 * In order: a sibling `$ref` walks the value first; the position's own checks
 * run, and a failure is repaired through the node's lookup and re-checked;
 * then the object or array under it is walked child by child; then the
 * conditional branches the value takes. Each child's walk answers the value it
 * should hold, so a repair deep in the document is written back on the way out
 * — in place, or into copies made only of the containers along that path.
 */
const emitWalk = (schema: JSONSchema, ctx: WalkContext, walkers: Walkers, isRoot: boolean): string | null => {
  if (schema === false) return falseWalker(ctx, walkers)
  if (!isSchemaObject(schema)) return null
  if (walkers.has(schema)) return walkers.get(schema) ?? null
  const node = schema as Record<string, unknown>
  const helpers = ctx.repair.helpers

  const ref = readKey(node, '$ref')
  const refWalker = typeof ref === 'string' ? repairWalkNameFor(refToName(ref, ctx.repair.typeSuffix)) : null
  const checks = ownChecks(node, ctx)
  const properties = schemaMap(node, 'properties') ?? {}
  const required = (readKey(node, 'required') as unknown[] | undefined)?.filter(
    (key): key is string => typeof key === 'string',
  )
  const hasObjectPart =
    Object.keys(properties).length > 0 ||
    (required !== undefined && required.length > 0) ||
    readKey(node, 'additionalProperties') !== undefined ||
    readKey(node, 'patternProperties') !== undefined
  const items = subschema(node, 'items')
  const hasConditional = readKey(node, 'if') !== undefined || Array.isArray(readKey(node, 'allOf'))
  const ownsObjectType = readKey(node, 'type') === 'object'

  // A bare reference is the target's own walk, called directly.
  if (
    refWalker !== null &&
    checks.length === 0 &&
    !hasObjectPart &&
    items === undefined &&
    !hasConditional &&
    !isRoot
  ) {
    walkers.set(schema, refWalker)
    return refWalker
  }

  const id = ctx.repair.next()
  const name = `_walk${id}`
  // Claimed before the children are emitted: a child never reaches its parent
  // except through a `$ref`, but the claim keeps the answer stable regardless.
  walkers.set(schema, name)
  const typeId = JSON.stringify(isRoot ? ctx.typeName : inlineTypeId(node, ctx.repair.typeSuffix))
  const lookup = ctx.lookupFor(schema)
  const body: string[] = []

  if (refWalker !== null) {
    body.push(`v = ${refWalker}(v, run)`, `if (v === REPAIR_DROP) return v`)
  }

  if (checks.length > 0) {
    const ok = checks.map((check) => check.condition).join(' && ')
    const okName = `_walkOk${id}`
    const fixName = `_walkFix${id}`
    helpers.push(`const ${okName} = (v: unknown, ${/\brun\b/.test(ok) ? 'run' : '_run'}: RepairRun): boolean => ${ok}`)
    helpers.push(
      [
        `const ${fixName} = (v: unknown, run: RepairRun): unknown => {`,
        `  const found: ValidationError[] = []`,
        ...checks.map((check) => `  if (!(${check.condition})) ${check.report}`),
        `  return walkRepair(run, v, found, ${lookup ?? 'null'}, ${okName}, ${coercibleTypes(node) ?? 'null'})`,
        `}`,
      ].join('\n'),
    )
    // The checks run inline, so a valid value costs the conditions and nothing
    // else; only a failure calls out to build errors. A replacement is walked
    // again in full, reporting rather than repairing what is still wrong with it.
    body.push(
      `if (!(${ok})) {`,
      `  const fixed = ${fixName}(v, run)`,
      `  if (fixed !== v) return fixed === REPAIR_DROP ? fixed : walkVerified(run, fixed, ${name})`,
      `}`,
    )
  }

  const container: string[] = []
  if (hasObjectPart || ownsObjectType)
    container.push(...objectPart(node, properties, required ?? [], lookup, id, ctx, walkers))
  if (items !== undefined) container.push(...arrayPart(items, ctx, walkers))

  const conditional = conditionalPart(node, name, typeId, lookup, ctx, walkers)

  if (container.length > 0) {
    body.push(`if (++run.work > run.maxWork || run.path.length > run.maxDepth) return walkHalt(run, v)`)
    body.push(...container)
  }
  body.push(...conditional)

  if (body.length === 0) {
    walkers.set(schema, null)
    return null
  }

  const bodyName = container.length > 0 ? `_walkBody${id}` : name
  helpers.push(
    [`const ${bodyName}: RepairWalk = (v, run) => {`, ...body.map((line) => `  ${line}`), `  return v`, `}`].join('\n'),
  )
  // Only a container can be shared or cyclic, so only a container's walk is
  // worth remembering — and the check of 'memo' is all a run without it pays.
  if (container.length > 0) {
    helpers.push(
      `const ${name}: RepairWalk = (v, run) => (run.memo === null ? ${bodyName}(v, run) : walkMemo(run, v, ${bodyName}))`,
    )
  }
  return name
}

/** The statements that walk the object at a position, when it is one. */
const objectPart = (
  node: Record<string, unknown>,
  properties: Record<string, JSONSchema>,
  required: readonly string[],
  lookup: string | null,
  id: number,
  ctx: WalkContext,
  walkers: Walkers,
): string[] => {
  const inner: string[] = []
  const write = (key: string): string => `o = walkSet(run, o, o !== src, ${key}, n)`
  const requiredSet = new Set(required)

  for (const [key, child] of Object.entries(properties)) {
    const walker = emitWalk(child, ctx, walkers, false)
    const quoted = JSON.stringify(key)
    if (requiredSet.has(key)) {
      if (walker === null) {
        inner.push(
          `if (!Object.hasOwn(o, ${quoted})) o = walkMissing(run, o, o !== src, ${quoted}, ${lookup ?? 'null'}, null)`,
        )
      } else {
        inner.push(
          `if (Object.hasOwn(o, ${quoted})) {`,
          `  const c = o[${quoted}]`,
          ...walkChild(walker, quoted, write(quoted)).map((line) => `  ${line}`),
          `} else o = walkMissing(run, o, o !== src, ${quoted}, ${lookup ?? 'null'}, ${walker})`,
        )
      }
    } else if (walker !== null) {
      // Read first and asked about second: most declared properties are absent
      // from any one object, and an absent one costs a single read.
      inner.push(
        `{`,
        `  const c = o[${quoted}]`,
        `  if (c !== undefined && Object.hasOwn(o, ${quoted})) {`,
        ...walkChild(walker, quoted, write(quoted)).map((line) => `    ${line}`),
        `  }`,
        `}`,
      )
    }
  }
  for (const key of required) {
    if (Object.hasOwn(properties, key)) continue
    const quoted = JSON.stringify(key)
    inner.push(
      `if (!Object.hasOwn(o, ${quoted})) o = walkMissing(run, o, o !== src, ${quoted}, ${lookup ?? 'null'}, null)`,
    )
  }

  inner.push(...mapPart(node, properties, id, ctx, walkers))

  return [
    `if (typeof v === 'object' && v !== null && !Array.isArray(v)) {`,
    `  const src = v as Record<string, unknown>`,
    `  let o = src`,
    `  if (run.plain) o = walkProto(run, o, false)`,
    ...inner.map((line) => `  ${line}`),
    `  v = o`,
    `}`,
  ]
}

/**
 * The loop over the keys `properties` does not name: each is walked under every
 * `patternProperties` entry it matches, and only when it matches none, under
 * `additionalProperties` — a schema to walk, or `false`, which removes the key.
 */
const mapPart = (
  node: Record<string, unknown>,
  properties: Record<string, JSONSchema>,
  id: number,
  ctx: WalkContext,
  walkers: Walkers,
): string[] => {
  const patterns = Object.entries(schemaMap(node, 'patternProperties') ?? {}).map(([source, child]) => ({
    source,
    walker: emitWalk(child, ctx, walkers, false),
  }))
  const additional = subschema(node, 'additionalProperties')
  const additionalWalker =
    additional === undefined || additional === false ? null : emitWalk(additional, ctx, walkers, false)
  const closed = additional === false
  const patternsMatter = patterns.some((pattern) => pattern.walker !== null) || closed || additionalWalker !== null
  if (!patternsMatter) return []

  const helpers = ctx.repair.helpers
  const lines: string[] = [`for (const k in src) {`, `  if (!Object.hasOwn(src, k)) continue`]
  const declared = Object.keys(properties)
  if (declared.length > 0) {
    const setName = `_walkDeclared${id}`
    helpers.push(`const ${setName} = new Set(${JSON.stringify(declared)})`)
    lines.push(`  if (${setName}.has(k)) continue`)
  }
  // A key removed already — an own '__proto__', under 'plainObjects' — is not
  // there to walk.
  lines.push(`  if (o !== src && !Object.hasOwn(o, k)) continue`)

  const needsMatched = patterns.length > 0 && (closed || additionalWalker !== null)
  if (needsMatched) lines.push(`  let matched = false`)
  patterns.forEach((pattern, index) => {
    const regexName = `_walkPattern${id}_${index}`
    helpers.push(
      `const ${regexName} = new RegExp(${JSON.stringify(pattern.source)}, ${JSON.stringify(regexFlagsFor(pattern.source))})`,
    )
    const walk =
      pattern.walker === null
        ? []
        : [
            `const c = o[k]`,
            ...walkChild(pattern.walker, 'k', `{`),
            `  o = walkSet(run, o, o !== src, k, n)`,
            `  if (n === REPAIR_DROP) continue`,
            `}`,
          ]
    if (!needsMatched && walk.length === 0) return
    lines.push(`  if (${regexName}.test(k)) {`)
    if (needsMatched) lines.push(`    matched = true`)
    lines.push(...walk.map((line) => `    ${line}`), `  }`)
  })

  const otherwise = needsMatched ? `if (!matched) ` : ''
  if (closed) {
    lines.push(`  ${otherwise}o = walkExtra(run, o, o !== src, k)`)
  } else if (additionalWalker !== null) {
    lines.push(
      `  ${otherwise}{`,
      `    const c = o[k]`,
      ...walkChild(additionalWalker, 'k', `o = walkSet(run, o, o !== src, k, n)`).map((line) => `    ${line}`),
      `  }`,
    )
  }
  lines.push(`}`)
  return lines
}

/**
 * The statements that walk the array at a position, when it is one. A removed
 * element is marked where it stands and taken out after the loop, so every
 * index reported along the way is the document's own.
 */
const arrayPart = (items: JSONSchema, ctx: WalkContext, walkers: Walkers): string[] => {
  const walker = emitWalk(items, ctx, walkers, false)
  if (walker === null) return []
  return [
    `if (Array.isArray(v)) {`,
    `  const src: unknown[] = v`,
    `  let a = src`,
    `  let dropped = false`,
    `  for (let i = 0; i < src.length; i++) {`,
    `    const c = src[i]`,
    ...walkChild(walker, 'i', `{`).map((line) => `    ${line}`),
    `      if (n === REPAIR_DROP) dropped = true`,
    `      a = walkSetItem(run, a, a !== src, i, n)`,
    `    }`,
    `  }`,
    `  v = dropped ? walkCompact(a) : a`,
    `}`,
  ]
}

/**
 * The statements that walk the branches a value takes: the `if` is asked of the
 * value as it stands now, after its own repairs, and each `allOf` entry walks
 * the same position in turn. A branch that is an opted-in Reference schema
 * queues the `$ref`'s target, to be walked under this position's type.
 */
const conditionalPart = (
  node: Record<string, unknown>,
  self: string,
  typeId: string,
  lookup: string | null,
  ctx: WalkContext,
  walkers: Walkers,
): string[] => {
  const lines: string[] = []
  // While a branch walks this position, this node's lookup is in scope: a key
  // the branch requires but only this node declares is filled from here.
  const leave = lookup === null ? 'return v' : 'return walkUnscope(run, v)'
  const branch = (schema: JSONSchema | undefined): string[] => {
    if (schema === undefined) return []
    const walker = emitWalk(schema, ctx, walkers, false)
    const out = walker === null ? [] : [`v = ${walker}(v, run)`, `if (v === REPAIR_DROP) ${leave}`]
    if (isReferenceSchema(schema, ctx.rootSchema)) out.push(`walkRef(run, v, ${self}, ${typeId})`)
    return out
  }

  const ifSchema = subschema(node, 'if')
  const thenSchema = subschema(node, 'then')
  const elseSchema = subschema(node, 'else')
  if (ifSchema !== undefined && (thenSchema !== undefined || elseSchema !== undefined)) {
    // Settled before either branch is emitted: a branch an `if: true` or an
    // `if: false` never takes would be a walker nothing calls.
    const test = namedTest(ifSchema, ctx.repair)
    if (test === true) lines.push(...branch(thenSchema))
    else if (test === false) lines.push(...branch(elseSchema))
    else {
      const thenLines = branch(thenSchema)
      const elseLines = branch(elseSchema)
      if (thenLines.length > 0) {
        lines.push(`if (${test}(v)) {`, ...thenLines.map((line) => `  ${line}`))
        if (elseLines.length > 0) lines.push(`} else {`, ...elseLines.map((line) => `  ${line}`))
        lines.push(`}`)
      } else if (elseLines.length > 0) {
        lines.push(`if (!${test}(v)) {`, ...elseLines.map((line) => `  ${line}`), `}`)
      }
    }
  }

  const allOf = readKey(node, 'allOf')
  if (Array.isArray(allOf)) {
    for (const entry of allOf as JSONSchema[]) lines.push(...branch(entry))
  }
  if (lines.length === 0 || lookup === null) return lines
  return [`walkScope(run, ${lookup})`, ...lines, `walkUnscope(run, v)`]
}

/**
 * Emits the single-pass repair walk for a definition and answers the name of its
 * root walker, or `null` when nothing in it is checked.
 */
export const emitRepairWalk = (schema: JSONSchema, ctx: WalkContext): string | null =>
  emitWalk(schema, ctx, new Map(), true)
