import type { RefKeyword } from './reference'
import { baseAfterId, splitFragment } from './resource-registry'

/**
 * The part of resolution that cannot be answered statically.
 *
 * A `$dynamicRef` does not name one target. It binds at *evaluation* time to the
 * outermost `$dynamicAnchor` of that name along the dynamic scope — the chain of
 * schema resources actually being applied — so the same keyword can resolve to a
 * different schema depending on where evaluation entered from. Inlining happens
 * once, so a resolver that inlines every `$dynamicRef` has to guess, and a wrong
 * guess changes what the document accepts.
 *
 * So we do not guess. Where the binding is decidable we inline as before; where
 * it is not, the `$dynamicRef` stays in the output and the scaffolding it needs
 * to resolve at validation time — the `$dynamicAnchor`s it may bind to, and the
 * `$id`s that delimit the resources those anchors live in — stays with it. That
 * is the same move the resolver already makes for a reference cycle: keep the
 * reference rather than collapse it to one wrong answer.
 */

/**
 * Whether a reference's target is only decided when the document is evaluated,
 * which is what makes it unsafe to inline.
 *
 * Two `$dynamicRef` shapes are decidable and keep being inlined:
 *
 * - a **pointer fragment** (`#`, `#/$defs/items`, or no fragment at all) is a
 *   plain `$ref` per the spec — there is no anchor to late-bind to;
 * - an **anchor name declared at most once** in the document. With a single
 *   `$dynamicAnchor` of that name there is only one schema the dynamic lookup
 *   could ever land on, and with none the keyword degrades to `$ref` semantics
 *   against whatever `$anchor` the name resolves to. Either way the static
 *   answer is the only answer.
 *
 * Everything else — an anchor name declared twice or more — is kept, because
 * "which one" is exactly the question the dynamic scope answers and we are not
 * the ones evaluating.
 */
export const bindsAtEvaluationTime = (
  keyword: RefKeyword,
  ref: string,
  ambiguousAnchors: ReadonlySet<string>,
): boolean => {
  if (keyword !== '$dynamicRef') return false
  const { fragment } = splitFragment(ref)
  if (fragment === '' || fragment.startsWith('/')) return false
  return ambiguousAnchors.has(fragment)
}

/**
 * Nodes of the resolved document whose meaning depends on the `$id` scope they
 * sit in: a kept reference (it is resolved later, against the base it stands
 * in), a `$dynamicAnchor` a kept `$dynamicRef` might bind to, and anything
 * containing either. Tracked by identity, because the resolver shares one
 * resolved object per unique ref.
 */
export type ScopeSensitiveNodes = WeakSet<object>

/** Whether `value` is a node the resolver marked scope-sensitive. */
export const isScopeSensitive = (nodes: ScopeSensitiveNodes, value: unknown): boolean =>
  value !== null && typeof value === 'object' && nodes.has(value)

/**
 * Whether a node declares a `$dynamicAnchor` some kept `$dynamicRef` could bind
 * to. Such a declaration registers its name against the resource it sits in, so
 * moving it into a different resource would add a binding target where the
 * original document had none.
 */
export const declaresAmbiguousAnchor = (
  node: Record<string, unknown>,
  ambiguousAnchors: ReadonlySet<string>,
): boolean => {
  const anchor = node['$dynamicAnchor']
  return typeof anchor === 'string' && ambiguousAnchors.has(anchor)
}

/**
 * Whether inlining `target` into a node whose base URI is `nodeBase` leaves the
 * target in the very resource it was defined in.
 *
 * This is what decides whether a scope-sensitive target may be inlined at all.
 * Inlining copies the target into the referencing node's `$id` scope, and the
 * dynamic scope is a chain of *resources* — so the copy keeps its place in that
 * chain only when it re-establishes the same base: either the target already
 * belongs to the referencing node's resource, or it carries the `$id` that
 * defines its own, and that `$id` still resolves to the same URI from where it
 * lands. A ref pointing *into* another resource (`other#/$defs/thing`) does
 * neither — the copy leaves that resource behind, which is the case the suite
 * calls "`$dynamicRef` avoids the root of each schema, but scopes are still
 * registered".
 */
export const inliningKeepsScope = (target: unknown, nodeBase: string, targetBase: string): boolean => {
  if (target === null || typeof target !== 'object' || Array.isArray(target)) return nodeBase === targetBase
  return baseAfterId(target as Record<string, unknown>, nodeBase) === targetBase
}
