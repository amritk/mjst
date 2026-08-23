import { asArray, asSchema, isObject } from '#helpers/guards'
import { readDocMeta } from '#helpers/read-doc-meta'
import { collectProperties, hasProperties } from '#reference/collect-properties'
import type { DocSort } from '#types/doc'
import type { DocEntry, PathSegment } from '#types/render'
import type { SchemaProperty } from '#types/schema'

/**
 * Marks the array hop in a property path, so a derived example wraps the value
 * in `[…]` at the right level.
 *
 * A symbol rather than a string: any sentinel string is a property name some
 * schema is entitled to use, and the previous one — a literal NUL — made this
 * file binary as far as git and grep were concerned, and leaked an unprintable
 * character into error messages.
 */
export const ARRAY_ITEM = Symbol('array item')

/**
 * Marks the map-key hop, for an object that describes its values through
 * `additionalProperties` / `patternProperties` rather than named properties.
 * Without it a derived example for `environments.*.url` came out as
 * `{ environments: { url: … } }` — a sample that does not validate against the
 * schema it was derived from, because the key level is missing.
 */
export const MAP_KEY = Symbol('map key')

/** What a map key is called in a derived example, having no real name. */
export const MAP_KEY_PLACEHOLDER = '<name>'

/** Renders a path for a human — an error message, a derived example's keys. */
export const formatPath = (path: readonly PathSegment[]): string =>
  path
    .map((segment) => {
      if (segment === ARRAY_ITEM) return '[]'
      if (segment === MAP_KEY) return MAP_KEY_PLACEHOLDER
      // A tuple position says which position, or an error message about one of
      // them points at the wrong shape.
      return typeof segment === 'number' ? `[${segment}]` : segment
    })
    .join('.')

/**
 * How many container levels deep the search for children goes. A matrix is two,
 * a map of arrays of maps is three; past a handful the shape is not something a
 * reference page can lay out anyway.
 */
const MAX_CONTAINER_DEPTH = 8

/** One place a property's children come from, and the path hops that reach it. */
export type ChildSource = { readonly node: SchemaProperty; readonly hops: readonly PathSegment[] }

/**
 * Every place a property's children come from, in the order a reader meets
 * them.
 *
 * A node's own named properties come first. Then the containers, because a
 * shape can live one level down: in the item schema of an array (`pagination:
 * [{ name, type }]` documents `name` and `type`, not the array), or in the
 * value schema of a map (`environments`, `resources`, and every other
 * `additionalProperties` bag).
 *
 * All of them, not the first of them. A node with `properties` *and*
 * `additionalProperties` documents its known fields and the shape of the custom
 * ones; a tuple documents every position; a map keyed by two patterns documents
 * both value shapes. Returning only the first source dropped whichever the
 * author wrote second, with nothing in the output to say so.
 *
 * Each candidate is tested with {@link hasProperties} rather than a bare
 * `properties` check, because a container's contents are just as likely to sit
 * behind a `$ref` to a `boolean | object` union as they are to be spelled out.
 */
export const childSources = (prop: SchemaProperty, depth = 0, own = true): readonly ChildSource[] => {
  const sources: ChildSource[] = []
  if (depth > MAX_CONTAINER_DEPTH) return sources
  if (own && hasProperties(prop)) sources.push({ node: prop, hops: [] })

  /**
   * A container's contents, one hop in. A container whose values are another
   * container is the same question one level down — an array of maps, a map of
   * arrays, a matrix — and stopping at the first level documented the outer
   * shape and dropped every field inside it without a word.
   */
  const contained = (node: SchemaProperty, hop: PathSegment): void => {
    // Asked once: `childSources` would ask again on the way in, and this runs
    // for every value of every map and every item of every array.
    if (hasProperties(node)) {
      sources.push({ node, hops: [hop] })
      return
    }
    for (const inner of childSources(node, depth + 1, false)) {
      sources.push({ node: inner.node, hops: [hop, ...inner.hops] })
    }
  }

  // The container keywords can sit on the node, or on a branch of it — a
  // `$ref` to "an array of X, or a string" keeps the item schema one level
  // inside the union, and looking only at the node documented nothing at all.
  const candidates = [
    prop,
    ...[prop.allOf, prop.anyOf, prop.oneOf].flatMap((keyword) => asArray(keyword).map(asSchema)),
  ]
  for (const candidate of candidates) {
    // `prefixItems` and draft-07's array-form `items` both spell one schema per
    // index, and each index is a different shape.
    // A tuple's positions each get their own index. They used to share the hop
    // of position zero, so position one's example was built at index zero —
    // a sample that does not validate against the schema it was derived from.
    const tuple = [...asArray(candidate.prefixItems), ...(Array.isArray(candidate.items) ? candidate.items : [])]
    for (const [index, entry] of tuple.entries()) contained(asSchema(entry), index)
    if (candidate.items !== undefined && !Array.isArray(candidate.items)) {
      contained(asSchema(candidate.items), ARRAY_ITEM)
    }
    for (const values of [candidate.additionalProperties, ...Object.values(asSchema(candidate.patternProperties))]) {
      if (isObject(values)) contained(asSchema(values), MAP_KEY)
    }
  }
  return sources
}

/** The first source a property's children come from. */
export const childSchema = (prop: SchemaProperty): ChildSource => childSources(prop)[0] ?? { node: {}, hops: [] }

/**
 * Orders properties for rendering. `x-doc.order` wins wherever it is set — that
 * is the escape hatch for putting the two options everybody needs above the
 * twenty nobody does — and the rest fall back to the page's sort mode, which is
 * either the order the schema declares them in or alphabetical.
 */
export const sortEntries = (entries: readonly DocEntry[], sort: DocSort): readonly DocEntry[] =>
  entries
    .map((entry, index) => ({ entry, index, order: readDocMeta(entry.prop).order }))
    .sort((a, b) => {
      const orderA = a.order ?? Number.POSITIVE_INFINITY
      const orderB = b.order ?? Number.POSITIVE_INFINITY
      if (orderA !== orderB) return orderA - orderB
      // Case-insensitive, so `Timeout` files next to `timeoutMs` rather than
      // ahead of every lowercase name in the list.
      if (sort === 'alphabetical' && a.entry.name !== b.entry.name) {
        const left = a.entry.name.toLowerCase()
        const right = b.entry.name.toLowerCase()
        if (left !== right) return left < right ? -1 : 1
        return a.entry.name < b.entry.name ? -1 : 1
      }
      return a.index - b.index
    })
    .map(({ entry }) => entry)

/**
 * The renderable children of a property: hidden ones dropped, the rest sorted,
 * each carrying the path it sits at so its examples can be wrapped back into
 * the shape of the config file.
 */
export const childEntries = (
  prop: SchemaProperty,
  path: readonly PathSegment[],
  sort: DocSort,
): readonly DocEntry[] => {
  const seen = new Set<string>()
  const entries: DocEntry[] = []
  for (const { node, hops } of childSources(prop)) {
    const { properties, required } = collectProperties(node)
    const basePath = [...path, ...hops]
    for (const [name, child] of Object.entries(properties)) {
      // A name declared by two sources is one field: the first description of
      // it wins, the way it does across composition branches.
      if (seen.has(name)) continue
      seen.add(name)
      entries.push({ name, prop: asSchema(child), path: [...basePath, name], required: required.has(name) })
    }
  }
  return sortEntries(
    entries.filter(({ prop: child }) => !readDocMeta(child).hidden),
    sort,
  )
}
