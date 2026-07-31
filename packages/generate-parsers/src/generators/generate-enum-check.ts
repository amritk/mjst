import { generateDeepEqualCheck } from './generate-deep-equal-check'

/**
 * Generates an enum validation check expression.
 * Returns a string that checks if the value is in the allowed enum values.
 *
 * For the common all-primitive case this emits a parenthesized `x === a || x ===
 * b` chain rather than `[a, b].includes(x)`. The `.includes` form allocates a
 * fresh array on every call (this expression runs on the parser hot path); the
 * `===` chain is allocation-free and matches the validators package's
 * `enumMembershipExpr`.
 *
 * An object or array member is compared *structurally* via
 * {@link generateDeepEqualCheck}. `.includes` was SameValueZero — reference
 * equality — so `{ enum: [{ a: 1 }] }` could never match a freshly parsed
 * `{ a: 1 }`: the fast path never fired and the strict parser threw on a document
 * Ajv accepts. `NaN` keeps its own `Number.isNaN` test, the one case `===` cannot
 * express.
 */
export const generateEnumCheck = (accessor: string, enumValues: readonly unknown[]): string => {
  if (enumValues.length === 0) return 'false'
  const members = enumValues.map((value) => {
    const check = generateDeepEqualCheck(accessor, value)
    // A structural member expands to an `&&` chain. `&&` binds tighter than the
    // `||` below so this is only about readability — but an unparenthesized chain
    // inside a long disjunction is genuinely hard to read.
    return value !== null && typeof value === 'object' ? `(${check})` : check
  })
  return `(${members.join(' || ')})`
}

/**
 * Builds a case-insensitive coercion expression for a string `enum`/`const`
 * value whose exact-match check has already failed. Only the *string* members
 * participate (a number/boolean/null member has no case to fold): a value that
 * matches one case-insensitively normalizes to that member's exact casing, and
 * everything else yields `fallback`.
 *
 * This is emitted ONLY on the already-invalid branch of the coercion ternary, so
 * a correctly-cased value never reaches it — the exact `===` fast path (and the
 * shape validators / deep guards built on it) is unchanged, so the hot path pays
 * nothing. Only a mis-cased value, which today coerces straight to the default,
 * now takes a single `toLowerCase()` and an O(1) map lookup instead.
 *
 * Returns `null` when no member is a string (nothing to fold), so the caller
 * keeps its plain fallback and emits no extra code.
 */
export const generateEnumCaseInsensitiveCoercion = (
  accessor: string,
  enumValues: readonly unknown[],
  fallback: string,
): string | null => {
  const entries: [string, string][] = []
  const seen = new Set<string>()
  for (const value of enumValues) {
    if (typeof value !== 'string') continue
    const lower = value.toLowerCase()
    // First writer wins, so declaration order breaks ties between members that
    // fold to the same key (e.g. `"on"` and `"ON"`). `Set` membership is used
    // instead of `lower in obj` so a member folding to an inherited name like
    // `constructor` or `toString` is not wrongly treated as already-present.
    if (seen.has(lower)) continue
    seen.add(lower)
    entries.push([lower, value])
  }
  if (entries.length === 0) return null
  // A `Map` — not a plain object — so a folded key that collides with an
  // inherited member (`constructor`, `toString`, `__proto__`, …) resolves to
  // `undefined` (→ `fallback`) rather than an `Object.prototype` value. A
  // plain-object lookup would return the inherited function/object for such a key.
  const map = `new Map(${JSON.stringify(entries)})`
  return `(typeof ${accessor} === "string" ? (${map}.get((${accessor} as string).toLowerCase()) ?? ${fallback}) : ${fallback})`
}
