import {
  codePointLength,
  compilePattern,
  deepEqual,
  getEnumSet,
  hasProperty,
  type InterpreterContext,
  interpret,
  isPlainObject,
  matchesType,
  NO_DYNAMIC_SCOPE,
  newValidatorCaches,
} from '@/interpreter/interpret'
import { validationLimitError } from '@/interpreter/limits'
import { getNodeMeta, type NodeMeta } from '@/interpreter/node-meta'
import { resolveLocalRef } from '@/interpreter/resolve-local-ref'
import { resolveScopedRef } from '@/interpreter/resolve-scoped-ref'
import type { SchemaRegistry } from '@/interpreter/schema-registry'

/**
 * One compiled schema node: a closure that answers the node's whole verdict for
 * a value. `depth` is threaded so a `$ref` cycle over recursive data still hits
 * the same ceiling the interpreter enforces rather than the native stack.
 */
export type Plan = (value: unknown, depth: number) => boolean

export type PlanEnv = {
  readonly root: unknown
  readonly formats: 'all' | ReadonlySet<string>
  readonly maxDepth: number
  readonly maxSteps: number
  /**
   * The document's `$id` resource registry, or `null` when it declares none.
   * Present, every `$ref` is resolved through the interpreter's own scoped
   * resolver rather than as a bare pointer, so a document that reroots part of
   * itself with a nested `$id` compiles to the same links the walker follows.
   */
  readonly registry: SchemaRegistry | null
  /**
   * Compiled nodes, keyed by the base URI in effect and then by schema node, so
   * a `$ref` cycle terminates at compile time.
   *
   * The base has to be part of the key: the same subschema reached under two
   * different `$id` scopes resolves its own relative `$ref`s to different
   * targets, so one plan cannot serve both.
   */
  readonly plans: Map<string, Map<object, Plan>>
}

/**
 * Keywords this compiler does not answer itself. A node carrying any of them is
 * handed to the interpreter **whole, subtree included**, which is what makes the
 * fallback sound rather than merely convenient: the annotation-collecting
 * keywords (`unevaluated*`) and the conditional ones need the walk's own
 * bookkeeping, and half-compiling a node whose parent needs annotations from it
 * would produce a verdict neither implementation agrees with.
 *
 * The list is deliberately generous. Every entry costs only the speed of a
 * schema that uses it, and the compiled path is here for the shapes that
 * dominate a hot loop — typed objects, arrays of those, scalars with bounds.
 * Anything exotic keeps exactly the behavior it has today.
 */
export const UNCOMPILED_KEYWORDS: readonly string[] = [
  'if',
  'then',
  'else',
  'dependentSchemas',
  'dependentRequired',
  'dependencies',
  'unevaluatedProperties',
  'unevaluatedItems',
  'contains',
  'minContains',
  'maxContains',
  'propertyNames',
  'patternProperties',
  'format',
  'uniqueItems',
  '$dynamicRef',
  '$dynamicAnchor',
  '$recursiveRef',
  '$recursiveAnchor',
  '$vocabulary',
  'nullable',
]

/** True when the node declares anything {@link UNCOMPILED_KEYWORDS} names. */
const needsInterpreter = (schema: Record<string, unknown>): boolean =>
  UNCOMPILED_KEYWORDS.some((keyword) => Object.hasOwn(schema, keyword))

/**
 * A plan that defers to the interpreter for this node.
 *
 * The interpreter runs against the **real root**, not against `schema` — a
 * subtree reached by fallback can still carry a `$ref` that only resolves in the
 * document it came from, and re-rooting it there would break the pointer.
 *
 * The caches are per-plan and captured here, so a fallback node reused across
 * calls keeps its warm regex and `$ref` maps exactly as a prepared validator
 * would.
 */
const interpreterPlan = (schema: unknown, env: PlanEnv, base: string): Plan => {
  const caches = newValidatorCaches()
  caches.nodeMeta = new WeakMap()
  const scope = env.registry === null ? NO_DYNAMIC_SCOPE : [base]
  return (value, depth) => {
    const ctx: InterpreterContext = {
      root: env.root,
      // The document's own registry, so a fallback node resolves `$ref` exactly
      // as the walker would from this position. Compilation is never attempted
      // with sibling documents registered (see `compileGuard`), so the
      // validation vocabulary always asserts.
      registry: env.registry,
      assertsValidation: true,
      formats: env.formats,
      emitErrors: false,
      caches,
      errors: null,
      failed: false,
      refStack: [],
      maxDepth: env.maxDepth,
      budget: { steps: env.maxSteps },
    }
    interpret(ctx, schema, value, '', null, depth, scope)
    return !ctx.failed
  }
}

const ALWAYS: Plan = () => true
const NEVER: Plan = () => false

/**
 * Compiles `schema` into a {@link Plan}, memoized per schema node.
 *
 * The memo is what lets a recursive `$ref` compile at all: the node is entered
 * into it as a forwarding stub *before* its body is built, so a reference back
 * to it during that build resolves to the stub, and the finished plan replaces
 * the stub for every later reference. Nodes compiled after the cycle closes pay
 * no indirection.
 */
export const compilePlan = (schema: unknown, env: PlanEnv, base: string): Plan => {
  if (schema === true) return ALWAYS
  if (schema === false) return NEVER
  if (!isPlainObject(schema)) return ALWAYS

  // A node declaring `$id` opens a new resource: its own `$ref`s, and those of
  // everything under it, resolve against that base instead of the enclosing one.
  const declared = env.registry?.baseOf.get(schema)
  const scope = declared ?? base

  let byNode = env.plans.get(scope)
  if (byNode === undefined) {
    byNode = new Map()
    env.plans.set(scope, byNode)
  }
  const memo = byNode.get(schema)
  if (memo !== undefined) return memo

  let built: Plan | null = null
  const stub: Plan = (value, depth) => (built as Plan)(value, depth)
  byNode.set(schema, stub)

  const plan = needsInterpreter(schema) ? interpreterPlan(schema, env, scope) : buildPlan(schema, env, scope)
  built = plan
  byNode.set(schema, plan)
  return plan
}

/**
 * Folds a node's keyword checks into one plan.
 *
 * Checks are gathered as a flat array and then specialized by length: the
 * overwhelmingly common one- and two-check nodes get a closure that calls them
 * directly rather than looping, which is most of what this compiler buys over
 * the walker on a scalar-heavy schema.
 */
const buildPlan = (schema: Record<string, unknown>, env: PlanEnv, base: string): Plan => {
  const meta = getNodeMeta(null, schema)
  const checks: Plan[] = []

  const ref = meta.refs?.ref
  if (ref !== undefined) {
    // With a registry the ref goes through the interpreter's own scoped
    // resolver, which answers absolute URIs, `$anchor` names and pointers alike
    // and reports the base the target's own refs resolve against. Without one
    // the document is a single resource and a plain pointer is the whole story.
    const resolved =
      env.registry === null
        ? { value: resolveLocalRef(ref, env.root), base }
        : (resolveScopedRef(env.registry, ref, base) ?? { value: resolveLocalRef(ref, env.root), base })
    if (resolved.value === undefined) {
      // An unresolvable `$ref` must fail loudly rather than quietly accept
      // everything — the same contract the interpreter holds. Deferring to it
      // reproduces the error verbatim instead of restating the message.
      return interpreterPlan(schema, env, base)
    }
    const targetPlan = compilePlan(resolved.value, env, resolved.base)
    checks.push((value, depth) => {
      // A `$ref` moves between schema nodes without consuming data, so it is the
      // one descent that can recurse forever. This is the same ceiling, and the
      // same error, the interpreter applies at every node.
      if (depth >= env.maxDepth) {
        throw validationLimitError(
          `Validation exceeded its maximum depth of ${env.maxDepth} (deeply nested data against a recursive ` +
            'schema). Raise it with `limits: { maxDepth }` if the schema and data are trusted.',
        )
      }
      return targetPlan(value, depth + 1)
    })
  }

  addTypeCheck(checks, meta)
  addMembershipChecks(checks, schema, meta)
  addStringChecks(checks, meta)
  addNumberChecks(checks, meta)
  addArrayChecks(checks, meta, env, base)
  addObjectChecks(checks, meta, env, base)
  addBranchChecks(checks, meta, env, base)

  return combine(checks)
}

/** Specializes the fold by arity; the loop is the fallback, not the common case. */
const combine = (checks: readonly Plan[]): Plan => {
  if (checks.length === 0) return ALWAYS
  if (checks.length === 1) return checks[0] as Plan
  if (checks.length === 2) {
    const [a, b] = checks as [Plan, Plan]
    return (value, depth) => a(value, depth) && b(value, depth)
  }
  if (checks.length === 3) {
    const [a, b, c] = checks as [Plan, Plan, Plan]
    return (value, depth) => a(value, depth) && b(value, depth) && c(value, depth)
  }
  const all = [...checks]
  return (value, depth) => {
    for (const check of all) if (!check(value, depth)) return false
    return true
  }
}

const addTypeCheck = (checks: Plan[], meta: NodeMeta): void => {
  const type = meta.type
  if (type !== undefined) {
    // `matchesType` throws on an unknown type keyword; calling it once here at
    // compile time surfaces a typo'd `type: "strng"` when the plan is built
    // rather than on the first value that reaches it.
    matchesType(type, null)
    checks.push((value) => matchesType(type, value))
    return
  }
  const types = meta.types
  if (types !== undefined) {
    for (const one of types) matchesType(one, null)
    if (types.length === 1) {
      const only = types[0] as string
      checks.push((value) => matchesType(only, value))
      return
    }
    const list = [...types]
    checks.push((value) => {
      for (const one of list) if (matchesType(one, value)) return true
      return false
    })
  }
}

const addMembershipChecks = (checks: Plan[], schema: Record<string, unknown>, meta: NodeMeta): void => {
  if (meta.hasConst) {
    const expected = meta.constValue
    checks.push((value) => deepEqual(value, expected))
  }
  const values = meta.enumValues
  if (values !== undefined) {
    // An all-primitive enum resolves to a `Set` for O(1) membership, exactly as
    // the interpreter memoizes it — taken from the same cache so the two cannot
    // disagree about which enums qualify.
    const set = getEnumSet(schema, values)
    if (set !== null) {
      checks.push((value) => set.has(value))
      return
    }
    const list = [...values]
    checks.push((value) => {
      for (const member of list) if (deepEqual(value, member)) return true
      return false
    })
  }
}

const addStringChecks = (checks: Plan[], meta: NodeMeta): void => {
  const strings = meta.strings
  if (strings === null) return

  const { minLength, maxLength, pattern } = strings
  if (minLength !== undefined) {
    checks.push((value) => typeof value !== 'string' || codePointLength(value) >= minLength)
  }
  if (maxLength !== undefined) {
    checks.push((value) => typeof value !== 'string' || codePointLength(value) <= maxLength)
  }
  if (pattern !== undefined) {
    // Compiled once, here, instead of once per validation — the single largest
    // per-call cost the walker memoizes and this removes outright.
    const regex = compilePattern(pattern)
    checks.push((value) => {
      if (typeof value !== 'string') return true
      // `lastIndex` is shared state on a `g`/`y` regex; a JSON Schema `pattern`
      // carries neither flag, so `test` here is stateless.
      return regex.test(value)
    })
  }
}

const addNumberChecks = (checks: Plan[], meta: NodeMeta): void => {
  const numbers = meta.numbers
  if (numbers === null) return

  const { minimum, maximum, exclusiveMinimum, exclusiveMaximum, strictMinimum, strictMaximum, multipleOf } = numbers

  // Every bound is written as the pass condition, never as a negated failure
  // test — the rule `@amritk/helpers/numeric-bound-check` documents for the
  // generators. `NaN` compares `false` against every operator, so it fails here,
  // which is what the interpreter and Ajv both say.
  if (minimum !== undefined) {
    checks.push(
      strictMinimum
        ? (value) => typeof value !== 'number' || value > minimum
        : (value) => typeof value !== 'number' || value >= minimum,
    )
  }
  if (maximum !== undefined) {
    checks.push(
      strictMaximum
        ? (value) => typeof value !== 'number' || value < maximum
        : (value) => typeof value !== 'number' || value <= maximum,
    )
  }
  if (exclusiveMinimum !== undefined) {
    checks.push((value) => typeof value !== 'number' || value > exclusiveMinimum)
  }
  if (exclusiveMaximum !== undefined) {
    checks.push((value) => typeof value !== 'number' || value < exclusiveMaximum)
  }
  if (multipleOf !== undefined && multipleOf > 0) {
    // The two divisor cases the interpreter distinguishes, specialized at compile
    // time so the branch is not re-taken per value.
    if (Number.isInteger(multipleOf)) {
      checks.push((value) => typeof value !== 'number' || (Number.isInteger(value) && value % multipleOf === 0))
    } else {
      checks.push((value) => {
        if (typeof value !== 'number') return true
        const quotient = value / multipleOf
        return Math.abs(quotient - Math.round(quotient)) <= 2 * Number.EPSILON * Math.max(1, Math.abs(quotient))
      })
    }
  }
}

const addArrayChecks = (checks: Plan[], meta: NodeMeta, env: PlanEnv, base: string): void => {
  const arrays = meta.arrays
  if (arrays === null) return

  const { minItems, maxItems, tuple, rest } = arrays
  if (minItems !== undefined) checks.push((value) => !Array.isArray(value) || value.length >= minItems)
  if (maxItems !== undefined) checks.push((value) => !Array.isArray(value) || value.length <= maxItems)

  const tuplePlans = tuple?.map((item) => compilePlan(item, env, base))
  const restPlan = rest === undefined ? null : compilePlan(rest, env, base)

  if (tuplePlans !== undefined) {
    checks.push((value, depth) => {
      if (!Array.isArray(value)) return true
      const positional = Math.min(tuplePlans.length, value.length)
      for (let index = 0; index < positional; index++) {
        if (!(tuplePlans[index] as Plan)(value[index], depth + 1)) return false
      }
      if (restPlan === null) return true
      for (let index = positional; index < value.length; index++) {
        if (!restPlan(value[index], depth + 1)) return false
      }
      return true
    })
    return
  }

  if (restPlan !== null) {
    checks.push((value, depth) => {
      if (!Array.isArray(value)) return true
      for (const item of value) if (!restPlan(item, depth + 1)) return false
      return true
    })
  }
}

const addObjectChecks = (checks: Plan[], meta: NodeMeta, env: PlanEnv, base: string): void => {
  const objects = meta.objects
  if (objects === null) return

  const { properties, required, minProperties, maxProperties, hasAdditionalProperties, additionalProperties } = objects

  if (minProperties !== undefined) {
    checks.push((value) => !isPlainObject(value) || Object.keys(value).length >= minProperties)
  }
  if (maxProperties !== undefined) {
    checks.push((value) => !isPlainObject(value) || Object.keys(value).length <= maxProperties)
  }

  if (required !== undefined && required.length > 0) {
    const names = [...required]
    checks.push((value) => {
      if (!isPlainObject(value)) return true
      for (const name of names) if (!hasProperty(value, name)) return false
      return true
    })
  }

  // The property plans are resolved into a flat array once, so validation walks
  // a list of `[key, plan]` pairs instead of re-reading `properties` and
  // re-deriving each subschema on every call.
  let entries: Array<readonly [string, Plan]> | null = null
  if (properties !== undefined) {
    entries = Object.keys(properties).map((key) => [key, compilePlan(properties[key], env, base)] as const)
    if (entries.length === 0) entries = null
  }
  if (entries !== null) {
    const pairs = entries
    checks.push((value, depth) => {
      if (!isPlainObject(value)) return true
      for (const [key, plan] of pairs) {
        // An absent property is not a violation of its subschema — `required`
        // is the keyword that says it must be there.
        if (!Object.hasOwn(value, key)) continue
        if (!plan(value[key], depth + 1)) return false
      }
      return true
    })
  }

  if (!hasAdditionalProperties) return

  const declared = properties === undefined ? null : new Set(Object.keys(properties))
  if (additionalProperties === false) {
    checks.push((value) => {
      if (!isPlainObject(value)) return true
      for (const key of Object.keys(value)) {
        if (declared === null || !declared.has(key)) return false
      }
      return true
    })
    return
  }
  if (additionalProperties === true) return

  const extras = compilePlan(additionalProperties, env, base)
  checks.push((value, depth) => {
    if (!isPlainObject(value)) return true
    for (const key of Object.keys(value)) {
      if (declared?.has(key)) continue
      if (!extras(value[key], depth + 1)) return false
    }
    return true
  })
}

const addBranchChecks = (checks: Plan[], meta: NodeMeta, env: PlanEnv, base: string): void => {
  const branches = meta.branches
  if (branches === null) return

  const { allOf, anyOf, oneOf, hasNot, not } = branches

  if (allOf !== undefined) {
    const plans = allOf.map((branch) => compilePlan(branch, env, base))
    for (const plan of plans) checks.push(plan)
  }
  if (anyOf !== undefined) {
    const plans = anyOf.map((branch) => compilePlan(branch, env, base))
    checks.push((value, depth) => {
      for (const plan of plans) if (plan(value, depth)) return true
      return false
    })
  }
  if (oneOf !== undefined) {
    const plans = oneOf.map((branch) => compilePlan(branch, env, base))
    checks.push((value, depth) => {
      let matched = 0
      for (const plan of plans) {
        if (plan(value, depth)) {
          matched += 1
          // Exactly one is the contract, so a second match settles it.
          if (matched > 1) return false
        }
      }
      return matched === 1
    })
  }
  if (hasNot) {
    const plan = compilePlan(not, env, base)
    checks.push((value, depth) => !plan(value, depth))
  }
}
