import type { JSONSchema } from 'json-schema-typed/draft-2020-12'

import { buildResourceRegistry, entersSchemaMap, escapePointerSegment, isDataPosition } from './build-resource-registry'
import { assertSchemaDepth } from './max-schema-depth'
import { readKey } from './read-key'
import { resolveRef } from './resolve-ref'
import { resolveScopedRef } from './resolve-scoped-ref'

/** True when a subschema declares targets a fragment ref could legitimately mean. */
const declaresLocalTargets = (record: Record<string, unknown>): boolean =>
  typeof readKey(record, '$defs') === 'object' ||
  typeof readKey(record, 'definitions') === 'object' ||
  typeof readKey(record, '$anchor') === 'string'

/**
 * Fails a document whose `$id` scoping this package cannot honour.
 *
 * In 2020-12 an `$id` on a subschema starts a new resource, and a `#/...` ref
 * inside it resolves against *that* resource rather than the document root.
 * {@link normalizeRefScopes} implements that, so nearly every such document now
 * generates correctly. What is left is the residue: a fragment ref inside an
 * embedded resource that names nothing in the resource it belongs to. The spec
 * calls that unresolvable, but the resolvers here navigate from the document
 * root, so it would quietly pick up the *outer* definition of the same name — a
 * different type, no warning, exit 0. A wrong type that compiles is the worst
 * outcome available, so it is rejected up front instead.
 *
 * The check stays deliberately narrow: it only fires when the enclosing resource
 * declares ref targets of its own (`$defs`, `definitions`, or an `$anchor`),
 * which is exactly the ambiguous case. A decorative `$id` with nothing local to
 * point at has only one possible reading, so it stays silent and keeps working.
 */
export const assertIdScopes = (rootSchema: JSONSchema): void => {
  const registry = buildResourceRegistry(rootSchema)
  if (registry === null) return

  /**
   * `resource` is the nearest enclosing non-root resource — the node that opened
   * the scope, plus the base URI it established — or null while still in the
   * document's own resource.
   */
  const walk = (
    node: unknown,
    pointer: string,
    enclosing: string,
    resource: Record<string, unknown> | null,
    depth: number,
    inSchemaMap: boolean,
  ): void => {
    assertSchemaDepth(depth, 'assertIdScopes')
    if (node === null || typeof node !== 'object') return
    if (Array.isArray(node)) {
      for (let index = 0; index < node.length; index++) {
        walk(node[index], `${pointer}/${index}`, enclosing, resource, depth + 1, inSchemaMap)
      }
      return
    }

    const record = node as Record<string, unknown>
    const declared = registry.baseAt.get(pointer)
    const base = declared ?? enclosing
    const scope = declared !== undefined && pointer !== '' ? record : resource

    for (const key of ['$ref', '$dynamicRef'] as const) {
      const ref = readKey(record, key)
      if (typeof ref !== 'string' || !ref.startsWith('#') || ref === '#') continue
      if (scope === null || !declaresLocalTargets(scope)) continue
      const target = resolveScopedRef(registry, ref, base)
      if (target !== undefined && resolveRef(`#${target.pointer}`, rootSchema as Record<string, unknown>)) continue
      throw new Error(
        `The subschema with $id "${scope['$id'] as string}" declares its own definitions and contains the ref ` +
          `"${ref}", which names nothing inside it. $id base-URI scoping makes that ref unresolvable, but ` +
          'resolving it from the document root would silently select a different definition. Point the ref at a ' +
          'definition the embedded resource declares, hoist the resource into the root $defs, or drop the inner $id.',
      )
    }

    for (const key of Object.keys(record)) {
      if (isDataPosition(key, inSchemaMap)) continue
      walk(
        record[key],
        `${pointer}/${escapePointerSegment(key)}`,
        base,
        scope,
        depth + 1,
        entersSchemaMap(key, inSchemaMap),
      )
    }
  }

  walk(rootSchema, '', registry.rootBase, null, 0, false)
}
