import { generateIndexBarrel } from '@amritk/helpers/generate-index-barrel'
import { DEFAULT_UNKNOWN_KEYS, type UnknownKeysStrategy } from '@amritk/helpers/unknown-keys-strategy'
import { walkRefGraph } from '@amritk/helpers/walk-ref-graph'
import type { JSONSchema } from 'json-schema-typed/draft-2020-12'

import { emitFormatModule, FORMAT_FRAGMENTS, formatCheckName } from './emit-format-checks'
import { generateValidatorFile } from './generate-files'

/**
 * Represents a generated TypeScript file with its filename and content.
 */
export type GeneratedFile = {
  filename: string
  content: string
}

/**
 * The runtime contract every generated validator imports: the `ValidationResult`
 * types plus the helpers emitted code calls as free identifiers. Exported so tests
 * can evaluate the very source that ships instead of reimplementing it.
 */
export const VALIDATION_RESULT_CONTENT = `/**
 * A single validation error: what went wrong, where, and which keyword said so.
 *
 * The shape matches \`@amritk/runtime-validators\`, so an error from a generated
 * validator and one from the runtime interpreter can be handled by the same
 * code — grouped, translated, or branched on — without knowing which produced it.
 */
export type ValidationError = {
  /** Human-readable description of what went wrong. */
  message: string
  /** JSON Pointer to the offending value inside the instance. */
  path: string
  /** The JSON Schema keyword that rejected the value — \`type\`, \`required\`, \`minimum\`, … */
  keyword: string
  /**
   * The keyword's own values, as far as they explain the failure: the bound that
   * was exceeded, the property that was missing, the allowed values that were not
   * matched. Empty for a keyword with nothing to add beyond its name.
   */
  params: Record<string, unknown>
}

/**
 * The result of a generated validator function.
 * Returns \`true\` when the input is valid, or an object with \`valid: false\`
 * and a list of errors when it is not.
 */
export type ValidationResult = true | { valid: false; errors: ValidationError[] }

/**
 * The result of a generated coercing validator.
 *
 * Unlike \`ValidationResult\` there is no bare \`true\`: a caller that coerces wants
 * the value back, and the whole point is that it may differ from what went in.
 * The input is never modified — \`value\` is the input itself when nothing needed
 * coercing, and otherwise a copy that shares everything the coercion did not
 * touch. So a caller does not have to clone defensively the way an in-place
 * coercer forces them to.
 */
export type CoercionResult<T> = { valid: true; value: T } | { valid: false; errors: ValidationError[] }

/**
 * A string this will read as a number: an optional sign, digits with an optional
 * fractional part, an optional exponent. Nothing else.
 *
 * Deliberately narrower than what \`Number()\` accepts, which is where Ajv gets
 * its surprises — \`Number(" ")\` is \`0\`, \`Number("0x10")\` is \`16\` and
 * \`Number("Infinity")\` is a value JSON cannot even represent. A config that says
 * \`retries: " "\` has a mistake in it, and answering \`0\` is the one thing worse
 * than rejecting it. Leading zeros (\`"007"\`) and exponents (\`"1e3"\`) stay: both
 * are ordinary ways to write a number in a YAML file, and neither is ambiguous.
 */
const isNumericString = (text: string): boolean => {
  // \`/^[+-]?(?:\\d+|\\d*\\.\\d+)(?:[eE][+-]?\\d+)?$/\`, walked by hand. The regex
  // cost more than the rest of a number coercion put together — a string past
  // its end reads \`NaN\` from \`charCodeAt\`, which fails every test below, so
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
 * One scalar, coerced toward \`type\`, or returned untouched when that is not
 * possible.
 *
 * Returning the original on failure is what keeps the error honest: nothing is
 * substituted, so the validator that runs next rejects the value the caller
 * actually wrote, with the keyword and params that rejected it. That is the
 * difference between this and a parser's repair, which repairs toward a default
 * and leaves nothing to report.
 *
 * The table is Ajv's \`coerceTypes\` minus the cells where Ajv guesses. Every
 * value this coerces, Ajv coerces to the same value — \`coerced-vs-ajv\` pins that
 * as a property, so moving off Ajv never changes a value, it only turns some of
 * Ajv's silent repairs into errors. What is deliberately *not* coerced:
 *
 *  - **Anything to or from \`null\`.** Ajv reads \`null\` as \`""\`, \`0\` and
 *    \`false\`, and reads \`""\`, \`0\` and \`false\` back as \`null\`. \`null\` is a
 *    JSON value in its own right and usually means "not set"; turning it into an
 *    empty string, or an empty string into it, loses the distinction the document
 *    drew.
 *  - **Strings that are not cleanly numeric** ({@link isNumericString}) — no
 *    whitespace padding, no \`0x\`/\`0o\`/\`0b\`, no \`Infinity\`, no trailing \`.\`.
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
 * One scalar at a position that offers several types — a \`type\` array, or a
 * union of scalar branches — coerced only when every type that can take it
 * agrees on the result.
 *
 * A value whose type is already one of the offered types is left alone: it is
 * what the schema asked for, and the question of coercion does not arise. That
 * one rule is where this parts company with Ajv, which walks its own coercion
 * list in order and so turns \`"1"\` into \`1\` under \`["number", "string"]\` while
 * leaving it a string under \`["string", "number"]\`. The answer should not depend
 * on the order someone wrote the union in.
 *
 * Otherwise every offered type is tried, and the coercion is taken only if the
 * types that succeed all agree on it. \`true\` against \`number | string\` could be
 * \`1\` or \`"true"\` with equal justification, so it stays \`true\` and the
 * validator says what is wrong with it. \`"1"\` against \`number | integer\` is \`1\`
 * either way, so it is \`1\`.
 */
export const coerceUnion = (value: unknown, types: readonly string[]): unknown => {
  const actual = value === null ? 'null' : typeof value
  for (const type of types) {
    // \`integer\` is satisfied by a number, so a non-integral number is not a
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
 * reaching a \`const\` / \`enum\` / \`uniqueItems\` check used to recurse until the
 * stack overflowed, so \`validateFoo\` threw a \`RangeError\` instead of returning
 * the \`ValidationResult\` its signature promises. The cap turns that into an
 * ordinary "these are different" without ever coming near real data;
 * \`@amritk/runtime-validators\` guards its own \`deepEqual\` at the same depth.
 */
const MAX_EQUAL_DEPTH = 512

/**
 * Structural deep equality used by generated \`const\` checks. Objects compare by
 * their key sets rather than serialization, so \`{ a: 1, b: 2 }\` and
 * \`{ b: 2, a: 1 }\` are equal — unlike \`JSON.stringify\`, which is key-order
 * sensitive and would reject a reordered-but-equal value.
 */
export const valuesEqual = (a: unknown, b: unknown, depth = 0): boolean => {
  // SameValueZero: \`===\` settles every primitive except \`NaN\`, which counts as
  // equal to itself here. That is what the native \`Set\` in {@link allUnique} does,
  // what Ajv does, and what the interpreter's \`deepEqual\` does — leaving it out
  // made a \`NaN\` nested inside an object compare unequal to itself, so the same
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
 * hash, and \`NaN\` / \`-0\` collapse the way SameValueZero does. Depth-capped like
 * {@link valuesEqual}: an over-deep value simply shares a bucket and is settled by
 * the (also capped) comparison, so the cap can cost a little time and never a
 * wrong answer. This is the same hash \`@amritk/runtime-validators\` uses.
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
 * True when every element of \`arr\` is distinct under structural equality
 * ({@link valuesEqual}). Backs generated \`uniqueItems\` checks whose items may be
 * objects or arrays, where a \`JSON.stringify\` dedupe key would be key-order
 * sensitive and let a reordered-but-equal duplicate (\`{ a: 1, b: 2 }\` vs
 * \`{ b: 2, a: 1 }\`) slip through.
 *
 * A native \`Set\` dedupes the all-primitive case in one linear pass. Object and
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
 * True when \`test\` holds for every element of \`arr\`, holes included. Backs the
 * item check inside a generated boolean guard.
 *
 * Not \`Array.prototype.every\`, because that *skips holes* in a sparse array
 * (\`[, 'x']\`), whereas the validator's index-based loop reads a hole as
 * \`undefined\` and rejects it — and the guard must never accept what the validator
 * rejects. The guard used to get that by materialising \`Array.from(arr)\` first,
 * which copied every array it looked at; an index loop reads a hole the same way
 * and copies nothing.
 */
export const everyItem = (arr: readonly unknown[], test: (item: unknown) => boolean): boolean => {
  for (let i = 0; i < arr.length; i++) if (!test(arr[i])) return false
  return true
}

/**
 * Escapes one JSON Pointer segment (RFC 6901): \`~\` → \`~0\`, \`/\` → \`~1\`, in that
 * order. Generated error paths are built from *runtime* keys wherever the schema
 * did not name them — a \`patternProperties\` match, an \`additionalProperties\`
 * sweep, a \`propertyNames\` loop — and a key containing a \`/\` would otherwise read
 * back as two segments, so an error on \`{"a/b": …}\` pointed at \`/a/b\`, which is
 * the child \`b\` of a property \`a\`. Keys the schema *does* name are escaped at
 * generation time instead, and \`@amritk/runtime-validators\` escapes the same way,
 * so all three agree.
 *
 * The \`indexOf\` pre-test keeps the common key — no \`/\`, no \`~\` — off the replace
 * path entirely, which is what the interpreter does for the same reason.
 */
export const escapePointer = (key: string): string =>
  key.indexOf('/') !== -1 || key.indexOf('~') !== -1 ? key.replace(/~/g, '~0').replace(/\\//g, '~1') : key

/**
 * The errors of the branch that was plainly the one meant, out of every branch a
 * failing \`anyOf\` / \`oneOf\` rejected. Empty when no branch stands out.
 *
 * A failing combinator on its own says almost nothing: "must match a schema in
 * anyOf" names no field and no reason, and on the shape this is most often used
 * for — a union where the value plainly *is* one of the variants and one field of
 * it is wrong — that is the least useful thing a validator can say. The branch
 * errors are computed anyway to answer the yes/no question, so the only question
 * is which of them are worth reporting.
 *
 * Branches that rejected the value's *kind* go first: a branch wanting a string
 * has nothing to say about an object, so a \`string | { … }\` union is left with
 * the one branch that was even talking about this value. When more than one
 * survives they all describe the same kind of value, and the tie is broken the
 * way a discriminated union reads from the outside — if every survivor but one
 * was rejected on the value's *identity* (a \`const\` or \`enum\` on the value or
 * one of its own properties), the remaining one is the variant the author meant.
 *
 * Nothing is reported when no branch stands out, which is as much as can be said
 * honestly: "the branch with the fewest errors" would answer here too, and
 * answers wrongly on \`oneOf: [aReference, theActualThing]\`, where "you did not
 * write a $ref" is one complaint and the real mistake is two.
 *
 * \`path\` is where the combinator was applied, so a segment below it is a direct
 * property of the value being judged. \`@amritk/runtime-validators\` selects the
 * same branch by the same rule, so a generated validator and the interpreter
 * explain a failing union the same way.
 */
export const selectBranchErrors = (
  branches: readonly (readonly ValidationError[])[],
  path: string,
): readonly ValidationError[] => {
  const candidates: (readonly ValidationError[])[] = []
  for (const errors of branches) {
    // The value itself is \`path\`, so a \`type\` error there is a rejected kind.
    if (!errors.some((error) => error.keyword === 'type' && error.path === path)) candidates.push(errors)
  }
  if (candidates.length === 1) return candidates[0] as readonly ValidationError[]

  let selected: readonly ValidationError[] | null = null
  let rejectedOnIdentity = 0
  for (const errors of candidates) {
    // One segment below \`path\` and no deeper: a discriminator is conventionally a
    // direct field, and a \`const\` buried further down is far more likely to be an
    // ordinary payload constraint.
    const identity = errors.some(
      (error) =>
        (error.keyword === 'const' || error.keyword === 'enum') && error.path.indexOf('/', path.length + 1) === -1,
    )
    if (identity) {
      rejectedOnIdentity++
      continue
    }
    // Two branches survive the discriminator, so it did not discriminate.
    if (selected !== null) return []
    selected = errors
  }

  return selected !== null && rejectedOnIdentity === candidates.length - 1 ? selected : []
}

/**
 * The result of a generated repairing validator.
 *
 * \`repairs\` is not a second, parallel account of what went wrong — it *is* the
 * errors \`validateX\` produced, the ones a repair was found for. So a caller that
 * logs a repair logs the same path, keyword and params it would have been
 * rejected with, and the two can never drift apart, because there is only one of
 * them.
 *
 * A document that needed no repair comes back \`valid: true\` with an empty
 * \`repairs\`, which is exactly what \`coerceX\` would have returned. One that was
 * fully repaired is \`valid: true\` with a non-empty \`repairs\` — the caller
 * decides whether that is acceptable by looking, rather than by being told. One
 * that could not be fully repaired is \`valid: false\` and carries both: the
 * repairs that were applied, and the \`errors\` still outstanding against the
 * value handed back.
 */
export type RepairResult<T> =
  | { valid: true; value: T; repairs: ValidationError[] }
  | { valid: false; value: unknown; errors: ValidationError[]; repairs: ValidationError[] }

/**
 * Looks up the repaired value for one position, given that position's JSON
 * Pointer split into segments. Returns a thunk rather than a value so each
 * repair gets its own object — a shared literal would alias every site that
 * repaired to it — and \`null\` where the schema offers nothing to repair toward.
 */
export type RepairLookup = (segments: readonly string[]) => (() => unknown) | null

/**
 * How many validate-and-repair rounds \`repairX\` will run. Repairing a child can
 * expose a parent that only became checkable once the child was there, so one
 * round is not always enough; but each round is bounded further by the rule that
 * a position is repaired at most once, so this is a backstop rather than the
 * thing doing the terminating.
 */
export const MAX_REPAIR_PASSES = 8

/**
 * Splits a JSON Pointer into its segments, undoing the escaping
 * {@link escapePointer} applied. The root pointer (\`''\`) is zero segments.
 */
export const pointerSegments = (path: string): string[] =>
  path === ''
    ? []
    : path
        .slice(1)
        .split('/')
        .map((segment) =>
          segment.indexOf('~') === -1 ? segment : segment.replace(/~1/g, '/').replace(/~0/g, '~'),
        )

/**
 * Returns \`root\` with the position at \`segments\` replaced by \`value\`, copying
 * only the containers along the way.
 *
 * Copying rather than writing is not politeness, it is the same promise
 * \`coerceX\` makes: the caller's input is never modified, so a repaired document
 * can be compared against what was actually sent. Everything the path did not
 * touch is shared, so repairing one field of a large document does not clone it.
 *
 * Returns \`root\` unchanged when the path does not lead anywhere — a segment into
 * a missing or non-container parent. That is not a failure to handle here: the
 * parent has an error of its own, and repairing *it* is what makes this position
 * reachable on a later pass.
 */
export const repairAt = (root: unknown, segments: readonly string[], value: unknown): unknown => {
  if (segments.length === 0) return value
  const [head, ...rest] = segments as [string, ...string[]]

  if (Array.isArray(root)) {
    const index = Number(head)
    // \`index === root.length\` is an append, which is what padding a short array
    // to its \`minItems\` is made of. Anything past that would leave a hole, and a
    // hole is not a repair.
    if (!Number.isInteger(index) || index < 0 || index > root.length) return root
    const next = repairAt(root[index], rest, value)
    if (next === root[index]) return root
    const copy = [...root]
    copy[index] = next
    return copy
  }

  if (typeof root !== 'object' || root === null) return root
  const obj = root as Record<string, unknown>
  // A missing key is reachable only when this is the last segment: that is the
  // \`required\` repair, which is putting the key there. Deeper than that and the
  // parent is the thing that needs repairing first.
  if (!Object.hasOwn(obj, head) && rest.length > 0) return root
  const next = repairAt(obj[head], rest, value)
  if (next === obj[head] && Object.hasOwn(obj, head)) return root
  return { ...obj, [head]: next }
}

/**
 * The position one error is asking to have repaired, or \`null\` when the error is
 * not about a position a value can be put at.
 *
 * One keyword does not point at the value that is wrong: a \`required\` error is
 * reported against the *object* that is missing the key, and names the key in
 * \`params.missingProperty\`, so the position to fill is one segment deeper.
 * \`minItems\` is the other exception and is handled separately, because it is
 * satisfied by adding several values rather than by replacing one.
 */
const repairTarget = (error: ValidationError): readonly string[] | null => {
  const segments = pointerSegments(error.path)
  if (error.keyword === 'required') {
    const missing = error.params['missingProperty']
    return typeof missing === 'string' ? [...segments, missing] : null
  }
  return segments
}

/** The value at a pointer, or \`undefined\` when the path does not lead anywhere. */
const valueAt = (root: unknown, segments: readonly string[]): unknown =>
  segments.reduce<unknown>(
    (node, segment) =>
      Array.isArray(node)
        ? node[Number(segment)]
        : typeof node === 'object' && node !== null
          ? (node as Record<string, unknown>)[segment]
          : undefined,
    root,
  )

/**
 * Grows a short array to the length \`minItems\` asks for, or \`null\` when it
 * cannot.
 *
 * Padding is its own operation rather than a position repair because one
 * \`minItems\` error is satisfied by *several* values, not one. Doing it a single
 * element per round would work, but it would spend a round per element and a
 * \`minItems: 50\` would run out of them; filling the shortfall at once keeps the
 * number of rounds a question about the shape of the document rather than about
 * the size of its arrays.
 *
 * Every added element is a separate call to the thunk, so no two share an object.
 */
const padToMinItems = (
  root: unknown,
  error: ValidationError,
  lookup: RepairLookup,
  done: Set<string>,
): unknown => {
  const segments = pointerSegments(error.path)
  const array = valueAt(root, segments)
  const limit = error.params['limit']
  if (!Array.isArray(array) || typeof limit !== 'number' || array.length >= limit) return null

  // Keyed apart from a position repair at the same path: replacing the whole
  // array and padding it are different repairs, and having done one is no reason
  // to refuse the other.
  const key = \`\${segments.join('/')}#minItems\`
  if (done.has(key)) return null

  const element = lookup([...segments, String(array.length)])
  if (element === null) return null

  const padded = [...array]
  while (padded.length < limit) padded.push(element())
  const updated = repairAt(root, segments, padded)
  if (updated === root) return null
  done.add(key)
  return updated
}

/**
 * Applies one round of repairs: every error the schema offers a value for is
 * repaired, and the rest are handed back untouched.
 *
 * \`done\` carries the positions already repaired on an earlier round. A position
 * that failed again after being repaired is not repaired a second time — the
 * value the schema offered did not satisfy the schema, which is a fact about the
 * schema, and trying again would only produce the same value. Refusing keeps the
 * loop finite without relying on the pass cap, and turns the position into an
 * honest error instead of a silent spin.
 */
export const applyRepairs = (
  value: unknown,
  errors: readonly ValidationError[],
  lookup: RepairLookup,
  done: Set<string>,
): { value: unknown; repaired: ValidationError[] } => {
  const repaired: ValidationError[] = []
  let next = value

  for (const error of errors) {
    if (error.keyword === 'minItems') {
      const padded = padToMinItems(next, error, lookup, done)
      if (padded === null) continue
      next = padded
      repaired.push(error)
      continue
    }

    const target = repairTarget(error)
    if (target === null) continue
    const key = target.join('/')
    if (done.has(key)) continue
    const to = lookup(target)
    if (to === null) continue

    const updated = repairAt(next, target, to())
    // An unreachable position leaves the document exactly as it was. Not counting
    // it as repaired is what lets the parent's own error be the thing that
    // reports, rather than this silently claiming a fix that did not land.
    if (updated === next) continue
    done.add(key)
    next = updated
    repaired.push(error)
  }

  return { value: next, repaired }
}
`

/**
 * The type names {@link VALIDATION_RESULT_CONTENT} exports, which every generated
 * file imports. A definition that generates one of them would be imported twice
 * under one name, so generation refuses rather than emit a file that cannot load.
 */
const RESERVED_TYPE_NAMES = new Set(['ValidationResult', 'ValidationError'])

/** A name TypeScript will accept after `export type`. */
const TYPE_NAME = /^[\p{ID_Start}_$][\p{ID_Continue}$]*$/u

/**
 * The words TypeScript will not accept as a type name. `refToName` cannot produce
 * one — it PascalCases, and every reserved word is lower case — so this is really
 * about the root type name and the type suffix, which are passed in verbatim.
 */
const RESERVED_WORDS = new Set([
  'await',
  'break',
  'case',
  'catch',
  'class',
  'const',
  'continue',
  'debugger',
  'default',
  'delete',
  'do',
  'else',
  'enum',
  'export',
  'extends',
  'false',
  'finally',
  'for',
  'function',
  'if',
  'import',
  'in',
  'instanceof',
  'new',
  'null',
  'return',
  'super',
  'switch',
  'this',
  'throw',
  'true',
  'try',
  'typeof',
  'var',
  'void',
  'while',
  'with',
  'yield',
])

/**
 * Builds all TypeScript validator files from a JSON Schema by traversing all
 * `$ref` / `$dynamicRef` references recursively (via the shared
 * `@amritk/helpers/walk-ref-graph` walker).
 *
 * Each generated file exports:
 * - A TypeScript type definition
 * - A `validateFoo(input: unknown, _path?: string): ValidationResult` function
 * - A `checkFoo(input: unknown, _path?: string): ValidationResult` function, when
 *   `check` is on — the same result type, stopped at the first violation
 *
 * A `validation-result.ts` file containing the `ValidationResult` and `ValidationError`
 * runtime contract is always emitted. An `index.ts` re-exports everything.
 *
 * @param rootSchema - The root JSON Schema to build from
 * @param rootTypeName - The name for the root type (e.g. "Document")
 * @param typeSuffix - Suffix appended to every type name derived from a `$ref`
 *   (e.g. `'Object'` → `ContactObject`). Defaults to `''`. The root type name is
 *   used verbatim and is not affected.
 * @param schemas - Other schema documents you have **already loaded**, keyed by
 *   the absolute URI a `$ref` names them by. Supplying them makes those URIs
 *   resolvable, so the schema can reference a document that is not itself — each
 *   one becomes a resource of the generated document, with its own `$id`,
 *   anchors and nested resources all resolvable. Nothing is fetched here:
 *   loading is yours to do (or `@amritk/resolve-refs`'), and a `$ref` to a URI
 *   nobody registered still stops generation. Only the documents actually
 *   referenced get files.
 * @param unknownKeys - How the generated fast paths prove a closed object
 *   (`additionalProperties: false`) carries no undeclared key: `'count-keys'`
 *   (the default) compares `Object.keys(obj).length`, `'count-enumerable'`
 *   counts with `for…in`. The first is the faster form on JavaScriptCore (Bun),
 *   the second on V8 (Node) — see the README for the measurements.
 * @returns An array of generated TypeScript files
 *
 * @example
 * ```typescript
 * const files = await buildValidatorSchema(schema, 'Document')
 * // files → [{ filename: 'document.ts', content: '...' }, { filename: 'info.ts', ... }, ...]
 *
 * // Referencing a document you loaded yourself:
 * const withRemote = await buildValidatorSchema({ $ref: 'https://example.com/user.json' }, 'Document', '', {
 *   'https://example.com/user.json': userSchema,
 * })
 * ```
 */
export const buildValidatorSchema = async (
  rootSchema: JSONSchema,
  rootTypeName: string,
  typeSuffix = '',
  schemas?: Readonly<Record<string, unknown>>,
  unknownKeys: UnknownKeysStrategy = DEFAULT_UNKNOWN_KEYS,
  formats?: 'all' | readonly string[],
  coerce = false,
  branchErrors = false,
  repair = false,
  importExt: 'js' | 'ts' = 'js',
  check = false,
): Promise<GeneratedFile[]> => {
  // Resolved once: which names are enforced decides both what the emitters check
  // and what `formats.ts` has to define.
  const enforced: ReadonlySet<string> =
    formats === 'all'
      ? new Set(Object.keys(FORMAT_FRAGMENTS))
      : new Set((formats ?? []).filter((name) => Object.hasOwn(FORMAT_FRAGMENTS, name)))
  const files: GeneratedFile[] = []

  walkRefGraph(rootSchema, rootTypeName, { typeSuffix, ...(schemas !== undefined ? { schemas } : {}) }, (node) => {
    // `validation-result` and `index` are reserved output filenames. Skipping a
    // definition that wants one of them looked safe and was not: nothing stopped
    // the *importers* from being generated, so a `$defs.index` produced a
    // `root.ts` importing `validateIndex` from the barrel — a `TS2305` at build
    // time and a `SyntaxError` at runtime. Refusing here is what
    // `walkRefGraph` already does for two definitions that want one filename;
    // renaming has to be the caller's call, since the name is what every emitted
    // import is keyed on.
    if (node.filename === 'validation-result' || node.filename === 'index') {
      const owner = node.isRoot ? `the root type "${node.typeName}"` : `"${node.ref}"`
      const purpose = node.filename === 'index' ? 'the generated barrel' : "the generated validators' runtime contract"
      throw new Error(
        `${owner} generates the file "${node.filename}.ts", which is reserved for ${purpose}. Rename the ` +
          'definition (or pass a different root type name) so it gets a file of its own.',
      )
    }

    // A name that is not an identifier is not a name TypeScript will take. The
    // root type name and the type suffix arrive verbatim from the caller, so
    // `buildValidatorSchema(schema, 'my-doc')` used to emit `export type my-doc =
    // …` — output that does not parse, discovered in the consumer's build with
    // nothing to say about where it came from. `refToName` normalises a ref into
    // an identifier by itself; a suffix stuck on the end of one can still break it.
    if (!TYPE_NAME.test(node.typeName) || RESERVED_WORDS.has(node.typeName)) {
      const owner = node.isRoot ? 'the root type name' : `the name "${node.ref}" derives`
      const suffixNote = typeSuffix === '' ? '' : ` (with the type suffix "${typeSuffix}")`
      throw new Error(
        `${owner}${suffixNote}, "${node.typeName}", is not a TypeScript type name, so the generated file would ` +
          'not parse. Pass a name that is a plain identifier — letters, digits, "_" and "$", not starting with a ' +
          'digit, and not a reserved word.',
      )
    }

    // The same collision one level down, in the *names* rather than the files.
    // Every generated file opens with `import type { ValidationResult,
    // ValidationError } from './validation-result.js'`, so a definition whose type
    // name is one of those puts the name in the file twice — once imported, once
    // imported from its own module — which is a `TS2300` and, under Node ESM, a
    // duplicate binding the module never loads past. `ValidationResult` was caught
    // by the filename rule above only because its kebab form happens to be the
    // reserved file; `ValidationError` (or anything else that PascalCases onto
    // one, like a `$defs.validation_error`) went straight through and emitted a
    // file that does not compile. The type name is what the emitted code says, so
    // it is what to ask about — and a `typeSuffix` that moves it clear (a
    // `ValidationErrorObject`) is no collision at all.
    if (RESERVED_TYPE_NAMES.has(node.typeName)) {
      const owner = node.isRoot ? `the root type name "${node.typeName}"` : `"${node.ref}"`
      throw new Error(
        `${owner} generates the type "${node.typeName}", which every generated file already imports from ` +
          '"validation-result.ts". Rename the definition (or pass a different root type name or type suffix) so ' +
          'the two names do not collide.',
      )
    }

    const content = generateValidatorFile(node.schema, node.typeName, {
      rootSchema: node.rootSchema,
      typeSuffix,
      unknownKeys,
      formats: enforced,
      check,
      coerce,
      branchErrors,
      repair,
      importExt,
      ...(node.ref !== undefined ? { selfRef: node.ref } : {}),
    })
    files.push({ filename: `${node.filename}.ts`, content })
  })

  // Emit the runtime contract for validators. ValidationResult is mjst-defined
  // (not derived from the input schema), so its content is fixed.
  files.push({ filename: 'validation-result.ts', content: VALIDATION_RESULT_CONTENT })

  // The `format` checks, and only the ones some emitted file actually calls — a
  // schema declaring one `uuid` gets one regex rather than the whole table. Asked
  // of the emitted text for the same reason the per-file imports are.
  const called = [...enforced].filter((format) =>
    files.some((file) => file.content.includes(`${formatCheckName(format)}(`)),
  )
  const formatModule = emitFormatModule(called)
  if (formatModule !== '') files.push({ filename: 'formats.ts', content: formatModule })

  files.push({ filename: 'index.ts', content: generateIndexBarrel(files, { importExt }) })

  return files
}
