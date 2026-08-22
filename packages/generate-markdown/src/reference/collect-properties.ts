import { asArray, asProperties, asSchema, isObject } from '#helpers/guards'
import type { SchemaProperty } from '#types/schema'

/**
 * Every named property a schema node declares, and which of them it requires,
 * gathered from all the places JSON Schema lets an author put one.
 *
 * The order is declaration order: `properties` first, then whatever the
 * applicators add, and the first declaration of a name wins. Two branches
 * describing the same field are describing the same field.
 */
export type CollectedProperties = {
  readonly properties: Readonly<Record<string, SchemaProperty>>
  readonly required: ReadonlySet<string>
}

/**
 * How deep the collector follows composition while looking for named
 * properties. Composition nests (an `allOf` of `anyOf`s of `$ref`s), but not
 * this deeply in any real schema — the cap only fires on a document that has
 * already gone wrong, and the walk is over an already-dereferenced tree.
 */
const MAX_COMPOSITION_DEPTH = 12

/**
 * Assigns an own property, first declaration winning. Plain assignment sets the
 * prototype for a key named `__proto__`, which JSON can produce and a JS object
 * literal cannot.
 */
const defineOwn = (target: Record<string, SchemaProperty>, key: string, value: SchemaProperty): void => {
  if (Object.hasOwn(target, key)) return
  Object.defineProperty(target, key, { value, enumerable: true, writable: true, configurable: true })
}

const merge = (target: Record<string, SchemaProperty>, source: Readonly<Record<string, SchemaProperty>>): void => {
  for (const [name, child] of Object.entries(source)) defineOwn(target, name, child)
}

/** The names every one of these sets holds. Empty when there are no sets. */
const intersect = (sets: readonly ReadonlySet<string>[]): ReadonlySet<string> => {
  const [first, ...rest] = sets
  if (first === undefined) return new Set()
  return new Set([...first].filter((name) => rest.every((other) => other.has(name))))
}

/**
 * Collects the named properties a node contributes, following every applicator
 * that carries them.
 *
 * The rules differ per keyword because the keywords mean different things:
 *
 * - `allOf` branches all apply at once, so every branch contributes properties
 *   *and* requirements. `allOf: [{ $ref: Base }, { properties: … }]` is the
 *   inheritance idiom of every OpenAPI-derived schema, and taking only the
 *   first branch dropped whichever half the author wrote second.
 * - `anyOf` / `oneOf` branches are alternatives. A reader still needs to see
 *   every field that might apply, so their properties are all collected — but a
 *   field is only required if every alternative *that describes an object*
 *   requires it. A document satisfying an alternative that does not ask for the
 *   field is still valid, so marking it required would be a lie — that is the
 *   `versions`-or-`navigation` shape a generated root `anyOf` produces.
 *
 *   Only the object-describing branches count, because `string | { … }` is the
 *   other half of the same idiom: the scalar branch declares no properties at
 *   all, and letting its empty requirement set into the intersection stripped
 *   the markers off every field of the object form.
 * - `then` / `else` / `dependentSchemas` add properties that apply under a
 *   condition. Same treatment as the alternatives: shown, never required.
 */
const collect = (
  node: SchemaProperty,
  depth: number,
): { properties: Record<string, SchemaProperty>; required: Set<string> } => {
  const properties: Record<string, SchemaProperty> = {}
  const required = new Set<string>()
  if (depth > MAX_COMPOSITION_DEPTH) return { properties, required }

  for (const [name, child] of Object.entries(asProperties(node.properties)))
    defineOwn(properties, name, asSchema(child))
  for (const name of asArray(node.required)) if (typeof name === 'string') required.add(name)

  for (const branch of asArray(node.allOf)) {
    const collected = collect(asSchema(branch), depth + 1)
    merge(properties, collected.properties)
    for (const name of collected.required) required.add(name)
  }

  for (const keyword of [node.anyOf, node.oneOf]) {
    const branches = asArray(keyword).map((branch) => collect(asSchema(branch), depth + 1))
    for (const branch of branches) merge(properties, branch.properties)
    const describing = branches.filter((branch) => Object.keys(branch.properties).length > 0)
    for (const name of intersect(describing.map((branch) => branch.required))) required.add(name)
  }

  for (const conditional of [node.then, node.else]) {
    if (isObject(conditional)) merge(properties, collect(asSchema(conditional), depth + 1).properties)
  }
  for (const dependent of Object.values(asProperties(node.dependentSchemas))) {
    merge(properties, collect(asSchema(dependent), depth + 1).properties)
  }

  return { properties, required }
}

/** {@link collect}, as a readonly value. */
export const collectProperties = (node: SchemaProperty): CollectedProperties => collect(node, 0)

/**
 * True when the node contributes at least one named property — the test for
 * "is there anything to document below this?" that has to look through
 * composition, because a container's contents are as likely to sit behind a
 * `boolean | object` union as they are to be spelled out.
 */
export const hasProperties = (node: SchemaProperty): boolean =>
  Object.keys(collectProperties(node).properties).length > 0
