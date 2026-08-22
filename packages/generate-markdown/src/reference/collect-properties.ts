import { MAX_SCHEMA_DEPTH, RECURSION_STUB } from '#helpers/dereference'
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
 * properties — the same bound the inliner puts on the document it walks, so a
 * schema that made it through inlining is never cut short here.
 *
 * It was twelve, and a fourteen-level `allOf` chain (which an inheritance
 * hierarchy reaches without trying) lost its innermost fields with no error and
 * no gap in the output. Every other cap in this package throws for exactly that
 * reason; this one now does too.
 */
const MAX_COMPOSITION_DEPTH = MAX_SCHEMA_DEPTH

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
 */
const couldBeObject = (node: SchemaProperty, depth = 0): boolean => {
  // The stub a recursive `$ref` collapses to is this package's own truncation
  // marker. Read as a schema it says "an object requiring nothing", and letting
  // that into the intersection stripped the markers off every other branch of a
  // recursive union.
  if (RECURSION_STUB in node) return false
  if (depth > MAX_SCHEMA_DEPTH) return true
  const declared = typeof node.type === 'string' ? [node.type] : Array.isArray(node.type) ? node.type : undefined
  if (declared !== undefined && !declared.includes('object')) return false
  const values = asArray(node.enum)
  if (values.length > 0 && !values.some(isObject)) return false
  if (node.const !== undefined && !isObject(node.const)) return false
  // `allOf` branches all apply, so a branch that cannot be an object settles it
  // for the whole node — that is how a `$ref` to `allOf: [{ type: 'string' }]`
  // describes a string, and reading only the node's own `type` let it vote on
  // what an object alternative requires.
  return asArray(node.allOf).every((branch) => couldBeObject(asSchema(branch), depth + 1))
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
  if (depth > MAX_COMPOSITION_DEPTH) {
    throw new Error(
      `Following the schema's composition passed ${MAX_COMPOSITION_DEPTH} levels. Flatten the \`allOf\` chain, ` +
        'or the properties below this point would be dropped without a word.',
    )
  }

  for (const [name, child] of Object.entries(asProperties(node.properties)))
    defineOwn(properties, name, asSchema(child))
  for (const name of asArray(node.required)) if (typeof name === 'string') required.add(name)

  for (const branch of asArray(node.allOf)) {
    const collected = collect(asSchema(branch), depth + 1)
    merge(properties, collected.properties)
    for (const name of collected.required) required.add(name)
  }

  for (const keyword of [node.anyOf, node.oneOf]) {
    const branches = asArray(keyword).map((branch) => asSchema(branch))
    const collected = branches.map((branch) => collect(branch, depth + 1))
    for (const branch of collected) merge(properties, branch.properties)
    const describing = collected.filter((_, index) => couldBeObject(branches[index] ?? {}))
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
