import { FORMAT_CHECKS, isValidRegex } from '@/interpreter/format-checks'
import type {
  ArrayKeywords,
  BranchKeywords,
  NodeMeta,
  NumberKeywords,
  ObjectKeywords,
  StringKeywords,
  UnevaluatedKeywords,
} from '@/interpreter/node-meta'
import { getNodeMeta } from '@/interpreter/node-meta'
import { resolveScopedDynamicRef } from '@/interpreter/resolve-scoped-ref'
import {
  allUnique,
  childPath,
  codePointLength,
  compilePattern,
  type DynamicScope,
  deepEqual,
  depthLimitError,
  dynamicFallbackTarget,
  type Evaluation,
  enterResource,
  escapePointer,
  fail,
  getEnumSet,
  hasProperty,
  type InterpreterContext,
  isPlainObject,
  isPrimitiveEnumValue,
  matchesType,
  mergeEvaluation,
  newBranchContext,
  newEvaluation,
  resolveDyn,
  resolvePlainRef,
  resolveRec,
  resolveScoped,
  scopeAtNode,
  spend,
} from '@/interpreter/runtime'
import type { SchemaRegistry } from '@/interpreter/schema-registry'

/**
 * Turns a schema into a tree of closures — one per node — so that validating a
 * value is just calling them.
 *
 * The walker this replaces re-derived the same answers on every single call: it
 * asked each node which keywords it carried, looked its metadata up in a
 * `WeakMap`, rebuilt the `properties` key list, recompiled or re-fetched each
 * `pattern`, and re-decided which of the type-specific blocks could possibly do
 * work. None of that depends on the value being validated — it is a pure
 * function of the schema node — so it is settled once here, when the node is
 * first reached, and the node's step closes over the result. A call is then
 * nested closure invocations with the schema traversal, the keyword dispatch and
 * the metadata lookups already burned away.
 *
 * This is partial evaluation, not code generation. There is no `eval` and no
 * `new Function` anywhere in this package — that is the entire reason it exists
 * next to `@amritk/generate-validators` — so the specialized form is a tree of
 * ordinary closures, which runs unchanged under a strict CSP, on Cloudflare
 * Workers, and on React Native/Hermes.
 *
 * ## What stays dynamic
 *
 * Everything the *run* decides, rather than the node:
 *
 *   - **The dynamic scope.** `$dynamicRef` resolves against the chain of
 *     resources evaluation actually passed through, so the scope stays a
 *     parameter threaded down the tree exactly as it was, and a scoped `$ref`
 *     still resolves against the base URI in scope at call time. Only a document
 *     with no `$id` at all — the common case — has its refs settled up front.
 *   - **Error collection.** `validate` and `validateGuard` get separate trees
 *     (they are separate prepared validators), but a branch probe inside an
 *     error-collecting run evaluates in boolean mode, so `emitErrors` is still
 *     read per call rather than compiled in.
 *
 * ## Why building a node is deferred to its first visit
 *
 * {@link compileNode} hands back a {@link CompiledNode} record immediately and
 * builds the step behind it the first time that node is actually reached. That
 * keeps the package's cold one-shot promise — `validate(schema)` still returns
 * without walking anything, and a one-shot validation only pays to build the
 * nodes it visits, never the `$defs` it does not touch. It also makes a cyclic
 * schema — whether through `$ref` or through a genuinely self-referential object
 * graph — terminate for free: building a node only ever creates its children's
 * records, so the build never recurses.
 */

/**
 * One compiled schema node. The arguments mirror the walker's: the run state,
 * the value and its JSON Pointer path, the annotation scope in effect for
 * `unevaluated*`, the recursion depth, and the dynamic scope.
 */
export type Step = (
  ctx: InterpreterContext,
  value: unknown,
  path: string,
  evaluation: Evaluation | null,
  depth: number,
  scope: DynamicScope,
) => void

/**
 * A node's step behind a patchable slot.
 *
 * The slot is what makes deferred building free at steady state: the first call
 * builds the real step and writes it back here, so every later call is a field
 * load and a direct invocation with no laziness check left in the path. It is
 * also how a reference cycle resolves — a node's record exists before its step
 * does, so a `$ref` back to an ancestor simply finds the record.
 */
export type CompiledNode = { run: Step }

/**
 * The build-time context: everything fixed for one prepared validator, plus the
 * node records built so far.
 *
 * `nodes` is a `Map` rather than a `WeakMap` because its lifetime is the
 * validator's, and the validator already holds the schema alive through the
 * closure it hands back.
 */
export type Compiler = {
  /** The root document, which a document-local `$ref` resolves against. */
  readonly root: unknown
  /** The `$id` resource registry, or `null` when the document declares none. */
  readonly registry: SchemaRegistry | null
  /**
   * Whether the 2020-12 validation vocabulary asserts. Fixed for the whole
   * validator, so a dialect that drops it simply does not compile the keywords
   * it turns into annotations.
   */
  readonly asserts: boolean
  /** Enabled string formats, or `'all'`. */
  readonly formats: 'all' | ReadonlySet<string>
  readonly nodes: Map<object, CompiledNode>
}

export const newCompiler = (
  root: unknown,
  registry: SchemaRegistry | null,
  asserts: boolean,
  formats: 'all' | ReadonlySet<string>,
): Compiler => ({ root, registry, asserts, formats, nodes: new Map() })

const NOOP: Step = () => {}

/**
 * The prologue every node opens with, in the walker's order: an already-failed
 * guard run unwinds, then the depth ceiling, then one unit of the shared step
 * budget. Charged per *visit*, so the budget draws down exactly as it did.
 */
const openNode = (ctx: InterpreterContext, depth: number): boolean => {
  if (ctx.failed) return false
  if (depth > ctx.maxDepth) throw depthLimitError(ctx.maxDepth)
  spend(ctx)
  return true
}

/** `true`, `{}`, and any non-object schema: accepts everything, still costs a step. */
const acceptStep: Step = (ctx, _value, _path, _evaluation, depth) => {
  openNode(ctx, depth)
}

/** `false`: rejects everything. */
const rejectStep: Step = (ctx, _value, path, _evaluation, depth) => {
  if (openNode(ctx, depth)) fail(ctx, 'must not be valid', path)
}

const ACCEPT_NODE: CompiledNode = { run: acceptStep }
const REJECT_NODE: CompiledNode = { run: rejectStep }

/**
 * Runs `parts` in order, unwinding as soon as one of them fails — the
 * `if (ctx.failed) return` the walker wrote between every keyword block. The
 * small arities are spelled out because almost every real node has one or two
 * parts, and an array loop for two elements is pure overhead.
 */
const seq = (parts: readonly Step[]): Step => {
  if (parts.length === 0) return NOOP
  if (parts.length === 1) return parts[0] as Step
  if (parts.length === 2) {
    const [a, b] = parts as [Step, Step]
    return (ctx, value, path, evaluation, depth, scope) => {
      a(ctx, value, path, evaluation, depth, scope)
      if (ctx.failed) return
      b(ctx, value, path, evaluation, depth, scope)
    }
  }
  if (parts.length === 3) {
    const [first, second, third] = parts as [Step, Step, Step]
    return (ctx, value, path, evaluation, depth, scope) => {
      first(ctx, value, path, evaluation, depth, scope)
      if (ctx.failed) return
      second(ctx, value, path, evaluation, depth, scope)
      if (ctx.failed) return
      third(ctx, value, path, evaluation, depth, scope)
    }
  }
  const steps = [...parts]
  return (ctx, value, path, evaluation, depth, scope) => {
    for (let i = 0; i < steps.length; i++) {
      ;(steps[i] as Step)(ctx, value, path, evaluation, depth, scope)
      if (ctx.failed) return
    }
  }
}

/**
 * The same sequencing as {@link seq}, with the node prologue folded into the
 * same closure. Opening a node and running its first keyword used to be two
 * frames; on a schema whose nodes carry one or two keywords — which is most of
 * them — that wrapper was a measurable share of the whole validation.
 */
const nodeStep = (parts: readonly Step[]): Step => {
  if (parts.length === 1) {
    const a = parts[0] as Step
    return (ctx, value, path, evaluation, depth, scope) => {
      if (!openNode(ctx, depth)) return
      a(ctx, value, path, evaluation, depth, scope)
    }
  }
  if (parts.length === 2) {
    const [a, b] = parts as [Step, Step]
    return (ctx, value, path, evaluation, depth, scope) => {
      if (!openNode(ctx, depth)) return
      a(ctx, value, path, evaluation, depth, scope)
      if (ctx.failed) return
      b(ctx, value, path, evaluation, depth, scope)
    }
  }
  const body = seq(parts)
  return (ctx, value, path, evaluation, depth, scope) => {
    if (!openNode(ctx, depth)) return
    body(ctx, value, path, evaluation, depth, scope)
  }
}

/**
 * Runs `parts` in sequence, but only for a value of the right runtime type —
 * the guard each type-specific block opened with. Folded in here rather than
 * left to a caller so the block is one closure rather than a test wrapping a
 * sequence.
 */
const guardedSeq = (accepts: (value: unknown) => boolean, parts: readonly Step[]): Step => {
  if (parts.length === 1) {
    const a = parts[0] as Step
    return (ctx, value, path, evaluation, depth, scope) => {
      if (accepts(value)) a(ctx, value, path, evaluation, depth, scope)
    }
  }
  if (parts.length === 2) {
    const [a, b] = parts as [Step, Step]
    return (ctx, value, path, evaluation, depth, scope) => {
      if (!accepts(value)) return
      a(ctx, value, path, evaluation, depth, scope)
      if (ctx.failed) return
      b(ctx, value, path, evaluation, depth, scope)
    }
  }
  const body = seq(parts)
  return (ctx, value, path, evaluation, depth, scope) => {
    if (accepts(value)) body(ctx, value, path, evaluation, depth, scope)
  }
}

/** Whether a property name needs escaping to be a JSON Pointer token (RFC 6901). */
const needsPointerEscape = (key: string): boolean => key.indexOf('/') !== -1 || key.indexOf('~') !== -1

/** The runtime-type guards the type-specific blocks open with. */
const isObjectValue = (value: unknown): boolean => typeof value === 'object' && value !== null && !Array.isArray(value)
const isArrayValue = (value: unknown): boolean => Array.isArray(value)
const isStringValue = (value: unknown): boolean => typeof value === 'string'
const isNumberValue = (value: unknown): boolean => typeof value === 'number'

/**
 * The node record for `schema`, creating it on first request. The step behind it
 * is built lazily on first use and patched into the record, so asking for a node
 * costs a `Map` lookup and nothing else — see the note on {@link CompiledNode}.
 */
export const compileNode = (compiler: Compiler, schema: unknown): CompiledNode => {
  if (schema === false) return REJECT_NODE
  if (!isPlainObject(schema)) return ACCEPT_NODE

  const existing = compiler.nodes.get(schema)
  if (existing !== undefined) return existing

  const node: CompiledNode = { run: NOOP }
  node.run = (ctx, value, path, evaluation, depth, scope) => {
    const built = buildNode(compiler, schema)
    node.run = built
    built(ctx, value, path, evaluation, depth, scope)
  }
  compiler.nodes.set(schema, node)
  return node
}

/**
 * Validates `value` against `node` in a pure boolean context — the branches of
 * `anyOf` / `oneOf` / `not` / `if`, where a failing branch is expected and must
 * not pollute the caller's error list. Shares the ref caches and the work budget
 * so the isolation costs nothing beyond a small context object.
 */
const probe = (
  ctx: InterpreterContext,
  node: CompiledNode,
  value: unknown,
  depth: number,
  scope: DynamicScope,
  collect: Evaluation | null,
): boolean => {
  const sub = newBranchContext(ctx)
  // When the caller is tracking annotations, evaluate the branch into a private
  // tracker and fold it in only if the branch matched — annotations from a
  // failing branch never count toward `unevaluated*`.
  const branchEval = collect !== null ? newEvaluation() : null
  node.run(sub, value, '', branchEval, depth + 1, scope)
  const ok = !sub.failed
  if (ok && collect !== null && branchEval !== null) mergeEvaluation(collect, branchEval)
  return ok
}

/**
 * Applies an in-place applicator (`$ref`/`$dynamicRef` target, `allOf` item,
 * `then`/`else`, `dependentSchemas`) with correct `unevaluated*` scoping: the
 * child evaluates into a FRESH annotation scope, so its own `unevaluated*`
 * keyword sees only what its own subtree evaluated, and its annotations are then
 * merged UP so the parent's `unevaluated*` still counts them. With no ancestor
 * tracking annotations this is a plain call, so the common unevaluated-free
 * schema pays nothing.
 */
const runInPlace = (
  ctx: InterpreterContext,
  node: CompiledNode,
  value: unknown,
  path: string,
  parentScope: Evaluation | null,
  depth: number,
  scope: DynamicScope,
): void => {
  if (parentScope === null) {
    node.run(ctx, value, path, null, depth + 1, scope)
    return
  }
  const childScope = newEvaluation()
  node.run(ctx, value, path, childScope, depth + 1, scope)
  mergeEvaluation(parentScope, childScope)
}

/**
 * Recurses into a `$ref` / `$dynamicRef` target while breaking reference cycles.
 * A ref that resolves to the same (schema node, value) pair already being
 * validated higher on the stack is an infinite loop no finite data can escape —
 * e.g. `{ $ref: '#' }`, or mutually recursive `$defs` — so re-entering it would
 * recurse forever and blow the stack. Legitimately deep *data* is unaffected:
 * each level carries a distinct `value`, so no pair repeats.
 *
 * What the cycle break guarantees: an outer frame is already checking this exact
 * node against this exact value, so a *conjunctive* re-entry (the value must
 * satisfy the node, and the outer frame is deciding that) adds nothing and the
 * verdict is unchanged.
 *
 * What it does *not* guarantee: inside a disjunction, returning without failing
 * is itself a verdict — the branch counts as matched. So
 * `{ $defs: { n: { anyOf: [{ type: 'string' }, { $ref: '#/$defs/n' }] } },
 * $ref: '#/$defs/n' }` accepts `123`, even though the only non-recursive branch
 * demands a string. This is the price of terminating at all on a schema whose
 * `anyOf` is genuinely unbounded; Ajv stack-overflows on the same input, so
 * "answers something" beats "crashes the process".
 *
 * The cycle is keyed on the target *schema value*, not on its compiled node, so
 * it recognises exactly the pairs the walker did — a boolean or malformed target
 * has no node of its own to be identified by.
 */
const runRef = (
  ctx: InterpreterContext,
  target: unknown,
  node: CompiledNode,
  value: unknown,
  path: string,
  evaluation: Evaluation | null,
  depth: number,
  scope: DynamicScope,
): void => {
  const stack = ctx.refStack
  for (let i = 0; i < stack.length; i += 2) {
    if (stack[i] === target && stack[i + 1] === value) return
  }
  stack.push(target, value)
  runInPlace(ctx, node, value, path, evaluation, depth, scope)
  stack.length -= 2
}

/**
 * `$ref` against a document with no `$id` anywhere. The target depends only on
 * the root, so it is resolved (and its node built) on the first visit and kept —
 * but *not* before then, so an unresolvable pointer still throws when the
 * validator runs rather than when it is built, which is the documented contract
 * and what the "does no work until called" test pins down.
 */
const compilePlainRef = (compiler: Compiler, ref: string): Step => {
  let target: unknown
  let node: CompiledNode | null = null
  return (ctx, value, path, evaluation, depth, scope) => {
    let resolved = node
    if (resolved === null) {
      target = resolvePlainRef(ctx, ref)
      resolved = compileNode(compiler, target)
      node = resolved
    }
    runRef(ctx, target, resolved, value, path, evaluation, depth, scope)
  }
}

/**
 * `$ref` inside a document that declares an `$id`. The base URI in scope decides
 * the target, and the scope is a run-time value, so this stays a lookup per
 * visit — memoized per `(base, ref)` by {@link resolveScoped} exactly as before.
 */
const compileScopedRef = (compiler: Compiler, ref: string, registry: SchemaRegistry): Step => {
  const plain = compilePlainRef(compiler, ref)
  return (ctx, value, path, evaluation, depth, scope) => {
    const base = scope[scope.length - 1]
    if (base === undefined) {
      plain(ctx, value, path, evaluation, depth, scope)
      return
    }
    const target = resolveScoped(ctx, registry, ref, base)
    const node = compileNode(compiler, target.value)
    runRef(ctx, target.value, node, value, path, evaluation, depth, enterResource(scope, target.base))
  }
}

/**
 * `$dynamicRef` (2020-12) — late-binds to a matching `$dynamicAnchor`. The
 * `$id`-aware path is deliberately not memoized: its answer depends on the
 * dynamic scope the reference was reached through, which is the whole point of
 * the keyword.
 */
const compileDynamicRef = (compiler: Compiler, ref: string): Step => {
  const registry = compiler.registry
  if (registry === null) {
    let target: unknown
    let node: CompiledNode | null = null
    return (ctx, value, path, evaluation, depth, scope) => {
      let resolved = node
      if (resolved === null) {
        target = resolveDyn(ctx, ref)
        resolved = compileNode(compiler, target)
        node = resolved
      }
      runRef(ctx, target, resolved, value, path, evaluation, depth, scope)
    }
  }
  return (ctx, value, path, evaluation, depth, scope) => {
    const base = scope[scope.length - 1]
    if (base === undefined) {
      const target = resolveDyn(ctx, ref)
      runRef(ctx, target, compileNode(compiler, target), value, path, evaluation, depth, scope)
      return
    }
    const target = resolveScopedDynamicRef(registry, ref, base, scope) ?? dynamicFallbackTarget(ctx, ref, base)
    const node = compileNode(compiler, target.value)
    runRef(ctx, target.value, node, value, path, evaluation, depth, enterResource(scope, target.base))
  }
}

/**
 * `$recursiveRef` (2019-09) — the predecessor of `$dynamicRef`. Its only legal
 * value is `"#"`: late-binds to the `$recursiveAnchor: true` subschema, falling
 * back to the document root, so there is one possible target per document.
 */
const compileRecursiveRef = (compiler: Compiler): Step => {
  let target: unknown
  let node: CompiledNode | null = null
  return (ctx, value, path, evaluation, depth, scope) => {
    let resolved = node
    if (resolved === null) {
      target = resolveRec(ctx)
      resolved = compileNode(compiler, target)
      node = resolved
    }
    runRef(ctx, target, resolved, value, path, evaluation, depth, scope)
  }
}

/**
 * The reference keywords a node carries. Sibling keywords still apply per
 * 2020-12, so these are ordinary steps in the node's sequence rather than a
 * short circuit.
 */
const compileRefs = (compiler: Compiler, refs: NonNullable<NodeMeta['refs']>): Step[] => {
  const steps: Step[] = []
  const registry = compiler.registry
  if (refs.ref !== undefined) {
    steps.push(registry === null ? compilePlainRef(compiler, refs.ref) : compileScopedRef(compiler, refs.ref, registry))
  }
  if (refs.dynamicRef !== undefined) steps.push(compileDynamicRef(compiler, refs.dynamicRef))
  if (refs.hasRecursiveRef) steps.push(compileRecursiveRef(compiler))
  return steps
}

/** `const` — a primitive compares by identity, anything else structurally. */
const compileConst = (expected: unknown): Step => {
  if (isPrimitiveEnumValue(expected)) {
    const message = `must be equal to ${JSON.stringify(expected)}`
    return (ctx, value, path) => {
      if (value !== expected) fail(ctx, message, path)
    }
  }
  return (ctx, value, path) => {
    if (!deepEqual(value, expected)) fail(ctx, 'must be equal to the expected constant', path)
  }
}

/**
 * `enum` — membership against a `Set` when every value is a primitive (so the
 * lookup is O(1) and SameValueZero, matching the structural path on `NaN`), and
 * a `deepEqual` scan otherwise.
 *
 * The failure message is built on the first failure and kept, never up front: on
 * a 500-value enum that string is most of the node's cost, and a discriminated
 * union rejects such a node once per branch it does not take — all of it in
 * guard mode, where the message is dropped unread.
 */
const compileEnum = (schema: object, values: readonly unknown[]): Step => {
  const primitiveSet = getEnumSet(schema, values)
  let message: string | null = null
  return (ctx, value, path) => {
    let found: boolean
    if (primitiveSet !== null) {
      found = primitiveSet.has(value)
    } else {
      found = false
      for (const candidate of values) {
        if (deepEqual(value, candidate)) {
          found = true
          break
        }
      }
    }
    if (found) return
    if (!ctx.emitErrors) {
      ctx.failed = true
      return
    }
    if (message === null) message = `must be one of: ${values.map((v) => JSON.stringify(v)).join(', ')}`
    fail(ctx, message, path)
  }
}

/**
 * The predicate for one JSON Schema `type`, or `null` for a name the spec does
 * not define — a schema error the caller has to keep reporting per visit, not
 * one to raise while building.
 */
const typeTest = (type: string): ((value: unknown) => boolean) | null => {
  switch (type) {
    case 'string':
      return (value) => typeof value === 'string'
    case 'number':
      return (value) => typeof value === 'number'
    case 'integer':
      return (value) => Number.isInteger(value)
    case 'boolean':
      return (value) => typeof value === 'boolean'
    case 'null':
      return (value) => value === null
    case 'object':
      return (value) => typeof value === 'object' && value !== null && !Array.isArray(value)
    case 'array':
      return (value) => Array.isArray(value)
    default:
      return null
  }
}

/**
 * The step for a node that is nothing but `{ type: X }` — no bounds, no
 * properties, no anything. It has no per-node state at all, so there is one per
 * type for the whole process rather than one per node: a schema with fifty bare
 * `{ type: 'string' }` leaves compiles to fifty references to the same closure.
 */
const typeOnlySteps = new Map<string, Step>()

const typeOnlyStep = (type: string): Step | null => {
  const cached = typeOnlySteps.get(type)
  if (cached !== undefined) return cached
  const test = typeTest(type)
  if (test === null) return null
  const message = `must be ${type}`
  const step: Step = (ctx, value, path, _evaluation, depth) => {
    if (!openNode(ctx, depth)) return
    if (!test(value)) fail(ctx, message, path)
  }
  typeOnlySteps.set(type, step)
  return step
}

/** `type`, in both its single-string and array forms. */
const compileType = (meta: NodeMeta): Step | null => {
  const single = meta.type
  if (single !== undefined) {
    const test = typeTest(single)
    // An unknown `type` is a schema error, and the walker raised it every time
    // the node was reached rather than while reading the schema. Keep that: a
    // node the data never reaches must stay silent.
    if (test === null) {
      return (_ctx, value) => {
        matchesType(single, value)
      }
    }
    const message = `must be ${single}`
    return (ctx, value, path) => {
      if (!test(value)) fail(ctx, message, path)
    }
  }

  const types = meta.types
  if (types === undefined) return null
  const message = `must be one of type: ${types.join(', ')}`
  // Left as a `matchesType` loop rather than an array of predicates so an
  // unknown name late in the list still throws only when the earlier ones did
  // not already match, exactly as before.
  return (ctx, value, path) => {
    for (const type of types) {
      if (matchesType(type, value)) return
    }
    fail(ctx, message, path)
  }
}

/**
 * The string constraints. The length bounds and `pattern` belong to the
 * validation vocabulary; `format` is its own vocabulary and survives a dialect
 * that drops validation, so it is compiled either way — and only when the format
 * is one this validator was asked to check, since that set is fixed per
 * validator.
 */
const compileString = (compiler: Compiler, keywords: StringKeywords, guaranteed: boolean): Step | null => {
  const parts: Step[] = []

  if (compiler.asserts) {
    const minLength = keywords.minLength
    const maxLength = keywords.maxLength
    // A length *range* is one step rather than two. `{ minLength, maxLength }` is
    // the common pair, and emitting it fused costs a node one closure instead of
    // three — which the one-shot path, where every closure is built and used
    // once, feels directly.
    if (minLength !== undefined && maxLength !== undefined) {
      const minMessage = `must have at least ${minLength} characters`
      const maxMessage = `must have at most ${maxLength} characters`
      const band = 2 * minLength
      parts.push((ctx, value, path) => {
        const units = (value as string).length
        if (units < minLength || (units < band && codePointLength(value as string) < minLength)) {
          fail(ctx, minMessage, path)
          if (ctx.failed) return
        }
        if (units > maxLength && codePointLength(value as string) > maxLength) fail(ctx, maxMessage, path)
      })
    } else if (minLength !== undefined) {
      const message = `must have at least ${minLength} characters`
      // Length is measured in code points per spec, but `value.length` (UTF-16
      // code units) is an upper bound on it — and equal unless the string holds a
      // surrogate pair. So the cheap unit count is authoritative except in the
      // band [min, 2·min), and only there is the exact scan paid.
      const band = 2 * minLength
      parts.push((ctx, value, path) => {
        const units = (value as string).length
        if (units < minLength || (units < band && codePointLength(value as string) < minLength)) {
          fail(ctx, message, path)
        }
      })
    } else if (maxLength !== undefined) {
      const message = `must have at most ${maxLength} characters`
      parts.push((ctx, value, path) => {
        // units <= max ⇒ code points <= max (pass); only an over-long unit count
        // needs the exact scan, where surrogate pairs may still bring it within.
        if ((value as string).length > maxLength && codePointLength(value as string) > maxLength) {
          fail(ctx, message, path)
        }
      })
    }

    const pattern = keywords.pattern
    if (pattern !== undefined) {
      const message = `must match pattern ${pattern}`
      // Compiled once here rather than fetched from a per-validator cache on
      // every visit. `screenSchema` has already rejected a ReDoS-prone source by
      // this point, and a source that is not a valid regex at all still throws on
      // the node's first visit, because that is when the node is built.
      const regex = compilePattern(pattern)
      parts.push((ctx, value, path) => {
        if (!regex.test(value as string)) fail(ctx, message, path)
      })
    }
  }

  const format = keywords.format
  if (format !== undefined) {
    const formats = compiler.formats
    // Whether a format is checked at all is fixed for the validator, so a
    // disabled one compiles to nothing rather than to a per-call set lookup.
    if (formats === 'all' || formats.has(format)) {
      const message = `must match format "${format}"`
      if (format === 'regex') {
        // The one format whose check is a compile, not a pattern match.
        parts.push((ctx, value, path) => {
          if (!isValidRegex(value as string)) fail(ctx, message, path)
        })
      } else {
        // `Object.hasOwn`, not a bare index: the schema is runtime input, and
        // `format: "toString"` otherwise read `Function.prototype.toString` off
        // the prototype chain — truthy, with no `.test` — so an unknown format
        // that the spec says to ignore crashed the validator instead.
        const check = Object.hasOwn(FORMAT_CHECKS, format) ? FORMAT_CHECKS[format] : undefined
        if (check) {
          parts.push((ctx, value, path) => {
            if (!check.test(value as string)) fail(ctx, message, path)
          })
        }
      }
    }
  }

  return parts.length === 0 ? null : guaranteed ? seq(parts) : guardedSeq(isStringValue, parts)
}

/**
 * The numeric constraints.
 *
 * Bounds are written as *pass* conditions and negated so `NaN` — which compares
 * `false` against every operator — fails them, matching Ajv. A bare
 * `type: 'number'` with no bound still accepts non-finite numbers, as Ajv does;
 * only a bound (or `multipleOf`) rejects them.
 */
const compileNumber = (keywords: NumberKeywords, guaranteed: boolean): Step | null => {
  const parts: Step[] = []

  const minimum = keywords.minimum
  const maximum = keywords.maximum
  const plainRange =
    minimum !== undefined && maximum !== undefined && !keywords.strictMinimum && !keywords.strictMaximum
  if (plainRange && minimum !== undefined && maximum !== undefined) {
    // The ordinary numeric range, fused for the same reason the string length
    // range above is.
    const minMessage = `must be >= ${minimum}`
    const maxMessage = `must be <= ${maximum}`
    parts.push((ctx, value, path) => {
      const number = value as number
      if (!(number >= minimum)) {
        fail(ctx, minMessage, path)
        if (ctx.failed) return
      }
      if (!(number <= maximum)) fail(ctx, maxMessage, path)
    })
  }

  if (!plainRange && minimum !== undefined) {
    // Draft-04 used a boolean `exclusiveMinimum: true` alongside `minimum` to
    // make the bound strict; draft-06+ replaced it with a standalone numeric
    // keyword (below). Honour both forms.
    const message = keywords.strictMinimum ? `must be > ${minimum}` : `must be >= ${minimum}`
    if (keywords.strictMinimum) {
      parts.push((ctx, value, path) => {
        if (!((value as number) > minimum)) fail(ctx, message, path)
      })
    } else {
      parts.push((ctx, value, path) => {
        if (!((value as number) >= minimum)) fail(ctx, message, path)
      })
    }
  }

  if (!plainRange && maximum !== undefined) {
    const message = keywords.strictMaximum ? `must be < ${maximum}` : `must be <= ${maximum}`
    if (keywords.strictMaximum) {
      parts.push((ctx, value, path) => {
        if (!((value as number) < maximum)) fail(ctx, message, path)
      })
    } else {
      parts.push((ctx, value, path) => {
        if (!((value as number) <= maximum)) fail(ctx, message, path)
      })
    }
  }

  const exclusiveMinimum = keywords.exclusiveMinimum
  if (exclusiveMinimum !== undefined) {
    const message = `must be > ${exclusiveMinimum}`
    parts.push((ctx, value, path) => {
      if (!((value as number) > exclusiveMinimum)) fail(ctx, message, path)
    })
  }

  const exclusiveMaximum = keywords.exclusiveMaximum
  if (exclusiveMaximum !== undefined) {
    const message = `must be < ${exclusiveMaximum}`
    parts.push((ctx, value, path) => {
      if (!((value as number) < exclusiveMaximum)) fail(ctx, message, path)
    })
  }

  const multipleOf = keywords.multipleOf
  if (multipleOf !== undefined && multipleOf > 0) {
    const message = `must be a multiple of ${multipleOf}`
    if (Number.isInteger(multipleOf)) {
      // For an integer divisor `%` on doubles is exact, so this accepts huge true
      // multiples (`1e21 % 1 === 0`) that a quotient check would misjudge, and
      // rejects `NaN`/`±Infinity`, which is Ajv's verdict for `multipleOf` on any
      // non-finite value.
      parts.push((ctx, value, path) => {
        if (!(Number.isInteger(value) && (value as number) % multipleOf === 0)) fail(ctx, message, path)
      })
    } else {
      // Floating-point modulo is unreliable (`0.3 % 0.1 !== 0`), so divide and
      // measure the distance to the nearest integer. The tolerance tracks the
      // actual representation error in `q` (~`|q|·2⁻⁵²`); a non-finite value
      // yields a `NaN` distance, so the `<=` is `false` and it fails.
      parts.push((ctx, value, path) => {
        const q = (value as number) / multipleOf
        const tolerance = 2 * Number.EPSILON * Math.max(1, Math.abs(q))
        if (!(Math.abs(q - Math.round(q)) <= tolerance)) fail(ctx, message, path)
      })
    }
  }

  return parts.length === 0 ? null : guaranteed ? seq(parts) : guardedSeq(isNumberValue, parts)
}

/**
 * The array keywords. The count bounds and `uniqueItems` are
 * validation-vocabulary; `prefixItems`, `items` and `contains` are applicators
 * and always apply. Which of `prefixItems` / array-form `items` /
 * `additionalItems` supplies the positional schemas and which the tail was
 * already sorted out when the node's {@link NodeMeta} was read.
 */
const compileArray = (compiler: Compiler, keywords: ArrayKeywords, guaranteed: boolean): Step => {
  const asserts = compiler.asserts
  const parts: Step[] = []

  const minItems = asserts ? keywords.minItems : undefined
  if (minItems !== undefined) {
    const message = `must have at least ${minItems} items`
    parts.push((ctx, value, path) => {
      if ((value as unknown[]).length < minItems) fail(ctx, message, path)
    })
  }

  const maxItems = asserts ? keywords.maxItems : undefined
  if (maxItems !== undefined) {
    const message = `must have at most ${maxItems} items`
    parts.push((ctx, value, path) => {
      if ((value as unknown[]).length > maxItems) fail(ctx, message, path)
    })
  }

  const tuple = keywords.tuple
  const start = tuple ? tuple.length : 0
  if (tuple !== undefined) {
    const nodes = tuple.map((sub) => compileNode(compiler, sub))
    parts.push((ctx, value, path, evaluation, depth, scope) => {
      const arr = value as unknown[]
      for (let index = 0; index < nodes.length; index++) {
        if (arr.length <= index) continue
        ;(nodes[index] as CompiledNode).run(ctx, arr[index], childPath(ctx, path, index), null, depth + 1, scope)
        if (evaluation !== null) evaluation.items.add(index)
        if (ctx.failed) return
      }
    })
  }

  const rest = keywords.rest
  if (rest === false) {
    const message = `must NOT have more than ${start} items`
    parts.push((ctx, value, path) => {
      if ((value as unknown[]).length > start) fail(ctx, message, path)
    })
  } else if (rest === true) {
    // `items: true` evaluates the whole tail without validating any of it.
    parts.push((_ctx, _value, _path, evaluation) => {
      if (evaluation !== null) evaluation.allItems = true
    })
  } else if (rest !== undefined) {
    const node = compileNode(compiler, rest)
    parts.push((ctx, value, path, evaluation, depth, scope) => {
      const arr = value as unknown[]
      for (let i = start; i < arr.length; i++) {
        node.run(ctx, arr[i], childPath(ctx, path, i), null, depth + 1, scope)
        if (ctx.failed) return
      }
      // A tail `items`/`additionalItems` schema sweeps every index from `start` on.
      if (evaluation !== null) evaluation.allItems = true
    })
  }

  if (asserts && keywords.uniqueItems) {
    parts.push((ctx, value, path) => {
      if (!allUnique(ctx, value as unknown[])) fail(ctx, 'must have unique items', path)
    })
  }

  // `contains` — at least `minContains` (default 1) and at most `maxContains`
  // items must match the subschema. `minContains: 0` makes the lower bound
  // trivially satisfied (even for an empty array) while any `maxContains` still
  // applies. `minContains`/`maxContains` are validation-vocabulary; `contains`
  // itself is an applicator, and its own "at least one match" assertion stands
  // either way.
  if (keywords.hasContains) {
    const node = compileNode(compiler, keywords.contains)
    const min = asserts ? (keywords.minContains ?? 1) : 1
    const max = asserts ? keywords.maxContains : undefined
    const minMessage = `must contain at least ${min} matching items`
    const maxMessage = max === undefined ? '' : `must contain at most ${max} matching items`
    parts.push((ctx, value, path, evaluation, depth, scope) => {
      const arr = value as unknown[]
      // `maxContains` needs the exact total (it is an upper bound), and an active
      // annotation scope needs every match (not just the first `min`) — so only
      // when neither is in play can we stop early. Without this a 1000-element
      // array matching at index 0 cost the same as one matching at index 999.
      const needsExactCount = max !== undefined || evaluation !== null
      // The indices `contains` matched, which is the annotation it publishes for
      // a sibling `unevaluatedItems`. Collected only when something is listening.
      const matched: number[] | null = evaluation === null ? null : []
      let count = 0
      for (let i = 0; i < arr.length; i++) {
        if (!probe(ctx, node, arr[i], depth, scope, null)) continue
        count++
        matched?.push(i)
        if (!needsExactCount && count >= min) break
      }
      // A `contains` that is satisfied evaluates exactly the items it matched —
      // not the whole array. That distinction is the entire point of pairing
      // `contains` with `unevaluatedItems`, and it is one of the few places we
      // knowingly diverge from Ajv (which marks every index evaluated); see the
      // note in `differential.test.ts`.
      if (evaluation !== null && matched !== null && count >= min && (max === undefined || count <= max)) {
        for (const index of matched) evaluation.items.add(index)
      }
      if (count < min) {
        fail(ctx, minMessage, path)
        if (ctx.failed) return
      }
      if (max !== undefined && count > max) fail(ctx, maxMessage, path)
    })
  }

  return guaranteed ? seq(parts) : guardedSeq(isArrayValue, parts)
}

/**
 * The `properties` loop: the single hottest thing this package does, so
 * everything it needs is laid out here as parallel arrays — the key, the key
 * already escaped for JSON Pointer, whether it is required, the missing-property
 * message, and the child's node. All the walker used to rebuild or look up per
 * call is a fixed-index array read.
 */
const compileProperties = (
  compiler: Compiler,
  properties: Record<string, unknown>,
  required: ReadonlySet<string>,
): Step => {
  const keys = Object.keys(properties)
  // Escaping is a no-op for every ordinary key, so the escaped list is the key
  // list itself unless some key really does carry a `/` or `~` — one fewer array
  // to allocate per object node, which the one-shot path feels.
  const escaped = keys.some(needsPointerEscape) ? keys.map(escapePointer) : keys
  const nodes = keys.map((key) => compileNode(compiler, properties[key]))
  // A dialect without the validation vocabulary keeps `required` as an
  // annotation, so a missing property asserts nothing and the flag is simply off.
  const requiredFlags = keys.map((key) => compiler.asserts && required.has(key))
  const count = keys.length

  return (ctx, value, path, evaluation, depth, scope) => {
    const obj = value as Record<string, unknown>
    const emitErrors = ctx.emitErrors
    for (let i = 0; i < count; i++) {
      const key = keys[i] as string
      // One read, reused. Presence is own-property membership *and* a defined
      // value — Ajv's rule, so `{ a: undefined }` counts as absent — and the
      // `!== undefined` half is free off `propertyValue`.
      const propertyValue = obj[key]
      if (propertyValue !== undefined && Object.hasOwn(obj, key)) {
        // Build the child path from the pre-escaped key (a bare concat, no
        // per-call scan), only in error mode where it is actually read.
        ;(nodes[i] as CompiledNode).run(
          ctx,
          propertyValue,
          emitErrors ? `${path}/${escaped[i]}` : path,
          null,
          depth + 1,
          scope,
        )
        if (evaluation !== null) evaluation.props.add(key)
      } else if (requiredFlags[i]) {
        // Built here, not per declared key up front: a missing required property
        // is the failure path, and a one-shot validation of a 40-property schema
        // should not pay for 40 strings it will never read.
        fail(ctx, `must have required property '${key}'`, path)
      }
      if (ctx.failed) return
    }
  }
}

/**
 * The `properties` loop for the closed-object shape: `properties` plus
 * `additionalProperties: false`, with nothing between them — by far the most
 * common object in a real contract, and the one the sweep costs the most on.
 *
 * Fusing the two lets the loop count the declared keys the instance actually
 * carries, and that count is a proof: an object whose own key count equals it
 * has no additional property to find, so the sweep is skipped outright rather
 * than walked to confirm what the loop already established. A count that does
 * not match falls through to the same key-by-key sweep as before, so an object
 * that really does carry an extra key — or a declared key holding `undefined`,
 * which `Object.keys` counts and presence does not — is reported exactly as it
 * was.
 */
const compileClosedProperties = (
  compiler: Compiler,
  properties: Record<string, unknown>,
  required: ReadonlySet<string>,
): Step => {
  const keys = Object.keys(properties)
  // Escaping is a no-op for every ordinary key, so the escaped list is the key
  // list itself unless some key really does carry a `/` or `~` — one fewer array
  // to allocate per object node, which the one-shot path feels.
  const escaped = keys.some(needsPointerEscape) ? keys.map(escapePointer) : keys
  const nodes = keys.map((key) => compileNode(compiler, properties[key]))
  const requiredFlags = keys.map((key) => compiler.asserts && required.has(key))
  const count = keys.length

  return (ctx, value, path, evaluation, depth, scope) => {
    const obj = value as Record<string, unknown>
    const emitErrors = ctx.emitErrors
    let present = 0
    for (let i = 0; i < count; i++) {
      const key = keys[i] as string
      const propertyValue = obj[key]
      if (propertyValue !== undefined && Object.hasOwn(obj, key)) {
        present++
        ;(nodes[i] as CompiledNode).run(
          ctx,
          propertyValue,
          emitErrors ? `${path}/${escaped[i]}` : path,
          null,
          depth + 1,
          scope,
        )
        if (evaluation !== null) evaluation.props.add(key)
      } else if (requiredFlags[i]) {
        // Built here, not per declared key up front: a missing required property
        // is the failure path, and a one-shot validation of a 40-property schema
        // should not pay for 40 strings it will never read.
        fail(ctx, `must have required property '${key}'`, path)
      }
      if (ctx.failed) return
    }

    // `Object.keys().length` rather than a walk: the engine answers the count
    // without materializing the key array, so the common "exactly the declared
    // keys" object never pays for one.
    if (Object.keys(obj).length === present) return

    for (const key of Object.keys(obj)) {
      if (Object.hasOwn(properties, key)) continue
      if (evaluation !== null) evaluation.props.add(key)
      fail(ctx, 'must NOT have additional properties', childPath(ctx, path, key))
      if (ctx.failed) return
    }
  }
}

/**
 * The `patternProperties` / `additionalProperties` sweep over the instance's own
 * keys.
 *
 * `Object.keys`, not a guarded `for…in`: a bare `for…in` walks the prototype
 * chain, so an inherited key was validated as though the instance carried it —
 * and a polluted `Object.prototype` made `additionalProperties: false` reject
 * every object in the process. The key array also measured *faster* than either
 * `for…in` form on a 20-key object (92M ops/s against 19M and 9.5M).
 */
const compileKeySweep = (
  compiler: Compiler,
  keywords: ObjectKeywords,
  patternEntries: readonly (readonly [RegExp, CompiledNode])[] | null,
): Step | null => {
  const hasAdditional = keywords.hasAdditionalProperties
  const additional = keywords.additionalProperties
  if (patternEntries === null && !(hasAdditional && additional !== true)) return null

  const properties = keywords.properties
  const rejectsAdditional = hasAdditional && additional === false
  const additionalNode = hasAdditional && isPlainObject(additional) ? compileNode(compiler, additional) : null

  return (ctx, value, path, evaluation, depth, scope) => {
    const obj = value as Record<string, unknown>
    for (const key of Object.keys(obj)) {
      // `patternProperties` applies to every matching key independently of
      // `properties` — a key declared in both must satisfy both — so it runs even
      // when `key` is also a known property. Only `additionalProperties` is the
      // fallback for keys reached by neither.
      const inProperties = properties !== undefined && Object.hasOwn(properties, key)
      let matched = false
      if (patternEntries !== null) {
        for (const [regex, node] of patternEntries) {
          if (regex.test(key)) {
            matched = true
            if (evaluation !== null) evaluation.props.add(key)
            node.run(ctx, obj[key], childPath(ctx, path, key), null, depth + 1, scope)
            if (ctx.failed) return
          }
        }
      }

      if (inProperties || matched || !hasAdditional) continue
      if (rejectsAdditional) {
        if (evaluation !== null) evaluation.props.add(key)
        fail(ctx, 'must NOT have additional properties', childPath(ctx, path, key))
        if (ctx.failed) return
      } else if (additionalNode !== null) {
        if (evaluation !== null) evaluation.props.add(key)
        additionalNode.run(ctx, obj[key], childPath(ctx, path, key), null, depth + 1, scope)
        if (ctx.failed) return
      }
    }
  }
}

/** The object keywords, in the order the walker emitted them. */
const compileObject = (compiler: Compiler, keywords: ObjectKeywords, guaranteed: boolean): Step => {
  const asserts = compiler.asserts
  const parts: Step[] = []

  const properties = keywords.properties
  const requiredList = keywords.required ?? []
  const requiredSet = new Set(requiredList)

  // Whether the `properties` loop and the `additionalProperties: false` sweep
  // are adjacent — nothing the walker emitted between them, and no
  // `patternProperties` for the sweep to also apply. Only then can the two be
  // fused, because fusing reorders nothing that is there.
  const closed =
    properties !== undefined &&
    keywords.patternProperties === undefined &&
    keywords.hasAdditionalProperties &&
    keywords.additionalProperties === false &&
    keywords.dependentRequired === undefined &&
    keywords.dependentSchemas === undefined &&
    keywords.dependencies === undefined &&
    requiredList.every((key) => Object.hasOwn(properties, key))

  if (properties !== undefined) {
    parts.push(
      closed
        ? compileClosedProperties(compiler, properties, requiredSet)
        : compileProperties(compiler, properties, requiredSet),
    )
  }

  // `Object.hasOwn`, not `key in properties`: `in` walks `Object.prototype`, so
  // `required: ['toString']` alongside any `properties` object looked already
  // covered and was dropped here — and `toString` is not among the declared keys
  // either (those come from `Object.keys`), so nothing checked it and the key
  // went silently unenforced.
  const requiredElsewhere = asserts
    ? requiredList.filter((key) => !(properties !== undefined && Object.hasOwn(properties, key)))
    : []
  if (requiredElsewhere.length > 0) {
    const messages = requiredElsewhere.map((key) => `must have required property '${key}'`)
    parts.push((ctx, value, path) => {
      const obj = value as Record<string, unknown>
      for (let i = 0; i < requiredElsewhere.length; i++) {
        if (!hasProperty(obj, requiredElsewhere[i] as string)) {
          fail(ctx, messages[i] as string, path)
          if (ctx.failed) return
        }
      }
    })
  }

  const dependentRequired = asserts ? keywords.dependentRequired : undefined
  if (dependentRequired !== undefined) {
    const entries = Object.entries(dependentRequired)
      .filter(([, deps]) => Array.isArray(deps))
      .map(
        ([trigger, deps]) =>
          [
            trigger,
            deps as string[],
            (deps as string[]).map((dep) => `must have property '${dep}' when '${trigger}' is present`),
          ] satisfies [string, string[], string[]],
      )
    if (entries.length > 0) {
      parts.push((ctx, value, path) => {
        const obj = value as Record<string, unknown>
        for (const [trigger, deps, messages] of entries) {
          if (!hasProperty(obj, trigger)) continue
          for (let i = 0; i < deps.length; i++) {
            if (!hasProperty(obj, deps[i] as string)) {
              fail(ctx, messages[i] as string, path)
              if (ctx.failed) return
            }
          }
        }
      })
    }
  }

  // `dependentSchemas` (2020-12): when a property is present, the whole object
  // must also match the associated subschema.
  const dependentSchemas = keywords.dependentSchemas
  if (dependentSchemas !== undefined) {
    const entries = Object.entries(dependentSchemas).map(
      ([trigger, sub]) => [trigger, compileNode(compiler, sub)] satisfies [string, CompiledNode],
    )
    if (entries.length > 0) {
      parts.push((ctx, value, path, evaluation, depth, scope) => {
        const obj = value as Record<string, unknown>
        for (const [trigger, node] of entries) {
          if (!hasProperty(obj, trigger)) continue
          runInPlace(ctx, node, obj, path, evaluation, depth, scope)
          if (ctx.failed) return
        }
      })
    }
  }

  // `dependencies` (draft-07): the dual-form predecessor of `dependentRequired`
  // + `dependentSchemas`. An array value requires the listed keys; a schema value
  // is applied to the whole object — both gated on the trigger's presence.
  const dependencies = keywords.dependencies
  if (dependencies !== undefined) {
    const entries = Object.entries(dependencies).map(([trigger, dep]) => {
      if (Array.isArray(dep)) {
        const keys = dep as string[]
        return {
          trigger,
          keys,
          messages: keys.map((key) => `must have property '${key}' when '${trigger}' is present`),
          node: null,
        }
      }
      return { trigger, keys: null, messages: null, node: compileNode(compiler, dep) }
    })
    if (entries.length > 0) {
      parts.push((ctx, value, path, evaluation, depth, scope) => {
        const obj = value as Record<string, unknown>
        for (const entry of entries) {
          if (!hasProperty(obj, entry.trigger)) continue
          const keys = entry.keys
          if (keys !== null) {
            const messages = entry.messages as string[]
            for (let i = 0; i < keys.length; i++) {
              if (!hasProperty(obj, keys[i] as string)) {
                fail(ctx, messages[i] as string, path)
                if (ctx.failed) return
              }
            }
          } else {
            runInPlace(ctx, entry.node as CompiledNode, obj, path, evaluation, depth, scope)
            if (ctx.failed) return
          }
        }
      })
    }
  }

  // `additionalProperties: true` validates nothing but still annotates every
  // additional property as evaluated (mirroring the `items: true` tail sweep), so
  // `unevaluatedProperties` must treat the whole object as covered. The schema and
  // `false` forms mark their keys inside the sweep below; the `true` form has no
  // sweep to mark them in.
  if (keywords.hasAdditionalProperties && keywords.additionalProperties === true) {
    parts.push((_ctx, _value, _path, evaluation) => {
      if (evaluation !== null) evaluation.allProps = true
    })
  }

  // Compile each `patternProperties` regex once here (a stateless RegExp is safe
  // to share) so the per-key loop skips both a cache lookup and recompilation.
  const patternProperties = keywords.patternProperties
  const patternEntries = patternProperties
    ? Object.entries(patternProperties).map(
        ([source, sub]) => [compilePattern(source), compileNode(compiler, sub)] satisfies [RegExp, CompiledNode],
      )
    : null
  const sweep = closed ? null : compileKeySweep(compiler, keywords, patternEntries)
  if (sweep !== null) parts.push(sweep)

  const minProperties = asserts ? keywords.minProperties : undefined
  const maxProperties = asserts ? keywords.maxProperties : undefined
  if (minProperties !== undefined || maxProperties !== undefined) {
    const minMessage = minProperties === undefined ? '' : `must have at least ${minProperties} properties`
    const maxMessage = maxProperties === undefined ? '' : `must have at most ${maxProperties} properties`
    parts.push((ctx, value, path) => {
      // Own properties only, as the spec requires. `Object.keys().length` looks
      // like the allocating option but measured the fastest of the three forms by
      // a wide margin — the engine does not have to materialize the key array to
      // answer `.length`.
      const count = Object.keys(value as Record<string, unknown>).length
      if (minProperties !== undefined && count < minProperties) {
        fail(ctx, minMessage, path)
        if (ctx.failed) return
      }
      if (maxProperties !== undefined && count > maxProperties) fail(ctx, maxMessage, path)
    })
  }

  // `propertyNames` — every property *key* (as a string) must match the schema.
  if (keywords.hasPropertyNames) {
    const node = compileNode(compiler, keywords.propertyNames)
    parts.push((ctx, value, path, _evaluation, depth, scope) => {
      const obj = value as Record<string, unknown>
      // One scratch context for the whole key loop instead of a fresh one per
      // key — on a 20-key object that was 20 context allocations for what is
      // usually a one-keyword string check. Reuse is safe because the only
      // per-probe state is `failed` (we reset it): the caches, ref stack and
      // budget are shared by design, `errors` stays null in boolean mode, and
      // these probes cannot nest, since the key is a string and the inner walk
      // never reaches another `propertyNames` at this instance location.
      let scratch: InterpreterContext | null = null
      for (const key of Object.keys(obj)) {
        if (scratch === null) scratch = newBranchContext(ctx)
        else scratch.failed = false
        node.run(scratch, key, '', null, depth + 1, scope)
        if (scratch.failed) {
          fail(ctx, `property name "${key}" is invalid`, childPath(ctx, path, key))
          if (ctx.failed) return
        }
      }
    })
  }

  return guaranteed ? seq(parts) : guardedSeq(isObjectValue, parts)
}

/**
 * The asserting branch applicators — `allOf`, `anyOf`, `oneOf`, `not`. Returned
 * as separate steps so the node's sequence unwinds between them exactly where
 * the walker did.
 *
 * `if`/`then`/`else` is deliberately not here: see {@link compileConditional}.
 */
const compileBranches = (compiler: Compiler, branches: BranchKeywords): Step[] => {
  const parts: Step[] = []

  const allOf = branches.allOf
  if (allOf !== undefined) {
    const nodes = allOf.map((sub) => compileNode(compiler, sub))
    parts.push((ctx, value, path, evaluation, depth, scope) => {
      for (const node of nodes) {
        runInPlace(ctx, node, value, path, evaluation, depth, scope)
        if (ctx.failed) return
      }
    })
  }

  const anyOf = branches.anyOf
  if (anyOf !== undefined) {
    const nodes = anyOf.map((sub) => compileNode(compiler, sub))
    parts.push((ctx, value, path, evaluation, depth, scope) => {
      let ok = false
      for (const node of nodes) {
        // When tracking annotations, evaluate every branch (each match
        // contributes its evaluated keys); otherwise short-circuit on the first.
        if (probe(ctx, node, value, depth, scope, evaluation)) {
          ok = true
          if (evaluation === null) break
        }
      }
      if (!ok) fail(ctx, 'must match a schema in anyOf', path)
    })
  }

  const oneOf = branches.oneOf
  if (oneOf !== undefined) {
    const nodes = oneOf.map((sub) => compileNode(compiler, sub))
    parts.push((ctx, value, path, evaluation, depth, scope) => {
      let count = 0
      for (const node of nodes) {
        if (probe(ctx, node, value, depth, scope, evaluation)) count++
      }
      if (count !== 1) fail(ctx, 'must match exactly one schema in oneOf', path)
    })
  }

  if (branches.hasNot) {
    const node = compileNode(compiler, branches.not)
    parts.push((ctx, value, path, _evaluation, depth, scope) => {
      // `not` produces no annotations — a passing inner schema means failure.
      if (probe(ctx, node, value, depth, scope, null)) fail(ctx, 'must not match schema', path)
    })
  }

  return parts
}

/**
 * `if` / `then` / `else`.
 *
 * Kept apart from the other branch applicators because of where the walker put
 * its early returns: a failing `then` or `else` was the one failure that did
 * *not* return before `unevaluated*` ran, so the annotation sweep still saw it.
 * Preserved here so a validation charges the same steps against its budget as it
 * always did.
 */
const compileConditional = (compiler: Compiler, branches: BranchKeywords): Step | null => {
  if (!branches.hasIf) return null
  const condition = compileNode(compiler, branches.ifSchema)
  const onTrue = branches.hasThen ? compileNode(compiler, branches.thenSchema) : null
  const onFalse = branches.hasElse ? compileNode(compiler, branches.elseSchema) : null
  if (onTrue === null && onFalse === null) {
    // `if` on its own still runs — it publishes annotations into the scope a
    // sibling `unevaluated*` reads — but has no branch to apply afterwards.
    return (ctx, value, _path, evaluation, depth, scope) => {
      probe(ctx, condition, value, depth, scope, evaluation)
    }
  }
  return (ctx, value, path, evaluation, depth, scope) => {
    if (probe(ctx, condition, value, depth, scope, evaluation)) {
      if (onTrue !== null) runInPlace(ctx, onTrue, value, path, evaluation, depth, scope)
    } else if (onFalse !== null) {
      runInPlace(ctx, onFalse, value, path, evaluation, depth, scope)
    }
  }
}

/**
 * `unevaluatedProperties` / `unevaluatedItems` (2020-12) — they act on whatever
 * every *other* keyword applied to this instance location left untouched, so
 * they run last, against the annotations those keywords recorded.
 */
const compileUnevaluated = (compiler: Compiler, keywords: UnevaluatedKeywords): Step => {
  const parts: Step[] = []

  if (keywords.hasProperties) {
    const schema = keywords.properties
    const rejects = schema === false
    const node = schema !== true && isPlainObject(schema) ? compileNode(compiler, schema) : null
    parts.push((ctx, value, path, evaluation, depth, scope) => {
      if (typeof value !== 'object' || value === null || Array.isArray(value)) return
      const evaluated = evaluation as Evaluation
      if (evaluated.allProps) return
      const obj = value as Record<string, unknown>
      // Own keys only, matching every other property sweep in this package.
      for (const key of Object.keys(obj)) {
        if (evaluated.props.has(key)) continue
        if (rejects) {
          fail(ctx, 'must NOT have unevaluated properties', childPath(ctx, path, key))
        } else if (node !== null) {
          node.run(ctx, obj[key], childPath(ctx, path, key), null, depth + 1, scope)
        }
        evaluated.props.add(key)
        if (ctx.failed) return
      }
      if (!rejects) evaluated.allProps = true
    })
  }

  if (keywords.hasItems) {
    const schema = keywords.items
    const rejects = schema === false
    const node = schema !== true && isPlainObject(schema) ? compileNode(compiler, schema) : null
    parts.push((ctx, value, path, evaluation, depth, scope) => {
      if (!Array.isArray(value)) return
      const evaluated = evaluation as Evaluation
      if (evaluated.allItems) return
      const arr = value as unknown[]
      for (let i = 0; i < arr.length; i++) {
        if (evaluated.items.has(i)) continue
        if (rejects) {
          fail(ctx, 'must NOT have unevaluated items', childPath(ctx, path, i))
        } else if (node !== null) {
          node.run(ctx, arr[i], childPath(ctx, path, i), null, depth + 1, scope)
        }
        evaluated.items.add(i)
        if (ctx.failed) return
      }
      if (!rejects) evaluated.allItems = true
    })
  }

  return seq(parts)
}

/**
 * Dispatches to the at-most-one type-specific block that can do work for a
 * value. A value is only ever one of object / array / string / number, and each
 * block is inert for every other type, so the blocks a node does not declare
 * disappear here rather than being called and returning immediately.
 */
const compileTypeBlocks = (compiler: Compiler, meta: NodeMeta, guaranteedType: string | undefined): Step | null => {
  // A node that already asserted a single `type`, and returned on it, hands its
  // block a value whose runtime type is settled — so the block does not repeat
  // the test, and a one-keyword block stops needing a wrapper to hold it. Only
  // ever passed for the fused shape in `buildNode`, where the type check really
  // does return before the block runs.
  const objects = meta.objects === null ? null : compileObject(compiler, meta.objects, guaranteedType === 'object')
  const arrays = meta.arrays === null ? null : compileArray(compiler, meta.arrays, guaranteedType === 'array')
  const strings = meta.strings === null ? null : compileString(compiler, meta.strings, guaranteedType === 'string')
  // Every keyword the number block reads is validation-vocabulary, so a dialect
  // without it compiles the block away entirely. `integer` implies `number`, so
  // it settles that block's guard too.
  const numbers =
    meta.numbers === null || !compiler.asserts
      ? null
      : compileNumber(meta.numbers, guaranteedType === 'number' || guaranteedType === 'integer')

  if (objects === null && arrays === null && strings === null && numbers === null) return null

  // Nearly every real node declares keywords for exactly one type, and the block
  // already opens with the guard the dispatch would apply, so it *is* the
  // dispatch — no wrapper, no second test.
  if (arrays === null && strings === null && numbers === null) return objects
  if (objects === null && strings === null && numbers === null) return arrays
  if (objects === null && arrays === null && numbers === null) return strings
  if (objects === null && arrays === null && strings === null) return numbers

  // A node with keywords for more than one type still dispatches once on the
  // value, so at most one block is entered.
  return (ctx, value, path, evaluation, depth, scope) => {
    if (typeof value === 'object') {
      if (value === null) return
      if (Array.isArray(value)) {
        if (arrays !== null) arrays(ctx, value, path, evaluation, depth, scope)
      } else if (objects !== null) {
        objects(ctx, value, path, evaluation, depth, scope)
      }
    } else if (typeof value === 'string') {
      if (strings !== null) strings(ctx, value, path, evaluation, depth, scope)
    } else if (typeof value === 'number') {
      if (numbers !== null) numbers(ctx, value, path, evaluation, depth, scope)
    }
  }
}

/**
 * Builds the step for one object-form schema node — the walker's whole body,
 * with everything it used to rediscover per call resolved once.
 *
 * Runs on the node's first visit, never before, and only ever creates its
 * children's records rather than building them, so it neither recurses nor
 * touches a subtree the data does not reach.
 */
const buildNode = (compiler: Compiler, schema: Record<string, unknown>): Step => {
  // Every keyword this node carries, read once — see `node-meta.ts`. Nothing
  // caches it, because from here on nobody asks the node anything again.
  const meta = getNodeMeta(null, schema)

  // Whether this node is nothing but a `type` and (optionally) the keywords for
  // that one type — `{ type: 'string' }`, `{ type: 'integer', minimum: 0 }`,
  // `{ type: 'object', properties: … }`. That is the overwhelming majority of
  // the nodes in a real schema, and it is worth its own shape: the type test
  // lands in the node's own frame instead of behind a call, and because it
  // returns rather than falling through, the block it guards no longer has to
  // re-test the value either.
  const plain =
    meta.refs === null &&
    !meta.hasConst &&
    meta.enumValues === undefined &&
    meta.branches === null &&
    meta.unevaluated === null &&
    !meta.nullable &&
    !(compiler.registry !== null && meta.hasId)
  const singleType = meta.type
  const simpleType = plain && compiler.asserts && singleType !== undefined ? typeTest(singleType) : null

  const typeBlocks = compileTypeBlocks(compiler, meta, simpleType === null ? undefined : singleType)

  if (simpleType !== null && singleType !== undefined) {
    if (typeBlocks === null) return typeOnlyStep(singleType) as Step
    const message = `must be ${singleType}`
    return (ctx, value, path, evaluation, depth, scope) => {
      if (!openNode(ctx, depth)) return
      if (!simpleType(value)) {
        fail(ctx, message, path)
        return
      }
      typeBlocks(ctx, value, path, evaluation, depth, scope)
    }
  }

  const parts: Step[] = []
  // The reference keywords come first, and sibling keywords still apply per
  // 2020-12, so they do not stop the sequence.
  if (meta.refs !== null) parts.push(...compileRefs(compiler, meta.refs))
  // `const`, `enum` and `type` belong to the validation vocabulary: a dialect
  // whose `$vocabulary` leaves it out keeps them as annotations, and they simply
  // are not compiled.
  if (compiler.asserts && meta.hasConst) parts.push(compileConst(meta.constValue))
  if (compiler.asserts && meta.enumValues !== undefined) parts.push(compileEnum(schema, meta.enumValues))
  if (compiler.asserts) {
    const type = compileType(meta)
    if (type !== null) parts.push(type)
  }
  if (typeBlocks !== null) parts.push(typeBlocks)
  if (meta.branches !== null) parts.push(...compileBranches(compiler, meta.branches))

  const conditional = meta.branches === null ? null : compileConditional(compiler, meta.branches)
  const unevaluated = meta.unevaluated === null ? null : compileUnevaluated(compiler, meta.unevaluated)

  // Nothing to assert: an annotation-only node still costs a step, and nothing
  // more. Common enough to be worth its own shared step — `{ $comment: '…' }`,
  // a `$defs` holder, `{ title: 'x' }` under `properties`.
  if (parts.length === 0 && conditional === null && unevaluated === null && !meta.nullable) return acceptStep

  let body: Step | null = null
  if (conditional !== null && unevaluated !== null) {
    // The one place the sequence does not unwind on failure: see
    // {@link compileConditional}.
    const head = seq(parts)
    body = (ctx, value, path, evaluation, depth, scope) => {
      head(ctx, value, path, evaluation, depth, scope)
      if (ctx.failed) return
      conditional(ctx, value, path, evaluation, depth, scope)
      unevaluated(ctx, value, path, evaluation, depth, scope)
    }
  } else {
    if (conditional !== null) parts.push(conditional)
    if (unevaluated !== null) parts.push(unevaluated)
  }

  // `unevaluated*` consults annotations gathered by every other keyword applied
  // to this same instance location. An ancestor's tracker is inherited when one
  // is in scope; otherwise one starts here, and only because this node carries
  // the keyword — schemas that never use it allocate nothing.
  if (meta.unevaluated !== null) {
    const inner = body ?? seq(parts)
    body = (ctx, value, path, evaluation, depth, scope) => {
      inner(ctx, value, path, evaluation ?? newEvaluation(), depth, scope)
    }
  }

  // An `$id` here opens a new schema resource: refs written below resolve
  // against its URI, and it joins the dynamic scope a `$dynamicRef` searches.
  // Gated on the registry, so a document without a single `$id` — nearly all of
  // them — compiles this away entirely.
  const registry = compiler.registry
  if (registry !== null && meta.hasId) {
    const inner = body ?? seq(parts)
    body = (ctx, value, path, evaluation, depth, scope) => {
      inner(ctx, value, path, evaluation, depth, scopeAtNode(registry, schema, scope))
    }
  }

  // OpenAPI 3.0 `nullable: true` — a `null` value is accepted regardless of the
  // declared `type` (and short-circuits every other keyword), matching how Ajv is
  // configured for OpenAPI schemas.
  if (meta.nullable) {
    const inner = body ?? seq(parts)
    body = (ctx, value, path, evaluation, depth, scope) => {
      if (value === null) return
      inner(ctx, value, path, evaluation, depth, scope)
    }
  }

  // With no wrapper in play the node's whole body is its keyword sequence, and
  // the prologue folds into the same closure.
  if (body === null) return nodeStep(parts)

  const wrapped = body
  return (ctx, value, path, evaluation, depth, scope) => {
    if (!openNode(ctx, depth)) return
    wrapped(ctx, value, path, evaluation, depth, scope)
  }
}
