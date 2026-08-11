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
 *    input. These sources are screened for the two shapes we can recognize
 *    soundly before a validator is built — but the screen is a best-effort
 *    filter, not a guarantee. {@link ValidateLimits.allowUnsafePatterns}.
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
   * When `true`, skip the ReDoS screen so a `pattern` flagged as prone to
   * catastrophic backtracking is compiled and run as-is. Leave `false` (the
   * default) unless every schema is trusted and known to need such a pattern.
   * Note the screen is a filter for the shapes we can recognize, not a proof of
   * safety — see the ReDoS screen section below.
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
// `RegExp` and run against untrusted input, so we screen the source for the
// shapes that drive catastrophic backtracking before a validator is built
// (unless `allowUnsafePatterns`). Two shapes are recognized:
//
//  1. **Nested unbounded repetition** — "star height" >= 2, e.g. `(a+)+`,
//     `(a*)*`, `(\d+)*`. This is the `safe-regex` heuristic, and it
//     over-approximates: it can flag a benign pattern, which is the safe
//     direction.
//  2. **A provably ambiguous alternation under an unbounded quantifier** — two
//     branches of a quantified group that match the same single character, so
//     an n-character input has 2^n parses (`(a|a)+`, `(a|[a-z])+`, `(x|\w)*`).
//
// **This is a filter, not a guarantee.** Deciding whether a regex backtracks
// catastrophically means deciding language ambiguity, which no cheap syntactic
// pass can do, so patterns that are genuinely exponential still get through.
// Known gaps: multi-character ambiguous branches (`(a|aa)+`), ambiguity across
// concatenated quantifiers (`a*a*$`), and two overlapping *classes* with no
// literal side to pivot on (`([0-9]|\d)+`, `(\s|\n)+`).
//
// Rule 2 exists because star height alone missed a whole family: `^(a|a)+$` is
// star height 1 yet takes over a second on a 29-character input, so the screen's
// previous claim that it "may flag a few benign patterns, never the reverse" was
// simply false. Treat the screen as defence in depth behind
// {@link ValidateLimits.maxSteps} and a request timeout, not as a reason to
// trust an arbitrary third-party `pattern`.
//
// Rule 2 is deliberately *sound* rather than broad: it only fires when two
// branches provably match a common single character, which no sensible pattern
// does (it is dead alternation). The tempting broader test — overlapping first
// characters — is not sound: `(ab|ac)+` shares a first character yet is linear,
// because the branches diverge before the group can repeat.

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

/** Characters that mean something other than themselves in a regex source. */
const REGEX_METACHARS = '.^$|()[]{}*+?\\'

/**
 * The single character `branch` matches, when the branch is exactly one literal
 * character (`a`, or an escaped punctuation literal like `\.`). Returns `null`
 * for anything else, including the class shorthands (`\d`, `\w`) and the
 * zero-width assertions (`\b`), whose escape letter is alphanumeric.
 */
const singleLiteralChar = (branch: string): string | null => {
  if (branch.length === 1) return REGEX_METACHARS.includes(branch) ? null : branch
  if (branch.length === 2 && branch[0] === '\\' && /[^0-9A-Za-z]/.test(branch[1] as string)) return branch[1] as string
  return null
}

/** Class shorthands we can evaluate exactly when testing whether a branch matches a character. */
const CLASS_SHORTHANDS: Readonly<Record<string, RegExp>> = { d: /\d/, w: /\w/, s: /\s/ }

/**
 * Whether `branch` consumes exactly one character and that character can be
 * `ch`. Only the forms we can decide exactly answer `true`; anything we cannot
 * model (a group, a multi-character branch, an unrecognized escape) answers
 * `false`, which keeps {@link hasAmbiguousAlternation} sound rather than broad.
 */
const branchMatchesChar = (branch: string, ch: string): boolean => {
  if (singleLiteralChar(branch) === ch) return true
  // `.` matches everything but a line terminator, and we never compile with `s`.
  if (branch === '.') return ch !== '\n' && ch !== '\r'
  if (branch.length === 2 && branch[0] === '\\') return CLASS_SHORTHANDS[branch[1] as string]?.test(ch) === true
  // A bare `[...]` spanning the whole branch is one character too. A character
  // class cannot backtrack, so compiling and testing it here is exact and safe.
  if (branch.startsWith('[') && skipClass(branch, 0) === branch.length) {
    try {
      return new RegExp(`^${branch}$`, 'u').test(ch)
    } catch {
      return false
    }
  }
  return false
}

/**
 * Whether two of `branches` provably match the same input, which under an
 * unbounded quantifier means an n-character input has 2^n parses. Two cases
 * qualify: branches with identical source (identical language, trivially), and
 * a single-literal-character branch that another branch also accepts. See the
 * module doc for why the broader "overlapping first characters" test is not
 * used — it is not sound.
 */
const hasAmbiguousAlternation = (branches: readonly string[]): boolean => {
  if (branches.length < 2) return false
  for (let a = 0; a < branches.length; a++) {
    const x = branches[a] as string
    const xChar = singleLiteralChar(x)
    for (let b = a + 1; b < branches.length; b++) {
      const y = branches[b] as string
      if (x === y) return true
      if (xChar !== null && branchMatchesChar(y, xChar)) return true
      const yChar = singleLiteralChar(y)
      if (yChar !== null && branchMatchesChar(x, yChar)) return true
    }
  }
  return false
}

/** What one scanned region of a regex source tells us. See {@link scanRegion}. */
type RegionScan = {
  /** Maximum nesting of unbounded repetitions inside the region. `>= 2` is the catastrophic shape. */
  height: number
  /** Whether the region contains a quantified, provably ambiguous alternation. */
  ambiguous: boolean
  /** The region's own top-level alternation branches, so a quantifier on it can be judged. */
  branches: string[]
  /** Index just past the region (at the unmatched `)`, or the end of the source). */
  next: number
}

/**
 * Scans `source` from `i` until the end or an unmatched `)`, collecting both
 * signals the screen needs. Robust to malformed input — it never throws, and a
 * source it cannot parse simply scores as safe.
 */
const scanRegion = (source: string, i: number): RegionScan => {
  let height = 0 // max over the alternation branches seen so far
  let branchHeight = 0 // max over the atoms of the branch being scanned
  let ambiguous = false
  const branches: string[] = []
  let branchStart = i
  let pos = i
  while (pos < source.length) {
    const c = source[pos]
    if (c === ')') break
    if (c === '|') {
      branches.push(source.slice(branchStart, pos))
      if (branchHeight > height) height = branchHeight
      branchHeight = 0
      pos++
      branchStart = pos
      continue
    }
    let atomHeight = 0
    let after: number
    let inner: RegionScan | null = null
    if (c === '(') {
      inner = scanRegion(source, groupInnerStart(source, pos))
      atomHeight = inner.height
      if (inner.ambiguous) ambiguous = true
      after = source[inner.next] === ')' ? inner.next + 1 : inner.next
    } else if (c === '[') {
      after = skipClass(source, pos)
    } else if (c === '\\') {
      after = pos + 2
    } else {
      after = pos + 1
    }
    const q = readQuantifier(source, after)
    if (q) {
      if (q.repetition) {
        atomHeight += 1
        // Only an *unbounded* repetition turns an ambiguous alternation into
        // exponential backtracking: `(a|a){1,10}` tops out at 2^10 parses.
        if (inner !== null && hasAmbiguousAlternation(inner.branches)) ambiguous = true
      }
      after = q.next
    }
    if (atomHeight > branchHeight) branchHeight = atomHeight
    pos = after
  }
  branches.push(source.slice(branchStart, pos))
  if (branchHeight > height) height = branchHeight
  return { height, ambiguous, branches, next: pos }
}

/**
 * Best-effort test for a regex source prone to catastrophic backtracking:
 * nested unbounded repetition, or a provably ambiguous alternation under an
 * unbounded quantifier. A `false` here means "we found nothing", not "this is
 * safe" — see the module doc for the known gaps.
 */
export const hasUnsafeRegex = (source: string): boolean => {
  const scan = scanRegion(source, 0)
  return scan.height >= 2 || scan.ambiguous
}

// --- Schema pattern walk ---------------------------------------------------

/**
 * Keywords whose value is arbitrary *data*, not a subschema. The walk below
 * stops at these, because a schema is allowed to carry any JSON there — so
 * `{ const: { pattern: '(a+)+' } }` describes a literal object with a `pattern`
 * property, not a regex the validator will ever compile. Everything else is
 * descended into unconditionally.
 */
const DATA_KEYWORDS = new Set(['const', 'enum', 'default', 'examples', 'example'])

/**
 * Keywords whose value is a map of author-chosen names to schemas.
 *
 * Inside one the keys are names, so {@link DATA_KEYWORDS} carry no keyword
 * meaning there. Without the distinction a definition named `default` was
 * skipped outright — its `$id` never registered, and its `pattern` was never
 * screened, so a catastrophic-backtracking regex compiled with no opt-in.
 * Kept in step by hand with `@amritk/helpers`' `SCHEMA_MAPS`: this package
 * takes no `@amritk/*` dependency by design.
 */
const SCHEMA_MAPS = new Set([
  'properties',
  'patternProperties',
  '$defs',
  'definitions',
  'dependentSchemas',
  'dependencies',
])

/**
 * What one build-time walk of the schema tells {@link screenSchema}'s caller
 * beyond "the patterns are safe".
 */
export type SchemaScreen = {
  /**
   * Whether the document declares an `$id` anywhere. When it does not — nearly
   * every schema — there is exactly one base URI in play and the interpreter can
   * skip building an `$id` resource registry entirely. Reporting it from *this*
   * walk rather than a second one keeps the cold path to a single traversal,
   * which is the cost this package is judged on.
   */
  readonly declaresId: boolean
}

/**
 * Visits every regex source a validator could compile from `schema` — every
 * string-valued `pattern` key, and every key of a `patternProperties` object —
 * and reports whether the document declares an `$id` along the way.
 *
 * The walk is deliberately unrestricted rather than following a list of known
 * subschema keywords. A keyword list only sees the shapes it knows about: an
 * OpenAPI document parks its subschemas under `components/schemas` and reaches
 * them by `$ref`, so a keyword-driven walk declared such a document clean and
 * then happily compiled and ran its patterns. Chasing `$ref`s instead would fix
 * that one case and still miss the next unfamiliar layout, so we visit the whole
 * document and let a `pattern` be a `pattern` wherever it sits.
 *
 * The cost is over-screening: a `pattern` key inside data we do not recognize as
 * data gets screened as if it were a keyword. That is the direction we want —
 * the failure mode is a loud, build-time error with an `allowUnsafePatterns`
 * escape hatch, against a live CPU-pinning ReDoS the other way — and
 * {@link DATA_KEYWORDS} already covers the places a schema legitimately carries
 * arbitrary data.
 *
 * Iterative with an explicit stack, not recursive: this runs from `makeValidator`
 * *before* `maxDepth` applies, and a 20,000-level nested schema would otherwise
 * blow the native stack with a `RangeError` that `isValidationLimitError` does
 * not recognize — turning a rejected schema into a consumer's 500.
 */
const walkSchema = (schema: unknown, visit: ((source: string) => void) | null): SchemaScreen => {
  if (schema === null || typeof schema !== 'object') return { declaresId: false }
  const seen = new Set<object>()
  const stack: object[] = [schema]
  const inMaps: boolean[] = [false]
  let declaresId = false

  while (stack.length > 0) {
    // Both stacks pop together, before any early `continue` — they index each
    // other, so a branch that skipped one would shift every later position.
    const node = stack.pop() as object
    const inMap = inMaps.pop() as boolean
    if (seen.has(node)) continue
    seen.add(node)

    if (Array.isArray(node)) {
      // An array element inherits its array's position, as everywhere else.
      for (const item of node)
        if (item !== null && typeof item === 'object') {
          stack.push(item)
          inMaps.push(inMap)
        }
      continue
    }

    // One pass over the node's own keys, pushing only the children worth
    // descending into. A whole OpenAPI document goes through here on every cold
    // build, so this stays free of per-node `Object.keys` arrays and of stack
    // entries for the strings and numbers that make up most of a schema.
    const record = node as Record<string, unknown>
    for (const key of Object.keys(record)) {
      const child = record[key]
      if (typeof child === 'string') {
        // Only at a schema node: inside a name map these are property names.
        if (!inMap && key === 'pattern') visit?.(child)
        else if (!inMap && key === '$id' && child !== '') declaresId = true
        continue
      }
      if (child === null || typeof child !== 'object') continue
      if (visit && !inMap && key === 'patternProperties' && !Array.isArray(child))
        for (const source of Object.keys(child)) visit(source)
      // Skipping the data keywords by name alone also skipped a definition or
      // property *named* one, so an `$id` declared under `$defs.default` never
      // registered — and a `pattern` under it was never screened, so a
      // catastrophic-backtracking regex compiled with no opt-in.
      if (inMap || !DATA_KEYWORDS.has(key)) {
        stack.push(child)
        inMaps.push(!inMap && SCHEMA_MAPS.has(key))
      }
    }
  }

  return { declaresId }
}

/**
 * Walks `schema` once at validator-build time, screening every
 * `pattern`/`patternProperties` source for catastrophic backtracking — throwing
 * a {@link validationLimitError} on the first unsafe one, so an unsafe schema
 * fails fast at construction rather than mid-request — and reporting the
 * {@link SchemaScreen} facts the interpreter needs before it starts.
 *
 * With `allowUnsafePatterns` the regex screen is skipped but the walk still
 * runs: it is the same traversal either way, and its other findings are not
 * optional.
 */
export const screenSchema = (schema: unknown, allowUnsafePatterns: boolean): SchemaScreen =>
  walkSchema(
    schema,
    allowUnsafePatterns
      ? null
      : (source) => {
          if (hasUnsafeRegex(source)) {
            throw validationLimitError(
              `Unsafe regular expression in schema "pattern": ${JSON.stringify(source)} is prone to catastrophic ` +
                'backtracking (ReDoS risk) — it nests unbounded quantifiers, or repeats an ambiguous alternation. ' +
                'Rewrite it, or pass `limits: { allowUnsafePatterns: true }` if the schema is trusted.',
            )
          }
        },
  )
