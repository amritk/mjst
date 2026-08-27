import { assignKey } from '@amritk/helpers/assign-key'
import { readKey } from '@amritk/helpers/read-key'

/**
 * Which side of a key conflict wins when a trait and its target both set it.
 * Both majors define trait application via JSON Merge Patch (RFC 7386), but
 * they disagree on who patches whom — and 3.0 changed the answer on purpose:
 *
 * - `'trait'` — AsyncAPI 2.x: traits "MUST be merged into the message object
 *   using the JSON Merge Patch algorithm in the same order they are defined",
 *   so each trait is the *patch* and its values override the target's.
 * - `'target'` — AsyncAPI 3.0: "A property on a trait MUST NOT override the
 *   same property on the target object" — the target is applied last.
 */
export type TraitPrecedence = 'trait' | 'target'

/**
 * RFC 7386 JSON Merge Patch: objects merge recursively key by key, a `null`
 * patch value deletes the key, and everything else (arrays included) replaces
 * wholesale. Recursion is what the spec's primary trait use case rides on — a
 * `commonHeaders` trait contributing header *properties* that each message
 * extends — so a shallow top-level merge silently dropped one side's nested
 * contributions.
 */
const applyMergePatch = (target: unknown, patch: unknown): unknown => {
  if (typeof patch !== 'object' || patch === null || Array.isArray(patch)) return patch
  const base = typeof target === 'object' && target !== null && !Array.isArray(target) ? target : {}
  const result: Record<string, unknown> = {}
  // `assignKey` / `readKey` guard the copies: a document key named `__proto__`
  // must stay a plain property, never become the result's prototype.
  for (const [key, value] of Object.entries(base as Record<string, unknown>)) assignKey(result, key, value)
  for (const key of Object.keys(patch as Record<string, unknown>)) {
    const value = readKey(patch as Record<string, unknown>, key)
    if (value === null) {
      delete result[key]
    } else {
      assignKey(result, key, applyMergePatch(readKey(result, key), value))
    }
  }
  return result
}

/**
 * Applies a message's (or operation's) traits per the requested precedence:
 * with `'trait'` each trait patches the accumulating target in declaration
 * order; with `'target'` the traits accumulate first and the target lands as
 * the final patch. Merging happens *before* anything reads `schemaFormat` off
 * the result: a trait-contributed format is just as binding as an inline one,
 * and reading it pre-merge is how an Avro payload gets misjudged as JSON
 * Schema.
 *
 * The `traits` key itself is dropped from the result — it has been applied,
 * and a leftover copy would read as still-pending.
 */
export const mergeTraits = (
  target: Record<string, unknown>,
  traits: readonly Record<string, unknown>[],
  precedence: TraitPrecedence,
): Record<string, unknown> => {
  // The seed is cloned (not patched in — a patch drops `null`-valued keys as
  // RFC 7386 deletions), so the `delete` below never reaches into the
  // caller's document node.
  let merged: unknown = precedence === 'trait' ? structuredClone(target) : {}
  if (precedence === 'trait') {
    for (const trait of traits) merged = applyMergePatch(merged, trait)
  } else {
    for (const trait of traits) merged = applyMergePatch(merged, trait)
    merged = applyMergePatch(merged, target)
  }
  const result = merged as Record<string, unknown>
  delete result['traits']
  return result
}
