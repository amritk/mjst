import { asArray } from '#helpers/guards'
import { ARRAY_ITEM_SEGMENT } from '#reference/child-entries'
import type { DocExample } from '#types/doc'
import type { SchemaProperty } from '#types/schema'

/**
 * Turns a property's first `examples` entry into the code block a reader
 * actually needs: the value wrapped back into the config shape it belongs to.
 * `targets.typescript.packageName` with an example of `'@acme/api'` documents
 * itself as `{ "targets": { "typescript": { "packageName": "@acme/api" } } }`,
 * which is something you can paste, rather than a bare string that leaves the
 * reader to guess where it goes.
 *
 * `Object.fromEntries` rather than a computed key: a property literally named
 * `__proto__` (JSON can produce one) would otherwise set the prototype and
 * vanish from the example.
 */
export const deriveExample = (prop: SchemaProperty, path: readonly string[]): DocExample | undefined => {
  const examples = asArray(prop.examples)
  if (examples.length === 0) return undefined
  const value = path.reduceRight<unknown>(
    (nested, key) => (key === ARRAY_ITEM_SEGMENT ? [nested] : Object.fromEntries([[key, nested]])),
    examples[0],
  )
  return { value }
}
