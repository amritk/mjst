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
  path.map((segment) => (segment === ARRAY_ITEM ? '[]' : segment === MAP_KEY ? MAP_KEY_PLACEHOLDER : segment)).join('.')

/** One place a property's children come from, and the path hop that reaches it. */
export type ChildSource = { readonly node: SchemaProperty; readonly hop: PathSegment | undefined }

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
export const childSources = (prop: SchemaProperty): readonly ChildSource[] => {
  const sources: ChildSource[] = []
  if (hasProperties(prop)) sources.push({ node: prop, hop: undefined })

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
    for (const [index, entry] of tuple.entries()) {
      const item = asSchema(entry)
      if (hasProperties(item)) sources.push({ node: item, hop: index })
    }
    if (candidate.items !== undefined && !Array.isArray(candidate.items)) {
      const items = asSchema(candidate.items)
      if (hasProperties(items)) sources.push({ node: items, hop: ARRAY_ITEM })
    }
    for (const values of [candidate.additionalProperties, ...Object.values(asSchema(candidate.patternProperties))]) {
      if (isObject(values) && hasProperties(asSchema(values))) sources.push({ node: asSchema(values), hop: MAP_KEY })
    }
  }
  return sources
}

/** The first source a property's children come from. */
export const childSchema = (prop: SchemaProperty): ChildSource => childSources(prop)[0] ?? { node: {}, hop: undefined }

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
  for (const { node, hop } of childSources(prop)) {
    const { properties, required } = collectProperties(node)
    const basePath = hop === undefined ? path : [...path, hop]
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
