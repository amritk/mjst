import { createBoundedCache } from './bounded-cache'
import type { FilterNode, ParsedFilter } from './filter-expression'
import { parseFilterExpression } from './filter-expression'

/**
 * Evaluates one `[?(...)]` filter against a candidate node. Arguments are passed
 * positionally rather than in a context object because this runs once per node
 * of the document — the allocation would show up on large specs.
 *
 * `path` is the jsonpath-plus string form (`$['a'][0]`) that `@path` exposes, and
 * is only materialized for filters that actually reference it.
 */
export type FilterFn = (
  value: unknown,
  property: string | number | undefined,
  parent: unknown,
  root: unknown,
  path: string,
  parentProperty: string | number | undefined,
) => boolean

/** A filter that either compiled, or the reason it did not. */
export type CompiledFilter = { readonly test: FilterFn; readonly usesPath: boolean } | { readonly error: string }

// A filter that reaches for something the interpreter cannot do (a member of
// `null`, `.match` on a number) fails the same way the old `new Function` body
// did: the node simply does not match. That mirrors JavaScript, where those are
// TypeErrors, and keeps a filter like `@.a.b === 1` usable on nodes that have no
// `a` — which is exactly how rulesets are written.
const filterRuntimeError = (message: string): Error => new Error(message)

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * Reads a member of `object`. Only *own* properties are visible: a filter must
 * not be able to walk to `constructor`, `__proto__`, or any other prototype
 * member, which is what made the old `new Function` evaluator reachable code.
 */
const readMember = (object: unknown, name: string | number): unknown => {
  if (object === null || object === undefined) {
    throw filterRuntimeError(`Cannot read "${name}" of ${object === null ? 'null' : 'undefined'}`)
  }
  if (typeof object === 'string') {
    if (name === 'length') return object.length
    const index = typeof name === 'number' ? name : Number(name)
    return Number.isInteger(index) ? object[index] : undefined
  }
  if (Array.isArray(object)) {
    if (name === 'length') return object.length
    const index = typeof name === 'number' ? name : Number(name)
    return Number.isInteger(index) ? object[index] : undefined
  }
  if (isPlainObject(object)) return Object.hasOwn(object, name) ? object[name] : undefined
  // Numbers and booleans have no own properties worth exposing.
  return undefined
}

/** Coerces a call argument to a string the way `String(...)` would, for scalars only. */
const toStringArgument = (value: unknown): string => {
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean' || value === null || value === undefined) {
    return String(value)
  }
  throw filterRuntimeError('Expected a string-like argument')
}

const toRegExpArgument = (value: unknown): RegExp => {
  if (value instanceof RegExp) return value
  if (typeof value === 'string') return new RegExp(value)
  throw filterRuntimeError('Expected a regular expression argument')
}

/**
 * Runs one of the allowed pure methods. The allowlist lives in the parser (so an
 * unknown method is a *ruleset* error, caught once); this only has to enforce
 * that the receiver has the right shape.
 */
const callMethod = (receiver: unknown, name: string, args: unknown[]): unknown => {
  const [first] = args
  switch (name) {
    case 'indexOf':
    case 'lastIndexOf': {
      if (typeof receiver === 'string') {
        return name === 'indexOf'
          ? receiver.indexOf(toStringArgument(first))
          : receiver.lastIndexOf(toStringArgument(first))
      }
      if (Array.isArray(receiver)) return name === 'indexOf' ? receiver.indexOf(first) : receiver.lastIndexOf(first)
      throw filterRuntimeError(`"${name}" is not a function`)
    }
    case 'includes': {
      if (typeof receiver === 'string') return receiver.includes(toStringArgument(first))
      if (Array.isArray(receiver)) return receiver.includes(first)
      throw filterRuntimeError('"includes" is not a function')
    }
    case 'startsWith':
      if (typeof receiver !== 'string') throw filterRuntimeError('"startsWith" is not a function')
      return receiver.startsWith(toStringArgument(first))
    case 'endsWith':
      if (typeof receiver !== 'string') throw filterRuntimeError('"endsWith" is not a function')
      return receiver.endsWith(toStringArgument(first))
    case 'match':
      if (typeof receiver !== 'string') throw filterRuntimeError('"match" is not a function')
      return receiver.match(toRegExpArgument(first))
    case 'test': {
      if (!(receiver instanceof RegExp)) throw filterRuntimeError('"test" is not a function')
      // A `g`/`y` regex keeps `lastIndex` between calls, which would make the same
      // filter answer differently on consecutive nodes. Reset it first.
      receiver.lastIndex = 0
      return receiver.test(toStringArgument(first))
    }
    case 'toLowerCase':
      if (typeof receiver !== 'string') throw filterRuntimeError('"toLowerCase" is not a function')
      return receiver.toLowerCase()
    case 'toUpperCase':
      if (typeof receiver !== 'string') throw filterRuntimeError('"toUpperCase" is not a function')
      return receiver.toUpperCase()
    case 'trim':
      if (typeof receiver !== 'string') throw filterRuntimeError('"trim" is not a function')
      return receiver.trim()
    default:
      throw filterRuntimeError(`"${name}" is not a function`)
  }
}

/**
 * Abstract (`==`) equality for the values a document can hold. Objects and arrays
 * compare by reference — we deliberately do not run JavaScript's ToPrimitive on
 * them, since `[] == ''` style coercion has no place in a ruleset filter.
 */
const looseEquals = (left: unknown, right: unknown): boolean => {
  if (left === null || left === undefined) return right === null || right === undefined
  if (right === null || right === undefined) return false
  if (typeof left === typeof right) return left === right
  if (typeof left === 'object' || typeof right === 'object') return false
  return Number(left) === Number(right)
}

const compareRelational = (operator: '<' | '<=' | '>' | '>=', left: unknown, right: unknown): boolean => {
  if (typeof left === 'string' && typeof right === 'string') {
    switch (operator) {
      case '<':
        return left < right
      case '<=':
        return left <= right
      case '>':
        return left > right
      default:
        return left >= right
    }
  }
  const a = Number(left)
  const b = Number(right)
  if (Number.isNaN(a) || Number.isNaN(b)) return false
  switch (operator) {
    case '<':
      return a < b
    case '<=':
      return a <= b
    case '>':
      return a > b
    default:
      return a >= b
  }
}

/** The values a filter can read from the node under test. */
type EvaluationContext = {
  value: unknown
  property: string | number | undefined
  parent: unknown
  parentProperty: string | number | undefined
  path: string
  root: unknown
}

const evaluate = (node: FilterNode, context: EvaluationContext): unknown => {
  switch (node.kind) {
    case 'literal':
      return node.value
    case 'regex':
      return node.value
    case 'context':
      return context[node.ref]
    case 'member':
      return readMember(evaluate(node.object, context), node.name)
    case 'computed': {
      const index = evaluate(node.index, context)
      if (typeof index !== 'string' && typeof index !== 'number') {
        throw filterRuntimeError('A computed member must be a string or a number')
      }
      return readMember(evaluate(node.object, context), index)
    }
    case 'call':
      return callMethod(
        evaluate(node.object, context),
        node.name,
        node.args.map((argument) => evaluate(argument, context)),
      )
    case 'unary': {
      if (node.operator === '!') return !evaluate(node.operand, context)
      if (node.operator === 'void') {
        evaluate(node.operand, context)
        return undefined
      }
      return -Number(evaluate(node.operand, context))
    }
    case 'logical': {
      const left = evaluate(node.left, context)
      // `&&`/`||` yield the operand value, not a boolean, because rulesets chain
      // them (`@ && @.type === 'array'`) and rely on the JavaScript semantics.
      if (node.operator === '&&') return left ? evaluate(node.right, context) : left
      return left ? left : evaluate(node.right, context)
    }
    case 'comparison': {
      const left = evaluate(node.left, context)
      const right = evaluate(node.right, context)
      switch (node.operator) {
        case '===':
          return left === right
        case '!==':
          return left !== right
        case '==':
          return looseEquals(left, right)
        case '!=':
          return !looseEquals(left, right)
        default:
          return compareRelational(node.operator, left, right)
      }
    }
  }
}

const toFilterFn = (parsed: ParsedFilter): FilterFn => {
  const { node } = parsed
  return (value, property, parent, root, path, parentProperty) => {
    try {
      return Boolean(evaluate(node, { value, property, parent, parentProperty, path, root }))
    } catch {
      // A filter that cannot be evaluated against *this* node (a member of null,
      // a method on the wrong type) does not match it — the same outcome the
      // expression would have had in JavaScript, where those are TypeErrors.
      return false
    }
  }
}

// Rulesets reuse the same handful of filter bodies across many rules, so parsing
// is memoized. The cache is bounded: a service that accepts a ruleset per request
// must not accumulate one entry per distinct filter string forever.
const filterCache = createBoundedCache<string, CompiledFilter>(500)

/**
 * Compiles a `[?(...)]` filter body into a predicate, or reports why it cannot.
 *
 * There is no `eval` and no `new Function` anywhere in this path: the body is
 * parsed into an AST ({@link parseFilterExpression}) and interpreted. A ruleset
 * — which is data, and often YAML written by someone other than the person
 * running the linter — therefore cannot execute code in the host process.
 */
export const compileFilter = (source: string): CompiledFilter => {
  const cached = filterCache.get(source)
  if (cached) return cached
  const parsed = parseFilterExpression(source)
  const compiled: CompiledFilter =
    'error' in parsed ? { error: parsed.error } : { test: toFilterFn(parsed), usesPath: parsed.usesPath }
  filterCache.set(source, compiled)
  return compiled
}
