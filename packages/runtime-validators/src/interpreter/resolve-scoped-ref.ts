import { walkJsonPointer } from '@/interpreter/resolve-local-ref'
import { resolveUri, type SchemaRegistry } from '@/interpreter/schema-registry'

/**
 * Resolution against the `$id` base URIs a document declares — the half of
 * `$ref` handling that `resolve-local-ref.ts` deliberately leaves out.
 *
 * Both resolvers here answer with the target *and* the base URI it lives under,
 * because the interpreter needs that base twice over: to resolve the next `$ref`
 * written inside the target, and to record the resource on the dynamic scope
 * that `$dynamicRef` walks.
 */

/** A resolved reference: the subschema, and the base URI refs inside it resolve against. */
export type ScopedTarget = {
  readonly value: unknown
  readonly base: string
}

/** A fragment is a JSON Pointer when it is empty or starts with `/`; otherwise it names an anchor. */
const isPointerFragment = (fragment: string): boolean => fragment === '' || fragment.startsWith('/')

/**
 * Resolves `ref` against `base` and looks the result up among the document's
 * embedded resources.
 *
 * The returned base is the resource the target sits in, refined by any `$id` the
 * pointer walk crossed on its way down — so `"a#/$defs/x"` where `$defs/x` opens
 * its own resource reports *that* resource, not `a`.
 *
 * Returns `undefined` when the URI names no resource in this document (an
 * honest "not here", which the caller answers by falling back to a
 * document-global search and then by failing loudly).
 */
export const resolveScopedRef = (registry: SchemaRegistry, ref: string, base: string): ScopedTarget | undefined => {
  const absolute = resolveUri(ref, base)
  if (absolute === undefined) return undefined

  const hash = absolute.indexOf('#')
  const uri = hash === -1 ? absolute : absolute.slice(0, hash)
  const fragment = hash === -1 ? '' : absolute.slice(hash + 1)

  const resource = registry.resources.get(uri)
  if (resource === undefined) return undefined

  if (!isPointerFragment(fragment)) {
    const anchored = registry.anchors.get(`${uri}#${fragment}`)
    return anchored === undefined ? undefined : { value: anchored, base: uri }
  }

  // Track `$id`s crossed on the way down so the target reports the base its own
  // refs should resolve against.
  let targetBase = uri
  const value = walkJsonPointer(resource, fragment, (node) => {
    const crossed = registry.baseOf.get(node)
    if (crossed !== undefined) targetBase = crossed
  })
  return value === undefined ? undefined : { value, base: targetBase }
}

/**
 * Resolves a `$dynamicRef` through the dynamic scope — the chain of schema
 * resources evaluation actually passed through to get here, outermost first.
 *
 * 2020-12 calls this "bookending": a `$dynamicRef` only goes dynamic when its
 * *static* resolution already lands on a `$dynamicAnchor` of that name. That
 * bookend is what makes the reference safe to redirect — it guarantees the
 * schema author put a default target in the same resource. When it is present we
 * take the **outermost** resource in the dynamic scope that declares the same
 * `$dynamicAnchor`, which is how a generic `$ref`ed schema ends up validating
 * against the extension that pulled it in rather than its own default.
 *
 * Anything else — a pointer fragment, a name that only matches a plain
 * `$anchor`, a name with no bookend — degrades to ordinary {@link resolveScopedRef}
 * behavior, exactly as the spec requires.
 */
export const resolveScopedDynamicRef = (
  registry: SchemaRegistry,
  ref: string,
  base: string,
  dynamicScope: readonly string[],
): ScopedTarget | undefined => {
  const absolute = resolveUri(ref, base)
  if (absolute === undefined) return undefined

  const hash = absolute.indexOf('#')
  const fragment = hash === -1 ? '' : absolute.slice(hash + 1)
  if (!isPointerFragment(fragment) && registry.dynamicAnchors.has(`${absolute.slice(0, hash)}#${fragment}`)) {
    for (const scope of dynamicScope) {
      const found = registry.dynamicAnchors.get(`${scope}#${fragment}`)
      if (found !== undefined) return { value: found, base: scope }
    }
  }

  return resolveScopedRef(registry, ref, base)
}
