/**
 * The runtime half of the validator: the state one validation run threads
 * through, and the primitives the compiled steps in `compile.ts` are built out
 * of — equality, type tests, failure recording, `$ref` resolution.
 *
 * The split exists because almost everything a validation used to rediscover on
 * every call is a pure function of the schema node, and so belongs on the other
 * side of it. `compile.ts` walks a node once and hands back a closure that
 * already knows which keywords the node carries; what is left here is only what
 * genuinely depends on the value and the run. Nothing in this file uses `eval`
 * or `new Function` — that is the whole point of the package — so the compiled
 * form is a tree of ordinary closures, not generated source.
 */

import { validationLimitError } from '@/interpreter/limits'
import { resolveDynamicRef, resolveRecursiveRef } from '@/interpreter/resolve-dynamic-ref'
import { resolveLocalRef } from '@/interpreter/resolve-local-ref'
import { resolveScopedRef, type ScopedTarget } from '@/interpreter/resolve-scoped-ref'
import type { SchemaRegistry } from '@/interpreter/schema-registry'
import type { ValidationError } from '@/types'

/**
 * The one artifact of a validation that cannot be settled when the schema is
 * compiled: resolved `$ref` targets. A plain `$ref` resolves against the root
 * and a scoped one against the base URI in scope, so the answer depends on the
 * run rather than the node, and it is shared here across a run and its nested
 * branch contexts. Each map is allocated lazily on first use, so the common
 * `$ref`-free schema never allocates one — which is what a single (first-run)
 * validation is most sensitive to.
 */
export type ValidatorCaches = {
  /**
   * Resolved static `$ref` targets, keyed by the ref string.
   *
   * `$dynamicRef` gets its own map rather than a prefixed key in this one: the
   * same fragment can resolve differently as a dynamic anchor than as a static
   * pointer, and one shared map let a resolved `$dynamicRef: '#x'` (cached as
   * `dyn:#x`) answer a later `$ref: 'dyn:#x'` — a URI naming no registered
   * document, which has to fail loudly. Separate maps make that impossible
   * without spending a string concatenation per `$ref` on the hot path.
   */
  ref: Map<string, unknown> | null
  /** Resolved `$dynamicRef` targets — see {@link ValidatorCaches.ref}. */
  dynamicRef: Map<string, unknown> | null
  /**
   * The document's one `$recursiveRef` target, resolved on first use. A single
   * slot, not a map: 2019-09 allows exactly one target per document.
   */
  recursiveRef: { value: unknown } | null
  /**
   * Resolved `$ref`s for a document with `$id`s: base URI in scope → ref → target.
   * Nested rather than keyed on a composite string because the same ref resolves
   * differently from inside different `$id` scopes, and building `${base} ${ref}`
   * meant allocating and hashing a fresh string on every reference followed.
   */
  scopedRef: Map<string, Map<string, ScopedTarget>> | null
}

export const newValidatorCaches = (): ValidatorCaches => ({
  ref: null,
  dynamicRef: null,
  recursiveRef: null,
  scopedRef: null,
})

/**
 * The dynamic scope: the base URIs of the schema resources evaluation has
 * entered to reach the current node, outermost first. `$dynamicRef` walks it to
 * find the outermost matching `$dynamicAnchor`, and its last entry is always the
 * base URI in scope, which is what a plain `$ref` resolves against.
 *
 * It is threaded as an immutable array parameter rather than kept as a mutable
 * stack on the context precisely because the interpreter forks: `anyOf` probes,
 * `not`, and every early return would each need their own unwind. Copying only
 * ever happens when a resource boundary is actually crossed, and a document with
 * no `$id` shares one empty array for the whole run.
 */
export type DynamicScope = readonly string[]

/** The scope for a document that declares no `$id` — shared, so it never allocates. */
export const NO_DYNAMIC_SCOPE: DynamicScope = []

/** Extends `scope` with `base`, unless we are already in that resource. */
export const enterResource = (scope: DynamicScope, base: string): DynamicScope =>
  base === scope[scope.length - 1] ? scope : [...scope, base]

/**
 * The scope in effect *at* `node`, accounting for an `$id` it declares. Called
 * only for a document that has a registry *and* a node that declares an `$id`
 * (both tested by the caller off cheap flags), so an ordinary schema never pays
 * for the lookup.
 */
export const scopeAtNode = (
  registry: SchemaRegistry,
  node: Record<string, unknown>,
  scope: DynamicScope,
): DynamicScope => {
  const base = registry.baseOf.get(node)
  return base === undefined ? scope : enterResource(scope, base)
}

/**
 * Mutable state threaded through a single validation run.
 *
 * Deliberately small: everything a *node* fixes — which keywords it carries,
 * its compiled patterns, whether formats assert, whether the validation
 * vocabulary asserts — is settled when the node is compiled and closed over by
 * its step, so it does not have to be carried here and copied into every branch
 * probe. What is left is the value-and-run state: the failure sink, the ref
 * cycle stack, and the shared budget.
 */
export type InterpreterContext = {
  /** The root schema document, used to resolve local `$ref` pointers. */
  readonly root: unknown
  /**
   * The document's `$id` resource registry, or `null` when it declares no `$id`
   * — in which case every base-URI code path below is skipped outright.
   */
  readonly registry: SchemaRegistry | null
  /**
   * Whether this run collects every error (the {@link ValidationError} path) or
   * short-circuits to a boolean on the first failure (the guard path).
   */
  readonly emitErrors: boolean
  /** Lazily-built `$ref` target caches, shared with nested branch contexts. */
  readonly caches: ValidatorCaches
  /** Collected errors, lazily allocated so valid input never allocates. */
  errors: ValidationError[] | null
  /** Set in guard mode on the first failure so the walk can unwind. */
  failed: boolean
  /**
   * The active `$ref`/`$dynamicRef` recursion path as flattened `schema, value`
   * pairs. Shared by reference with nested branch contexts so a cycle routed
   * through `anyOf`/`oneOf` is still seen. Push/pop is balanced around each ref
   * edge, so it only ever holds current ancestors — see {@link interpretRef}.
   */
  readonly refStack: unknown[]
  /** Recursion-depth ceiling (see {@link ValidateLimits.maxDepth}). */
  readonly maxDepth: number
  /**
   * Remaining work budget, shared by reference with nested branch contexts so an
   * exponential `anyOf`/`oneOf` fan-out draws down one shared pool rather than a
   * fresh budget per branch (see {@link ValidateLimits.maxSteps}). A holder
   * object rather than a bare number precisely so the reference is shared.
   */
  readonly budget: { steps: number }
}

/**
 * The failure a run hits when data nested deeper than the ceiling meets a
 * recursive schema. Kept next to {@link spend} because the two are the node
 * prologue every compiled step opens with, and they have to stay worded exactly
 * as they were when the walker raised them inline.
 */
export const depthLimitError = (maxDepth: number): Error =>
  validationLimitError(
    `Validation exceeded its maximum depth of ${maxDepth} (deeply nested data against a recursive ` +
      'schema). Raise it with `limits: { maxDepth }` if the schema and data are trusted.',
  )

/** Charges one unit of the shared work budget, throwing once it is exhausted. */
export const spend = (ctx: InterpreterContext): void => {
  if (--ctx.budget.steps < 0) {
    throw validationLimitError(
      'Validation exceeded its step budget (possible exponential/quadratic schema or input). ' +
        'Raise it with `limits: { maxSteps }` if the schema and data are trusted.',
    )
  }
}

export const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

export const isPrimitiveEnumValue = (value: unknown): boolean =>
  value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'

/**
 * Annotation tracker for `unevaluatedProperties` / `unevaluatedItems`. These
 * 2020-12 keywords act on whatever a value's *other* keywords — including
 * in-place applicators (`allOf`, `$ref`, `if`/`then`/`else`, successful
 * `anyOf`/`oneOf` branches, `dependentSchemas`) — left untouched. We collect the
 * evaluated property keys / item indices for one instance location as those
 * keywords run, then the unevaluated keyword consults what is left.
 *
 * A tracker is created only when a schema node actually carries an
 * `unevaluated*` keyword, so the common path allocates nothing.
 */
export type Evaluation = {
  props: Set<string>
  /** Set once a schema-form `additionalProperties`/`unevaluatedProperties` swept every remaining key. */
  allProps: boolean
  items: Set<number>
  /** Set once a tail `items` schema swept every remaining index. */
  allItems: boolean
}

export const newEvaluation = (): Evaluation => ({
  props: new Set(),
  allProps: false,
  items: new Set(),
  allItems: false,
})

export const mergeEvaluation = (into: Evaluation, from: Evaluation): void => {
  for (const p of from.props) into.props.add(p)
  if (from.allProps) into.allProps = true
  for (const i of from.items) into.items.add(i)
  if (from.allItems) into.allItems = true
}

/**
 * Guards {@link deepEqual} against cyclic input. JSON data is acyclic, but this
 * validator is a plain function applied to arbitrary in-memory values, so a
 * self-referential object reaching `const`/`enum`/`uniqueItems` would otherwise
 * recurse until the stack overflows. A generous depth cap turns that crash into
 * an ordinary "not equal" without ever tripping on real (finite) data.
 */
const MAX_EQUAL_DEPTH = 512

/**
 * Deep structural equality, matching the comparison the generated validator
 * used for `const`, `enum`, and `uniqueItems`: arrays compare element-wise,
 * objects compare own enumerable keys, everything else uses SameValueZero (so
 * `NaN` equals `NaN`, matching the native `Set` fast path in {@link allUnique}
 * and {@link getEnumSet}). Depth-capped so cyclic input fails rather than throws.
 */
export const deepEqual = (a: unknown, b: unknown, depth = 0): boolean => {
  // SameValueZero: `a === b` covers everything except NaN, which we treat as
  // equal to itself so the structural and Set-based paths agree.
  if (a === b || (Number.isNaN(a) && Number.isNaN(b))) return true
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false
  if (depth >= MAX_EQUAL_DEPTH) return false
  const aArr = Array.isArray(a)
  const bArr = Array.isArray(b)
  if (aArr !== bArr) return false
  if (aArr) {
    const aa = a as unknown[]
    const bb = b as unknown[]
    if (aa.length !== bb.length) return false
    for (let i = 0; i < aa.length; i++) if (!deepEqual(aa[i], bb[i], depth + 1)) return false
    return true
  }
  const ao = a as Record<string, unknown>
  const bo = b as Record<string, unknown>
  const keys = Object.keys(ao)
  if (keys.length !== Object.keys(bo).length) return false
  for (const k of keys) {
    if (!Object.hasOwn(bo, k) || !deepEqual(ao[k], bo[k], depth + 1)) return false
  }
  return true
}

/**
 * A cheap, order-independent structural hash consistent with {@link deepEqual}:
 * `deepEqual(a, b)` implies `structuralHash(a) === structuralHash(b)`. It buckets
 * candidate-equal elements in {@link allUnique} so the exact `deepEqual` compare
 * runs only within a bucket — turning the realistic "array of distinct objects"
 * case from O(n²) into ~O(n). Object keys are folded commutatively (XOR) so key
 * order does not change the hash; `NaN`/`-0` collapse to match SameValueZero.
 * Depth-capped like `deepEqual`, so over-deep values simply share a bucket and
 * are settled by the (also depth-capped) `deepEqual` — never a wrong verdict.
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
  if (t !== 'object') return 0x5eed // symbol/function/undefined — rare in JSON data
  if (depth >= MAX_EQUAL_DEPTH) return 0xdee9 // over-deep: share a bucket, deepEqual settles it
  if (Array.isArray(value)) {
    let h = 0x12345 ^ value.length
    for (let i = 0; i < value.length; i++) h = (Math.imul(h, 31) + structuralHash(value[i], depth + 1)) | 0
    return h | 0
  }
  const obj = value as Record<string, unknown>
  const keys = Object.keys(obj)
  let h = 0xabcde ^ keys.length
  // Commutative fold: XOR each key/value contribution so ordering is irrelevant,
  // matching deepEqual's key-order-independent comparison.
  for (const k of keys) {
    let kh = 0x811c9dc5
    for (let i = 0; i < k.length; i++) kh = Math.imul(kh ^ k.charCodeAt(i), 0x01000193)
    h = (h ^ (Math.imul(kh, 0x9e3779b1) + structuralHash(obj[k], depth + 1))) | 0
  }
  return h | 0
}

/** True when every element of `arr` is distinct by {@link deepEqual}. */
export const allUnique = (ctx: InterpreterContext, arr: readonly unknown[]): boolean => {
  const len = arr.length
  if (len < 2) return true

  // Fast path: when every element is a primitive, dedupe in one linear pass via
  // a native Set. Set membership is SameValueZero, which is already type-sensitive
  // (1, "1", and true are three distinct entries), so it matches JSON Schema's
  // equality for primitives without allocating a stringified key per element.
  // Objects/arrays fall back to the structural comparison below.
  let allPrimitive = true
  for (let i = 0; i < len; i++) {
    const v = arr[i]
    if (v !== null && typeof v === 'object') {
      allPrimitive = false
      break
    }
  }
  if (allPrimitive) return new Set(arr).size === len

  // Structural path: bucket by hash, then run the exact `deepEqual` only within a
  // bucket. Distinct objects land in distinct buckets (~O(n)); the O(n²) pairwise
  // fallback survives only inside a bucket (equal or hash-colliding elements), and
  // every comparison there charges the step budget so a crafted all-collide input
  // fails loudly instead of hanging.
  const buckets = new Map<number, unknown[]>()
  for (let i = 0; i < len; i++) {
    const item = arr[i]
    const h = structuralHash(item)
    const bucket = buckets.get(h)
    if (bucket === undefined) {
      buckets.set(h, [item])
      continue
    }
    for (const seen of bucket) {
      spend(ctx)
      if (deepEqual(seen, item)) return false
    }
    bucket.push(item)
  }
  return true
}

/** True when `value` satisfies a single JSON Schema `type` keyword. */
export const matchesType = (type: string, value: unknown): boolean => {
  switch (type) {
    case 'string':
      return typeof value === 'string'
    case 'number':
      return typeof value === 'number'
    case 'integer':
      return Number.isInteger(value)
    case 'boolean':
      return typeof value === 'boolean'
    case 'null':
      return value === null
    case 'object':
      return typeof value === 'object' && value !== null && !Array.isArray(value)
    case 'array':
      return Array.isArray(value)
    default:
      // Unknown type keyword — a schema error, not a data error. Silently
      // matching everything would disable the constraint (a typo'd
      // `type: "strng"` accepting any value), so fail loudly instead, the same
      // contract as an unresolvable `$ref`.
      throw new Error(
        `Unknown type "${type}" in schema — expected one of: string, number, integer, boolean, null, object, array`,
      )
  }
}

/**
 * Records a failure. In error mode it appends `{ message, path }` (allocating
 * the array on first use); in guard mode it just trips the `failed` flag so the
 * walk unwinds without building any error objects.
 */
export const fail = (ctx: InterpreterContext, message: string, path: string): void => {
  if (ctx.emitErrors) {
    if (ctx.errors === null) ctx.errors = []
    ctx.errors.push({ message, path })
  } else {
    ctx.failed = true
  }
}

/**
 * Builds the child instance path for a nested property or item. In guard mode
 * the path is never read — {@link fail} only records it when `emitErrors` is set
 * — so we skip the concatenation and thread the parent path down unchanged. That
 * keeps every property/item recursion allocation-free on the guard hot path,
 * where a single validation is otherwise dominated by these throwaway strings.
 *
 * When a path *is* built, a property name is escaped for JSON Pointer (RFC 6901):
 * `~` → `~0`, `/` → `~1`, so `a/b` doesn't collide with `b` under `a`. The escape
 * is gated behind a two-char scan that virtually every real key (and every array
 * index) fails, so the common case stays a bare concatenation.
 */
export const escapePointer = (key: string): string =>
  key.indexOf('/') !== -1 || key.indexOf('~') !== -1 ? key.replace(/~/g, '~0').replace(/\//g, '~1') : key

export const childPath = (ctx: InterpreterContext, path: string, key: string | number): string => {
  if (!ctx.emitErrors) return path
  return `${path}/${typeof key === 'string' ? escapePointer(key) : key}`
}

/**
 * Counts Unicode code points in `value`, as JSON Schema's `minLength`/`maxLength`
 * require — `String.length` counts UTF-16 code units, so a single astral
 * character (e.g. an emoji) would otherwise count as 2. Iterating the string
 * yields code points without allocating an intermediate array.
 */
export const codePointLength = (value: string): number => {
  let count = 0
  for (let i = 0; i < value.length; i++) {
    count++
    const c = value.charCodeAt(i)
    // A high surrogate followed by a low surrogate is one code point: skip the pair.
    if (c >= 0xd800 && c <= 0xdbff && i + 1 < value.length) {
      const next = value.charCodeAt(i + 1)
      if (next >= 0xdc00 && next <= 0xdfff) i++
    }
  }
  return count
}

/**
 * Compiles a JSON Schema `pattern` source. 2020-12 regexes should be interpreted
 * as Unicode (Ajv compiles with `u` by default): without it `^.$` rejects a single
 * astral character and `\p{L}` is misread. Fall back to a non-Unicode compile for
 * the rare legacy pattern that is only valid without the stricter `u` escapes.
 */
export const compilePattern = (source: string): RegExp => {
  try {
    return new RegExp(source, 'u')
  } catch {
    return new RegExp(source)
  }
}

/**
 * The message a ref that resolves to nothing fails with. It names the one thing
 * the caller can do about it: this package never fetches, but it will happily
 * resolve a document you hand it.
 */
const unresolvableRef = (keyword: string, ref: string): Error =>
  new Error(
    `Cannot resolve ${keyword} "${ref}". It matches no JSON Pointer, \`$anchor\`, or \`$id\` in this schema, ` +
      'and no document was registered under that URI. This package does no I/O — load the document yourself and ' +
      'pass it as `{ schemas: { "<uri>": document } }`.',
  )

/**
 * The lazily-created target cache for one flavour of reference.
 *
 * Written as a plain accessor rather than a `memoize(key, resolve)` helper
 * because the callers below sit on the hot path: a closure per call, and the
 * string concatenation a shared key space would need, both showed up as a
 * measurable cost on a `$ref`-heavy document.
 */
const refCache = (caches: ValidatorCaches, kind: 'ref' | 'dynamicRef'): Map<string, unknown> => {
  const existing = caches[kind]
  if (existing !== null) return existing
  const created = new Map<string, unknown>()
  caches[kind] = created
  return created
}

/** The resolved target, or a loud failure — a bad ref is never treated as "anything goes". */
const orThrow = (value: unknown, keyword: string, ref: string): unknown => {
  if (value === undefined) throw unresolvableRef(keyword, ref)
  return value
}

/**
 * Resolves a document-local `$ref` with no `$id` in play, caching the target.
 * Throws on an unresolvable ref — the same loud failure the generated validator
 * produced — so a bad pointer is never silently treated as "anything goes",
 * which is also why an unresolved target never reaches the cache.
 */
export const resolvePlainRef = (ctx: InterpreterContext, ref: string): unknown => {
  const cache = refCache(ctx.caches, 'ref')
  const cached = cache.get(ref)
  if (cached !== undefined) return cached
  const resolved = orThrow(resolveLocalRef(ref, ctx.root), '$ref', ref)
  cache.set(ref, resolved)
  return resolved
}

/**
 * Resolves a `$ref` against the base URI in scope, caching the target under
 * `base` + ref (the same ref string resolves differently from inside different
 * `$id` scopes, so the ref alone is not a key).
 *
 * A ref that names nothing in its own resource falls back to the document-global
 * resolver. That keeps a bundled document working when it mixes an `$id` with
 * root-relative `#/$defs/...` pointers, and it can only ever *add* an answer —
 * a URI that does resolve in scope never reaches it.
 */
export const resolveScoped = (
  ctx: InterpreterContext,
  registry: SchemaRegistry,
  ref: string,
  base: string,
): ScopedTarget => {
  let cache = ctx.caches.scopedRef
  if (cache === null) {
    cache = new Map()
    ctx.caches.scopedRef = cache
  }
  let byRef = cache.get(base)
  if (byRef === undefined) {
    byRef = new Map()
    cache.set(base, byRef)
  }
  const cached = byRef.get(ref)
  if (cached !== undefined) return cached

  const scoped = resolveScopedRef(registry, ref, base)
  const resolved = scoped ?? fallbackTarget(ctx, ref, base)
  byRef.set(ref, resolved)
  return resolved
}

/**
 * The document-global answer for a ref that named nothing in its own resource,
 * keeping the referrer's base so the scope does not shift. Throws when even that
 * finds nothing, which is where an unresolvable ref finally fails loudly.
 */
const fallbackTarget = (ctx: InterpreterContext, ref: string, base: string): ScopedTarget => ({
  value: orThrow(resolveLocalRef(ref, ctx.root), '$ref', ref),
  base,
})

/** {@link fallbackTarget} for `$dynamicRef`, which may still bind to a `$dynamicAnchor`. */
export const dynamicFallbackTarget = (ctx: InterpreterContext, ref: string, base: string): ScopedTarget => ({
  value: orThrow(resolveDynamicRef(ref, ctx.root), '$dynamicRef', ref),
  base,
})

/**
 * Resolves a `$dynamicRef` target, from its own cache — see
 * {@link ValidatorCaches.ref}. Throws on an unresolvable ref, the same loud
 * failure {@link resolvePlainRef} produces.
 *
 * The `$id`-aware path is deliberately *not* cached: its answer depends on the
 * dynamic scope the reference was reached through, which is the whole point of
 * `$dynamicRef`. It is a couple of map lookups, so there is little to cache.
 */
export const resolveDyn = (ctx: InterpreterContext, ref: string): unknown => {
  const cache = refCache(ctx.caches, 'dynamicRef')
  const cached = cache.get(ref)
  if (cached !== undefined) return cached
  const resolved = orThrow(resolveDynamicRef(ref, ctx.root), '$dynamicRef', ref)
  cache.set(ref, resolved)
  return resolved
}

/**
 * Resolves the document's `$recursiveRef` target, caching it. There is only one
 * possible target per document (the `$recursiveAnchor: true` subschema, or the
 * root), so a single slot suffices. Never fails: the root is always a valid
 * fallback per 2019-09.
 */
export const resolveRec = (ctx: InterpreterContext): unknown => {
  const cached = ctx.caches.recursiveRef
  if (cached !== null) return cached.value
  const value = resolveRecursiveRef(ctx.root)
  ctx.caches.recursiveRef = { value }
  return value
}

/**
 * A boolean-mode child of `ctx`: same root, caches, ref stack and — by
 * reference — the same work budget, so an exponential branch fan-out draws down
 * the caller's pool rather than escaping into a fresh one. Only `failed` is
 * private, which is the whole point: a failing probe must not unwind the caller.
 */
export const newBranchContext = (ctx: InterpreterContext): InterpreterContext => ({
  root: ctx.root,
  registry: ctx.registry,
  emitErrors: false,
  caches: ctx.caches,
  errors: null,
  failed: false,
  refStack: ctx.refStack,
  maxDepth: ctx.maxDepth,
  budget: ctx.budget,
})
/**
 * The property-presence test, used by every keyword that asks the question:
 * `required`, `properties`, and the presence-gated dependency keywords
 * (`dependentRequired`, `dependentSchemas`, `dependencies`). Presence is
 * own-property membership *and* a defined value — Ajv's rule, so
 * `{ a: undefined }` counts as absent.
 *
 * This was a `!== undefined` read with a precomputed exemption for the standard
 * `Object.prototype` names, and it kept being wrong in a new way: an inherited
 * value from `Object.create({ token: 'x' })`, then a polluted `Object.prototype`
 * carrying a name the exemption list does not know, then the two call sites the
 * narrowing fixes missed. Each round it disagreed with `minProperties`,
 * `additionalProperties` and `unevaluatedProperties`, which sweep the
 * instance's own keys — so an object serializing to `{}` satisfied
 * `required: ['token']` while every other keyword agreed it had no properties.
 *
 * `Object.hasOwn` answers it outright. It costs a call per *declared* key —
 * the schema's, not the instance's, so a handful — against a class of bug that
 * has now recurred three times. One rule, no exemption list to keep correct.
 */
export const hasProperty = (obj: Record<string, unknown>, key: string): boolean =>
  Object.hasOwn(obj, key) && obj[key] !== undefined

/**
 * Memoized enum membership. An all-primitive enum resolves to a `Set` (SameValueZero,
 * so type-sensitive) for O(1) lookup; a mixed/structural enum returns `null`, and
 * the caller falls back to `deepEqual`. Keyed on the schema node so the scan runs
 * once per node rather than once per validation. `null` set means "not all
 * primitive"; an entry is always present after the first touch.
 *
 * Unlike the node's {@link NodeMeta} this is memoized from the first call on: the
 * scan is O(enum length) and a node under `items` is revisited once per array
 * element, so a single cold validation would otherwise rebuild it per element.
 */
const enumSetCache = new WeakMap<object, Set<unknown> | null>()

export const getEnumSet = (s: object, values: readonly unknown[]): Set<unknown> | null => {
  let set = enumSetCache.get(s)
  if (set === undefined) {
    set = values.every(isPrimitiveEnumValue) ? new Set(values) : null
    enumSetCache.set(s, set)
  }
  return set
}
