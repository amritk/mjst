import { type ResourceRegistry, resolveUri } from './build-resource-registry'

/**
 * Where a `$ref` lands once the `$id` base URIs in scope are applied.
 *
 * `pointer` is a JSON Pointer from the *document* root (`''` for the root
 * itself), so `#${pointer}` is a `$ref` every other helper here already
 * understands. `base` is the base URI refs written inside the target resolve
 * against, which a caller that keeps resolving as it walks needs in order to
 * take the next step.
 */
export type ScopedRefTarget = {
  readonly pointer: string
  readonly base: string
}

/** A fragment is a JSON Pointer when it is empty or starts with `/`; otherwise it names an anchor. */
const isPointerFragment = (fragment: string): boolean => fragment === '' || fragment.startsWith('/')

/**
 * The base URI in scope at a pointer — the deepest `$id` the path to it crosses,
 * falling back to the document's own base.
 *
 * Linear in the number of `$id`s the document declares, which is what makes it
 * cheap: `baseAt` holds only `$id`-bearing nodes, and a document with more than a
 * handful of embedded resources is already unusual.
 */
const baseInScopeAt = (registry: ResourceRegistry, pointer: string): string => {
  let base = registry.rootBase
  let matched = -1
  for (const [at, candidate] of registry.baseAt) {
    if (at.length <= matched) continue
    if (pointer === at || pointer.startsWith(at === '' ? '/' : `${at}/`)) {
      base = candidate
      matched = at.length
    }
  }
  return base
}

/**
 * Resolves `ref` against `base` and locates the result among the document's
 * embedded resources — the half of `$ref` handling that plain pointer navigation
 * deliberately leaves out.
 *
 * Every form a 2020-12 document can write is one call: a relative URI
 * (`"list"`), an absolute one, an absolute path (`"/absref/foobar.json"`), a URN,
 * a pointer into a resource (`"a.json#/$defs/x"`), an anchor in a resource
 * (`"child1#my_anchor"`), and the plain in-document `"#/$defs/x"` — which under
 * an enclosing `$id` means *that resource's* `$defs`, not the document's.
 *
 * Returns `undefined` when the URI names no resource in this document, or when
 * the resource has no such anchor. That is an honest "not here": the target may
 * live in another document, which is a fetch this package does not do.
 *
 * A *pointer* fragment is located, not navigated — the registry holds pointers,
 * not the document — so `"a.json#/$defs/nope"` still comes back as a pointer
 * into `a.json`. Callers that need the subschema itself run the returned pointer
 * through `resolveRef`, which is also how they find out it names nothing.
 */
export const resolveScopedRef = (
  registry: ResourceRegistry,
  ref: string,
  base: string,
): ScopedRefTarget | undefined => {
  const absolute = resolveUri(ref, base)
  if (absolute === undefined) return undefined

  const hash = absolute.indexOf('#')
  const uri = hash === -1 ? absolute : absolute.slice(0, hash)
  const fragment = hash === -1 ? '' : absolute.slice(hash + 1)

  const resource = registry.resources.get(uri)
  if (resource === undefined) return undefined

  if (!isPointerFragment(fragment)) {
    const anchored = registry.anchors.get(`${uri}#${fragment}`)
    return anchored === undefined ? undefined : { pointer: anchored, base: baseInScopeAt(registry, anchored) }
  }

  // The fragment is a pointer *into the resource*, so it hangs off the
  // resource's own pointer rather than off the document root.
  const pointer = `${resource}${fragment}`
  return { pointer, base: baseInScopeAt(registry, pointer) }
}
