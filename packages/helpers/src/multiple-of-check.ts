/**
 * Emits code for a JSON Schema `multipleOf` check that agrees with the runtime
 * interpreter (`packages/runtime-validators/src/interpreter/compile.ts`).
 *
 * The interpreter answers the keyword in two ways depending on the divisor, and
 * so does this emitter — the two must not diverge, or a generated validator and
 * `@amritk/runtime-validators` return different verdicts for the same document.
 *
 * **Integer divisor.** `%` on doubles is exact for an integer divisor, so the
 * emitted check is the plain one. It accepts huge true multiples (`1e21 % 1` is
 * `0`) that a quotient check would misjudge, and `Number.isInteger` rejects
 * `NaN` / `±Infinity`, which is Ajv's verdict for `multipleOf` on any non-finite
 * value.
 *
 * **Fractional divisor.** The naive `x % m === 0` is float-wrong — IEEE-754
 * makes `0.3 % 0.1` evaluate to `0.0999…`, so `0.3` would spuriously fail
 * `multipleOf: 0.1` — so the check divides and measures the quotient's distance
 * to its nearest integer. The tolerance tracks the actual representation error
 * in the quotient (~`|q|·2⁻⁵²`) rather than a fixed epsilon: a fixed one is both
 * too tight for large values (`1234567.89` against `multipleOf: 0.01`, whose
 * quotient error already exceeds it) and, at the `1e-8·|q|` this used to emit,
 * ~10⁷× too loose — it accepted clear non-multiples like `1000000.005` against
 * `multipleOf: 0.01`. A value whose quotient overflows to `Infinity` yields a
 * `NaN` distance, and `NaN <= tolerance` is `false`, so it fails rather than
 * reading as a clean multiple.
 *
 * `valueExpr` is inlined up to three times, so it must be a side-effect-free
 * expression (a property read or a cached variable — which is all the generators
 * ever pass). Both expressions are self-parenthesized, so a caller can drop
 * either into a `&&` / `||` chain or negate it without re-bracketing.
 */

/** Boolean expression that is TRUE when `valueExpr` is a valid multiple of `divisor`. */
export const multipleOfPassExpr = (valueExpr: string, divisor: number): string => {
  if (Number.isInteger(divisor)) {
    return `(Number.isInteger(${valueExpr}) && ${valueExpr} % ${divisor} === 0)`
  }
  const q = `${valueExpr} / ${divisor}`
  return `(Math.abs(${q} - Math.round(${q})) <= 2 * Number.EPSILON * Math.max(1, Math.abs(${q})))`
}

/** Boolean expression that is TRUE when `valueExpr` is NOT a multiple of `divisor` (the error condition). */
export const multipleOfFailExpr = (valueExpr: string, divisor: number): string =>
  `!${multipleOfPassExpr(valueExpr, divisor)}`
