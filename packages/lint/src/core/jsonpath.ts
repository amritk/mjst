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
  | { kind: 'filter'; test: FilterFn; source: string; usesPath: boolean; objectsOnly: boolean }
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
    return {
      kind: 'filter',
      test: filter.test,
      source: expr,
      usesPath: filter.usesPath,
      objectsOnly: filter.objectsOnly,
    }
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
 * The keywords whose values a schema-aware descent stays out of: they hold
 * instance data — an example payload, a default, an enumerated value — that
 * can look like a schema without being one.
 */
const DATA_KEYWORDS = new Set(['example', 'examples', 'default', 'const', 'enum'])

/**
 * The keywords whose values map names to schemas (or to other named
 * definitions). Inside one, `default` or `enum` is a name someone chose, not a
 * keyword, so a schema-aware descent goes into it as usual. This covers JSON
 * Schema's own maps and the named-component maps of OpenAPI and AsyncAPI.
 */
const NAME_MAP_KEYWORDS = new Set([
  'properties',
  'patternProperties',
  '$defs',
  'definitions',
  'dependentSchemas',
  'schemas',
  'responses',
  'parameters',
  'headers',
  'requestBodies',
  'securitySchemes',
  'links',
  'callbacks',
  'pathItems',
  'webhooks',
  'encoding',
  'variables',
  'dependencies',
  'messages',
  'channels',
  'operations',
  'servers',
  'serverVariables',
  'messageTraits',
  'operationTraits',
  'correlationIds',
  'replies',
  'replyAddresses',
  'serverBindings',
  'channelBindings',
  'operationBindings',
  'messageBindings',
])

/** Whether `node` is a map of names: the value of a name-map keyword that is itself not a name. */
const isNameMap = (node: Node | undefined): boolean => {
  // Walk up to the root first: whether a node is a name map depends on whether its parent is.
  const chain: Node[] = []
  for (let n = node; n !== undefined && n.parent !== undefined; n = n.parent) chain.push(n)
  let nameMap = false
  for (let i = chain.length - 1; i >= 0; i--) {
    const key = (chain[i] as Node).key
    nameMap = !nameMap && typeof key === 'string' && NAME_MAP_KEYWORDS.has(key)
  }
  return nameMap
}

/** Whether `node` is the value of a data keyword, which a schema-aware descent does not visit or yield. */
const isDataChild = (node: Node): boolean =>
  typeof node.key === 'string' && DATA_KEYWORDS.has(node.key) && isObject(node.parent?.value) && !isNameMap(node.parent)

/**
 * Visits `node` and every descendant (preorder), invoking `visit` on each.
 * Schema-aware, it does not go into the values of data keywords.
 *
 * The traversal keeps its own stack instead of recursing: document depth is
 * attacker-controlled, and a recursive walker turns a deeply nested file into a
 * `RangeError` that takes the whole process down. Children are pushed in reverse
 * so they pop in document order — match order is part of the observable output.
 */
const walkDescendants = (node: Node, visit: (n: Node) => void, schemaAware: boolean): void => {
  const stack: Node[] = [node]
  const nameMaps: boolean[] = [schemaAware && isNameMap(node)]
  while (stack.length > 0) {
    const current = stack.pop() as Node
    const nameMap = nameMaps.pop() as boolean
    visit(current)
    const value = current.value
    if (Array.isArray(value)) {
      for (let idx = value.length - 1; idx >= 0; idx--) {
        stack.push({ value: value[idx], parent: current, key: idx })
        nameMaps.push(false)
      }
    } else if (isObject(value)) {
      const keys = Object.keys(value)
      for (let k = keys.length - 1; k >= 0; k--) {
        const key = keys[k] as string
        if (schemaAware && !nameMap && DATA_KEYWORDS.has(key)) continue
        stack.push({ value: value[key], parent: current, key })
        nameMaps.push(schemaAware && !nameMap && NAME_MAP_KEYWORDS.has(key))
      }
    }
  }
}

/** Applies a list of steps to an existing set of nodes. */
const applySteps = (root: unknown, initial: Node[], steps: Step[], schemaAware = false): Node[] => {
  let current = initial
  for (const step of steps) {
    let next: Node[] = []
    if (step.recursive) {
      for (const node of current) walkDescendants(node, (n) => applySelector(n, step.selector, root, next), schemaAware)
      if (schemaAware) next = next.filter((n) => !isDataChild(n))
    } else {
      for (const node of current) applySelector(node, step.selector, root, next)
    }
    current = next
  }
  return current
}

const runSteps = (root: unknown, steps: Step[], schemaAware = false): Node[] =>
  applySteps(root, [{ value: root, parent: undefined, key: undefined }], steps, schemaAware)

const toMatches = (nodes: Node[]): IQueryMatch[] => {
  const out: IQueryMatch[] = new Array(nodes.length)
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i] as Node
    out[i] = { value: node.value, path: normalizePath(pathOf(node)) }
  }
  return out
}

/** How a path's `..` descents read the document. */
export type QueryOptions = {
  /**
   * Treat the document as JSON Schema (or an OpenAPI/AsyncAPI document) and
   * keep `..` out of instance data: the values of `example`, `examples`,
   * `default`, `const` and `enum` are neither visited nor matched, except
   * where those words are names in a map such as `properties`. A rule that
   * looks at schemas then does not trip over an example payload that happens
   * to read `"type": "object"`, and does not pay to walk it.
   */
  schemaAware?: boolean
}

/** Evaluates a pre-compiled path against `data`. */
export const queryCompiled = (data: unknown, compiled: CompiledPath, options: QueryOptions = {}): IQueryMatch[] => {
  // A malformed path matches nothing rather than falling back to the root.
  if (compiled.error !== undefined) return []
  if (data === null || data === undefined) return []
  return toMatches(runSteps(data, compiled.steps, options.schemaAware === true))
}

/**
 * Evaluates many pre-compiled paths against `data` with **one** walk of the
 * tree for every path that contains a `..` descent, wherever that descent
 * starts. `$..enum`, `$.paths.*..parameters` and
 * `$.components.schemas..[?(@.deprecated)]` all ride the same traversal: a
 * node is visited once, however many rules want to look at it, and a subtree
 * no descent can reach is not visited at all. Paths without a descent are
 * evaluated directly (cheap, no walk).
 *
 * Returns one match array per input path, index-aligned with `compiled`.
 */
export const queryMany = (
  data: unknown,
  compiled: CompiledPath[],
  options: readonly (QueryOptions | undefined)[] = [],
): IQueryMatch[][] => {
  const out: IQueryMatch[][] = new Array(compiled.length)
  if (data === null || data === undefined) {
    for (let i = 0; i < compiled.length; i++) out[i] = []
    return out
  }

  /** Index into `compiled` of every path the shared walk serves. */
  const shared: number[] = []
  const descents: Descent[] = []
  for (let i = 0; i < compiled.length; i++) {
    const c = compiled[i] as CompiledPath
    // Skip malformed paths entirely; they contribute no matches.
    if (c.error !== undefined) {
      out[i] = []
      continue
    }
    const schemaAware = options[i]?.schemaAware === true
    const descent = c.hasDescent ? toDescent(c.steps, schemaAware) : undefined
    if (descent === undefined) {
      out[i] = queryCompiled(data, c, { schemaAware })
      continue
    }
    shared.push(i)
    descents.push(descent)
  }

  if (descents.length > 0) {
    const seeds: Node[][] = descents.map(() => [])
    walkShared(data, descents, seeds)
    for (let d = 0; d < descents.length; d++) {
      const { rest, schemaAware } = descents[d] as Descent
      const seeded = seeds[d] as Node[]
      out[shared[d] as number] = toMatches(rest.length === 0 ? seeded : applySteps(data, seeded, rest, schemaAware))
    }
  }

  return out
}

/** The `@path` string of the child at `key` under `parent`, without allocating a node for it. */
const childPathString = (parent: Node, key: string | number): string => {
  const path = pathOf(parent)
  path.push(key)
  return pathToJsonPathString(path)
}

/**
 * A `..` path split where its first descent begins: the plain steps that lead
 * to it, the descent's own selector, and what runs from each node it yields.
 */
type Descent = {
  /** Non-recursive steps from the root to where the descent starts; each selects children of a node. */
  readonly prefix: Selector[]
  /** The first `..` step's selector, applied at every node at or under the end of `prefix`. */
  readonly first: Selector
  /** Everything after the first `..` step, applied to its matches afterwards. */
  readonly rest: Step[]
  /** Whether the path's descents stay out of instance data (see {@link QueryOptions}). */
  readonly schemaAware: boolean
}

/**
 * Splits `steps` at the first descent, or returns `undefined` when the prefix
 * cannot be followed inside the shared walk. The walk decides membership one
 * child at a time and in document order, so a prefix selector qualifies only
 * when it selects children *of the current node*, in document order, each at
 * most once: a name, an index, a wildcard or a filter. A union (it yields in
 * the order it lists names, and may list one twice), a slice, `^` and `~` keep
 * the per-path evaluation.
 */
const toDescent = (steps: Step[], schemaAware: boolean): Descent | undefined => {
  const prefix: Selector[] = []
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i] as Step
    if (step.recursive) return { prefix, first: step.selector, rest: steps.slice(i + 1), schemaAware }
    const kind = step.selector.kind
    if (kind !== 'child' && kind !== 'index' && kind !== 'wildcard' && kind !== 'filter') return undefined
    prefix.push(step.selector)
  }
  return undefined
}

/**
 * Whether a prefix selector picks the child at `key` of `parent` — the
 * one-child-at-a-time reading of what {@link applySelector} does for a whole
 * node, restricted to the selectors {@link toDescent} admits.
 */
const prefixSelects = (
  selector: Selector,
  parent: Node,
  key: string | number,
  child: unknown,
  root: unknown,
): boolean => {
  const value = parent.value
  switch (selector.kind) {
    case 'child':
      return typeof key === 'number' ? selector.index === key : selector.name === key
    case 'index': {
      if (typeof key === 'number') {
        const idx = selector.index < 0 ? (value as unknown[]).length + selector.index : selector.index
        return idx === key
      }
      return key === String(selector.index)
    }
    case 'wildcard':
      return true
    case 'filter':
      return selector.test(child, key, value, root, selector.usesPath ? childPathString(parent, key) : '', parent.key)
    default:
      return false
  }
}

/**
 * What the shared walk does inside one subtree: which descents are live (their
 * first selector runs at every node here), and which are still working through
 * their prefix (`pending` pairs of descent and prefix position, matched
 * against each child). Scopes are shared by every node they cover and only
 * change where a prefix advances, so a plain subtree costs no allocation.
 */
type Scope = {
  readonly active: readonly number[]
  readonly pending: readonly (readonly [descent: number, step: number])[]
  /** Live descents whose first selector is a plain name, by that name. */
  readonly byName: Map<string, number[]>
  /** Live name descents whose name also indexes an array, which `byName` cannot answer. */
  readonly numericChild: readonly number[]
  readonly wildcards: readonly number[]
  readonly filters: readonly number[]
  /** Live descents with any other first selector, applied node by node. */
  readonly others: readonly number[]
  /** This scope with its pending prefixes dropped — what a child that advances none of them gets. */
  settled: Scope | undefined
  /** Child scopes already built, by which pending prefixes advanced. */
  readonly next: Map<string, Scope>
  /** Whether a live descent is schema-aware, so data keywords need looking out for. */
  readonly schemaAware: boolean
  /** This scope without its schema-aware descents — what the value of a data keyword gets. */
  outsideData: Scope | undefined
}

const createScope = (
  descents: readonly Descent[],
  active: readonly number[],
  pending: readonly (readonly [number, number])[],
): Scope => {
  const byName = new Map<string, number[]>()
  const numericChild: number[] = []
  const wildcards: number[] = []
  const filters: number[] = []
  const others: number[] = []
  let schemaAware = false
  for (const d of active) {
    if ((descents[d] as Descent).schemaAware) schemaAware = true
    const selector = (descents[d] as Descent).first
    if (selector.kind === 'child') {
      const existing = byName.get(selector.name)
      if (existing === undefined) byName.set(selector.name, [d])
      else existing.push(d)
      if (selector.index !== undefined) numericChild.push(d)
    } else if (selector.kind === 'wildcard') wildcards.push(d)
    else if (selector.kind === 'filter') filters.push(d)
    else others.push(d)
  }
  return {
    active,
    pending,
    byName,
    numericChild,
    wildcards,
    filters,
    others,
    settled: undefined,
    next: new Map(),
    schemaAware,
    outsideData: undefined,
  }
}

/** The scope for the value of a data keyword: schema-aware descents stop at its edge. */
const outsideDataScope = (descents: readonly Descent[], scope: Scope): Scope => {
  if (scope.outsideData === undefined) {
    scope.outsideData = createScope(
      descents,
      scope.active.filter((d) => !(descents[d] as Descent).schemaAware),
      scope.pending,
    )
  }
  return scope.outsideData
}

/** The scope a child gets when no pending prefix advances on it. */
const settledScope = (descents: readonly Descent[], scope: Scope): Scope => {
  if (scope.pending.length === 0) return scope
  if (scope.settled === undefined) scope.settled = createScope(descents, scope.active, [])
  return scope.settled
}

/**
 * The scope for a child of a node in `scope`. Each pending prefix whose next
 * selector picks this child either moves one step on or, at its end, makes its
 * descent live from the child down (`..` is descendant-or-*self*).
 */
const childScope = (
  descents: readonly Descent[],
  scope: Scope,
  parent: Node,
  key: string | number,
  child: unknown,
  root: unknown,
): Scope => {
  const pending = scope.pending
  if (pending.length === 0) return scope
  let advanced: (readonly [number, number])[] | undefined
  for (const entry of pending) {
    const [d, step] = entry
    const prefix = (descents[d] as Descent).prefix
    if (prefixSelects(prefix[step] as Selector, parent, key, child, root)) {
      if (advanced === undefined) advanced = []
      advanced.push(entry)
    }
  }
  if (advanced === undefined) return settledScope(descents, scope)
  let signature = ''
  for (const [d, step] of advanced) signature += `${d}:${step},`
  const cached = scope.next.get(signature)
  if (cached !== undefined) return cached
  const active = scope.active.slice()
  const stillPending: (readonly [number, number])[] = []
  for (const [d, step] of advanced) {
    if (step + 1 === (descents[d] as Descent).prefix.length) active.push(d)
    else stillPending.push([d, step + 1])
  }
  const built = createScope(descents, active, stillPending)
  scope.next.set(signature, built)
  return built
}

/** Whether anything in `scope` can still produce a match at or under a node. */
const isLive = (scope: Scope): boolean => scope.active.length > 0 || scope.pending.length > 0

/**
 * Walks the tree once and collects, for every descent, the nodes its first
 * selector matches — the seeds its remaining steps then run from.
 *
 * The matching is inverted, and fused into the step that lists a node's
 * children for the walk anyway. Nearly every descent `given` opens with a
 * plain name (`$..parameters`, `$..enum`, `$..$ref`) or a filter
 * (`..[?(@.deprecated)]`): rather than asking each descent in turn whether a
 * node has its name, or listing a node's children once more per filter, each
 * child is looked at once — one map lookup for the names that want its key,
 * one call per live filter — as it is listed.
 *
 * A child gets a node only when it needs one: when it is a seed, or when the
 * walk has to go into it. Scalars are leaves, so on a typical document most
 * nodes are never allocated. A subtree no descent can reach is skipped whole.
 *
 * Seed order is document order, the order the per-path evaluation produces and
 * the order findings come out in.
 */
const walkShared = (data: unknown, descents: readonly Descent[], seeds: Node[][]): void => {
  const rootActive: number[] = []
  const rootPending: (readonly [number, number])[] = []
  for (let d = 0; d < descents.length; d++) {
    if ((descents[d] as Descent).prefix.length === 0) rootActive.push(d)
    else rootPending.push([d, 0])
  }

  // An explicit stack, as in {@link walkDescendants}: document depth is
  // attacker-controlled, so recursion is not an option.
  const nodes: Node[] = [{ value: data, parent: undefined, key: undefined }]
  const scopes: Scope[] = [createScope(descents, rootActive, rootPending)]
  // Whether each stacked node is a map of names (see `NAME_MAP_KEYWORDS`):
  // tracked only when some descent is schema-aware, which is the only reader.
  const tracksNameMaps = descents.some((descent) => descent.schemaAware)
  const nameMaps: boolean[] = [false]
  while (nodes.length > 0) {
    const current = nodes.pop() as Node
    const outer = scopes.pop() as Scope
    const nameMap = tracksNameMaps ? (nameMaps.pop() as boolean) : false
    const value = current.value
    const base = nodes.length
    if (typeof value === 'object' && value !== null) {
      const isArray = Array.isArray(value)
      const keys = isArray ? undefined : Object.keys(value)
      const length = isArray ? value.length : (keys as string[]).length
      for (let i = 0; i < length; i++) {
        const key: string | number = isArray ? i : ((keys as string[])[i] as string)
        const child = (value as Record<string | number, unknown>)[key]
        // A schema-aware descent neither matches nor enters the value of a data keyword.
        const scope =
          outer.schemaAware && !isArray && !nameMap && DATA_KEYWORDS.has(key as string)
            ? outsideDataScope(descents, outer)
            : outer
        const { byName, wildcards, filters } = scope
        // Allocated on first need, and shared by every seed list and the stack.
        let node: Node | undefined
        if (!isArray) {
          const interested = byName.get(key as string)
          if (interested !== undefined) {
            node = { value: child, parent: current, key }
            for (const d of interested) (seeds[d] as Node[]).push(node)
          }
        }
        if (wildcards.length > 0) {
          if (node === undefined) node = { value: child, parent: current, key }
          for (const d of wildcards) (seeds[d] as Node[]).push(node)
        }
        if (filters.length > 0) {
          const childIsObject = isObject(child)
          for (const d of filters) {
            const selector = (descents[d] as Descent).first as Extract<Selector, { kind: 'filter' }>
            // A filter that can only match an object is not asked about a scalar.
            if (selector.objectsOnly && !childIsObject) continue
            const path = selector.usesPath ? childPathString(current, key) : ''
            if (selector.test(child, key, value, data, path, current.key)) {
              if (node === undefined) node = { value: child, parent: current, key }
              ;(seeds[d] as Node[]).push(node)
            }
          }
        }
        const inner = childScope(descents, scope, current, key, child, data)
        // A scalar has no children to list, so it is only worth visiting for a
        // selector that looks at the node itself (`^`, `~`, an index…).
        const visit = typeof child === 'object' && child !== null ? isLive(inner) : inner.others.length > 0
        if (visit) {
          nodes.push(node === undefined ? { value: child, parent: current, key } : node)
          scopes.push(inner)
          if (tracksNameMaps) nameMaps.push(!isArray && !nameMap && NAME_MAP_KEYWORDS.has(key as string))
        }
      }
      if (isArray) {
        for (const d of outer.numericChild) {
          applySelector(current, (descents[d] as Descent).first, data, seeds[d] as Node[])
        }
      }
      // Children were pushed in document order; reverse them in place so they
      // pop preorder, which is the order matches have to come out in.
      for (let i = base, j = nodes.length - 1; i < j; i++, j--) {
        const heldNode = nodes[i] as Node
        nodes[i] = nodes[j] as Node
        nodes[j] = heldNode
        const heldScope = scopes[i] as Scope
        scopes[i] = scopes[j] as Scope
        scopes[j] = heldScope
        if (tracksNameMaps) {
          const heldNameMap = nameMaps[i] as boolean
          nameMaps[i] = nameMaps[j] as boolean
          nameMaps[j] = heldNameMap
        }
      }
    }
    for (const d of outer.others) {
      const descent = descents[d] as Descent
      if (!descent.schemaAware) {
        applySelector(current, descent.first, data, seeds[d] as Node[])
        continue
      }
      const found: Node[] = []
      applySelector(current, descent.first, data, found)
      for (const node of found) if (!isDataChild(node)) (seeds[d] as Node[]).push(node)
    }
  }
}

/** Runs a JSONPath expression and returns each match with its concrete path. */
export const query = (data: unknown, expression: string, options: QueryOptions = {}): IQueryMatch[] =>
  queryCompiled(data, compileQuery(expression), options)
