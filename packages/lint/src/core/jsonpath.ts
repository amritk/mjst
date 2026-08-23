import { createBoundedCache } from './bounded-cache'
import { compileFilter, type FilterFn } from './filter'
import type { JsonPath } from './types'

/** A single JSONPath match: the matched value and its concrete path from the root. */
export type IQueryMatch = {
  value: unknown
  path: JsonPath
}

// ---------------------------------------------------------------------------
// A small, purpose-built JSONPath engine.
//
// It replaces `jsonpath-plus` for the subset of JSONPath that Linter rulesets
// use (`$`, child/`['child']`, `..` recursive descent, `[*]`/`.*` wildcards,
// `[a,b]` unions, `[n]` indices, `[start:end:step]` slices, `[?(@ ...)]`
// filters, `^` parent and `~` property-name selectors). Two properties matter
// for performance:
//
//   1. Expressions are *compiled once* into a flat list of steps and cached by
//      string, so repeated `given`s (the ruleset has many) parse a single time.
//   2. Evaluation builds the concrete `path` array directly during traversal —
//      there is no path-string round-trip (`toPathArray`) per match.
//
// `[?(...)]` filter bodies are parsed and interpreted (see `./filter`), never
// turned into JavaScript. A ruleset is data — frequently YAML someone else
// wrote — so it must not be able to run code in the linting process.
//
// The compiled form is also what the runner's query planner groups on, so
// identical `given`s and shared recursive descents can be evaluated once.
// ---------------------------------------------------------------------------

type Selector =
  /**
   * `.name` / `['name']`. `index` is the same name read as an array index, or
   * `undefined` when it is not all digits — precomputed here because the check
   * used to run as a regex against the *same* name on every array node the
   * descent reached.
   */
  | { kind: 'child'; name: string; index: number | undefined }
  | { kind: 'index'; index: number }
  | { kind: 'wildcard' }
  | { kind: 'union'; names: (string | number)[] }
  | { kind: 'slice'; start?: number; end?: number; step?: number }
  | { kind: 'scriptIndex'; offset: number }
  | { kind: 'filter'; test: FilterFn; source: string; usesPath: boolean }
  | { kind: 'parent' }
  | { kind: 'keys' }
  // A segment that could not be parsed. The owning path carries the recorded
  // error and evaluates to no matches.
  | { kind: 'none' }

/** One compiled segment of a path: a selector and whether it follows a `..` descent. */
export type Step = {
  /** Whether this step is reached via `..` (descendant-or-self). */
  recursive: boolean
  selector: Selector
}

/** A JSONPath expression compiled into flat steps; the runner's query planner groups on these. */
export type CompiledPath = {
  readonly expression: string
  readonly steps: Step[]
  /** True when the path contains at least one `..` step. */
  readonly hasDescent: boolean
  /**
   * A parse error, when the expression is malformed (an unterminated bracket, a
   * missing `$` root, an unsupported script subscript, …). A compiled path with
   * an error matches nothing; callers such as {@link createRuleset} surface it.
   */
  readonly error?: string
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * True when `name` is a property of `value` that this module considers to exist.
 *
 * A node's members are its own *enumerable* string keys — exactly what a JSON or
 * YAML parser produces, what `Object.keys` returns, and so what every walk here
 * (`$..`, `$.*`, filters, the shared descent seeding) enumerates. Naming one
 * directly has to agree with enumerating it, or `query` and {@link queryMany}
 * answer the same expression differently: the shared descent seeds from
 * `Object.keys`, while a per-path `Object.hasOwn` would also match a
 * non-enumerable own property no walk ever visits.
 *
 * `Object.prototype.propertyIsEnumerable` is called off the prototype because
 * `value` is the linted document: it may well have a key of that name.
 * Inherited properties answer `false`, so this rules out `constructor` and
 * friends for free.
 */
const hasMember = (value: Record<string, unknown>, name: string | number): boolean =>
  Object.prototype.propertyIsEnumerable.call(value, name)

/**
 * True for a non-empty run of ASCII digits — what `/^\d+$/` matched, without
 * the regex. It is asked once per segment of every match's path, which on a
 * large dereferenced spec is hundreds of thousands of calls, and almost all of
 * them are settled by the first character.
 */
const isDigits = (value: string): boolean => {
  const length = value.length
  if (length === 0) return false
  for (let i = 0; i < length; i++) {
    const code = value.charCodeAt(i)
    if (code < 48 || code > 57) return false
  }
  return true
}

/** A `.name` selector, with the array-index reading of `name` worked out once. */
const childSelector = (name: string): Selector => ({
  kind: 'child',
  name,
  index: isDigits(name) ? Number(name) : undefined,
})

// jsonpath-plus emits numeric array indices as strings and Linter historically
// normalized *any* all-digit segment (including object keys like "200") to a
// number. Replicate that exactly so source-map lookups are unchanged.
const normalizeSegment = (segment: string | number): string | number => {
  if (typeof segment === 'number') return segment
  return isDigits(segment) ? Number(segment) : segment
}

const normalizePath = (path: (string | number)[]): JsonPath => path.map(normalizeSegment)

/**
 * Renders a concrete path as the jsonpath-plus string form (`$['a'][0]`). This
 * is what `@path` exposes inside a filter, so ruleset filters authored for
 * Spectral (which run on jsonpath-plus) see the same value.
 */
const pathToJsonPathString = (path: (string | number)[]): string => {
  let out = '$'
  for (const segment of path) {
    if (typeof segment === 'number') out += `[${segment}]`
    else out += `['${segment.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}']`
  }
  return out
}

// ---------------------------------------------------------------------------
// Compilation
// ---------------------------------------------------------------------------

// Bounded so a long-lived process that compiles rulesets from untrusted input
// (one per request, say) cannot grow this map without limit. 500 distinct
// expressions is far more than any real ruleset uses.
const compileCache = createBoundedCache<string, CompiledPath>(500)

/** Splits bracket content on top-level commas, respecting quotes (and their escapes). */
const splitUnion = (content: string): string[] => {
  const parts: string[] = []
  let depth = 0
  let quote = ''
  let current = ''
  for (let i = 0; i < content.length; i++) {
    const ch = content[i] as string
    if (quote) {
      if (ch === '\\' && i + 1 < content.length) {
        current += ch + content[i + 1]
        i++
        continue
      }
      if (ch === quote) quote = ''
      current += ch
      continue
    }
    if (ch === '"' || ch === "'") {
      quote = ch
      current += ch
      continue
    }
    if (ch === '[' || ch === '(') depth++
    else if (ch === ']' || ch === ')') depth--
    if (ch === ',' && depth === 0) {
      parts.push(current)
      current = ''
      continue
    }
    current += ch
  }
  parts.push(current)
  return parts
}

/** Unquotes a `'...'` / `"..."` token, honoring backslash escapes; returns null when not a quoted literal. */
const unquote = (token: string): string | null => {
  const t = token.trim()
  const quote = t[0]
  if (t.length < 2 || (quote !== '"' && quote !== "'")) return null
  let out = ''
  let i = 1
  let closed = false
  while (i < t.length) {
    const ch = t[i] as string
    if (ch === '\\' && i + 1 < t.length) {
      out += t[i + 1]
      i += 2
      continue
    }
    if (ch === quote) {
      closed = true
      i++
      break
    }
    out += ch
    i++
  }
  // A valid literal closes exactly at the end of the token.
  if (!closed || i !== t.length) return null
  return out
}

// A slice is `start:end` or `start:end:step`, each part optional and possibly
// negative, e.g. `0:2`, `-1:`, `::2`, `:`.
const SLICE_RE = /^-?\d*:-?\d*(:-?\d+)?$/

const buildSlice = (trimmed: string): Selector => {
  const [s, e, st] = trimmed.split(':')
  const num = (value: string | undefined): number | undefined =>
    value === undefined || value === '' ? undefined : Number(value)
  const selector: { kind: 'slice'; start?: number; end?: number; step?: number } = { kind: 'slice' }
  const start = num(s)
  const end = num(e)
  const step = num(st)
  if (start !== undefined) selector.start = start
  if (end !== undefined) selector.end = end
  if (step !== undefined) selector.step = step
  return selector
}

const bracketSelector = (content: string, onError: (message: string) => void): Selector => {
  const trimmed = content.trim()
  if (trimmed === '*') return { kind: 'wildcard' }
  if (trimmed.startsWith('?')) {
    // `?(expr)` — extract the inner expression between the first `(` and last `)`.
    const open = trimmed.indexOf('(')
    const close = trimmed.lastIndexOf(')')
    const expr = open !== -1 && close > open ? trimmed.slice(open + 1, close) : trimmed.slice(1)
    const filter = compileFilter(expr)
    // An expression outside the filter grammar is a ruleset bug, so it is
    // reported like any other malformed path segment. It must never degrade into
    // a predicate that quietly matches nothing — that is how a whole class of
    // rules can stop firing without anyone noticing.
    if ('error' in filter) {
      onError(filter.error)
      return { kind: 'none' }
    }
    return { kind: 'filter', test: filter.test, source: expr, usesPath: filter.usesPath }
  }
  if (trimmed.startsWith('(') && trimmed.endsWith(')')) {
    // Script subscript `[(expr)]`. We support the common `(@.length - N)` form
    // (a from-the-end index); anything else is rejected loudly so a typo does not
    // silently match nothing.
    const inner = trimmed.slice(1, -1).trim()
    const lengthOnly = /^@\.length$/.test(inner)
    const withOffset = /^@\.length\s*-\s*(\d+)$/.exec(inner)
    if (lengthOnly) return { kind: 'scriptIndex', offset: 0 }
    if (withOffset) return { kind: 'scriptIndex', offset: -Number(withOffset[1]) }
    onError(`Unsupported script subscript "[${content}]"`)
    return { kind: 'none' }
  }
  // A slice is only a slice when it is a single (comma-free) `:`-delimited token.
  if (!content.includes(',') && SLICE_RE.test(trimmed)) return buildSlice(trimmed)
  const parts = splitUnion(content)
  const names: (string | number)[] = []
  for (const part of parts) {
    const token = part.trim()
    const literal = unquote(token)
    if (literal !== null) {
      names.push(literal)
    } else if (/^-?\d+$/.test(token)) {
      names.push(Number(token))
    } else {
      names.push(token)
    }
  }
  if (names.length === 1) {
    const only = names[0] as string | number
    return typeof only === 'number' ? { kind: 'index', index: only } : childSelector(only)
  }
  return { kind: 'union', names }
}

/** Finds the index of the `]` that closes the `[` at `start`, respecting quotes (and escapes) and nesting. */
const findBracketEnd = (expression: string, start: number): number => {
  let depth = 0
  let quote = ''
  for (let i = start; i < expression.length; i++) {
    const ch = expression[i]
    if (quote) {
      if (ch === '\\') {
        // Skip the escaped character so an escaped quote does not end the string.
        i++
        continue
      }
      if (ch === quote) quote = ''
      continue
    }
    if (ch === '"' || ch === "'") quote = ch
    else if (ch === '[' || ch === '(') depth++
    else if (ch === ')') depth--
    else if (ch === ']') {
      depth--
      if (depth === 0) return i
    }
  }
  return -1
}

const readName = (expression: string, start: number): { name: string; end: number } => {
  let i = start
  while (i < expression.length && !'.[]^~'.includes(expression[i] as string)) i++
  return { name: expression.slice(start, i), end: i }
}

/** Compiles a JSONPath `expression` into a {@link CompiledPath}, cached by string so repeats are free. */
export const compileQuery = (expression: string): CompiledPath => {
  const cached = compileCache.get(expression)
  if (cached) return cached

  const steps: Step[] = []
  const errors: string[] = []
  const onError = (message: string): void => {
    errors.push(message)
  }
  let hasDescent = false
  let i = 0
  // Every well-formed JSONPath is rooted at `$`. Without it the expression would
  // otherwise compile to zero steps and match the document root — a silent bug.
  if (expression[0] === '$') i = 1
  else onError('JSONPath must start with "$"')
  let recursive = false

  while (i < expression.length) {
    const ch = expression[i]
    if (ch === '.') {
      if (expression[i + 1] === '.') {
        recursive = true
        hasDescent = true
        i += 2
        // A bare `..` followed by `.`/end is unusual; loop handles the selector.
        continue
      }
      i++
      if (expression[i] === '*') {
        steps.push({ recursive, selector: { kind: 'wildcard' } })
        recursive = false
        i++
        continue
      }
      const { name, end } = readName(expression, i)
      steps.push({ recursive, selector: childSelector(name) })
      recursive = false
      i = end
      continue
    }
    if (ch === '[') {
      const end = findBracketEnd(expression, i)
      if (end === -1) {
        onError(`Unterminated "[" in "${expression}"`)
        break
      }
      const content = expression.slice(i + 1, end)
      steps.push({ recursive, selector: bracketSelector(content, onError) })
      recursive = false
      i = end + 1
      continue
    }
    if (ch === '^') {
      // Honor a pending `..` so `$..^` selects every node's parent (fixing a
      // flag leak where the descent was dropped and the selector matched nothing).
      steps.push({ recursive, selector: { kind: 'parent' } })
      recursive = false
      i++
      continue
    }
    if (ch === '~') {
      steps.push({ recursive, selector: { kind: 'keys' } })
      recursive = false
      i++
      continue
    }
    if (ch === '*') {
      steps.push({ recursive, selector: { kind: 'wildcard' } })
      recursive = false
      i++
      continue
    }
    // Bare name following `..` (e.g. `$..foo`) or other unexpected token.
    if (recursive) {
      const { name, end } = readName(expression, i)
      if (end > i) {
        steps.push({ recursive: true, selector: childSelector(name) })
        recursive = false
        i = end
        continue
      }
    }
    i++
  }

  const compiled: CompiledPath = {
    expression,
    steps,
    hasDescent,
    ...(errors.length > 0 ? { error: errors.join('; ') } : {}),
  }
  compileCache.set(expression, compiled)
  return compiled
}

// ---------------------------------------------------------------------------
// Evaluation
// ---------------------------------------------------------------------------

// A match is held as a parent-linked node rather than a materialized path
// array. Building `[...path, key]` at every traversal step dominated rule-run
// time on large (`$ref`-resolved) specs; with links we only walk parent
// pointers to build a concrete path for the matches that survive — and for
// filters, only when they reference `@path`.
type Node = {
  value: unknown
  // `undefined` only for the document root.
  parent: Node | undefined
  key: string | number | undefined
}

/** Materializes the concrete (un-normalized) path from root to `node`. */
const pathOf = (node: Node): (string | number)[] => {
  let depth = 0
  for (let n: Node | undefined = node; n !== undefined && n.parent !== undefined; n = n.parent) depth++
  const out = new Array<string | number>(depth)
  let i = depth - 1
  for (let n: Node | undefined = node; n !== undefined && n.parent !== undefined; n = n.parent) {
    out[i--] = n.key as string | number
  }
  return out
}

const applySelector = (node: Node, selector: Selector, root: unknown, out: Node[]): void => {
  const value = node.value
  switch (selector.kind) {
    case 'child': {
      if (isObject(value)) {
        if (hasMember(value, selector.name)) out.push({ value: value[selector.name], parent: node, key: selector.name })
      } else if (Array.isArray(value) && selector.index !== undefined) {
        const idx = selector.index
        if (idx < value.length) out.push({ value: value[idx], parent: node, key: idx })
      }
      return
    }
    case 'index': {
      if (Array.isArray(value)) {
        const idx = selector.index < 0 ? value.length + selector.index : selector.index
        if (idx >= 0 && idx < value.length) out.push({ value: value[idx], parent: node, key: idx })
      } else if (isObject(value) && hasMember(value, selector.index)) {
        out.push({ value: value[selector.index], parent: node, key: selector.index })
      }
      return
    }
    case 'wildcard': {
      if (Array.isArray(value)) {
        for (let idx = 0; idx < value.length; idx++) out.push({ value: value[idx], parent: node, key: idx })
      } else if (isObject(value)) {
        for (const key of Object.keys(value)) out.push({ value: value[key], parent: node, key })
      }
      return
    }
    case 'union': {
      for (const name of selector.names) {
        if (Array.isArray(value)) {
          if (typeof name === 'number') {
            const idx = name < 0 ? value.length + name : name
            if (idx >= 0 && idx < value.length) out.push({ value: value[idx], parent: node, key: idx })
          }
        } else if (isObject(value) && hasMember(value, name)) {
          out.push({ value: value[name], parent: node, key: name })
        }
      }
      return
    }
    case 'slice': {
      if (!Array.isArray(value)) return
      const len = value.length
      const step = selector.step ?? 1
      if (step === 0) return
      const clamp = (raw: number | undefined, fallback: number): number => {
        if (raw === undefined) return fallback
        return raw < 0 ? raw + len : raw
      }
      if (step > 0) {
        const start = Math.max(0, clamp(selector.start, 0))
        const end = Math.min(len, clamp(selector.end, len))
        for (let idx = start; idx < end; idx += step) out.push({ value: value[idx], parent: node, key: idx })
      } else {
        const start = Math.min(len - 1, clamp(selector.start, len - 1))
        const end = Math.max(-1, clamp(selector.end, -1))
        for (let idx = start; idx > end; idx += step) out.push({ value: value[idx], parent: node, key: idx })
      }
      return
    }
    case 'scriptIndex': {
      // `[(@.length - N)]` indexes from the end; N === 0 (`@.length`) is out of range.
      if (!Array.isArray(value)) return
      const idx = value.length + selector.offset
      if (idx >= 0 && idx < value.length) out.push({ value: value[idx], parent: node, key: idx })
      return
    }
    case 'filter': {
      // `@parentProperty` is `node.key`; `@path` is materialized only when used.
      const pp = node.key
      if (Array.isArray(value)) {
        for (let idx = 0; idx < value.length; idx++) {
          const child: Node = { value: value[idx], parent: node, key: idx }
          const path = selector.usesPath ? pathToJsonPathString(pathOf(child)) : ''
          if (selector.test(value[idx], idx, value, root, path, pp)) out.push(child)
        }
      } else if (isObject(value)) {
        for (const key of Object.keys(value)) {
          const child: Node = { value: value[key], parent: node, key }
          const path = selector.usesPath ? pathToJsonPathString(pathOf(child)) : ''
          if (selector.test(value[key], key, value, root, path, pp)) out.push(child)
        }
      }
      return
    }
    case 'parent': {
      if (node.parent !== undefined) out.push(node.parent)
      return
    }
    case 'keys': {
      if (node.parent === undefined) return
      // The selected value is the node's own key, but it occupies the same path.
      out.push({ value: node.key, parent: node.parent, key: node.key })
      return
    }
    case 'none':
      return
  }
}

/**
 * Visits `node` and every descendant (preorder), invoking `visit` on each.
 *
 * The traversal keeps its own stack instead of recursing: document depth is
 * attacker-controlled, and a recursive walker turns a deeply nested file into a
 * `RangeError` that takes the whole process down. Children are pushed in reverse
 * so they pop in document order — match order is part of the observable output.
 */
const walkDescendants = (node: Node, visit: (n: Node) => void): void => {
  const stack: Node[] = [node]
  while (stack.length > 0) {
    const current = stack.pop() as Node
    visit(current)
    const value = current.value
    if (Array.isArray(value)) {
      for (let idx = value.length - 1; idx >= 0; idx--) stack.push({ value: value[idx], parent: current, key: idx })
    } else if (isObject(value)) {
      const keys = Object.keys(value)
      for (let k = keys.length - 1; k >= 0; k--) {
        const key = keys[k] as string
        stack.push({ value: value[key], parent: current, key })
      }
    }
  }
}

/** Applies a list of steps to an existing set of nodes. */
const applySteps = (root: unknown, initial: Node[], steps: Step[]): Node[] => {
  let current = initial
  for (const step of steps) {
    const next: Node[] = []
    if (step.recursive) {
      for (const node of current) walkDescendants(node, (n) => applySelector(n, step.selector, root, next))
    } else {
      for (const node of current) applySelector(node, step.selector, root, next)
    }
    current = next
  }
  return current
}

const runSteps = (root: unknown, steps: Step[]): Node[] =>
  applySteps(root, [{ value: root, parent: undefined, key: undefined }], steps)

const toMatches = (nodes: Node[]): IQueryMatch[] => {
  const out: IQueryMatch[] = new Array(nodes.length)
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i] as Node
    out[i] = { value: node.value, path: normalizePath(pathOf(node)) }
  }
  return out
}

/** Evaluates a pre-compiled path against `data`. */
export const queryCompiled = (data: unknown, compiled: CompiledPath): IQueryMatch[] => {
  // A malformed path matches nothing rather than falling back to the root.
  if (compiled.error !== undefined) return []
  if (data === null || data === undefined) return []
  return toMatches(runSteps(data, compiled.steps))
}

/**
 * Evaluates many pre-compiled paths against `data`, sharing a *single* recursive
 * descent of the tree across every `$..`-rooted path. The ruleset has ~16
 * descent `given`s; walking the (post-deref, ~60k-node) tree once and testing
 * each path's first selector at every node — instead of one full traversal per
 * path — is the dominant rule-run speedup on large specs. Non-recursive paths
 * are evaluated directly (cheap, no descent).
 *
 * Returns one match array per input path, index-aligned with `compiled`.
 */
export const queryMany = (data: unknown, compiled: CompiledPath[]): IQueryMatch[][] => {
  const out: IQueryMatch[][] = new Array(compiled.length)
  if (data === null || data === undefined) {
    for (let i = 0; i < compiled.length; i++) out[i] = []
    return out
  }

  const recursive: number[] = []
  for (let i = 0; i < compiled.length; i++) {
    const c = compiled[i] as CompiledPath
    // Skip malformed paths entirely; they contribute no matches.
    if (c.error !== undefined) {
      out[i] = []
      continue
    }
    const first = c.steps[0]
    if (first?.recursive) recursive.push(i)
    else out[i] = queryCompiled(data, c)
  }

  if (recursive.length > 0) {
    const firsts = recursive.map((i) => (compiled[i] as CompiledPath).steps[0] as Step)
    const seeds: Node[][] = recursive.map(() => [])
    seedDescents(data, firsts, seeds)
    for (let r = 0; r < recursive.length; r++) {
      const c = compiled[recursive[r] as number] as CompiledPath
      out[recursive[r] as number] = toMatches(applySteps(data, seeds[r] as Node[], c.steps.slice(1)))
    }
  }

  return out
}

/**
 * Walks the whole tree once and collects, for every `$..` path, the nodes its
 * first selector matches — the seeds its remaining steps then run from.
 *
 * The traversal is shared across paths (a ruleset has a dozen-odd descent
 * `given`s, and the dereferenced tree is large), and the *matching* is inverted
 * on top of that. Nearly every descent `given` opens with a plain name —
 * `$..parameters`, `$..enum`, `$..$ref` — so asking each path in turn whether
 * this node has its name meant a dozen own-property checks per node. Instead
 * we look at each own key the node already has and ask which paths wanted *it*:
 * one map lookup per key, and a node whose keys nobody named costs nothing.
 *
 * The children are being materialized for the walk anyway, so a seeded child
 * reuses that node rather than allocating a second one for the match.
 *
 * Everything else (`$..*`, `$..[?(...)]`, unions, slices) keeps the general
 * per-path call. Seed order stays document order, which is the order findings
 * come out in.
 */
const seedDescents = (data: unknown, firsts: readonly Step[], seeds: Node[][]): void => {
  /** Own key → the descent paths whose first selector names it. */
  const byName = new Map<string, number[]>()
  /** Paths whose name can also index an array, which `byName` cannot answer for. */
  const numericChild: number[] = []
  /** Paths whose first selector is not a plain name, applied one by one. */
  const others: number[] = []
  for (let r = 0; r < firsts.length; r++) {
    const selector = (firsts[r] as Step).selector
    if (selector.kind !== 'child') {
      others.push(r)
      continue
    }
    const existing = byName.get(selector.name)
    if (existing === undefined) byName.set(selector.name, [r])
    else existing.push(r)
    if (selector.index !== undefined) numericChild.push(r)
  }

  // The same explicit stack as {@link walkDescendants}, and for the same reason:
  // document depth is attacker-controlled, so recursion is not an option.
  const stack: Node[] = [{ value: data, parent: undefined, key: undefined }]
  while (stack.length > 0) {
    const current = stack.pop() as Node
    const value = current.value
    if (Array.isArray(value)) {
      for (let idx = value.length - 1; idx >= 0; idx--) stack.push({ value: value[idx], parent: current, key: idx })
      for (const r of numericChild) applySelector(current, (firsts[r] as Step).selector, data, seeds[r] as Node[])
    } else if (isObject(value)) {
      // Children are pushed in document order (so a seeded one is collected in
      // that order too), then reversed in place so they still pop preorder.
      const base = stack.length
      for (const key of Object.keys(value)) {
        const child: Node = { value: value[key], parent: current, key }
        stack.push(child)
        const interested = byName.get(key)
        if (interested !== undefined) for (const r of interested) (seeds[r] as Node[]).push(child)
      }
      for (let i = base, j = stack.length - 1; i < j; i++, j--) {
        const held = stack[i] as Node
        stack[i] = stack[j] as Node
        stack[j] = held
      }
    }
    for (const r of others) applySelector(current, (firsts[r] as Step).selector, data, seeds[r] as Node[])
  }
}

/** Runs a JSONPath expression and returns each match with its concrete path. */
export const query = (data: unknown, expression: string): IQueryMatch[] => queryCompiled(data, compileQuery(expression))
