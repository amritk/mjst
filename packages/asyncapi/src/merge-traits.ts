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
 * Deep target-wins overlay for 3.0's precedence rule. This is deliberately
 * NOT a merge patch with the target as the patch: only *traits* carry RFC
 * 7386 patch semantics, so a `null` the message itself authors — a
 * `const: null` in a payload schema, a `default: null` — is a value to keep,
 * never a deletion marker. Plain objects merge key by key with the target's
 * side winning; everything else copies from the target verbatim.
 */
const overlayTarget = (base: unknown, target: unknown): unknown => {
  if (typeof target !== 'object' || target === null || Array.isArray(target)) return target
  if (typeof base !== 'object' || base === null || Array.isArray(base)) return structuredClone(target)
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(base as Record<string, unknown>)) assignKey(result, key, value)
  for (const key of Object.keys(target as Record<string, unknown>)) {
    assignKey(result, key, overlayTarget(readKey(result, key), readKey(target as Record<string, unknown>, key)))
  }
  return result
}

/**
 * Applies a message's (or operation's) traits per the requested precedence:
 * with `'trait'` each trait patches the accumulating target in declaration
 * order; with `'target'` the traits accumulate first and the target overlays
 * them, its own values — authored `null`s included — kept verbatim. Merging
 * happens *before* anything reads `schemaFormat` off the result: a
 * trait-contributed format is just as binding as an inline one, and reading
 * it pre-merge is how an Avro payload gets misjudged as JSON Schema.
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
  let merged: unknown
  if (precedence === 'trait') {
    merged = structuredClone(target)
    for (const trait of traits) merged = applyMergePatch(merged, trait)
  } else {
    merged = {}
    for (const trait of traits) merged = applyMergePatch(merged, trait)
    merged = overlayTarget(merged, target)
  }
  const result = merged as Record<string, unknown>
  delete result['traits']
  return result
}
