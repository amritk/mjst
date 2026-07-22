/**
 * Resource limits that keep a single validation from turning into a
 * denial-of-service. The interpreter walks arbitrary (and possibly untrusted)
 * schemas over arbitrary (and possibly untrusted) data, so three unbounded
 * costs need a ceiling:
 *
 *  - **Recursion depth** — deeply nested data against a recursive schema
 *    (`{ items: { $ref: '#' } }`) recurses per level and would otherwise hit the
 *    native stack limit as an uncatchable `RangeError`. {@link ValidateLimits.maxDepth}.
 *  - **Total work** — nested `anyOf`/`oneOf` re-evaluate every branch against the
 *    same value, so an attacker-shaped schema can cost `2^depth` evaluations from
 *    a few kilobytes; a large `uniqueItems` array is quadratic. A single step
 *    budget bounds both. {@link ValidateLimits.maxSteps}.
 *  - **Regex backtracking (ReDoS)** — a schema `pattern` is compiled and run
 *    natively, so a catastrophic pattern like `(a+)+$` pins a CPU on a short
 *    input. These sources are screened for nested unbounded quantifiers before a
 *    validator is built. {@link ValidateLimits.allowUnsafePatterns}.
 *
 * Every limit is generous enough that ordinary schemas and documents never trip
 * it, and each is configurable. Exceeding a runtime limit throws a
 * {@link isValidationLimitError | ValidationLimitError} — the same
 * fail-loud contract the interpreter already uses for an unresolvable `$ref` or
 * an unknown `type`, rather than silently returning a verdict.
 */

/** Tunable per-validation resource ceilings. See {@link ValidateLimits} usage in the module doc. */
export type ValidateLimits = {
  /**
   * Maximum interpreter recursion depth. Guards deeply-nested data against a
   * recursive schema from overflowing the call stack. Defaults to
   * {@link DEFAULT_MAX_DEPTH}.
   */
  readonly maxDepth?: number
  /**
   * Maximum number of schema-node evaluations (plus structural comparisons) in
   * one validation. Guards exponential combinator blow-up and quadratic
   * `uniqueItems`. Defaults to {@link DEFAULT_MAX_STEPS}.
   */
  readonly maxSteps?: number
  /**
   * When `true`, skip the ReDoS screen so a `pattern` with nested unbounded
   * quantifiers is compiled and run as-is. Leave `false` (the default) unless
   * every schema is trusted and known to need such a pattern.
   */
  readonly allowUnsafePatterns?: boolean
}

/**
 * Default recursion-depth cap. Deliberately conservative: a recursive schema
 * adds two-plus native frames per data level, and some runtimes (Workers,
 * Hermes) have small stacks, so this leaves generous headroom below the native
 * limit while still admitting any realistically-nested document. Matches the
 * `deepEqual` cap for symmetry.
 */
export const DEFAULT_MAX_DEPTH = 512

/**
 * Default work budget. High enough that even a large, deeply-structured
 * document never approaches it (an ordinary node costs one step), low enough
 * that an exponential (`2^depth` branch) or quadratic (`uniqueItems`) blow-up
 * trips in well under a second.
 */
export const DEFAULT_MAX_STEPS = 10_000_000

/** The resolved, defaulted form of {@link ValidateLimits} threaded through a run. */
export type ResolvedLimits = {
  readonly maxDepth: number
  readonly maxSteps: number
  readonly allowUnsafePatterns: boolean
}

export const resolveLimits = (limits: ValidateLimits | undefined): ResolvedLimits => ({
  maxDepth: limits?.maxDepth ?? DEFAULT_MAX_DEPTH,
  maxSteps: limits?.maxSteps ?? DEFAULT_MAX_STEPS,
  allowUnsafePatterns: limits?.allowUnsafePatterns ?? false,
})

/** A stable key for the resolved limits, so {@link resolveLimits} folds into the prepare-cache key. */
export const limitsCacheKey = (limits: ResolvedLimits): string =>
  `${limits.maxDepth}:${limits.maxSteps}:${limits.allowUnsafePatterns ? 1 : 0}`

const LIMIT_ERROR_NAME = 'ValidationLimitError'

/**
 * The error thrown when a validation exceeds one of its {@link ValidateLimits}
 * (or is built from a schema with an unsafe `pattern`). It is a plain `Error`
 * with a recognizable `name`, so `instanceof Error` and logging work; use
 * {@link isValidationLimitError} to distinguish it from an ordinary throw.
 */
export const validationLimitError = (message: string): Error => {
  const error = new Error(message)
  error.name = LIMIT_ERROR_NAME
  return error
}

/** Whether `value` is the error thrown when a validation hits a resource limit. */
export const isValidationLimitError = (value: unknown): value is Error =>
  value instanceof Error && value.name === LIMIT_ERROR_NAME

// --- ReDoS screen ----------------------------------------------------------
//
// A schema `pattern` (and each `patternProperties` key) is compiled to a native
// `RegExp` and run against untrusted input. Catastrophic backtracking needs a
// repetition nested inside another repetition — "star height" >= 2, e.g.
// `(a+)+`, `(a*)*`, `(\d+)*`. We compute a conservative star height and reject
// such sources before a validator is built (unless `allowUnsafePatterns`). The
// heuristic — the same one `safe-regex` uses — over-approximates: it may flag a
// few benign patterns, never the reverse, which is the safe direction.

/** Reads a quantifier at `i`, returning whether it is an unbounded repetition and the index after it. */
const readQuantifier = (source: string, i: number): { repetition: boolean; next: number } | null => {
  const c = source[i]
  if (c === '*' || c === '+') {
    const j = i + 1
    // A trailing `?` (lazy) or `+` (possessive) is part of the quantifier.
    return { repetition: true, next: source[j] === '?' || source[j] === '+' ? j + 1 : j }
  }
  if (c === '?') {
    const j = i + 1
    return { repetition: false, next: source[j] === '?' || source[j] === '+' ? j + 1 : j }
  }
  if (c === '{') {
    const m = /^\{(\d+)(,(\d*))?\}/.exec(source.slice(i))
    if (m) {
      // `{n,}` (comma, no max) is unbounded; `{n}` and `{n,m}` are bounded and do
      // not drive exponential backtracking.
      const unbounded = m[2] !== undefined && (m[3] === undefined || m[3] === '')
      const end = i + m[0].length
      return { repetition: unbounded, next: source[end] === '?' || source[end] === '+' ? end + 1 : end }
    }
  }
  return null
}

/** Advances past a `[...]` character class, returning the index after the closing `]`. */
const skipClass = (source: string, i: number): number => {
  let j = i + 1
  if (source[j] === '^') j++
  if (source[j] === ']') j++ // a leading `]` is a literal member
  while (j < source.length && source[j] !== ']') j += source[j] === '\\' ? 2 : 1
  return j + 1
}

/** Advances past a group's `(` prefix (capturing, `(?:`, lookaround, named), returning the inner start. */
const groupInnerStart = (source: string, i: number): number => {
  if (source[i + 1] !== '?') return i + 1
  const c2 = source[i + 2]
  if (c2 === ':' || c2 === '=' || c2 === '!') return i + 3
  if (c2 === '<') {
    // Lookbehind `(?<=`/`(?<!` or a named group `(?<name>`.
    if (source[i + 3] === '=' || source[i + 3] === '!') return i + 4
    const close = source.indexOf('>', i + 3)
    return close === -1 ? i + 3 : close + 1
  }
  return i + 2
}

/**
 * Star height of `source` from `i` until the end or an unmatched `)`: the
 * maximum nesting of unbounded repetitions. `>= 2` is the catastrophic shape.
 * Returns `[height, next]`. Robust to malformed input — it never throws.
 */
const scanStarHeight = (source: string, i: number): [number, number] => {
  let height = 0 // max over the alternation branches / concatenation seen so far
  let pos = i
  while (pos < source.length) {
    const c = source[pos]
    if (c === ')') break
    if (c === '|') {
      pos++
      continue
    }
    let atomHeight = 0
    let after: number
    if (c === '(') {
      const inner = groupInnerStart(source, pos)
      const [h, end] = scanStarHeight(source, inner)
      atomHeight = h
      after = source[end] === ')' ? end + 1 : end
    } else if (c === '[') {
      after = skipClass(source, pos)
    } else if (c === '\\') {
      after = pos + 2
    } else {
      after = pos + 1
    }
    const q = readQuantifier(source, after)
    if (q) {
      if (q.repetition) atomHeight += 1
      after = q.next
    }
    if (atomHeight > height) height = atomHeight
    pos = after
  }
  return [height, pos]
}

/**
 * Conservative test for a regex source prone to catastrophic backtracking:
 * star height (nested unbounded repetition) of two or more. See the module doc.
 */
export const hasUnsafeRegex = (source: string): boolean => scanStarHeight(source, 0)[0] >= 2

// --- Schema pattern walk ---------------------------------------------------

// Keywords whose value is a single subschema.
const SUBSCHEMA_KEYWORDS = [
  'additionalProperties',
  'unevaluatedProperties',
  'propertyNames',
  'additionalItems',
  'unevaluatedItems',
  'contains',
  'not',
  'if',
  'then',
  'else',
] as const

// Keywords whose value is an array of subschemas.
const SUBSCHEMA_ARRAY_KEYWORDS = ['allOf', 'anyOf', 'oneOf', 'prefixItems'] as const

// Keywords whose value is a record of name -> subschema.
const SUBSCHEMA_MAP_KEYWORDS = ['properties', 'patternProperties', 'dependentSchemas', '$defs', 'definitions'] as const

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/**
 * Visits every regex source a validator would compile from `schema` — the
 * `pattern` keyword and every `patternProperties` key — walking only
 * subschema-bearing positions, so a regex-shaped string sitting in `const`,
 * `enum`, or `default` *data* is never mistaken for a pattern.
 */
const forEachRegexSource = (schema: unknown, visit: (source: string) => void, seen: Set<object>): void => {
  if (Array.isArray(schema)) {
    for (const item of schema) forEachRegexSource(item, visit, seen)
    return
  }
  if (!isObject(schema) || seen.has(schema)) return
  seen.add(schema)

  if (typeof schema['pattern'] === 'string') visit(schema['pattern'])

  const patternProperties = schema['patternProperties']
  if (isObject(patternProperties)) {
    for (const source of Object.keys(patternProperties)) visit(source)
    for (const sub of Object.values(patternProperties)) forEachRegexSource(sub, visit, seen)
  }

  for (const keyword of SUBSCHEMA_KEYWORDS) forEachRegexSource(schema[keyword], visit, seen)
  for (const keyword of SUBSCHEMA_ARRAY_KEYWORDS) forEachRegexSource(schema[keyword], visit, seen)
  for (const keyword of SUBSCHEMA_MAP_KEYWORDS) {
    if (keyword === 'patternProperties') continue // already handled (keys + values)
    const map = schema[keyword]
    if (isObject(map)) for (const sub of Object.values(map)) forEachRegexSource(sub, visit, seen)
  }

  // `items` is a subschema (2020-12) or, in older drafts, an array of them.
  forEachRegexSource(schema['items'], visit, seen)
  // `dependencies` (draft-07) values may be subschemas (object) or key lists (array — skipped).
  const dependencies = schema['dependencies']
  if (isObject(dependencies)) for (const sub of Object.values(dependencies)) forEachRegexSource(sub, visit, seen)
}

/**
 * Screens every `pattern`/`patternProperties` source in `schema` for
 * catastrophic backtracking, throwing a {@link validationLimitError} on the
 * first unsafe one. Runs once when a validator is built, so an unsafe schema
 * fails fast at construction rather than mid-request.
 */
export const screenPatterns = (schema: unknown, allowUnsafePatterns: boolean): void => {
  if (allowUnsafePatterns) return
  forEachRegexSource(
    schema,
    (source) => {
      if (hasUnsafeRegex(source)) {
        throw validationLimitError(
          `Unsafe regular expression in schema "pattern": ${JSON.stringify(source)} has nested unbounded ` +
            'quantifiers (catastrophic backtracking / ReDoS risk). Rewrite it, or pass ' +
            '`limits: { allowUnsafePatterns: true }` if the schema is trusted.',
        )
      }
    },
    new Set(),
  )
}
