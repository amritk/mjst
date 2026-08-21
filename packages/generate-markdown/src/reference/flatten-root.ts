import { asArray, asProperties, asSchema, isObject } from '#helpers/guards'
import type { ConfigSchema, SchemaProperty } from '#types/schema'

/**
 * The composition keywords a root schema uses when it is not a plain object.
 * Order matters only in that the first one carrying properties wins — a schema
 * that uses two of them at the root is describing something this renderer
 * cannot draw as one property list anyway.
 */
const BRANCH_KEYWORDS = ['anyOf', 'oneOf', 'allOf'] as const

/**
 * Flattens a root schema whose shape comes from `anyOf` / `oneOf` / `allOf`
 * into the plain `properties` + `required` pair the renderers walk.
 *
 * Generated schemas do this constantly: "a config with `versions`, or one
 * without" becomes a two-branch `anyOf` at the root, and the properties a
 * reader cares about live one level down in both branches. Without this the
 * whole document would render as a title and nothing else.
 *
 * Branches merge in order and the first declaration of a property wins. A
 * property is only marked required when *every* branch that declares it
 * requires it — with `anyOf`, a document satisfying the branch that does not
 * require it is still valid, so calling it required would be a lie.
 */
export const flattenRoot = (schema: ConfigSchema): ConfigSchema => {
  if (Object.keys(asProperties(schema.properties)).length > 0) return schema

  const record = schema as Readonly<Record<string, unknown>>
  for (const keyword of BRANCH_KEYWORDS) {
    const branches = asArray(record[keyword] as readonly unknown[] | undefined)
      .map(asSchema)
      .filter((branch) => Object.keys(asProperties(branch.properties)).length > 0)
    if (branches.length === 0) continue

    const properties: Record<string, SchemaProperty> = {}
    const declaredIn = new Map<string, number>()
    const requiredIn = new Map<string, number>()
    for (const branch of branches) {
      const required = new Set(asArray(branch.required))
      for (const [name, prop] of Object.entries(asProperties(branch.properties))) {
        // `Object.defineProperty` rather than assignment: a property named
        // `__proto__` would otherwise set the prototype and vanish.
        if (!Object.hasOwn(properties, name)) {
          Object.defineProperty(properties, name, {
            value: prop,
            enumerable: true,
            writable: true,
            configurable: true,
          })
        }
        declaredIn.set(name, (declaredIn.get(name) ?? 0) + 1)
        if (required.has(name)) requiredIn.set(name, (requiredIn.get(name) ?? 0) + 1)
      }
    }

    const requiredNames = [...requiredIn.entries()]
      .filter(([name, count]) => count === declaredIn.get(name))
      .map(([name]) => name)

    // The root's own documentation wins; a branch only fills in what the root
    // left unsaid, which is common in generated schemas where the title sits on
    // the branches.
    const branchWith = <T>(read: (branch: ConfigSchema) => T | undefined): T | undefined =>
      branches.map(read).find((value) => value !== undefined)
    const title = schema.title ?? branchWith((branch) => branch.title)
    const description = schema.description ?? branchWith((branch) => branch.description)
    const doc = isObject(schema['x-doc']) ? schema['x-doc'] : branchWith((branch) => branch['x-doc'])

    return {
      ...(title !== undefined && { title }),
      ...(description !== undefined && { description }),
      ...(doc !== undefined && { 'x-doc': doc }),
      required: requiredNames,
      properties,
    }
  }
  return schema
}
