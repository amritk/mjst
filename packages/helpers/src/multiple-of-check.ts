/**
 * Emits code for a JSON Schema `multipleOf` check that agrees with the runtime
 * interpreter (`packages/runtime-validators/src/interpreter/interpret.ts`).
 *
 * The naive `x % m === 0` is float-wrong: IEEE-754 makes `0.3 % 0.1` evaluate to
 * `0.0999…`, so `0.3` would spuriously fail `multipleOf: 0.1`. The interpreter
 * instead divides and compares the quotient to its nearest integer within a
 * tolerance that *scales with the quotient's magnitude* — a fixed epsilon falsely
 * rejects large values (e.g. `1234567.89` against `multipleOf: 0.01`) whose
 * representation error in the quotient already exceeds it. Keeping the emitted
 * check identical to the interpreter's keeps generated validators/parsers and the
 * interpreter from disagreeing on the same document.
 *
 * `valueExpr` is inlined three times, so it must be a side-effect-free expression
 * (a property read or a cached variable — which is all the generators ever pass).
 */
const quotientTolerance = (valueExpr: string, divisor: number): { q: string; tol: string } => {
  const q = `${valueExpr} / ${divisor}`
  return { q, tol: `1e-8 * Math.max(1, Math.abs(${q}))` }
}

/** Boolean expression that is TRUE when `valueExpr` is a valid multiple of `divisor`. */
export const multipleOfPassExpr = (valueExpr: string, divisor: number): string => {
  const { q, tol } = quotientTolerance(valueExpr, divisor)
  return `Math.abs(${q} - Math.round(${q})) <= ${tol}`
}

/** Boolean expression that is TRUE when `valueExpr` is NOT a multiple of `divisor` (the error condition). */
export const multipleOfFailExpr = (valueExpr: string, divisor: number): string => {
  const { q, tol } = quotientTolerance(valueExpr, divisor)
  return `Math.abs(${q} - Math.round(${q})) > ${tol}`
}
