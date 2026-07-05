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
