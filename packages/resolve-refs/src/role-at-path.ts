import { childRole, type NodeRole } from './child-role'
import type { JsonPath } from './types'

/**
 * The role of the node a document path leads to, starting from the document
 * root (which is a schema).
 *
 * A reference is inlined by resolving its *target*, so the target has to be
 * walked with the role it has where it is defined, not the role of the node
 * pointing at it. `#/$defs/a` lands in a schema whichever keyword the reference
 * sat under, and `#/components/schemas/Foo` lands outside the vocabulary either
 * way — so resolution of a given target does not depend on who referenced it,
 * and the resolvers can keep memoizing per unique ref.
 *
 * The path segments alone are enough: no part of the classification depends on
 * the values in the document.
 */
export const roleAtPath = (pointer: JsonPath): NodeRole =>
  pointer.reduce<NodeRole>((role, segment) => childRole(role, segment), 'schema')
