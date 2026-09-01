import type { FromSchema, TypeDescribesEveryAcceptedValue } from '@/from-schema'
import { resolveLimits, screenSchema } from '@/interpreter/limits'
import { prepareValidator } from '@/interpreter/prepare'
import { buildSchemaRegistry } from '@/interpreter/schema-registry'
import type { Check, Guard, ValidateOptions } from '@/types'

import { compilePlan, type Plan, type PlanEnv } from './plan'

/** Mirrors {@link validateGuard}'s return type so this is a drop-in for it. */
type InferredGuard<S> = TypeDescribesEveryAcceptedValue<S> extends false ? Check<FromSchema<S>> : Guard<FromSchema<S>>

const normalizeFormats = (formats: ValidateOptions['formats']): 'all' | ReadonlySet<string> => {
  if (formats === 'all') return 'all'
  if (formats === undefined) return new Set()
  return new Set(formats)
}

/**
 * Builds a boolean type guard by **partially evaluating the schema into a tree
 * of closures**, once, up front — the opt-in counterpart to {@link validateGuard}.
 *
 * The two answer identically. The difference is only *when* the work happens.
 * {@link validateGuard} walks the schema on every call, reading keywords as it
 * goes; this reads them once and hands back a closure per schema node with the
 * decisions already made — regexes compiled, property lists flattened, bounds
 * and divisor cases specialized, `$ref`s resolved and linked. Validation is then
 * a tree of direct calls with no schema inspection left in it.
 *
 * **Which to use.** Reach for this when you validate the *same* schema many
 * times — a request handler, a stream, a batch import. It pays for the compile
 * up front and wins from there, by roughly 1.4–2.8× on the benchmark shapes.
 * For the one-shot path this package is built around — a schema you see once and
 * apply to a handful of values — stay on {@link validateGuard}: the compile is
 * overhead a one-shot may not earn back, costing up to ~2.5× the interpreter's
 * cold time on a wide schema (though a `$ref`-heavy one comes out ahead, because
 * linking each reference once beats resolving it per value).
 *
 * That trade is why this is a separate entry point and not the default. Making
 * it the default would spend the cold-start advantage that is the whole reason
 * to interpret a schema rather than compile it — both paths stay two orders of
 * magnitude ahead of a JIT-compiling validator there, and that is worth more to
 * most callers than steady-state throughput.
 *
 * It stays **eval-free**. There is no `new Function` and no code generation —
 * only ordinary closures — so it runs under a strict CSP, on Workers, and on
 * Hermes exactly as the interpreter does.
 *
 * **Correctness comes from deferral, not from a second implementation.** Any
 * node carrying a keyword the compiler does not answer itself — the conditional
 * and annotation-collecting ones, `patternProperties`, `format`, `uniqueItems`,
 * and friends — is handed to the interpreter whole, subtree included. A document
 * carrying `$dynamicRef` / `$recursiveRef`, or validated against a registry of
 * other documents, is not compiled at all. So the compiled path is a scheduling
 * change over the same predicates, and where it cannot be, it is the
 * interpreter. `compile-parity.test.ts` holds the two to the same verdict across
 * the JSON Schema Test Suite.
 *
 * @example
 * ```typescript
 * const isUser = compileGuard({
 *   type: 'object',
 *   properties: { id: { type: 'integer' }, name: { type: 'string' } },
 *   required: ['id', 'name'],
 * })
 *
 * for (const row of millionsOfRows) if (isUser(row)) handle(row)
 * ```
 */
export const compileGuard = <T = never, const S = unknown>(
  schema: S,
  options?: ValidateOptions,
): [T] extends [never] ? InferredGuard<S> : Guard<T> => {
  const limits = resolveLimits(options?.limits)

  // The same up-front screen a prepared validator runs: a ReDoS-prone `pattern`
  // fails here, at build time, rather than mid-request. It also reports whether
  // the document declares an `$id`.
  const screen = screenSchema(schema, limits.allowUnsafePatterns)

  // Two things are the interpreter's alone.
  //
  // Sibling documents registered through `schemas` make `$ref` a cross-document
  // question this compiler does not link, so the whole schema goes over.
  //
  // `$dynamicRef` / `$recursiveRef` are the deeper reason. They resolve against
  // the *dynamic scope* — the chain of resources entered on the way to the
  // reference — which only exists while a walk is in progress. A compiled tree
  // has no walk to accumulate it from, and a node that fell back mid-tree would
  // be handed an empty scope and resolve to the wrong target. There is no sound
  // partial answer, so a document containing either keyword is not compiled.
  if (options?.schemas !== undefined || hasDynamicReference(schema)) {
    return prepareValidator(schema, options, false) as never
  }

  // A document that declares `$id` gets the same resource registry a prepared
  // validator builds, and every `$ref` is linked through it. Built only when
  // there is an `$id` to register: for everything else `registry` stays null and
  // a `$ref` is a plain pointer, which is all it can be.
  const registry = screen.declaresId ? buildSchemaRegistry(schema) : null

  const env: PlanEnv = {
    root: schema,
    formats: normalizeFormats(options?.formats),
    maxDepth: limits.maxDepth,
    maxSteps: limits.maxSteps,
    registry,
    plans: new Map(),
  }
  const plan: Plan = compilePlan(schema, env, registry?.rootBase ?? '')
  return ((input: unknown): boolean => plan(input, 0)) as never
}

/**
 * Whether the document anywhere reaches for a reference that resolves against
 * the dynamic scope. Scans values rather than schema positions on purpose: a
 * false positive costs only the speed of that schema, where a false negative
 * would cost a wrong verdict.
 */
const hasDynamicReference = (node: unknown, depth = 0): boolean => {
  if (depth > 128 || node === null || typeof node !== 'object') return false
  if (Array.isArray(node)) return node.some((item) => hasDynamicReference(item, depth + 1))
  const record = node as Record<string, unknown>
  if (Object.hasOwn(record, '$dynamicRef') || Object.hasOwn(record, '$recursiveRef')) return true
  return Object.keys(record).some((key) => hasDynamicReference(record[key], depth + 1))
}
