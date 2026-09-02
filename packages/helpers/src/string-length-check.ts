/**
 * Emits code for JSON Schema's `minLength` / `maxLength`, which count Unicode
 * **code points** — not the UTF-16 code units `String.prototype.length` reports.
 * A single astral character (`"💩"`) is one code point but two units, so a bare
 * `.length` both accepts values the schema forbids (`"💩"` against
 * `minLength: 2`) and rejects ones it allows (`"💩💩"` against `maxLength: 2`).
 * Ajv — the differential oracle — counts code points, as does the runtime
 * interpreter (`packages/runtime-validators/src/interpreter/compile.ts`).
 *
 * The exact count needs a scan, so the emitted expression pays for it only where
 * it can change the answer. `units` is an upper bound on the code-point count and
 * equals it unless the string holds a surrogate pair, which gives two shortcuts:
 *
 *  - `units < min` ⇒ code points `< min` (fail), and `units >= 2·min` ⇒ code
 *    points `>= min` (pass, since a code point is at most 2 units). Only the band
 *    `[min, 2·min)` needs the scan.
 *  - `units <= max` ⇒ code points `<= max` (pass). Only an over-long unit count
 *    needs the scan.
 *
 * `Array.from` yields code points (the string iterator does the surrogate
 * pairing), and the `as string` cast states what the caller's `typeof` guard has
 * already proven — the accessor's static type may be `unknown` at that point.
 *
 * `valueExpr` is inlined more than once, so it must be a side-effect-free
 * expression (a property read or a cached variable — all the generators pass).
 *
 * Every expression here is self-parenthesized, including the single-comparison
 * fast paths, so a caller can drop one into a `&&` / `||` chain or negate it
 * without re-bracketing — the same contract `multiple-of-check` makes. A bare
 * `!` on the unparenthesized form parsed as `(!x.length) >= 1`, which is
 * `false >= 1`: constant `false`, so the check silently passed everything.
 */
const codePoints = (valueExpr: string): string => `Array.from(${valueExpr} as string).length`

/** Boolean expression that is TRUE when `valueExpr` has at least `min` code points. */
export const minLengthPassExpr = (valueExpr: string, min: number): string => {
  if (min <= 0) return 'true'
  // A string with at least one code unit has at least one code point, so the
  // overwhelmingly common `minLength: 1` needs no band and no scan at all.
  if (min === 1) return `(${valueExpr}.length >= 1)`
  return `(${valueExpr}.length >= ${min} && (${valueExpr}.length >= ${min * 2} || ${codePoints(valueExpr)} >= ${min}))`
}

/** Boolean expression that is TRUE when `valueExpr` has at most `max` code points. */
export const maxLengthPassExpr = (valueExpr: string, max: number): string =>
  `(${valueExpr}.length <= ${max} || ${codePoints(valueExpr)} <= ${max})`

/** Boolean expression that is TRUE when `valueExpr` has FEWER than `min` code points (the error condition). */
export const minLengthFailExpr = (valueExpr: string, min: number): string => {
  if (min <= 0) return 'false'
  if (min === 1) return `(${valueExpr}.length < 1)`
  return `(${valueExpr}.length < ${min} || (${valueExpr}.length < ${min * 2} && ${codePoints(valueExpr)} < ${min}))`
}

/** Boolean expression that is TRUE when `valueExpr` has MORE than `max` code points (the error condition). */
export const maxLengthFailExpr = (valueExpr: string, max: number): string =>
  `(${valueExpr}.length > ${max} && ${codePoints(valueExpr)} > ${max})`
