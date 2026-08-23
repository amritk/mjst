import { asArray } from '#helpers/guards'
import { ARRAY_ITEM, MAP_KEY, MAP_KEY_PLACEHOLDER } from '#reference/child-entries'
import type { DocExample } from '#types/doc'
import type { PathSegment } from '#types/render'
import type { SchemaProperty } from '#types/schema'

/**
 * Turns a property's first `examples` entry into the code block a reader
 * actually needs: the value wrapped back into the config shape it belongs to.
 * `targets.typescript.packageName` with an example of `'@acme/api'` documents
 * itself as `{ "targets": { "typescript": { "packageName": "@acme/api" } } }`,
 * which is something you can paste, rather than a bare string that leaves the
 * reader to guess where it goes.
 *
 * `Object.fromEntries` builds the wrapper. A computed key would do as well —
 * only the literal `__proto__:` form sets a prototype — but going through
 * `fromEntries` keeps that true no matter how the line is later rewritten.
 */
export const deriveExample = (prop: SchemaProperty, path: readonly PathSegment[]): DocExample | undefined => {
  const examples = asArray(prop.examples)
  if (examples.length === 0) return undefined
  // A tuple position past the first cannot be shown on its own: the positions
  // before it are other shapes with their own requirements, and inventing them
  // would produce a sample that does not validate. Better no example than a
  // wrong one.
  if (path.some((segment) => typeof segment === 'number' && segment > 0)) return undefined

  const value = path.reduceRight<unknown>((nested, key) => {
    if (key === ARRAY_ITEM || key === 0) return [nested]
    // A map key has no name in the schema, so the sample shows the shape with a
    // placeholder rather than promoting a value's own field to a key.
    const name = key === MAP_KEY ? MAP_KEY_PLACEHOLDER : String(key)
    return Object.fromEntries([[name, nested]])
  }, examples[0])
  return { value }
}
