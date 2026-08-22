import { DATA_KEYWORDS, SCHEMA_MAPS } from '@/interpreter/keywords'

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
//     `(a*)*`, `(\d+)*`. This is the `safe-regex` heuristic, minus the
//     separator-delimited repetitions it gets wrong; see {@link isAnchoredRepetition}.
//     What is left still over-approximates: it can flag a benign pattern, which
//     is the safe direction.
//  2. **A provably ambiguous alternation under an unbounded quantifier** — two
//     branches of a quantified group that match the same single character, so
//     an n-character input has 2^n parses (`(a|a)+`, `(a|[a-z])+`, `(x|\w)*`).
//
// **This is a filter, not a guarantee.** Deciding whether a regex backtracks
// catastrophically means deciding language ambiguity, which no cheap syntactic
// pass can do, so patterns that are genuinely exponential still get through.
// Known gaps: multi-character ambiguous branches (`(a|aa)+`), ambiguity across
// concatenated quantifiers (`a*a*$`), and two overlapping *classes* with no
// literal side to pivot on (`([0-9]|\d)+`, `(\s|\n)+`). An anchored repetition
// (rule 1's exemption) inherits every one of them for its body, since what the
// exemption proves is only that the *outer* loop adds no ambiguity of its own:
// `(\.(a|aa)*)*` is admitted, but so is the `\.(a|aa)*` it is built from.
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
//
// The screen runs on an untrusted `pattern`, so it also has to be cheap *on*
// one: a screen that can be made to pin a CPU is the very thing it exists to
// prevent. Three bounds keep it so, and all three are named below —
// {@link MAX_GROUP_DEPTH} (rule 1's descent, which would otherwise recurse on
// the native stack), {@link MAX_AMBIGUITY_COMPARISONS} (rule 2's pairwise scan,
// which is quadratic in the number of branches), and {@link MAX_ANCHOR_SCAN}
// (rule 1's exemption, which re-reads a group body). Rule 2 giving up early is
// one more entry on the known-gaps list above; the anchor scan giving up early
// only costs an exemption, so it fails safe; running out of depth is neither,
// and fails the pattern loudly instead.

/** `{n}` / `{n,}` / `{n,m}`, matched in place at an offset. Sticky, so `lastIndex` selects the offset. */
const BOUNDED_QUANTIFIER = /\{(\d+)(,(\d*))?\}/y

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
    // Sticky rather than `^…` against `source.slice(i)`: the slice would copy the
    // rest of the pattern at every `{` in it.
    BOUNDED_QUANTIFIER.lastIndex = i
    const m = BOUNDED_QUANTIFIER.exec(source)
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

/** Their negations, keyed the same way — `\D` matches `ch` exactly when `\d` does not. */
const NEGATED_CLASS_SHORTHANDS: Readonly<Record<string, RegExp>> = { D: /\d/, W: /\w/, S: /\s/ }

/** What `.` declines to match, since the screen never compiles with the `s` flag. */
const LINE_TERMINATORS = new Set(['\n', '\r', '\u2028', '\u2029'])

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
 * How many branch pairs rule 2 will compare across one whole pattern.
 *
 * The test is pairwise, so a single quantified group with n branches costs
 * n²/2 comparisons — and a `(a|b|c|…)+` with a few thousand branches is a couple
 * of kilobytes of schema that took the screen minutes, turning the ReDoS guard
 * into its own CPU sink. The budget is shared by every alternation in the
 * pattern, so total screening work is bounded no matter how the branches are
 * spread out. It is generous enough to compare every pair of an alternation up
 * to ~200 branches, which is far past anything a person writes; beyond it the
 * screen simply stops looking, which is the same "we found nothing" answer the
 * known gaps already produce.
 */
const MAX_AMBIGUITY_COMPARISONS = 20_000

/**
 * How many characters of group body rule 1's anchor exemption will re-read
 * across one whole pattern.
 *
 * {@link isAnchoredRepetition} scans a quantified group's body a second time, so
 * a pattern of nested anchored groups could re-read the same text once per level
 * — bounded by {@link MAX_GROUP_DEPTH}, but that is still 100 × the source
 * length, and the source is untrusted. One shared allowance caps the total no
 * matter how the groups nest. Running out only costs an exemption, so unlike
 * rule 2's budget it fails toward flagging rather than away from it.
 */
const MAX_ANCHOR_SCAN = 20_000

/** The screen's shared work allowances, spent across one whole pattern. */
type ScreenBudget = {
  /** Remaining branch-pair comparisons for rule 2. */
  comparisons: number
  /** Remaining group-body characters for rule 1's anchor exemption. */
  anchorChars: number
}

/**
 * Whether two of `branches` provably match the same input, which under an
 * unbounded quantifier means an n-character input has 2^n parses. Two cases
 * qualify: branches with identical source (identical language, trivially), and
 * a single-literal-character branch that another branch also accepts. See the
 * module doc for why the broader "overlapping first characters" test is not
 * used — it is not sound.
 *
 * `budget` is the shared comparison allowance; running out ends the scan with
 * `false`, so an adversarially wide alternation costs bounded work.
 */
const hasAmbiguousAlternation = (branches: readonly string[], budget: ScreenBudget): boolean => {
  if (branches.length < 2) return false
  for (let a = 0; a < branches.length; a++) {
    const x = branches[a] as string
    const xChar = singleLiteralChar(x)
    for (let b = a + 1; b < branches.length; b++) {
      if (--budget.comparisons < 0) return false
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
  /** Whether the region nests groups past {@link MAX_GROUP_DEPTH}, so it was never fully read. */
  tooDeep: boolean
  /** The region's own top-level alternation branches, so a quantifier on it can be judged. */
  branches: string[]
  /** Index just past the region (at the unmatched `)`, or the end of the source). */
  next: number
}

/**
 * Whether `atom` — one character-consuming regex atom — might consume `ch`.
 *
 * The mirror image of {@link branchMatchesChar}, and deliberately not that
 * function with the result negated: `branchMatchesChar` answers `false` both for
 * "provably does not match" and for "cannot tell", which is what keeps rule 2
 * sound. Here the safe default runs the other way, so anything we cannot decide
 * exactly — an unrecognized escape, a backreference, a class that will not
 * compile — answers `true` and costs the caller its anchor.
 */
const atomMayMatchChar = (atom: string, ch: string): boolean => {
  const literal = singleLiteralChar(atom)
  if (literal !== null) return literal === ch
  // `.` matches everything but a line terminator, and we never compile with `s`.
  if (atom === '.') return !LINE_TERMINATORS.has(ch)
  if (atom.length === 2 && atom[0] === '\\') {
    const positive = CLASS_SHORTHANDS[atom[1] as string]
    if (positive) return positive.test(ch)
    const negated = NEGATED_CLASS_SHORTHANDS[atom[1] as string]
    if (negated) return !negated.test(ch)
    // `\b`, `\uXXXX`, `\p{…}`, a backreference: not modelled, so assume it can.
    return true
  }
  // A character class cannot backtrack, so compiling and testing it is exact.
  if (atom.startsWith('[') && skipClass(atom, 0) === atom.length) {
    try {
      return new RegExp(`^${atom}$`, 'u').test(ch)
    } catch {
      return true
    }
  }
  return true
}

/**
 * Regex source characters that carry structure rather than consuming input, and
 * so cannot put an anchor character into a matched word.
 *
 * Skipping them in {@link noOtherAtomConsumes} is sound for a reason worth
 * stating: every one of them is in {@link REGEX_METACHARS}, and an anchor comes
 * from {@link singleLiteralChar}, which refuses a metachar. The anchor can
 * therefore never *be* one of these, so passing over them cannot pass over an
 * occurrence of it. (`.` is a metachar too but does consume, so it is an atom
 * here, not a skip.)
 */
const NON_CONSUMING_CHARS = new Set([')', '|', '^', '$', '*', '+', '?', '{', '}'])

/**
 * Steps over one token of a regex body at `i`, reporting where it ends and
 * whether it consumes a character. The one tokenizer both anchor passes share,
 * so "what counts as an atom" is defined once.
 */
const readToken = (body: string, i: number): { consuming: boolean; next: number } => {
  const c = body[i] as string
  // A group opener is structure; its contents are tokens like any other, which
  // is what lets the sweeps stay flat instead of modelling the group tree.
  if (c === '(') return { consuming: false, next: groupInnerStart(body, i) }
  if (NON_CONSUMING_CHARS.has(c)) return { consuming: false, next: i + 1 }
  return { consuming: true, next: c === '[' ? skipClass(body, i) : c === '\\' ? i + 2 : i + 1 }
}

/**
 * The single literal character every word of `body` must carry at `end`, when
 * the atom there is an unquantified literal — `\.` at the front of
 * `(\.[A-Za-z_][A-Za-z0-9_]*)*`, `\.` at the back of `(\w+\.)*`.
 *
 * Returns the character and the span it occupies, or `null` when there is no
 * such atom: a class, a group, an assertion, or a literal carrying a quantifier.
 * A quantifier disqualifies it because the proof {@link isAnchoredRepetition}
 * needs is "exactly one anchor per word, at a fixed end" — `?` and `*` allow
 * none, `+` and `{2,}` allow several.
 *
 * At the back, the atom must also *end* the body, which is what makes it
 * mandatory and unquantified in one test: a trailing `?`, a `)`, or a `$` all
 * leave the last consuming atom short of the end and forfeit the anchor.
 */
const anchorAt = (
  body: string,
  end: 'front' | 'back',
  budget: ScreenBudget,
): { readonly char: string; readonly from: number; readonly to: number } | null => {
  if (end === 'front') {
    const first = body[0]
    if (first === undefined) return null
    const to = first === '\\' ? 2 : 1
    const char = singleLiteralChar(body.slice(0, to))
    if (char === null || readQuantifier(body, to) !== null) return null
    return { char, from: 0, to }
  }

  // Walk forward to find the last consuming atom: a regex body cannot be read
  // right-to-left (`\\.` is an escaped backslash then any-char, `\.` is a dot).
  let last: { from: number; to: number } | null = null
  let i = 0
  while (i < body.length) {
    const token = readToken(body, i)
    budget.anchorChars -= Math.max(1, token.next - i)
    if (budget.anchorChars < 0) return null
    last = token.consuming ? { from: i, to: token.next } : last
    i = token.next
  }
  if (last === null || last.to !== body.length) return null
  const char = singleLiteralChar(body.slice(last.from, last.to))
  return char === null ? null : { char, from: last.from, to: last.to }
}

/**
 * Whether no atom of `body` outside `[from, to)` can consume `anchor`.
 *
 * A flat lexical sweep rather than a structural one: the question is only
 * whether *some* atom anywhere inside the body could produce the anchor
 * character, so group nesting and alternation do not have to be modelled — every
 * atom is visited whatever it sits inside. Lookaround contents are visited too,
 * which over-approximates (they consume nothing) in the conservative direction.
 *
 * `budget` is the shared allowance from {@link MAX_ANCHOR_SCAN}; running out
 * answers `false`, which withholds the exemption rather than granting one we did
 * not finish proving.
 */
const noOtherAtomConsumes = (body: string, from: number, to: number, anchor: string, budget: ScreenBudget): boolean => {
  let i = 0
  while (i < body.length) {
    if (i === from) {
      i = to
      continue
    }
    const token = readToken(body, i)
    // Charged by span, so a body of many short classes cannot buy more
    // `RegExp` compiles than the allowance pays for.
    budget.anchorChars -= Math.max(1, token.next - i)
    if (budget.anchorChars < 0) return false
    if (token.consuming && atomMayMatchChar(body.slice(i, token.next), anchor)) return false
    i = token.next
  }
  return true
}

/** The index just past the `)` closing the group that opens at `i`, or -1 if it never closes. */
const groupEnd = (source: string, i: number): number => {
  let depth = 0
  let j = i
  while (j < source.length) {
    const c = source[j]
    if (c === '\\') {
      j += 2
      continue
    }
    if (c === '[') {
      j = skipClass(source, j)
      continue
    }
    if (c === '(') depth++
    else if (c === ')' && --depth === 0) return j + 1
    j++
  }
  return -1
}

/** Splits an alternation on its top-level `|`, ignoring ones nested in groups or classes. */
const topLevelBranches = (source: string): string[] => {
  const out: string[] = []
  let start = 0
  let depth = 0
  let j = 0
  while (j < source.length) {
    const c = source[j]
    if (c === '\\') {
      j += 2
      continue
    }
    if (c === '[') {
      j = skipClass(source, j)
      continue
    }
    if (c === '(') depth++
    else if (c === ')') depth--
    else if (c === '|' && depth === 0) {
      out.push(source.slice(start, j))
      start = j + 1
    }
    j++
  }
  out.push(source.slice(start))
  return out
}

/**
 * Strips one fully-enclosing group, so the `([^\/~])` AsyncAPI writes its
 * alternation branches as reads as the `[^\/~]` it actually is.
 */
const unwrapGroup = (source: string): string =>
  source.startsWith('(') && groupEnd(source, 0) === source.length
    ? source.slice(groupInnerStart(source, 0), source.length - 1)
    : source

/** One unit of a body's top-level concatenation: a single-character atom, or the alternation ending it. */
type Unit = {
  /** The atom's source, or `null` for the trailing group. */
  readonly atom: string | null
  /** For the trailing group, the first atom of each branch. */
  readonly firsts: readonly string[]
  /** Whether an unbounded quantifier repeats it. */
  readonly repeats: boolean
  /** Whether it can match nothing, so the unit after it can start where it did. */
  readonly nullable: boolean
}

/**
 * Reads `body` as a concatenation of single-character atoms optionally ending in
 * one alternation group, or `null` for anything richer.
 *
 * The grammar is deliberately tiny — the shapes whose derivations can be argued
 * about in a paragraph, which is all {@link hasUniqueDerivation} is willing to
 * claim. `?` and `{n,m}` are refused outright: an optional unit is exactly the
 * "matches nothing in more than one way" hazard that makes a repetition
 * exponential, and `{n,m}` reintroduces it (`a{0,2}a{0,2}`).
 */
const readUnits = (body: string, budget: ScreenBudget): Unit[] | null => {
  const units: Unit[] = []
  let i = 0
  while (i < body.length) {
    budget.anchorChars -= 1
    if (budget.anchorChars < 0) return null
    const c = body[i] as string

    if (c === '(') {
      const end = groupEnd(body, i)
      if (end === -1) return null
      const q = readQuantifier(body, end)
      // Only as the final unit: a repeated group in the middle would need its
      // *last* characters compared against what follows, and the branches make
      // that a per-position question this pass does not answer.
      if ((q ? q.next : end) !== body.length) return null
      if (q !== null && !q.repetition) return null
      const branches = topLevelBranches(body.slice(groupInnerStart(body, i), end - 1)).map(unwrapGroup)
      const firsts: string[] = []
      for (const branch of branches) {
        // A branch must be a fixed-length run of single-character atoms: its
        // length is then settled by the first character, so choosing a branch is
        // the only choice the alternation offers.
        if (branch === '' || branch.includes('(') || branch.includes('|')) return null
        let j = 0
        let first: string | null = null
        while (j < branch.length) {
          budget.anchorChars -= 1
          if (budget.anchorChars < 0) return null
          const b = branch[j] as string
          if (b !== '.' && b !== '[' && b !== '\\' && REGEX_METACHARS.includes(b)) return null
          const next = b === '[' ? skipClass(branch, j) : b === '\\' ? j + 2 : j + 1
          if (readQuantifier(branch, next) !== null) return null
          first ??= branch.slice(j, next)
          j = next
        }
        if (first === null) return null
        firsts.push(first)
      }
      units.push({ atom: null, firsts, repeats: q?.repetition === true, nullable: false })
      i = body.length
      continue
    }

    if (c !== '.' && c !== '[' && c !== '\\' && REGEX_METACHARS.includes(c)) return null
    const next = c === '[' ? skipClass(body, i) : c === '\\' ? i + 2 : i + 1
    const q = readQuantifier(body, next)
    if (q !== null && !q.repetition) return null
    const repeats = q?.repetition === true
    units.push({ atom: body.slice(i, next), firsts: [], repeats, nullable: repeats && body[next] === '*' })
    i = q ? q.next : next
  }
  return units
}

/**
 * Whether two single-character atoms provably share no character.
 *
 * Only decidable here when one side is a literal, which turns the question into
 * the membership test {@link atomMayMatchChar} already answers exactly. Two
 * classes (`\w` against `[a-z]`) would need a real intersection, which JavaScript
 * gives no way to compute, so they are refused rather than guessed at.
 */
const atomsAreDisjoint = (a: string, b: string): boolean => {
  const aChar = singleLiteralChar(a)
  if (aChar !== null) return !atomMayMatchChar(b, aChar)
  const bChar = singleLiteralChar(b)
  return bChar !== null && !atomMayMatchChar(a, bChar)
}

/**
 * Whether `body` matches each word it accepts by exactly one derivation — the
 * second half of the proof {@link isAnchoredRepetition} needs, and the half the
 * "separator pivot" argument leaves out.
 *
 * A forced *split* is not enough. A backtracking engine explores derivations,
 * not splits, so if one repetition can match its own substring k ways, n
 * repetitions offer kⁿ and a failing input walks all of them.
 * `(\.((\w[a-z]?|b\w+)?|(a*[a-z0-9]?)?))*` is anchored by `.` and still takes 94
 * ms on 22 characters where its body alone takes 0.0 ms: every iteration can
 * match the empty tail two ways, and the star raises that to 2ⁿ.
 *
 * What is checked, on the tiny grammar {@link readUnits} admits:
 *
 *  - **Nothing optional** — no `?`, no `{n,m}`, no nullable alternation branch.
 *    That is what kills the empty-tail family above.
 *  - **A repeated atom cannot run into what follows it.** `\w+\.` is fine
 *    because `\w` cannot match `.`, so `\w+` has to stop exactly at the dot;
 *    `a*a*` is not, and `a*b*a*` is not either — hence the walk continues past a
 *    nullable unit to the first one that must consume.
 *  - **A trailing alternation is settled by its first character.** Branches are
 *    fixed-length runs with pairwise-disjoint first atoms, so the first
 *    character picks the branch and the branch's length picks the next boundary:
 *    `([^\/~])|(~[01])` qualifies, `(a|aa)` does not.
 *
 * A repeated unit at the very end runs into the *next iteration*, whose first
 * character is the anchor — and that the anchor cannot be produced by anything
 * in the body is precisely what {@link noOtherAtomConsumes} already established.
 */
const hasUniqueDerivation = (body: string, budget: ScreenBudget): boolean => {
  const units = readUnits(body, budget)
  if (units === null) return false
  for (let i = 0; i < units.length; i++) {
    const unit = units[i] as Unit
    // The trailing alternation only settles a branch by its first character if
    // no two branches can start with the same one. Without this `(a|aa)*` reads
    // as deterministic, and `(\.(a|aa)*)*` is exponential.
    for (let a = 0; a < unit.firsts.length; a++) {
      for (let b = a + 1; b < unit.firsts.length; b++) {
        budget.anchorChars -= 1
        if (budget.anchorChars < 0) return false
        if (!atomsAreDisjoint(unit.firsts[a] as string, unit.firsts[b] as string)) return false
      }
    }
    if (!unit.repeats || unit.atom === null) continue
    // Walk forward to the first unit that must consume: everything nullable in
    // between could yield its position back to this one.
    for (let j = i + 1; j < units.length; j++) {
      budget.anchorChars -= 1
      if (budget.anchorChars < 0) return false
      const follower = units[j] as Unit
      const firsts = follower.atom === null ? follower.firsts : [follower.atom]
      for (const first of firsts) if (!atomsAreDisjoint(unit.atom, first)) return false
      if (!follower.nullable) break
    }
  }
  return true
}

/**
 * Whether repeating `inner` under an unbounded quantifier cannot multiply the
 * ways an input splits — so the repetition adds a level of *nesting* but not a
 * level of *ambiguity*, and rule 1 should not count it.
 *
 * The proof is the one separators give you. If every word the body matches
 * carries some character `c` at a fixed end and contains no other `c`, then in
 * any concatenation of such words the `c` positions are exactly the word
 * boundaries: the split is forced, so there is nothing for the outer loop to
 * backtrack over. `(\.[A-Za-z_][A-Za-z0-9_]*)*` is that shape (`.` starts each
 * repetition and `[A-Za-z0-9_]` cannot produce one), as is
 * `(\/(([^\/~])|(~[01]))*)*` (`/`, which `[^\/~]` excludes) and the
 * separator-last spelling of the same idea, `(\w+\.)*`. All are linear on the
 * input that made `safe-regex`-style star height flag them, and the first two
 * come from the AsyncAPI meta-schemas, which had to be hand-rewritten to load.
 *
 * Both ends, but only the ends. A `c` in the *middle* proves nothing: `(a*\.a*)*`
 * puts exactly one dot in every word too, yet `a.aa.a` splits three ways, because
 * the `a`s around a dot can go to either neighbour. Only a boundary occurrence
 * pins the split.
 *
 * `([A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*)*` is the counter-example
 * that must keep failing: its body starts with `[A-Za-z_]`, a class the body's
 * own `[A-Za-z0-9_]*` can also produce, so `aaaa…` splits exponentially many
 * ways and one trailing invalid character forces every split to be tried — 8.9
 * seconds on 30 characters under V8. `(\w+a)*` fails the same test for the same
 * reason at the other end, and is exponential in the same way.
 *
 * Four conditions, each of them load-bearing:
 *
 *  - **The body itself repeats** (`height >= 1`). Without an inner unbounded
 *    quantifier the level being waived tops out at height 1 and changes no
 *    verdict, so the exemption would be pure cost. This is also the gate that
 *    keeps the scan off the hot path for ordinary patterns.
 *  - **One top-level branch.** With an alternation every branch would have to be
 *    anchored by the *same* character to keep the split forced, and no real
 *    pattern needs that proof.
 *  - **A boundary literal no other atom can produce**, which forces the split.
 *  - **A body that derives each word exactly once**
 *    ({@link hasUniqueDerivation}). A forced split is *not* on its own enough,
 *    and the difference is the whole reason this function is not just the
 *    "separator pivot" test: the engine backtracks over derivations, so an
 *    iteration that matches its own substring k ways makes n iterations cost kⁿ
 *    even though every boundary is pinned.
 *
 * What this does *not* claim is that the body is safe — see the module doc's
 * known gaps. Anything the body does wrong on its own (height >= 2 inside it, a
 * provably ambiguous alternation) still propagates up through {@link RegionScan}
 * and still flags the pattern.
 */
const isAnchoredRepetition = (inner: RegionScan, budget: ScreenBudget): boolean => {
  if (inner.height < 1 || inner.branches.length !== 1) return false
  const body = inner.branches[0] as string
  for (const end of ['front', 'back'] as const) {
    const anchor = anchorAt(body, end, budget)
    if (anchor === null || !noOtherAtomConsumes(body, anchor.from, anchor.to, anchor.char, budget)) continue
    if (hasUniqueDerivation(body, budget)) return true
  }
  return false
}

/**
 * How deep the group nesting may go before the scan stops descending.
 *
 * {@link scanRegion} recurses per `(`, on the native stack, and the pattern is
 * untrusted — so `'('.repeat(30000)` overflowed it with a `RangeError`, which is
 * neither a {@link isValidationLimitError} nor anything a caller of `validate`
 * expects to catch. The cap turns that into a loud, ordinary rejection. No real
 * pattern comes close: a hundred nested groups is already unreadable.
 */
const MAX_GROUP_DEPTH = 100

/**
 * Scans `source` from `i` until the end or an unmatched `)`, collecting the
 * signals the screen needs. Robust to malformed input — it never throws, and a
 * source it cannot parse simply scores as safe.
 *
 * `depth` is the group nesting of this region, bounded by {@link MAX_GROUP_DEPTH};
 * `budget` is the shared allowance for rule 2's pairwise comparisons and rule
 * 1's anchor scans.
 */
const scanRegion = (source: string, i: number, depth: number, budget: ScreenBudget): RegionScan => {
  let height = 0 // max over the alternation branches seen so far
  let branchHeight = 0 // max over the atoms of the branch being scanned
  let ambiguous = false
  let tooDeep = false
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
      if (depth >= MAX_GROUP_DEPTH) {
        // Stop descending rather than overflow the stack. The pattern is
        // reported unanalysable, which fails it — see MAX_GROUP_DEPTH.
        return { height, ambiguous, tooDeep: true, branches, next: source.length }
      }
      inner = scanRegion(source, groupInnerStart(source, pos), depth + 1, budget)
      atomHeight = inner.height
      if (inner.ambiguous) ambiguous = true
      if (inner.tooDeep) tooDeep = true
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
        // A repetition whose body is separator-anchored forces one split per
        // input, so it nests without adding anything to backtrack over and does
        // not count toward star height. See {@link isAnchoredRepetition}.
        if (inner === null || !isAnchoredRepetition(inner, budget)) atomHeight += 1
        // Only an *unbounded* repetition turns an ambiguous alternation into
        // exponential backtracking: `(a|a){1,10}` tops out at 2^10 parses.
        if (inner !== null && hasAmbiguousAlternation(inner.branches, budget)) ambiguous = true
      }
      after = q.next
    }
    if (atomHeight > branchHeight) branchHeight = atomHeight
    pos = after
  }
  branches.push(source.slice(branchStart, pos))
  if (branchHeight > height) height = branchHeight
  return { height, ambiguous, tooDeep, branches, next: pos }
}

/**
 * Best-effort test for a regex source prone to catastrophic backtracking:
 * nested unbounded repetition, or a provably ambiguous alternation under an
 * unbounded quantifier. A repetition that {@link isAnchoredRepetition} can show
 * forces its own split *and* derives each word once does not count as nesting.
 * A source nested too deeply to read is reported unsafe as well, since "we could
 * not analyse it" is not "we found nothing". A `false` here means the latter,
 * not "this is safe" — see the module doc for the known gaps.
 */
export const hasUnsafeRegex = (source: string): boolean => {
  const scan = scanRegion(source, 0, 0, { comparisons: MAX_AMBIGUITY_COMPARISONS, anchorChars: MAX_ANCHOR_SCAN })
  return scan.height >= 2 || scan.ambiguous || scan.tooDeep
}

// --- Schema pattern walk ---------------------------------------------------

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
    // descending into — no stack entries for the strings and numbers that make
    // up most of a schema. `Object.keys` rather than a `for…in`: the walk has
    // to see own keys only (a polluted `Object.prototype.pattern` made every
    // schema fail screening), and `interpret.ts`'s benchmark measures the key
    // array as cheaper than a `for…in` with a per-key `Object.hasOwn` guard.
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
                'backtracking (ReDoS risk) — it nests unbounded quantifiers, repeats an ambiguous alternation, or ' +
                'nests groups too deeply to analyse. Rewrite it, or pass ' +
                '`limits: { allowUnsafePatterns: true }` if the schema is trusted.',
            )
          }
        },
  )
