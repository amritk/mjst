import { assignKey } from '@amritk/helpers/assign-key'

/**
 * Applies a message's (or operation's) traits: each trait's top-level keys are
 * laid down in declaration order, then the target's own keys win — the shallow
 * merge the AsyncAPI spec defines. Merging happens *before* anything reads
 * `schemaFormat` off the result: a trait-contributed format is just as binding
 * as an inline one, and reading it pre-merge is how an Avro payload gets
 * misjudged as JSON Schema.
 *
 * The `traits` key itself is dropped from the result — it has been applied,
 * and a leftover copy would read as still-pending. `assignKey` guards the
 * copy: a trait key named `__proto__` must become a property, not a prototype.
 */
export const mergeTraits = (
  target: Record<string, unknown>,
  traits: readonly Record<string, unknown>[],
): Record<string, unknown> => {
  const merged: Record<string, unknown> = {}
  for (const trait of traits) {
    for (const [key, value] of Object.entries(trait)) assignKey(merged, key, value)
  }
  for (const [key, value] of Object.entries(target)) assignKey(merged, key, value)
  delete merged['traits']
  return merged
}
