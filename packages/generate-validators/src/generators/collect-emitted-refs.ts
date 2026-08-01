/**
 * Recursively walks a schema and yields every `$ref` the validator emitter turns
 * into a `validateX(...)` call, in traversal order (duplicates included — the
 * callers dedupe on what they key by).
 *
 * The emitter recurses into far more than properties/items/additionalProperties
 * and the top-level combinators: it also delegates for `patternProperties`,
 * `propertyNames`, `if`/`then`/`else`, `contains`, `prefixItems`,
 * `dependentSchemas`, `not`, and objects nested inside any combinator branch. A
 * `$ref` reached by *any* of those paths becomes a call in the output, so both
 * the import collector and the generatability check have to see exactly this set
 * — which is why the traversal lives here rather than in either of them.
 *
 * `$defs` / `definitions` are deliberately skipped: they are split into their own
 * generated files rather than inlined into this one.
 */
export const collectEmittedRefs = (value: unknown, refs: string[] = []): string[] => {
  if (typeof value !== 'object' || value === null) return refs

  if (Array.isArray(value)) {
    for (const item of value) collectEmittedRefs(item, refs)
    return refs
  }

  const schema = value as Record<string, unknown>

  // A `$ref` is a leaf: the emitter delegates the whole value to the referenced
  // validator, so record the ref and do not descend past it.
  if (typeof schema['$ref'] === 'string') {
    refs.push(schema['$ref'])
    return refs
  }

  // `properties` and `patternProperties` hold subschemas as object *values*; the
  // combinator/tuple keywords hold them in arrays; the rest are single
  // subschemas. `dependencies` (draft-07) is dual-form — a string array
  // (dependentRequired) or a subschema (dependentSchemas) — and the string form
  // is a harmless no-op here, since this self-guards on non-objects.
  for (const mapKey of ['properties', 'patternProperties', 'dependentSchemas', 'dependencies']) {
    const map = schema[mapKey]
    if (typeof map === 'object' && map !== null && !Array.isArray(map)) {
      for (const sub of Object.values(map)) collectEmittedRefs(sub, refs)
    }
  }

  for (const key of ['items', 'additionalProperties', 'propertyNames', 'contains', 'if', 'then', 'else', 'not']) {
    if (key in schema) collectEmittedRefs(schema[key], refs)
  }

  for (const key of ['oneOf', 'anyOf', 'allOf', 'prefixItems']) {
    const list = schema[key]
    if (Array.isArray(list)) {
      for (const sub of list) collectEmittedRefs(sub, refs)
    }
  }

  return refs
}
