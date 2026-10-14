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
//
// The failure is a flag, not an exception. On real rulesets it is the common
// case rather than the exceptional one — `@.type[0] === 'object'` fails on
// every node without a `type`, and every string node besides — and throwing
// (an `Error` with its stack trace, then the unwind) made those failures the
// bulk of a rule pass over a large spec. A failed read raises the flag and
// yields `undefined`; the logical operators stop at a raised flag, and
// {@link toFilterFn} reads a raised flag as "no match" whatever the expression
// went on to compute. Evaluation is synchronous and filters cannot call
// filters, so one module-level flag is never shared by two evaluations.
let failed = false

/** Marks the running evaluation as failed. Returns `undefined` so call sites can `return fail()`. */
const fail = (): undefined => {
  failed = true
  return undefined
}

/**
 * Reads a member of `object`. Only own *enumerable* properties are visible: a
 * filter must not be able to walk to `constructor`, `__proto__`, or any other
 * prototype member, which is what made the old `new Function` evaluator
 * reachable code. Enumerable, not merely own, so `@.foo` sees a node's members
 * on the same terms the surrounding JSONPath walk does — the engine has one
 * answer to "does this node have a `foo`", not two.
 *
 * `propertyIsEnumerable` comes off the prototype because `object` is a node of
 * the linted document and may carry a key of that name. Inherited properties
 * answer `false`, so the prototype walk is ruled out by the same check.
 */
const readMember = (object: unknown, name: string | number): unknown => {
  if (object === null || object === undefined) return fail()
  if (typeof object === 'object') {
    if (Array.isArray(object)) {
      if (name === 'length') return object.length
      const index = typeof name === 'number' ? name : Number(name)
      return Number.isInteger(index) ? object[index] : undefined
    }
    // Most reads in a filter miss (`@.deprecated` on a node without one), and a
    // miss needs no ownership check: whether or not the name is an own
    // enumerable member, the answer is `undefined`. No inherited member of a
    // plain object reads as `undefined`, so a hit still gets the check.
    const member = (object as Record<string | number, unknown>)[name]
    if (member === undefined) return undefined
    return Object.prototype.propertyIsEnumerable.call(object, name) ? member : undefined
  }
  if (typeof object === 'string') {
    if (name === 'length') return object.length
    const index = typeof name === 'number' ? name : Number(name)
    return Number.isInteger(index) ? object[index] : undefined
  }
  // Numbers and booleans have no own properties worth exposing.
  return undefined
}

/** Coerces a call argument to a string the way `String(...)` would, for scalars only. */
const toStringArgument = (value: unknown): string => {
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean' || value === null || value === undefined) {
    return String(value)
  }
  return fail() as never
}

const toRegExpArgument = (value: unknown): RegExp => {
  if (value instanceof RegExp) return value
  if (typeof value === 'string') return new RegExp(value)
  return fail() as never
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
      return fail()
    }
    case 'includes': {
      if (typeof receiver === 'string') return receiver.includes(toStringArgument(first))
      if (Array.isArray(receiver)) return receiver.includes(first)
      return fail()
    }
    case 'startsWith':
      if (typeof receiver !== 'string') return fail()
      return receiver.startsWith(toStringArgument(first))
    case 'endsWith':
      if (typeof receiver !== 'string') return fail()
      return receiver.endsWith(toStringArgument(first))
    case 'match':
      if (typeof receiver !== 'string') return fail()
      return receiver.match(toRegExpArgument(first))
    case 'test': {
      if (!(receiver instanceof RegExp)) return fail()
      // A `g`/`y` regex keeps `lastIndex` between calls, which would make the same
      // filter answer differently on consecutive nodes. Reset it first.
      receiver.lastIndex = 0
      return receiver.test(toStringArgument(first))
    }
    case 'toLowerCase':
      if (typeof receiver !== 'string') return fail()
      return receiver.toLowerCase()
    case 'toUpperCase':
      if (typeof receiver !== 'string') return fail()
      return receiver.toUpperCase()
    case 'trim':
      if (typeof receiver !== 'string') return fail()
      return receiver.trim()
    default:
      return fail()
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

/**
 * One compiled expression node. It takes the six values a filter can read
 * positionally rather than in a context object: this runs once per node of the
 * document — on a large dereferenced spec, hundreds of thousands of times per
 * lint — so the object the old walker built per call was pure garbage.
 */
type Thunk = (
  value: unknown,
  property: string | number | undefined,
  parent: unknown,
  parentProperty: string | number | undefined,
  path: string,
  root: unknown,
) => unknown

/** A run of member reads with fixed names (`@.a.b`, `@.type[0]`, `@['$ref']`) off one base. */
type MemberChain = { base: FilterNode; names: (string | number)[] }

/**
 * Unrolls `node` into a {@link MemberChain} when every read in it has a fixed
 * name — a `.name`, or a bracket holding a string or number literal, which is
 * all a computed read with a constant key can be. `undefined` for anything
 * else.
 */
const memberChain = (node: FilterNode): MemberChain | undefined => {
  const names: (string | number)[] = []
  let current = node
  while (true) {
    if (current.kind === 'member') names.push(current.name)
    else if (
      current.kind === 'computed' &&
      current.index.kind === 'literal' &&
      (typeof current.index.value === 'string' || typeof current.index.value === 'number')
    ) {
      names.push(current.index.value)
    } else break
    current = current.object
  }
  if (names.length === 0) return undefined
  names.reverse()
  return { base: current, names }
}

/** Compiles a member chain into one closure that reads each name in turn. */
const compileMemberChain = ({ base, names }: MemberChain): Thunk => {
  const count = names.length
  const read = (object: unknown): unknown => {
    let current = object
    for (let i = 0; i < count; i++) {
      current = readMember(current, names[i] as string | number)
      if (failed) return undefined
    }
    return current
  }
  // Reading off the candidate itself is most of what a filter does; skip the
  // call that would only hand it back.
  if (base.kind === 'context' && base.ref === 'value') {
    if (count === 1) {
      const name = names[0] as string | number
      return (value) => readMember(value, name)
    }
    return (value) => read(value)
  }
  const object = compileNode(base)
  return (value, property, parent, parentProperty, path, root) =>
    read(object(value, property, parent, parentProperty, path, root))
}

/**
 * Turns one parsed node into a closure that computes it.
 *
 * The predecessor walked the AST on every evaluation, re-reading `node.kind`
 * and re-dispatching through a `switch` at each node — the same decisions, for
 * the same expression, once per document node. Compiling those decisions into
 * closures makes each evaluation a chain of direct calls, and it lifts the
 * per-operator branches (`&&` vs `||`, `===` vs `<`) out of the hot path too.
 * A CPU profile of a full lint of a 2.8 MB OpenAPI spec put ~15% of the run in
 * the old walker.
 *
 * Still no `eval` and no `new Function`: these are ordinary closures over a
 * parsed tree, so a ruleset — which is data, often written by someone other
 * than the person running the linter — still cannot execute code here.
 */
const compileNode = (node: FilterNode): Thunk => {
  switch (node.kind) {
    case 'literal':
    case 'regex': {
      const constant = node.value
      return () => constant
    }
    case 'context': {
      switch (node.ref) {
        case 'value':
          return (value) => value
        case 'property':
          return (_value, property) => property
        case 'parent':
          return (_value, _property, parent) => parent
        case 'parentProperty':
          return (_value, _property, _parent, parentProperty) => parentProperty
        case 'path':
          return (_value, _property, _parent, _parentProperty, path) => path
        default:
          return (_value, _property, _parent, _parentProperty, _path, root) => root
      }
    }
    case 'member':
    case 'computed': {
      const chain = memberChain(node)
      if (chain !== undefined) return compileMemberChain(chain)
      // Only a computed member with a non-literal key gets here.
      const computed = node as Extract<FilterNode, { kind: 'computed' }>
      const object = compileNode(computed.object)
      const index = compileNode(computed.index)
      return (value, property, parent, parentProperty, path, root) => {
        const key = index(value, property, parent, parentProperty, path, root)
        if (typeof key !== 'string' && typeof key !== 'number') {
          return fail()
        }
        return readMember(object(value, property, parent, parentProperty, path, root), key)
      }
    }
    case 'call': {
      const object = compileNode(node.object)
      const name = node.name
      const args = node.args.map(compileNode)
      const arity = args.length
      return (value, property, parent, parentProperty, path, root) => {
        const values = new Array<unknown>(arity)
        for (let i = 0; i < arity; i++) {
          values[i] = (args[i] as Thunk)(value, property, parent, parentProperty, path, root)
        }
        const receiver = object(value, property, parent, parentProperty, path, root)
        // Nothing after a failed read can change the verdict; skip the call.
        if (failed) return undefined
        return callMethod(receiver, name, values)
      }
    }
    case 'unary': {
      const operand = compileNode(node.operand)
      if (node.operator === '!') {
        return (value, property, parent, parentProperty, path, root) =>
          !operand(value, property, parent, parentProperty, path, root)
      }
      if (node.operator === 'void') {
        return (value, property, parent, parentProperty, path, root) => {
          operand(value, property, parent, parentProperty, path, root)
          return undefined
        }
      }
      return (value, property, parent, parentProperty, path, root) =>
        -Number(operand(value, property, parent, parentProperty, path, root))
    }
    case 'logical': {
      // `a && b && c` parses as `(a && b) && c`; run the whole chain as one loop
      // instead of a closure per operator.
      const operator = node.operator
      const operands: Thunk[] = []
      const collect = (operand: FilterNode): void => {
        if (operand.kind === 'logical' && operand.operator === operator) {
          collect(operand.left)
          collect(operand.right)
        } else operands.push(compileNode(operand))
      }
      collect(node)
      const count = operands.length
      // `&&`/`||` yield the operand value, not a boolean, because rulesets chain
      // them (`@ && @.type === 'array'`) and rely on the JavaScript semantics.
      if (operator === '&&') {
        return (value, property, parent, parentProperty, path, root) => {
          let outcome: unknown
          for (let i = 0; i < count; i++) {
            outcome = (operands[i] as Thunk)(value, property, parent, parentProperty, path, root)
            if (failed) return undefined
            if (!outcome) return outcome
          }
          return outcome
        }
      }
      return (value, property, parent, parentProperty, path, root) => {
        let outcome: unknown
        for (let i = 0; i < count; i++) {
          outcome = (operands[i] as Thunk)(value, property, parent, parentProperty, path, root)
          if (failed) return undefined
          if (outcome) return outcome
        }
        return outcome
      }
    }
    case 'comparison': {
      const left = compileNode(node.left)
      // Comparing against a literal (`@.type === 'object'`) is the usual shape;
      // read the constant directly rather than calling a thunk for it.
      if (node.right.kind === 'literal' && (node.operator === '===' || node.operator === '!==')) {
        const constant = node.right.value
        return node.operator === '==='
          ? (value, property, parent, parentProperty, path, root) =>
              left(value, property, parent, parentProperty, path, root) === constant
          : (value, property, parent, parentProperty, path, root) =>
              left(value, property, parent, parentProperty, path, root) !== constant
      }
      const right = compileNode(node.right)
      switch (node.operator) {
        case '===':
          return (value, property, parent, parentProperty, path, root) =>
            left(value, property, parent, parentProperty, path, root) ===
            right(value, property, parent, parentProperty, path, root)
        case '!==':
          return (value, property, parent, parentProperty, path, root) =>
            left(value, property, parent, parentProperty, path, root) !==
            right(value, property, parent, parentProperty, path, root)
        case '==':
          return (value, property, parent, parentProperty, path, root) =>
            looseEquals(
              left(value, property, parent, parentProperty, path, root),
              right(value, property, parent, parentProperty, path, root),
            )
        case '!=':
          return (value, property, parent, parentProperty, path, root) =>
            !looseEquals(
              left(value, property, parent, parentProperty, path, root),
              right(value, property, parent, parentProperty, path, root),
            )
        default: {
          const operator = node.operator
          return (value, property, parent, parentProperty, path, root) =>
            compareRelational(
              operator,
              left(value, property, parent, parentProperty, path, root),
              right(value, property, parent, parentProperty, path, root),
            )
        }
      }
    }
  }
}

const toFilterFn = (parsed: ParsedFilter): FilterFn => {
  const test = compileNode(parsed.node)
  return (value, property, parent, root, path, parentProperty) => {
    failed = false
    try {
      const outcome = test(value, property, parent, parentProperty, path, root)
      // A filter that cannot be evaluated against *this* node (a member of null,
      // a method on the wrong type) does not match it — the same outcome the
      // expression would have had in JavaScript, where those are TypeErrors.
      return failed ? false : Boolean(outcome)
    } catch {
      // What still throws is the host itself: an invalid pattern handed to
      // `.match`, say. It is the same "cannot evaluate here" outcome.
      return false
    } finally {
      failed = false
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
