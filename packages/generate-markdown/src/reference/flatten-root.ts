import { asArray, asProperties, isObject } from '#helpers/guards'
import { childSchema } from '#reference/child-entries'
import { collectProperties } from '#reference/collect-properties'
import type { ConfigSchema, SchemaProperty } from '#types/schema'

/**
 * Flattens a root schema into the plain `properties` + `required` pair the
 * renderers walk, no matter which keyword the author used to describe its shape.
 *
 * Three shapes reach this that a bare `schema.properties` read would document
 * as a title and nothing else:
 *
 * - Composition. A generated root says "a config with `versions`, or one
 *   without" as a two-branch `anyOf`, and everything a reader cares about lives
 *   one level down in both branches. `collectProperties` merges those branches
 *   — together with `allOf`, which is how an OpenAPI-derived root inherits, and
 *   which applies *alongside* the root's own `properties` rather than instead
 *   of them.
 * - A map. `additionalProperties` carrying the value shape is how a config that
 *   is one big keyed bag describes itself.
 * - An array. Rarer, and the same story one level down.
 *
 * The branch merge only reaches the properties; requiredness follows the
 * keyword's meaning (see `collectProperties`), so a name required by one `anyOf`
 * branch alone is not reported as required.
 */
export const flattenRoot = (schema: ConfigSchema): ConfigSchema => {
  const collected = collectProperties(schema as SchemaProperty)
  const ownNames = Object.keys(asProperties(schema.properties))
  const collectedNames = Object.keys(collected.properties)

  // Nothing composed anything in: the root already is what it says it is.
  if (collectedNames.length > 0 && collectedNames.length === ownNames.length) return schema

  const container = collectedNames.length === 0 ? childSchema(schema as SchemaProperty) : undefined
  const { properties, required } =
    container !== undefined && Object.keys(collectProperties(container.node).properties).length > 0
      ? collectProperties(container.node)
      : collected
  if (Object.keys(properties).length === 0) return schema

  // The root's own documentation wins; a branch only fills in what the root left
  // unsaid, which is common in generated schemas where the title sits on the
  // branches rather than above them.
  const composed = schema as SchemaProperty
  const branches = [composed.anyOf, composed.oneOf, composed.allOf]
    .flatMap((keyword) => asArray(keyword))
    .filter(isObject) as readonly ConfigSchema[]
  const branchWith = <T>(read: (branch: ConfigSchema) => T | undefined): T | undefined =>
    branches.map(read).find((value) => value !== undefined)
  const title = schema.title ?? branchWith((branch) => branch.title)
  const description = schema.description ?? branchWith((branch) => branch.description)
  const doc = isObject(schema['x-doc']) ? schema['x-doc'] : branchWith((branch) => branch['x-doc'])

  return {
    ...(title !== undefined && { title }),
    ...(description !== undefined && { description }),
    ...(doc !== undefined && { 'x-doc': doc }),
    required: [...required],
    properties,
  }
}
