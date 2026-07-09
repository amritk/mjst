/**
 * Generates an enum validation check expression.
 * Returns a string that checks if the value is in the allowed enum values.
 *
 * For the common all-primitive case this emits a parenthesized `x === a || x ===
 * b` chain rather than `[a, b].includes(x)`. The `.includes` form allocates a
 * fresh array on every call (this expression runs on the parser hot path); the
 * `===` chain is allocation-free and matches the validators package's
 * `enumMembershipExpr`. It falls back to `.includes` when a member is an
 * object/array (reference equality) or `NaN` (where `includes`'s SameValueZero
 * differs from `===`), so the verdict is unchanged.
 */
export const generateEnumCheck = (accessor: string, enumValues: readonly unknown[]): string => {
  const allPrimitive =
    enumValues.length > 0 &&
    enumValues.every((v) => (v === null || typeof v !== 'object') && typeof v !== 'function') &&
    !enumValues.some((v) => typeof v === 'number' && Number.isNaN(v))

  if (allPrimitive) {
    return `(${enumValues.map((v) => `${accessor} === ${JSON.stringify(v)}`).join(' || ')})`
  }

  const serializedEnum = JSON.stringify(enumValues)
  return `${serializedEnum}.includes(${accessor} as never)`
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
  const byLower: Record<string, string> = {}
  for (const value of enumValues) {
    if (typeof value !== 'string') continue
    const lower = value.toLowerCase()
    // First writer wins, so declaration order breaks ties between members that
    // fold to the same key (e.g. `"on"` and `"ON"`).
    if (!(lower in byLower)) byLower[lower] = value
  }
  if (Object.keys(byLower).length === 0) return null
  const map = JSON.stringify(byLower)
  return `(typeof ${accessor} === "string" ? ((${map} as Record<string, string>)[(${accessor} as string).toLowerCase()] ?? ${fallback}) : ${fallback})`
}
