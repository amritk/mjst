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
 * it — how to resolve one, and the answers already worked out.
 *
 * Only the inliner passes this; the collector reads an already-inlined
 * document, where every reference has been replaced by what it pointed at. The
 * answers are cached because whether a pointer describes an object depends only
 * on the document and the pointer, and a `$defs` graph asked the same question
 * of the same pointer thousands of times — nineteen seconds of one test.
 */
export type ShapeContext = {
  readonly resolve: (ref: string) => unknown
  readonly known: Map<string, boolean>
}

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
export const couldBeObject = (node: SchemaProperty, context?: ShapeContext, depth = 0): boolean => {
  // A stub stands for an object definition, so it is one — it just votes with
  // the requirements it carries rather than with the empty set it looks like.
  if (stubRequired(node) !== undefined) return true
  if (depth > MAX_SCHEMA_DEPTH) return true
  // A branch reached through a reference is whatever the definition says: the
  // `allOf`-wrapped `$ref` is how OpenAPI 3.0 attaches a description to one,
  // and read without following it a scalar definition looks like an object —
  // which is exactly the vote this function exists to refuse.
  const ref = (node as Readonly<Record<string, unknown>>)['$ref']
  if (context !== undefined && typeof ref === 'string') {
    // A reference already being read cannot settle the question by itself: a
    // definition that is an object only if it is an object is one.
    const known = context.known.get(ref)
    if (known !== undefined) return known
    context.known.set(ref, true)
    const target = context.resolve(ref)
    const answer = isObject(target) ? couldBeObject(asSchema(target), context, depth + 1) : true
    context.known.set(ref, answer)
    return answer
  }
  const declared = typeof node.type === 'string' ? [node.type] : Array.isArray(node.type) ? node.type : undefined
  if (declared !== undefined && !declared.includes('object')) return false
  const values = asArray(node.enum)
  if (values.length > 0 && !values.some(isObject)) return false
  if (node.const !== undefined && !isObject(node.const)) return false
  // `allOf` branches all apply, so a branch that cannot be an object settles it
  // for the whole node — that is how a `$ref` to `allOf: [{ type: 'string' }]`
  // describes a string, and reading only the node's own `type` let it vote on
  // what an object alternative requires.
  if (!asArray(node.allOf).every((branch) => couldBeObject(asSchema(branch), context, depth + 1))) return false
  // A union of alternatives is an object only if one of its alternatives is —
  // `anyOf: [{ type: 'string' }, { type: 'number' }]` is a scalar however many
  // ways it is spelled.
  for (const keyword of [node.anyOf, node.oneOf]) {
    const branches = asArray(keyword)
    if (branches.length > 0 && !branches.some((branch) => couldBeObject(asSchema(branch), context, depth + 1)))
      return false
  }
  return true
}
