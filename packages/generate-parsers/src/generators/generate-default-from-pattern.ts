/**
 * Builds a default string for a `pattern`-constrained schema — a value a
 * coercing parser can fall back to when the input cannot be repaired.
 *
 * The one invariant: **a returned default always matches the pattern it was
 * built from** (and any length bounds handed in alongside it). Every candidate,
 * synthesized or recognized, is tested against the real `RegExp` before it is
 * returned, and anything that fails is discarded. That check is the whole point.
 * Without it this returned a value the schema rejects — `'^\\+?\\d{3}\\d{4}$'`
 * was answered with `"+1234567890"`, which has three digits too many — so a
 * coercing parser "repaired" input into a document still invalid against its own
 * schema, and the array or object built around it was invalid for the same
 * reason.
 *
 * Two sources of candidates, in order:
 *
 *  1. {@link synthesize}, which reads the pattern and constructs a matching
 *     string from it. This covers the ordinary shapes real schemas use — slugs,
 *     identifiers, fixed-width codes — that no fixed list can anticipate.
 *  2. A short list of well-known shapes (email, UUID, URL, semver, ISO date),
 *     which read better than a synthesized `"aaa"` when they happen to fit.
 *
 * Returns `null` when nothing verifies, which callers already treat as "no
 * usable default" — the safe answer, and far better than a confident wrong one.
 */

/** Recognizable shapes worth preferring over a synthesized string when they match. */
const RECOGNIZED_DEFAULTS: readonly string[] = [
  'user@example.com',
  '00000000-0000-0000-0000-000000000000',
  'https://example.com',
  '1.0.0',
  '2000-01-01',
  '+1234567890',
]

/** Constructs a regex engine cannot be asked to generate a string for. */
const UNSUPPORTED = /\(\?[=!<]|\\[1-9]|\\b|\\B/

/** Characters a synthesized value prefers, most readable first. */
const PREFERRED = 'abcdefghijklmnopqrstuvwxyz0123456789'

/** The single character an escape sequence stands for, or null when it is a literal escape. */
const escapedChar = (sequence: string): string | null => {
  switch (sequence) {
    case 'd':
      return '0'
    case 'w':
      return 'a'
    case 's':
      return ' '
    case 'D':
    case 'S':
      return 'a'
    case 'W':
      return '-'
    case 'n':
      return '\n'
    case 't':
      return '\t'
    case 'r':
      return '\r'
    default:
      return null
  }
}

type Quantifier = { readonly min: number; readonly max: number }
type Node =
  | { readonly kind: 'literal'; readonly value: string; readonly quantifier: Quantifier }
  | { readonly kind: 'class'; readonly value: string; readonly quantifier: Quantifier }
  | { readonly kind: 'group'; readonly alternatives: Node[][]; readonly quantifier: Quantifier }

const ONCE: Quantifier = { min: 1, max: 1 }

/**
 * Picks one character satisfying a `[...]` class body. Ranges contribute their
 * low end, escapes their stand-in, and everything else itself; a negated class
 * picks the first preferred character it does not exclude.
 */
const pickFromClass = (body: string): string | null => {
  const negated = body.startsWith('^')
  const source = negated ? body.slice(1) : body
  const members: string[] = []

  for (let i = 0; i < source.length; i++) {
    const char = source[i] as string
    if (char === '\\') {
      const next = source[++i]
      if (next === undefined) return null
      members.push(escapedChar(next) ?? next)
      continue
    }
    // A range only counts when the `-` sits between two members; a trailing or
    // leading `-` (as in `[a-z0-9-]`) is the literal character.
    if (source[i + 1] === '-' && i + 2 < source.length && source[i + 2] !== ']') {
      const low = char
      const high = source[i + 2] as string
      // Prefer a readable member of the range over its low end where possible.
      const preferred = [...PREFERRED].find((candidate) => candidate >= low && candidate <= high)
      members.push(preferred ?? low)
      i += 2
      continue
    }
    members.push(char)
  }

  if (!negated) {
    // Prefer an alphanumeric member so a synthesized slug reads like one.
    return [...PREFERRED].find((candidate) => members.includes(candidate)) ?? members[0] ?? null
  }
  return [...PREFERRED].find((candidate) => !members.includes(candidate)) ?? null
}

/** Reads the quantifier following a node, defaulting to exactly once. */
const readQuantifier = (pattern: string, start: number): { quantifier: Quantifier; next: number } => {
  const char = pattern[start]
  let quantifier = ONCE
  let next = start

  if (char === '*') {
    quantifier = { min: 0, max: Number.POSITIVE_INFINITY }
    next = start + 1
  } else if (char === '+') {
    quantifier = { min: 1, max: Number.POSITIVE_INFINITY }
    next = start + 1
  } else if (char === '?') {
    quantifier = { min: 0, max: 1 }
    next = start + 1
  } else if (char === '{') {
    const close = pattern.indexOf('}', start)
    const body = close === -1 ? null : pattern.slice(start + 1, close)
    const match = body === null ? null : /^(\d+)(,(\d*)?)?$/.exec(body)
    if (match && close !== -1) {
      const min = Number(match[1])
      const max = match[2] === undefined ? min : match[3] ? Number(match[3]) : Number.POSITIVE_INFINITY
      quantifier = { min, max }
      next = close + 1
    }
  }

  // A lazy or possessive marker changes matching, never the language, so the
  // generated string is unaffected — skip it.
  if (quantifier !== ONCE && (pattern[next] === '?' || pattern[next] === '+')) next += 1
  return { quantifier, next }
}

/** Parses a pattern (or one group body) into alternatives of nodes. */
const parseAlternatives = (pattern: string, start: number, stop: number): { alternatives: Node[][]; next: number } => {
  const alternatives: Node[][] = []
  let current: Node[] = []
  let i = start

  while (i < stop) {
    const char = pattern[i] as string

    if (char === ')') break
    if (char === '|') {
      alternatives.push(current)
      current = []
      i += 1
      continue
    }

    let node: Node | null = null

    if (char === '(') {
      // Skip the group's own prefix: `(?:`, `(?<name>`, or a plain capture.
      let bodyStart = i + 1
      if (pattern.startsWith('(?:', i)) bodyStart = i + 3
      else if (pattern.startsWith('(?<', i)) {
        const close = pattern.indexOf('>', i)
        if (close === -1) return { alternatives: [], next: stop }
        bodyStart = close + 1
      }
      const inner = parseAlternatives(pattern, bodyStart, stop)
      if (pattern[inner.next] !== ')') return { alternatives: [], next: stop }
      const { quantifier, next } = readQuantifier(pattern, inner.next + 1)
      node = { kind: 'group', alternatives: inner.alternatives, quantifier }
      i = next
    } else if (char === '[') {
      // Find the closing bracket, honouring escapes and a leading `]` member.
      let end = i + 1
      if (pattern[end] === '^') end += 1
      if (pattern[end] === ']') end += 1
      while (end < stop && pattern[end] !== ']') end += pattern[end] === '\\' ? 2 : 1
      if (end >= stop) return { alternatives: [], next: stop }
      const picked = pickFromClass(pattern.slice(i + 1, end))
      if (picked === null) return { alternatives: [], next: stop }
      const { quantifier, next } = readQuantifier(pattern, end + 1)
      node = { kind: 'class', value: picked, quantifier }
      i = next
    } else if (char === '\\') {
      const sequence = pattern[i + 1]
      if (sequence === undefined) return { alternatives: [], next: stop }
      const { quantifier, next } = readQuantifier(pattern, i + 2)
      node = { kind: 'literal', value: escapedChar(sequence) ?? sequence, quantifier }
      i = next
    } else if (char === '.') {
      const { quantifier, next } = readQuantifier(pattern, i + 1)
      node = { kind: 'class', value: 'a', quantifier }
      i = next
    } else if (char === '^' || char === '$') {
      i += 1
      continue
    } else {
      const { quantifier, next } = readQuantifier(pattern, i + 1)
      node = { kind: 'literal', value: char, quantifier }
      i = next
    }

    current.push(node)
  }

  alternatives.push(current)
  return { alternatives, next: i }
}

/**
 * Renders nodes into a string. `budget` is how many optional repetitions each
 * variable-length quantifier takes beyond its minimum, which is what lets a
 * caller grow `^[a-z]+$` from `"a"` up to a `minLength` without the generator
 * having to reason about lengths itself.
 */
const render = (nodes: readonly Node[], budget: number): string => {
  let out = ''
  for (const node of nodes) {
    const { min, max } = node.quantifier
    const count = Math.min(min + (max > min ? budget : 0), max)
    const unit = node.kind === 'group' ? render(node.alternatives[0] ?? [], budget) : (node as { value: string }).value
    out += unit.repeat(count)
  }
  return out
}

/** Builds candidate strings for a pattern, shortest first. */
const synthesize = (pattern: string): string[] => {
  if (UNSUPPORTED.test(pattern)) return []
  const { alternatives } = parseAlternatives(pattern, 0, pattern.length)
  const candidates: string[] = []
  for (const alternative of alternatives) {
    // A budget of 0 gives the shortest match; higher budgets grow the
    // variable-length parts so a `minLength` can be satisfied.
    for (let budget = 0; budget <= 64; budget++) {
      const rendered = render(alternative, budget)
      candidates.push(rendered)
      if (rendered.length > 512) break
    }
  }
  return candidates
}

/** Compiles a pattern, preferring the `u` flag the generated code uses. */
const compile = (pattern: string): RegExp | null => {
  try {
    return new RegExp(pattern, 'u')
  } catch {
    try {
      return new RegExp(pattern)
    } catch {
      return null
    }
  }
}

export const generateDefaultFromPattern = (pattern: string, minLength?: number, maxLength?: number): string | null => {
  if (pattern === '') return null
  const regex = compile(pattern)
  if (regex === null) return null

  const low = typeof minLength === 'number' && minLength > 0 ? minLength : 0
  const high = typeof maxLength === 'number' && maxLength >= 0 ? maxLength : Number.POSITIVE_INFINITY

  const fits = (candidate: string): boolean => {
    if (candidate.length < low || candidate.length > high) return false
    // A fresh `lastIndex` is irrelevant without `/g`, but `test` is still the
    // cheapest exact check available for an arbitrary author-supplied pattern.
    return regex.test(candidate)
  }

  // A recognizable shape reads better than "aaa" — but only when it genuinely
  // matches, which is exactly what this list used to be trusted to do and did not.
  for (const candidate of RECOGNIZED_DEFAULTS) {
    if (fits(candidate)) return JSON.stringify(candidate)
  }

  for (const candidate of synthesize(pattern)) {
    if (fits(candidate)) return JSON.stringify(candidate)
  }

  return null
}
