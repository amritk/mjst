import { validationLimitError } from '@/interpreter/limits'
import { getNodeMeta, type NodeMeta } from '@/interpreter/node-meta'
import { resolveLocalRef } from '@/interpreter/resolve-local-ref'
import { compilePattern } from '@/interpreter/runtime'

/**
 * The state one coercion pass threads through the walk: what to coerce toward
 * (`root`, for resolving `$ref`), the memo the interpreter already uses for
 * keyword extraction, the two switches from `ParseOptions`, and the same
 * resource ceilings a validation runs under.
 *
 * A coercion walk reads attacker-controlled *data* against an
 * attacker-controlled *schema*, exactly as validation does, so it is bounded the
 * same way rather than trusting that the validator downstream will be.
 */
export type CoerceContext = {
  readonly root: unknown
  readonly meta: WeakMap<object, NodeMeta>
  readonly coerce: boolean
  readonly defaults: boolean
  readonly maxDepth: number
  readonly maxSteps: number
  steps: number
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const spend = (ctx: CoerceContext): void => {
  ctx.steps += 1
  if (ctx.steps > ctx.maxSteps) throw validationLimitError(`parse exceeded maxSteps (${ctx.maxSteps})`)
}

/**
 * Writes `key` onto a rebuilt object without ever going through a setter.
 *
 * A plain `out[key] = value` is a prototype-pollution hole for exactly one key:
 * `__proto__` is an accessor on `Object.prototype`, so assigning it *reparents*
 * the object instead of adding a property — and the key comes from attacker
 * data here, since the walk rebuilds whatever object it was handed. `enum`,
 * `const` and `required` all treat `__proto__` as an ordinary property name
 * elsewhere in this package, so dropping it would disagree with the validator
 * that judges the result. `defineProperty` keeps it an ordinary own property,
 * which is what every other keyword already believes it is.
 *
 * Paid only on the one key that needs it: everything else takes the plain
 * assignment.
 */
const setKey = (out: Record<string, unknown>, key: string, value: unknown): void => {
  if (key === '__proto__') {
    Object.defineProperty(out, key, { value, writable: true, enumerable: true, configurable: true })
    return
  }
  out[key] = value
}

/**
 * A JSON-shaped deep copy of a `default` before it is handed to the caller.
 *
 * The annotation lives in the schema, which callers routinely hold as a module
 * constant and reuse across every parse. Inserting it by reference means the
 * first caller to push onto a defaulted array mutates the schema, and every
 * later parse inherits the change — a shared-mutable-state bug that surfaces
 * far from its cause. Depth-capped for the same reason every other walk here is.
 */
const cloneDefault = (value: unknown, depth: number): unknown => {
  if (depth > 64 || typeof value !== 'object' || value === null) return value
  if (Array.isArray(value)) return value.map((item) => cloneDefault(item, depth + 1))
  const out: Record<string, unknown> = {}
  for (const key of Object.keys(value))
    setKey(out, key, cloneDefault((value as Record<string, unknown>)[key], depth + 1))
  return out
}

/**
 * The one string-to-scalar conversion table, applied only where the subschema
 * names a single scalar `type`.
 *
 * Every rule is conservative in the same direction: when the string does not
 * actually denote the declared type, the **original string is returned** and the
 * validator downstream rejects it with a proper type error. Guessing here would
 * turn a bad request into a silently wrong value — `Number('abc')` is `NaN`,
 * which `typeof`-checks as a number and would sail through the validator.
 *
 * - `Number('')` and `Number('  ')` are `0`, so blank strings stay strings.
 * - `Number.isFinite` also rejects `'Infinity'`, which `Number` happily parses:
 *   a non-finite number passes a `type: 'number'` check and then serializes back
 *   out as JSON `null`, which is silent corruption rather than a rejection.
 * - `integer` converts like `number` and lets the validator judge integrality,
 *   so `'1.5'` fails with "must be integer" rather than a vaguer type error.
 *
 * Exported because it is the monorepo's single copy of these rules.
 * `@amritk/api` reaches for it directly: its request pipeline fuses coercion
 * into building the params/query/headers object from the raw transport (one
 * pass, no intermediate value), so it cannot call {@link parse} — but the
 * conversion rules must not fork, and every one of the guards above was written
 * there first, in a bug report.
 */
export const coerceScalar = (raw: string, type: string): unknown => {
  if (type === 'boolean') return raw === 'true' ? true : raw === 'false' ? false : raw
  if (type === 'null') return raw === 'null' ? null : raw
  if (type === 'number' || type === 'integer') {
    if (raw.trim() === '') return raw
    const value = Number(raw)
    return Number.isFinite(value) ? value : raw
  }
  return raw
}

/**
 * True when this node leaves the target type genuinely ambiguous, so no scalar
 * conversion may happen at it.
 *
 * A `type: ['number', 'string']`, an `anyOf`, or an `if`/`then` all admit more
 * than one reading of the same input, and `'42'` is a legitimate value under the
 * string branch of every one of them. Converting would pick a branch on the
 * author's behalf and destroy a value they declared valid. This is the same rule
 * `@amritk/api`'s coercion plan already applied by only ever planning for
 * single-`type` properties — restated here so it holds at every depth, not just
 * the top level.
 *
 * Structural descent is unaffected: `properties` and `items` on such a node say
 * the same thing under every branch, so children are still walked.
 */
const isAmbiguous = (meta: NodeMeta): boolean =>
  meta.types !== undefined ||
  (meta.branches !== null &&
    (meta.branches.anyOf !== undefined || meta.branches.oneOf !== undefined || meta.branches.hasIf))

/**
 * Coerces `value` toward `schema`, returning a new value only where something
 * actually changed.
 *
 * Structural sharing is not an optimization detail here, it is the contract: an
 * input that already has the declared types comes back as the very object that
 * went in (`===`), so a caller can tell "nothing needed doing" from "rebuilt",
 * and the already-typed JSON-body path — the common one — allocates nothing.
 *
 * `refChain` guards the one walk that does not consume data: a `$ref` moves
 * between schema nodes while staying on the same value, so `{ $ref: '#' }` at
 * the root would recurse forever. It records the nodes visited *on this ref
 * chain* and is dropped the moment the walk descends into a child value, where
 * the data has shrunk and ordinary termination takes over.
 */
export const coerceToSchema = (
  value: unknown,
  schema: unknown,
  ctx: CoerceContext,
  depth: number,
  refChain: ReadonlySet<object> | null = null,
): unknown => {
  if (depth > ctx.maxDepth) throw validationLimitError(`parse exceeded maxDepth (${ctx.maxDepth})`)
  if (!isPlainObject(schema)) return value
  spend(ctx)

  const meta = getNodeMeta(ctx.meta, schema)
  let current = value

  // `$ref` is an ordinary applicator in 2020-12: it constrains the same value
  // this node's own keywords do, so the target is folded in first and this
  // node's keywords then apply to the result. Only *local* refs are followed —
  // a pointer or `$anchor` into the document we were handed. A cross-document
  // or `$id`-scoped ref resolves through machinery this pass deliberately does
  // not carry, so the walk simply stops descending there and the value passes
  // through uncoerced; the validator still resolves it and judges it in full.
  const ref = meta.refs?.ref
  if (ref !== undefined) {
    const target = resolveLocalRef(ref, ctx.root)
    if (isPlainObject(target) && !(refChain?.has(target) ?? false)) {
      const chain = new Set(refChain ?? []).add(schema).add(target)
      current = coerceToSchema(current, target, ctx, depth + 1, chain)
    }
  }

  // Every `allOf` branch constrains this same value, so they fold in sequence —
  // a `{ allOf: [{ type: 'integer' }] }` next to a bare `properties` is a
  // perfectly ordinary way to write a schema, and the type lives in the branch.
  const allOf = meta.branches?.allOf
  if (allOf !== undefined) {
    for (const branch of allOf) current = coerceToSchema(current, branch, ctx, depth + 1, refChain)
  }

  const ambiguous = isAmbiguous(meta)

  if (ctx.coerce && !ambiguous && typeof current === 'string' && meta.type !== undefined) {
    current = coerceScalar(current, meta.type)
  }

  if (isPlainObject(current)) return coerceObject(current, meta, ctx, depth)
  if (Array.isArray(current)) return coerceArray(current, meta, ctx, depth)
  return current
}

/**
 * Whether `key` is covered by the `patternProperties` entry `source`, decided by
 * the interpreter's own compiler so the coercion walk and the validation that
 * follows it always agree on the key set. An uncompilable pattern matches
 * nothing, which is also what the validator does with it.
 */
const matchesPattern = (source: string, key: string): boolean => {
  try {
    return compilePattern(source).test(key)
  } catch {
    return false
  }
}

/**
 * Walks an object's own keys against `properties` / `patternProperties` /
 * `additionalProperties`, then fills absent properties from their `default`.
 *
 * Key order is the input's own, with defaulted keys appended — so a rebuilt
 * object serializes in the order the caller sent, which matters to anyone
 * diffing or signing the result.
 */
const coerceObject = (
  value: Record<string, unknown>,
  meta: NodeMeta,
  ctx: CoerceContext,
  depth: number,
): Record<string, unknown> => {
  const objects = meta.objects
  if (objects === null) return value

  const patterns = objects.patternProperties
  let out: Record<string, unknown> | null = null

  for (const key of Object.keys(value)) {
    spend(ctx)
    const child = value[key]
    let next = child

    const declared = objects.properties !== undefined && Object.hasOwn(objects.properties, key)
    if (declared) {
      next = coerceToSchema(next, (objects.properties as Record<string, unknown>)[key], ctx, depth + 1)
    }

    let matchedPattern = false
    if (patterns !== undefined) {
      for (const source of Object.keys(patterns)) {
        // A pattern that does not compile is not an assertion the validator will
        // make either, so it selects nothing here rather than throwing. The
        // compile itself goes through the interpreter's own `compilePattern`, so
        // this walk and the validation that follows it can never disagree about
        // which keys a `patternProperties` entry covers.
        if (!matchesPattern(source, key)) continue
        matchedPattern = true
        next = coerceToSchema(next, patterns[source], ctx, depth + 1)
      }
    }

    // `additionalProperties` covers exactly the keys no `properties` entry and no
    // `patternProperties` entry matched — the same set the validator judges with
    // it.
    if (!declared && !matchedPattern && objects.hasAdditionalProperties) {
      next = coerceToSchema(next, objects.additionalProperties, ctx, depth + 1)
    }

    if (next !== child) {
      out ??= shallowCopy(value)
      setKey(out, key, next)
    }
  }

  if (ctx.defaults && objects.properties !== undefined) {
    const properties = objects.properties
    for (const key of Object.keys(properties)) {
      if (Object.hasOwn(value, key)) continue
      const property = properties[key]
      if (!isPlainObject(property) || !Object.hasOwn(property, 'default')) continue
      out ??= shallowCopy(value)
      setKey(out, key, cloneDefault(property['default'], 0))
    }
  }

  return out ?? value
}

/** An own-enumerable copy that routes every key through {@link setKey}. */
const shallowCopy = (value: Record<string, unknown>): Record<string, unknown> => {
  const out: Record<string, unknown> = {}
  for (const key of Object.keys(value)) setKey(out, key, value[key])
  return out
}

/**
 * Walks an array's elements against `prefixItems` (or draft-07's array-form
 * `items`) and the `items` / `additionalItems` schema covering the rest.
 */
const coerceArray = (value: readonly unknown[], meta: NodeMeta, ctx: CoerceContext, depth: number): unknown[] => {
  const arrays = meta.arrays
  if (arrays === null) return value as unknown[]

  const tuple = arrays.tuple
  const rest = arrays.rest
  if (tuple === undefined && rest === undefined) return value as unknown[]

  let out: unknown[] | null = null
  for (let index = 0; index < value.length; index++) {
    spend(ctx)
    const child = value[index]
    const positional = tuple !== undefined && index < tuple.length ? tuple[index] : rest
    if (positional === undefined) continue
    const next = coerceToSchema(child, positional, ctx, depth + 1)
    if (next !== child) {
      out ??= [...value]
      out[index] = next
    }
  }
  return out ?? (value as unknown[])
}
