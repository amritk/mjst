/**
 * Emits code for the JSON Schema numeric *bound* keywords — `minimum`,
 * `maximum`, `exclusiveMinimum`, `exclusiveMaximum` — that agrees with the
 * runtime interpreter (`packages/runtime-validators/src/interpreter/interpret.ts`).
 *
 * There is one rule here and it is easy to get wrong: **a bound is written as a
 * pass condition and negated, never as a failure condition directly.** For every
 * ordinary value the two spellings are identical:
 *
 * ```
 * !(x >= min)   // pass condition, negated
 * x < min       // failure condition, written directly
 * ```
 *
 * For `NaN` they are opposite. `NaN` compares `false` against every relational
 * operator, so `!(NaN >= 5)` is `true` — the value fails the bound, which is
 * Ajv's verdict and the interpreter's — while `NaN < 5` is `false`, which
 * silently *accepts* it. A generated validator spelled the second way was more
 * permissive than the interpreter for the same schema, and nothing caught it:
 * a conformance corpus is JSON, and JSON cannot express `NaN`.
 *
 * The keyword-level semantics this encodes, all matching Ajv:
 *
 *   - `NaN` fails any bound it is checked against.
 *   - `±Infinity` follows the ordinary comparison, so `Infinity` passes
 *     `minimum: 0` and fails `maximum: 10`.
 *   - A bare `type: 'number'` with no bound still accepts non-finite numbers.
 *     Only a bound (or `multipleOf`) rejects them.
 *   - Draft-04's boolean `exclusiveMinimum: true` / `exclusiveMaximum: true`
 *     makes a sibling `minimum` / `maximum` strict; draft-06+ replaced it with
 *     the standalone numeric keywords. Both forms are spelled through `strict`.
 *
 * `valueExpr` is inlined once per expression, so it must be a side-effect-free
 * expression (a property read or a cached variable — which is all the generators
 * ever pass). Every expression is self-parenthesized, so a caller can drop one
 * into a `&&` / `||` chain or negate it without re-bracketing.
 *
 * Companion to `multiple-of-check`, which does the same for `multipleOf`.
 */

/** Which bound a check is for, in the direction it compares. */
export type BoundKind = 'minimum' | 'maximum'

/**
 * Boolean expression that is TRUE when `valueExpr` satisfies the bound.
 *
 * @param strict `>` / `<` rather than `>=` / `<=` — draft-06+'s
 *   `exclusiveMinimum` / `exclusiveMaximum`, or draft-04's boolean form.
 */
export const boundPassExpr = (valueExpr: string, kind: BoundKind, bound: number, strict = false): string => {
  const operator = kind === 'minimum' ? (strict ? '>' : '>=') : strict ? '<' : '<='
  return `(${valueExpr} ${operator} ${bound})`
}

/**
 * Boolean expression that is TRUE when `valueExpr` VIOLATES the bound (the error
 * condition) — the negated pass condition, which is the whole point of this
 * module. See the file comment for why the direct spelling is wrong.
 */
export const boundFailExpr = (valueExpr: string, kind: BoundKind, bound: number, strict = false): string =>
  `!${boundPassExpr(valueExpr, kind, bound, strict)}`

/**
 * The relational operator a bound's *message* names (`must be >= 5`), kept here
 * so the message and the check it describes cannot drift apart.
 */
export const boundOperator = (kind: BoundKind, strict = false): string =>
  kind === 'minimum' ? (strict ? '>' : '>=') : strict ? '<' : '<='
