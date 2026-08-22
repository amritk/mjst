import { asArray, asSchema, isObject } from '#helpers/guards'
import type { SchemaProperty } from '#types/schema'

/**
 * How deep any walk follows a schema. The node budget bounds how *much* is
 * inlined, which is the right guard for a `$ref` that expands exponentially —
 * but a plain, ref-free schema nested twelve thousand levels deep is only
 * twelve thousand nodes, and it overflowed the stack with a bare `RangeError`
 * naming nothing. Real config schemas nest tens of levels, not hundreds.
 */
export const MAX_SCHEMA_DEPTH = 512

/**
 * Marks the `{ type: 'object' }` a recursive `$ref` collapses to, and carries
 * the one thing the collapse would otherwise throw away: what the definition it
 * stands for requires.
 *
 * It is the inliner's truncation marker, not something the author wrote, and
 * readers of the inlined document have to tell the difference. Taken at face
 * value the stub says "an object with no fields and no requirements", which is
 * a claim nothing in the schema makes — and in a union it decided what the
 * *other* alternatives require. Ignoring it instead only moved the error the
 * other way: dropping an alternative from an intersection can invent
 * requirements as easily as reading it wrongly can erase them. So it neither
 * votes as an empty object nor abstains: it votes with the requirements of the
 * definition it truncates.
 */
export const RECURSION_STUB = Symbol('recursive reference')

/** The `required` list of the definition a stub stands for. */
export const stubRequired = (node: unknown): readonly string[] | undefined => {
  if (!isObject(node)) return undefined
  const marker = (node as Record<symbol, unknown>)[RECURSION_STUB]
  return Array.isArray(marker) ? (marker as readonly string[]) : undefined
}

/**
 * What {@link couldBeObject} needs to read a document that still has `$ref`s in
 * it: how to resolve one, the answers already worked out, and an allowance.
 *
 * Only the inliner passes this; the collector reads an already-inlined
 * document, where every reference has been replaced by what it pointed at.
 *
 * The answers are cached because whether a pointer describes an object depends
 * only on the document and the pointer — so a `$defs` graph read as a tree
 * instead of a graph is pure waste, and a layered one cost four times as much
 * per level: six and a half minutes on a 3 KB schema, to print an error. Only
 * an answer that did not lean on a cycle is cached, so the cache cannot make
 * the verdict depend on the order the walk asks. The allowance is the backstop
 * for the cyclic graph that defeats the cache.
 */
export type ShapeContext = {
  readonly resolve: (ref: string) => unknown
  readonly known: Map<string, boolean>
  readonly budget: { remaining: number }
}

/**
 * How many nodes one reading may look at while working out what a definition
 * can be. The cache makes a `$defs` graph linear; this is the backstop for the
 * cyclic one the cache cannot hold an answer for, and past it the reading
 * answers `true` rather than refusing the document.
 */
export const MAX_SHAPE_NODES = 10_000

/**
 * An answer, and whether it leaned on a reference that was still being read —
 * which makes it true of the path that reached it rather than of the pointer.
 */
type Verdict = { readonly answer: boolean; readonly cyclic: boolean }

/** An answer that holds wherever the node appears. */
const settled = (answer: boolean): Verdict => ({ answer, cyclic: false })

/**
 * True when a branch could describe an object, and so has a say in what an
 * alternative requires.
 *
 * A branch that names no fields still constrains objects — `{ type: 'object',
 * additionalProperties: { … } }` is the free-form half of "a map of strings, or
 * this exact pair", and a document taking that half has none of the other
 * half's required fields. Filtering on "declares a named property" dropped it
 * from the intersection and asserted **Required** on fields a valid document is
 * free to omit.
 *
 * What is excluded is a branch that cannot be an object at all: the `string` in
 * `string | { … }`, whose empty requirement set would otherwise strip every
 * marker off the object form.
 *
 * Both places that intersect alternatives ask this — the collector reading the
 * inlined document and the inliner working out what a truncation stands for.
 * They used to disagree, and the same union was documented two ways on one
 * page depending on which route reached it.
 */
const couldBe = (
  node: SchemaProperty,
  context: ShapeContext | undefined,
  seen: ReadonlySet<string>,
  depth: number,
): Verdict => {
  // A stub stands for an object definition, so it is one — it just votes with
  // the requirements it carries rather than with the empty set it looks like.
  if (stubRequired(node) !== undefined) return settled(true)
  // `true` for the same reason a cycle answers `true`: keeping a branch in an
  // intersection loses a marker, dropping one invents a marker. A backstop
  // rather than a guard anyone reaches — the inliner refuses a document this
  // deep before the reading starts — so it stays unexercised on purpose.
  if (depth > MAX_SCHEMA_DEPTH) return settled(true)
  // Running out answers `true`, for the same reason a cycle does: keeping a
  // branch in an intersection loses a **Required** marker, dropping one invents
  // one, and losing is the safer way to be wrong. Throwing instead refused a
  // 727-byte schema outright — every mutually recursive graph taints its whole
  // ancestor chain, so nothing is cached and the allowance is all that fires.
  // A page with a marker missing beats no page at all.
  if (context !== undefined && context.budget.remaining-- <= 0) return settled(true)
  // A branch reached through a reference is whatever the definition says, with
  // whatever the ref site says on top: the `allOf`-wrapped `$ref` is how
  // OpenAPI 3.0 attaches a description to one, and read without following it a
  // scalar definition looks like an object — which is exactly the vote this
  // function exists to refuse. Read without the ref site's own keywords it
  // answers for the wrong node, which is the same error pointing the other way.
  const ref = (node as Readonly<Record<string, unknown>>)['$ref']
  if (context !== undefined && typeof ref === 'string') {
    // A reference already on the path cannot settle the question by itself: a
    // definition that is an object only if it is an object is taken to be one,
    // because keeping a branch in an intersection loses a marker while dropping
    // one invents a marker, and the first is the safer way to be wrong.
    if (seen.has(ref)) return { answer: true, cyclic: true }
    const target = context.resolve(ref)
    if (!isObject(target)) return settled(true)
    const { $ref: _resolved, ...siblings } = node as Readonly<Record<string, unknown>>
    // The cache answers for a pointer, so only a bare pointer may ask it.
    // `{ $ref: X, type: 'string' }` and `{ $ref: X }` are different questions,
    // and keying both on `X` let whichever was written first decide the other
    // for the rest of the document — the order-dependence the taint rule was
    // added to prevent, arriving by a different door.
    const bare = Object.keys(siblings).length === 0
    if (bare) {
      const cached = context.known.get(ref)
      if (cached !== undefined) return settled(cached)
    }
    const verdict = couldBe(asSchema({ ...target, ...siblings }), context, new Set(seen).add(ref), depth + 1)
    if (bare && !verdict.cyclic) context.known.set(ref, verdict.answer)
    return verdict
  }

  const declared = typeof node.type === 'string' ? [node.type] : Array.isArray(node.type) ? node.type : undefined
  if (declared !== undefined && !declared.includes('object')) return settled(false)
  const values = asArray(node.enum)
  if (values.length > 0 && !values.some(isObject)) return settled(false)
  if (node.const !== undefined && !isObject(node.const)) return settled(false)

  let cyclic = false
  // `allOf` branches all apply, so a branch that cannot be an object settles it
  // for the whole node — that is how a `$ref` to `allOf: [{ type: 'string' }]`
  // describes a string, and reading only the node's own `type` let it vote on
  // what an object alternative requires.
  for (const branch of asArray(node.allOf)) {
    const verdict = couldBe(asSchema(branch), context, seen, depth + 1)
    cyclic = cyclic || verdict.cyclic
    if (!verdict.answer) return { answer: false, cyclic }
  }
  // A union of alternatives is an object only if one of its alternatives is —
  // `anyOf: [{ type: 'string' }, { type: 'number' }]` is a scalar however many
  // ways it is spelled.
  for (const keyword of [node.anyOf, node.oneOf]) {
    const branches = asArray(keyword)
    if (branches.length === 0) continue
    let admits = false
    for (const branch of branches) {
      const verdict = couldBe(asSchema(branch), context, seen, depth + 1)
      cyclic = cyclic || verdict.cyclic
      if (verdict.answer) {
        admits = true
        break
      }
    }
    if (!admits) return { answer: false, cyclic }
  }
  return { answer: true, cyclic }
}

/** {@link couldBe}, from the top. */
export const couldBeObject = (node: SchemaProperty, context?: ShapeContext): boolean =>
  couldBe(node, context, new Set(), 0).answer
