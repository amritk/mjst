import { safeAccessor } from '@amritk/helpers/safe-accessor'

/**
 * Builds a boolean expression that is TRUE when `accessor` is structurally equal
 * to `value` — a literal known at generation time (an `enum` member, a `const`).
 *
 * Why not `===` / `.includes` / `JSON.stringify`, the three forms this replaced:
 *
 * - `.includes(x)` is SameValueZero, i.e. *reference* equality for objects and
 *   arrays. `{ enum: [{ a: 1 }] }` could therefore never match a freshly parsed
 *   `{ a: 1 }`, so the strict parser threw on a document Ajv accepts and the fast
 *   path never fired.
 * - `JSON.stringify(x) !== '{"a":1,"b":2}'` is key-order sensitive, so a
 *   reordered-but-equal `{ b: 2, a: 1 }` was rejected — and it serialized the
 *   whole value on every call just to answer a yes/no question.
 *
 * Because the literal is known up front the comparison is unrolled into a flat
 * chain of `typeof` / `===` tests against its shape: no serialization, no
 * allocation, and key order cannot matter because keys are compared by name. The
 * `Object.keys(...).length === n` term is what makes it an equality rather than a
 * "has at least these fields" check.
 *
 * @param accessor - Expression yielding the runtime value (may be `unknown`).
 * @param value - The literal to compare against.
 */
export const generateDeepEqualCheck = (accessor: string, value: unknown): string => {
  if (value === null || typeof value !== 'object') {
    // `NaN` cannot appear in a JSON document but can be hand-authored into a
    // schema; `===` is false for it, so ask the only question that is not.
    if (typeof value === 'number' && Number.isNaN(value)) return `Number.isNaN(${accessor})`
    return `${accessor} === ${JSON.stringify(value)}`
  }

  if (Array.isArray(value)) {
    const elements = `(${accessor} as unknown[])`
    const parts = [`Array.isArray(${accessor})`, `${elements}.length === ${value.length}`]
    for (let i = 0; i < value.length; i++) {
      parts.push(generateDeepEqualCheck(`${elements}[${i}]`, value[i]))
    }
    return parts.join(' && ')
  }

  const entries = Object.entries(value as Record<string, unknown>)
  const record = `(${accessor} as Record<string, unknown>)`
  const parts = [
    `typeof ${accessor} === "object"`,
    `${accessor} !== null`,
    `!Array.isArray(${accessor})`,
    // Pins the key count, so an object carrying extra keys is not "equal" to one
    // that only has the declared ones. Combined with the per-key value checks
    // below (an absent key reads as `undefined`, which no JSON literal equals)
    // this is exact structural equality.
    `Object.keys(${accessor} as object).length === ${entries.length}`,
  ]
  for (const [key, sub] of entries) {
    parts.push(generateDeepEqualCheck(safeAccessor(record, key), sub))
  }
  return parts.join(' && ')
}
