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
// `[a,b]` unions, `[n]` indices, `[?(@ ...)]` filters, `^` parent and `~`
// property-name selectors). Two properties matter for performance:
//
//   1. Expressions are *compiled once* into a flat list of steps and cached by
//      string, so repeated `given`s (the ruleset has many) parse a single time.
//   2. Evaluation builds the concrete `path` array directly during traversal —
//      there is no path-string round-trip (`toPathArray`) per match.
//
// The compiled form is also what the runner's query planner groups on, so
// identical `given`s and shared recursive descents can be evaluated once.
// ---------------------------------------------------------------------------

type FilterFn = (
  value: unknown,
  property: string | number | undefined,
  parent: unknown,
  root: unknown,
  path: JsonPath,
  parentProperty: string | number | undefined,
) => boolean

type Selector =
  | { kind: 'child'; name: string }
  | { kind: 'index'; index: number }
  | { kind: 'wildcard' }
  | { kind: 'union'; names: (string | number)[] }
  | { kind: 'filter'; test: FilterFn; source: string; usesPath: boolean }
  | { kind: 'parent' }
  | { kind: 'keys' }

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
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

// jsonpath-plus emits numeric array indices as strings and Linter historically
// normalized *any* all-digit segment (including object keys like "200") to a
// number. Replicate that exactly so source-map lookups are unchanged.
const normalizeSegment = (segment: string | number): string | number => {
  if (typeof segment === 'number') return segment
  if (segment.length > 0 && /^\d+$/.test(segment)) return Number(segment)
  return segment
}

const normalizePath = (path: (string | number)[]): JsonPath => path.map(normalizeSegment)

// ---------------------------------------------------------------------------
// Compilation
// ---------------------------------------------------------------------------

const compileCache = new Map<string, CompiledPath>()
const filterCache = new Map<string, FilterFn>()

const compileFilter = (source: string): FilterFn => {
  const cached = filterCache.get(source)
  if (cached) return cached
  // Map jsonpath-plus' `@`-context tokens onto real identifiers, longest first
  // so `@parentProperty` is not eaten by `@parent`.
  const body = source
    .replace(/@parentProperty/g, '_pp')
    .replace(/@parent/g, '_parent')
    .replace(/@property/g, '_prop')
    .replace(/@path/g, '_path')
    .replace(/@root/g, '_root')
    .replace(/@/g, '_v')
  let fn: FilterFn
  try {
    // `_pp` (`@parentProperty`) is supplied directly by the caller rather than
    // derived from a materialized path, so most filters never force a path
    // allocation. `_path` (`@path`) is only materialized for filters that use it.
    const compiled = new Function(
      '_v',
      '_prop',
      '_parent',
      '_root',
      '_path',
      '_pp',
      `try { return !!(${body}); } catch (_e) { return false; }`,
    ) as FilterFn
    fn = compiled
  } catch {
    fn = () => false
  }
  filterCache.set(source, fn)
  return fn
}

/** Splits bracket content on top-level commas, respecting quotes. */
const splitUnion = (content: string): string[] => {
  const parts: string[] = []
  let depth = 0
  let quote = ''
  let current = ''
  for (let i = 0; i < content.length; i++) {
    const ch = content[i] as string
    if (quote) {
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

const unquote = (token: string): string | null => {
  const t = token.trim()
  if (t.length >= 2 && (t[0] === '"' || t[0] === "'") && t[t.length - 1] === t[0]) {
    return t.slice(1, -1)
  }
  return null
}

const bracketSelector = (content: string): Selector => {
  const trimmed = content.trim()
  if (trimmed === '*') return { kind: 'wildcard' }
  if (trimmed.startsWith('?')) {
    // `?(expr)` — extract the inner expression between the first `(` and last `)`.
    const open = trimmed.indexOf('(')
    const close = trimmed.lastIndexOf(')')
    const expr = open !== -1 && close > open ? trimmed.slice(open + 1, close) : trimmed.slice(1)
    return { kind: 'filter', test: compileFilter(expr), source: expr, usesPath: expr.includes('@path') }
  }
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
    return typeof only === 'number' ? { kind: 'index', index: only } : { kind: 'child', name: only }
  }
  return { kind: 'union', names }
}

/** Finds the index of the `]` that closes the `[` at `start`, respecting quotes/nesting. */
const findBracketEnd = (expression: string, start: number): number => {
  let depth = 0
  let quote = ''
  for (let i = start; i < expression.length; i++) {
    const ch = expression[i]
    if (quote) {
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
  let hasDescent = false
  let i = 0
  if (expression[0] === '$') i = 1
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
      steps.push({ recursive, selector: { kind: 'child', name } })
      recursive = false
      i = end
      continue
    }
    if (ch === '[') {
      const end = findBracketEnd(expression, i)
      if (end === -1) break
      const content = expression.slice(i + 1, end)
      steps.push({ recursive, selector: bracketSelector(content) })
      recursive = false
      i = end + 1
      continue
    }
    if (ch === '^') {
      steps.push({ recursive: false, selector: { kind: 'parent' } })
      i++
      continue
    }
    if (ch === '~') {
      steps.push({ recursive: false, selector: { kind: 'keys' } })
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
        steps.push({ recursive: true, selector: { kind: 'child', name } })
        recursive = false
        i = end
        continue
      }
    }
    i++
  }

  const compiled: CompiledPath = { expression, steps, hasDescent }
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

const EMPTY_PATH: JsonPath = []

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
        if (Object.hasOwn(value, selector.name))
          out.push({ value: value[selector.name], parent: node, key: selector.name })
      } else if (Array.isArray(value) && /^\d+$/.test(selector.name)) {
        const idx = Number(selector.name)
        if (idx < value.length) out.push({ value: value[idx], parent: node, key: idx })
      }
      return
    }
    case 'index': {
      if (Array.isArray(value)) {
        const idx = selector.index < 0 ? value.length + selector.index : selector.index
        if (idx >= 0 && idx < value.length) out.push({ value: value[idx], parent: node, key: idx })
      } else if (isObject(value) && Object.hasOwn(value, selector.index)) {
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
        } else if (isObject(value) && Object.hasOwn(value, name)) {
          out.push({ value: value[name], parent: node, key: name })
        }
      }
      return
    }
    case 'filter': {
      // `@parentProperty` is `node.key`; `@path` is materialized only when used.
      const pp = node.key
      if (Array.isArray(value)) {
        for (let idx = 0; idx < value.length; idx++) {
          const child: Node = { value: value[idx], parent: node, key: idx }
          const path = selector.usesPath ? pathOf(child) : EMPTY_PATH
          if (selector.test(value[idx], idx, value, root, path, pp)) out.push(child)
        }
      } else if (isObject(value)) {
        for (const key of Object.keys(value)) {
          const child: Node = { value: value[key], parent: node, key }
          const path = selector.usesPath ? pathOf(child) : EMPTY_PATH
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
  }
}

/** Visits `node` and every descendant (preorder), invoking `visit` on each. */
const walkDescendants = (node: Node, visit: (n: Node) => void): void => {
  visit(node)
  const value = node.value
  if (Array.isArray(value)) {
    for (let idx = 0; idx < value.length; idx++) walkDescendants({ value: value[idx], parent: node, key: idx }, visit)
  } else if (isObject(value)) {
    for (const key of Object.keys(value)) walkDescendants({ value: value[key], parent: node, key }, visit)
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
    const first = c.steps[0]
    if (first?.recursive) recursive.push(i)
    else out[i] = queryCompiled(data, c)
  }

  if (recursive.length > 0) {
    // Walk the whole tree exactly once, applying every descent path's first
    // selector at each visited node in the same pass (fused descent), so the
    // ~15k-node resolved tree is traversed a single time rather than once per
    // `$..` given. Each path's surviving seeds then run its remaining steps.
    const firsts = recursive.map((i) => (compiled[i] as CompiledPath).steps[0] as Step)
    const seeds: Node[][] = recursive.map(() => [])
    const root: Node = { value: data, parent: undefined, key: undefined }
    walkDescendants(root, (node) => {
      for (let r = 0; r < recursive.length; r++)
        applySelector(node, (firsts[r] as Step).selector, data, seeds[r] as Node[])
    })
    for (let r = 0; r < recursive.length; r++) {
      const c = compiled[recursive[r] as number] as CompiledPath
      out[recursive[r] as number] = toMatches(applySteps(data, seeds[r] as Node[], c.steps.slice(1)))
    }
  }

  return out
}

/** Runs a JSONPath expression and returns each match with its concrete path. */
export const query = (data: unknown, expression: string): IQueryMatch[] => queryCompiled(data, compileQuery(expression))
