/**
 * The runtime the coercing and matching halves of generated code call: scalar
 * coercion, structural equality, uniqueness, pointer escaping.
 *
 * The validator engine ships these inside its emitted `validation-result.ts`,
 * which a parser build does not have. A coercing parser that agrees with
 * `coerceX` has to coerce, and judge, exactly as `coerceX` does, so it imports
 * the very same functions from here. They are kept byte-identical to the
 * emitted copies — `coercion-runtime.test.ts` in `@amritk/validation` fails
 * the moment the two differ — because two implementations of "is this a
 * number" are two answers waiting to disagree.
 */

/**
 * A string this will read as a number: an optional sign, digits with an optional
 * fractional part, an optional exponent. Nothing else.
 *
 * Deliberately narrower than what `Number()` accepts, which is where Ajv gets
 * its surprises — `Number(" ")` is `0`, `Number("0x10")` is `16` and
 * `Number("Infinity")` is a value JSON cannot even represent. A config that says
 * `retries: " "` has a mistake in it, and answering `0` is the one thing worse
 * than rejecting it. Leading zeros (`"007"`) and exponents (`"1e3"`) stay: both
 * are ordinary ways to write a number in a YAML file, and neither is ambiguous.
 */
const isNumericString = (text: string): boolean => {
  // `/^[+-]?(?:\d+|\d*\.\d+)(?:[eE][+-]?\d+)?$/`, walked by hand. The regex
  // cost more than the rest of a number coercion put together — a string past
  // its end reads `NaN` from `charCodeAt`, which fails every test below, so
  // the scan needs no bounds checks of its own.
  let i = 0
  let c = text.charCodeAt(0)
  if (c === 43 || c === 45) c = text.charCodeAt(++i)
  let digits = 0
  while (c >= 48 && c <= 57) {
    digits++
    c = text.charCodeAt(++i)
  }
  if (c === 46) {
    c = text.charCodeAt(++i)
    let fraction = 0
    while (c >= 48 && c <= 57) {
      fraction++
      c = text.charCodeAt(++i)
    }
    if (fraction === 0) return false
  } else if (digits === 0) return false
  if (c === 101 || c === 69) {
    c = text.charCodeAt(++i)
    if (c === 43 || c === 45) c = text.charCodeAt(++i)
    let exponent = 0
    while (c >= 48 && c <= 57) {
      exponent++
      c = text.charCodeAt(++i)
    }
    if (exponent === 0) return false
  }
  return i === text.length
}

/**
 * One scalar, coerced toward `type`, or returned untouched when that is not
 * possible.
 *
 * Returning the original on failure is what keeps the error honest: nothing is
 * substituted, so the validator that runs next rejects the value the caller
 * actually wrote, with the keyword and params that rejected it. That is the
 * difference between this and a parser's repair, which repairs toward a default
 * and leaves nothing to report.
 *
 * The table is Ajv's `coerceTypes` minus the cells where Ajv guesses. Every
 * value this coerces, Ajv coerces to the same value — `coerced-vs-ajv` pins that
 * as a property, so moving off Ajv never changes a value, it only turns some of
 * Ajv's silent repairs into errors. What is deliberately *not* coerced:
 *
 *  - **Anything to or from `null`.** Ajv reads `null` as `""`, `0` and
 *    `false`, and reads `""`, `0` and `false` back as `null`. `null` is a
 *    JSON value in its own right and usually means "not set"; turning it into an
 *    empty string, or an empty string into it, loses the distinction the document
 *    drew.
 *  - **Strings that are not cleanly numeric** ({@link isNumericString}) — no
 *    whitespace padding, no `0x`/`0o`/`0b`, no `Infinity`, no trailing `.`.
 */
export const coerceScalar = (value: unknown, type: string): unknown => {
  switch (type) {
    case 'string':
      return typeof value === 'number' || typeof value === 'boolean' ? String(value) : value
    case 'number':
    case 'integer': {
      if (typeof value === 'boolean') return value ? 1 : 0
      if (typeof value !== 'string' || !isNumericString(value)) return value
      const asNumber = Number(value)
      if (!Number.isFinite(asNumber)) return value
      return type === 'integer' && asNumber % 1 !== 0 ? value : asNumber
    }
    case 'boolean':
      if (value === 'true' || value === 1) return true
      if (value === 'false' || value === 0) return false
      return value
    default:
      return value
  }
}

/**
 * One scalar at a position that offers several types — a `type` array, or a
 * union of scalar branches — coerced only when every type that can take it
 * agrees on the result.
 *
 * A value whose type is already one of the offered types is left alone: it is
 * what the schema asked for, and the question of coercion does not arise. That
 * one rule is where this parts company with Ajv, which walks its own coercion
 * list in order and so turns `"1"` into `1` under `["number", "string"]` while
 * leaving it a string under `["string", "number"]`. The answer should not depend
 * on the order someone wrote the union in.
 *
 * Otherwise every offered type is tried, and the coercion is taken only if the
 * types that succeed all agree on it. `true` against `number | string` could be
 * `1` or `"true"` with equal justification, so it stays `true` and the
 * validator says what is wrong with it. `"1"` against `number | integer` is `1`
 * either way, so it is `1`.
 */
export const coerceUnion = (value: unknown, types: readonly string[]): unknown => {
  const actual = value === null ? 'null' : typeof value
  for (const type of types) {
    // `integer` is satisfied by a number, so a non-integral number is not a
    // *type* mismatch here — the validator is what holds it to being whole.
    if (actual === type || (actual === 'number' && type === 'integer')) return value
  }

  let coerced: unknown = value
  for (const type of types) {
    const candidate = coerceScalar(value, type)
    if (candidate === value) continue
    if (coerced === value) coerced = candidate
    else if (candidate !== coerced) return value
  }
  return coerced
}

/**
 * How deep a structural comparison walks before it gives up and answers "not
 * equal".
 *
 * JSON data is acyclic, but a generated validator is a plain function applied to
 * whatever in-memory value a caller hands it — and a self-referential object
 * reaching a `const` / `enum` / `uniqueItems` check used to recurse until the
 * stack overflowed, so `validateFoo` threw a `RangeError` instead of returning
 * the `ValidationResult` its signature promises. The cap turns that into an
 * ordinary "these are different" without ever coming near real data;
 * `@amritk/runtime-validators` guards its own `deepEqual` at the same depth.
 */
const MAX_EQUAL_DEPTH = 512

/**
 * Structural deep equality used by generated `const` checks. Objects compare by
 * their key sets rather than serialization, so `{ a: 1, b: 2 }` and
 * `{ b: 2, a: 1 }` are equal — unlike `JSON.stringify`, which is key-order
 * sensitive and would reject a reordered-but-equal value.
 */
export const valuesEqual = (a: unknown, b: unknown, depth = 0): boolean => {
  // SameValueZero: `===` settles every primitive except `NaN`, which counts as
  // equal to itself here. That is what the native `Set` in {@link allUnique} does,
  // what Ajv does, and what the interpreter's `deepEqual` does — leaving it out
  // made a `NaN` nested inside an object compare unequal to itself, so the same
  // array was "unique" here and "duplicated" everywhere else.
  if (a === b || (Number.isNaN(a) && Number.isNaN(b))) return true
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false
  if (depth >= MAX_EQUAL_DEPTH) return false
  const aArray = Array.isArray(a)
  const bArray = Array.isArray(b)
  if (aArray !== bArray) return false
  if (aArray) {
    const aa = a as unknown[]
    const bb = b as unknown[]
    if (aa.length !== bb.length) return false
    for (let i = 0; i < aa.length; i++) if (!valuesEqual(aa[i], bb[i], depth + 1)) return false
    return true
  }
  const ao = a as Record<string, unknown>
  const bo = b as Record<string, unknown>
  const keys = Object.keys(ao)
  if (keys.length !== Object.keys(bo).length) return false
  for (const key of keys) {
    if (!Object.hasOwn(bo, key) || !valuesEqual(ao[key], bo[key], depth + 1)) return false
  }
  return true
}

/**
 * A cheap, order-independent structural hash consistent with {@link valuesEqual}:
 * equal values always hash the same. It buckets candidate-equal elements in
 * {@link allUnique} so the exact comparison only ever runs inside a bucket.
 *
 * Object keys are folded commutatively (XOR) so key order does not change the
 * hash, and `NaN` / `-0` collapse the way SameValueZero does. Depth-capped like
 * {@link valuesEqual}: an over-deep value simply shares a bucket and is settled by
 * the (also capped) comparison, so the cap can cost a little time and never a
 * wrong answer. This is the same hash `@amritk/runtime-validators` uses.
 */
const structuralHash = (value: unknown, depth = 0): number => {
  if (value === null) return 0x1a2b3c
  const t = typeof value
  if (t === 'number') {
    const n = value as number
    return Number.isNaN(n) ? 0x7ff8 : n === 0 ? 0 : Math.trunc(n * 2654435761) | 0
  }
  if (t === 'string') {
    const s = value as string
    let h = 0x811c9dc5
    for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193)
    return h | 0
  }
  if (t === 'boolean') return value ? 1 : 2
  if (t !== 'object') return 0x5eed
  if (depth >= MAX_EQUAL_DEPTH) return 0xdee9
  if (Array.isArray(value)) {
    let h = 0x12345 ^ value.length
    for (let i = 0; i < value.length; i++) h = (Math.imul(h, 31) + structuralHash(value[i], depth + 1)) | 0
    return h | 0
  }
  const obj = value as Record<string, unknown>
  const keys = Object.keys(obj)
  let h = 0xabcde ^ keys.length
  for (const k of keys) {
    let kh = 0x811c9dc5
    for (let i = 0; i < k.length; i++) kh = Math.imul(kh ^ k.charCodeAt(i), 0x01000193)
    h = (h ^ (Math.imul(kh, 0x9e3779b1) + structuralHash(obj[k], depth + 1))) | 0
  }
  return h | 0
}

/**
 * True when every element of `arr` is distinct under structural equality
 * ({@link valuesEqual}). Backs generated `uniqueItems` checks whose items may be
 * objects or arrays, where a `JSON.stringify` dedupe key would be key-order
 * sensitive and let a reordered-but-equal duplicate (`{ a: 1, b: 2 }` vs
 * `{ b: 2, a: 1 }`) slip through.
 *
 * A native `Set` dedupes the all-primitive case in one linear pass. Object and
 * array elements are bucketed by {@link structuralHash} first, so the exact
 * comparison runs only against elements that could actually be equal: an array of
 * distinct objects costs ~O(n) instead of the O(n²) an exhaustive pairwise sweep
 * charged — 4 000 rows took over half a second of pure comparison before, which
 * is a lot to hand an unauthenticated caller.
 */
export const allUnique = (arr: readonly unknown[]): boolean => {
  const len = arr.length
  if (len < 2) return true
  let allPrimitive = true
  for (let i = 0; i < len; i++) {
    const v = arr[i]
    if (v !== null && typeof v === 'object') {
      allPrimitive = false
      break
    }
  }
  if (allPrimitive) return new Set(arr).size === len
  const buckets = new Map<number, unknown[]>()
  for (let i = 0; i < len; i++) {
    const item = arr[i]
    const hash = structuralHash(item)
    const bucket = buckets.get(hash)
    if (bucket === undefined) {
      buckets.set(hash, [item])
      continue
    }
    for (const seen of bucket) if (valuesEqual(seen, item)) return false
    bucket.push(item)
  }
  return true
}

/**
 * True when `test` holds for every element of `arr`, holes included. Backs the
 * item check inside a generated boolean guard.
 *
 * Not `Array.prototype.every`, because that *skips holes* in a sparse array
 * (`[, 'x']`), whereas the validator's index-based loop reads a hole as
 * `undefined` and rejects it — and the guard must never accept what the validator
 * rejects. The guard used to get that by materialising `Array.from(arr)` first,
 * which copied every array it looked at; an index loop reads a hole the same way
 * and copies nothing.
 */
export const everyItem = (arr: readonly unknown[], test: (item: unknown) => boolean): boolean => {
  for (let i = 0; i < arr.length; i++) if (!test(arr[i])) return false
  return true
}

/**
 * Escapes one JSON Pointer segment (RFC 6901): `~` → `~0`, `/` → `~1`, in that
 * order. Generated error paths are built from *runtime* keys wherever the schema
 * did not name them — a `patternProperties` match, an `additionalProperties`
 * sweep, a `propertyNames` loop — and a key containing a `/` would otherwise read
 * back as two segments, so an error on `{"a/b": …}` pointed at `/a/b`, which is
 * the child `b` of a property `a`. Keys the schema *does* name are escaped at
 * generation time instead, and `@amritk/runtime-validators` escapes the same way,
 * so all three agree.
 *
 * The `indexOf` pre-test keeps the common key — no `/`, no `~` — off the replace
 * path entirely, which is what the interpreter does for the same reason.
 */
export const escapePointer = (key: string): string =>
  key.indexOf('/') !== -1 || key.indexOf('~') !== -1 ? key.replace(/~/g, '~0').replace(/\//g, '~1') : key
