import { FORMAT_CHECKS, isValidRegex } from '@/interpreter/format-checks'
import { validationLimitError } from '@/interpreter/limits'
import { resolveDynamicRef, resolveRecursiveRef } from '@/interpreter/resolve-dynamic-ref'
import { getNodeMeta, type NodeMeta } from '@/interpreter/node-meta'
import { resolveLocalRef } from '@/interpreter/resolve-local-ref'
import { resolveScopedDynamicRef, resolveScopedRef, type ScopedTarget } from '@/interpreter/resolve-scoped-ref'
import type { SchemaRegistry } from '@/interpreter/schema-registry'
import type { ValidationError } from '@/types'

/**
 * The genuinely reusable artifacts of a validation — compiled `RegExp`s and
 * resolved `$ref` targets — held in one place and shared across a run and its
 * nested branch contexts. Each map is allocated lazily on first use, so the
 * common schema that has neither a `pattern` nor a `$ref` never allocates them —
 * which is what a single (first-run) validation is most sensitive to.
 */
export type ValidatorCaches = {
  regex: Map<string, RegExp> | null
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
  /** Resolved `$ref`s for a document with `$id`s, keyed by the base in scope plus the ref. */
  scopedRef: Map<string, ScopedTarget> | null
  /**
   * Per-node keyword metadata (see `node-meta.ts`), or `null` while this
   * validator is still on its first call — a one-shot validation would only ever
   * write to it. `prepare.ts` allocates it once the validator is called again.
   */
  nodeMeta: WeakMap<object, NodeMeta> | null
}

export const newValidatorCaches = (): ValidatorCaches => ({
  regex: null,
  ref: null,
  dynamicRef: null,
  recursiveRef: null,
  scopedRef: null,
  nodeMeta: null,
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
const enterResource = (scope: DynamicScope, base: string): DynamicScope =>
  base === scope[scope.length - 1] ? scope : [...scope, base]

/**
 * The scope in effect *at* `node`, accounting for an `$id` it declares. Called
 * only for a document that has a registry *and* a node that declares an `$id`
 * (both tested by the caller off cheap flags), so an ordinary schema never pays
 * for the lookup.
 */
const scopeAtNode = (registry: SchemaRegistry, node: Record<string, unknown>, scope: DynamicScope): DynamicScope => {
  const base = registry.baseOf.get(node)
  return base === undefined ? scope : enterResource(scope, base)
}

/**
 * Mutable state threaded through a single validation run.
 *
 * Unlike a code-generating validator, the interpreter walks the schema afresh
 * on every call — there is no `new Function`, so it runs anywhere (a strict CSP,
 * Cloudflare Workers, React Native/Hermes) and costs nothing at startup. The two
 * genuinely reusable artifacts — compiled `RegExp`s and resolved `$ref` targets —
 * are cached on {@link ValidatorCaches} so a reused validator builds each once.
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
   * Whether the 2020-12 validation vocabulary asserts. Almost always `true`; it
   * is `false` only when the schema's `$schema` names a registered metaschema
   * whose `$vocabulary` leaves that vocabulary out, which turns `type`, `enum`,
   * `required`, the bounds and friends into pure annotations. See
   * `asserts-validation.ts`.
   */
  readonly assertsValidation: boolean
  /** Enabled string formats, or `'all'`. */
  readonly formats: 'all' | ReadonlySet<string>
  /**
   * Whether this run collects every error (the {@link ValidationError} path) or
   * short-circuits to a boolean on the first failure (the guard path).
   */
  readonly emitErrors: boolean
  /** Lazily-built regex/`$ref` caches, shared with nested branch contexts. */
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

/** Charges one unit of the shared work budget, throwing once it is exhausted. */
const spend = (ctx: InterpreterContext): void => {
  if (--ctx.budget.steps < 0) {
    throw validationLimitError(
      'Validation exceeded its step budget (possible exponential/quadratic schema or input). ' +
        'Raise it with `limits: { maxSteps }` if the schema and data are trusted.',
    )
  }
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isPrimitiveEnumValue = (value: unknown): boolean =>
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
type Evaluation = {
  props: Set<string>
  /** Set once a schema-form `additionalProperties`/`unevaluatedProperties` swept every remaining key. */
  allProps: boolean
  items: Set<number>
  /** Set once a tail `items` schema swept every remaining index. */
  allItems: boolean
}

const newEvaluation = (): Evaluation => ({ props: new Set(), allProps: false, items: new Set(), allItems: false })

const mergeEvaluation = (into: Evaluation, from: Evaluation): void => {
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
const deepEqual = (a: unknown, b: unknown, depth = 0): boolean => {
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
const allUnique = (ctx: InterpreterContext, arr: readonly unknown[]): boolean => {
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
const matchesType = (type: string, value: unknown): boolean => {
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
const fail = (ctx: InterpreterContext, message: string, path: string): void => {
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
const escapePointer = (key: string): string =>
  key.indexOf('/') !== -1 || key.indexOf('~') !== -1 ? key.replace(/~/g, '~0').replace(/\//g, '~1') : key

const childPath = (ctx: InterpreterContext, path: string, key: string | number): string => {
  if (!ctx.emitErrors) return path
  return `${path}/${typeof key === 'string' ? escapePointer(key) : key}`
}

/**
 * Counts Unicode code points in `value`, as JSON Schema's `minLength`/`maxLength`
 * require — `String.length` counts UTF-16 code units, so a single astral
 * character (e.g. an emoji) would otherwise count as 2. Iterating the string
 * yields code points without allocating an intermediate array.
 */
const codePointLength = (value: string): number => {
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
const compilePattern = (source: string): RegExp => {
  try {
    return new RegExp(source, 'u')
  } catch {
    return new RegExp(source)
  }
}

/** Returns a cached compiled `RegExp` for the given source. */
const getRegex = (ctx: InterpreterContext, source: string): RegExp => {
  let cache = ctx.caches.regex
  if (cache === null) {
    cache = new Map()
    ctx.caches.regex = cache
  }
  let re = cache.get(source)
  if (re === undefined) {
    re = compilePattern(source)
    cache.set(source, re)
  }
  return re
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
const resolvePlainRef = (ctx: InterpreterContext, ref: string): unknown => {
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
const resolveScoped = (ctx: InterpreterContext, registry: SchemaRegistry, ref: string, base: string): ScopedTarget => {
  // A space is an unambiguous separator here: `base` comes out of `URL.href`, so
  // it can never contain one.
  const key = `${base} ${ref}`
  let cache = ctx.caches.scopedRef
  if (cache === null) {
    cache = new Map()
    ctx.caches.scopedRef = cache
  }
  const cached = cache.get(key)
  if (cached !== undefined) return cached

  const scoped = resolveScopedRef(registry, ref, base)
  const resolved = scoped ?? fallbackTarget(ctx, ref, base)
  cache.set(key, resolved)
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
const dynamicFallbackTarget = (ctx: InterpreterContext, ref: string, base: string): ScopedTarget => ({
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
const resolveDyn = (ctx: InterpreterContext, ref: string): unknown => {
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
const resolveRec = (ctx: InterpreterContext): unknown => {
  const cached = ctx.caches.recursiveRef
  if (cached !== null) return cached.value
  const value = resolveRecursiveRef(ctx.root)
  ctx.caches.recursiveRef = { value }
  return value
}

/**
 * A boolean-mode child of `ctx`: same root, formats, caches, ref stack and — by
 * reference — the same work budget, so an exponential branch fan-out draws down
 * the caller's pool rather than escaping into a fresh one. Only `failed` is
 * private, which is the whole point: a failing probe must not unwind the caller.
 */
const newBranchContext = (ctx: InterpreterContext): InterpreterContext => ({
  root: ctx.root,
  registry: ctx.registry,
  assertsValidation: ctx.assertsValidation,
  formats: ctx.formats,
  emitErrors: false,
  caches: ctx.caches,
  errors: null,
  failed: false,
  refStack: ctx.refStack,
  maxDepth: ctx.maxDepth,
  budget: ctx.budget,
})

/**
 * Evaluates a subschema in a pure boolean context — used for the branches of
 * `anyOf` / `oneOf` / `not` / `if`, where a failing branch is expected and must
 * not pollute the caller's error list. Shares the regex and ref caches so the
 * isolation costs nothing beyond a small context object.
 */
const matchesSchema = (
  ctx: InterpreterContext,
  schema: unknown,
  value: unknown,
  depth: number,
  scope: DynamicScope,
  collect?: Evaluation | null,
): boolean => {
  const sub = newBranchContext(ctx)
  // When the caller is tracking annotations, evaluate the branch into a private
  // tracker and fold it in only if the branch matched — annotations from a
  // failing branch never count toward `unevaluated*`.
  const branchEval = collect ? newEvaluation() : null
  interpret(sub, schema, value, '', branchEval, depth + 1, scope)
  const ok = !sub.failed
  if (ok && collect && branchEval) mergeEvaluation(collect, branchEval)
  return ok
}

/**
 * The allocation-heavy, reusable parts of an object schema node: its property
 * keys, the `required` membership set, the leftover required keys not covered by
 * `properties`, the compiled `patternProperties` entries, and the entry lists of
 * the three presence-gated dependency keywords. These are a pure function of the
 * schema node, so they are computed once and memoized per node (keyed on the node
 * object) instead of rebuilt on every validation.
 */
type ObjectMeta = {
  properties: Record<string, unknown> | undefined
  knownKeys: string[] | undefined
  /** `knownKeys` pre-escaped for JSON Pointer, so the error-path build is a bare concat. */
  escapedKeys: string[] | undefined
  requiredSet: Set<string>
  requiredNotInProps: string[]
  patternEntries: [RegExp, unknown][] | null
  /**
   * `dependentRequired` as entries, already filtered to the array-valued ones a
   * validation would act on. `null` when the keyword is absent, so the (much more
   * common) node without it never touches this.
   */
  dependentRequiredEntries: [string, string[]][] | null
  /** `dependentSchemas` as entries — see {@link ObjectMeta.dependentRequiredEntries}. */
  dependentSchemasEntries: [string, unknown][] | null
  /** Draft-07 `dependencies` as entries — see {@link ObjectMeta.dependentRequiredEntries}. */
  dependenciesEntries: [string, unknown][] | null
}

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
const hasProperty = (obj: Record<string, unknown>, key: string): boolean =>
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

const getEnumSet = (s: object, values: readonly unknown[]): Set<unknown> | null => {
  let set = enumSetCache.get(s)
  if (set === undefined) {
    set = values.every(isPrimitiveEnumValue) ? new Set(values) : null
    enumSetCache.set(s, set)
  }
  return set
}

/**
 * Per-node cache for {@link ObjectMeta}. A schema's object metadata never
 * changes, so a module-level `WeakMap` shares it across every validator and call
 * that touches the node. Crucially this is built *only for object schema nodes*
 * (there are few of them) and lazily on first touch, so the cold one-shot path —
 * which this package optimizes for — pays at most a handful of small allocations,
 * not one per scalar node. An object node revisited many times (an array of
 * objects, a recursive `$ref`, or a reused validator) then rebuilds none of it.
 */
const objectMetaCache = new WeakMap<object, ObjectMeta>()

const getObjectMeta = (s: Record<string, unknown>, node: NodeMeta): ObjectMeta => {
  let meta = objectMetaCache.get(s)
  if (meta === undefined) {
    // Every keyword here was already read (and type-narrowed) when the node's
    // {@link NodeMeta} was built, so this only does the allocating work.
    const { properties, patternProperties, dependentRequired, dependentSchemas, dependencies } = node
    const required = node.required ?? []
    const knownKeys = properties ? Object.keys(properties) : undefined
    meta = {
      properties,
      knownKeys,
      escapedKeys: knownKeys?.map(escapePointer),
      requiredSet: new Set(required),
      // `Object.hasOwn`, not `k in properties`: `in` walks `Object.prototype`, so
      // `required: ['toString']` alongside any `properties` object looked already
      // covered and was dropped here — and `toString` is not in `knownKeys` either
      // (that is `Object.keys`), so nothing checked it and the key went silently
      // unenforced.
      requiredNotInProps: required.filter((k) => !(properties !== undefined && Object.hasOwn(properties, k))),
      // Compile each `patternProperties` regex once here (a stateless RegExp is
      // safe to share across contexts) so the per-key loop below skips both the
      // shared-cache Map lookup and recompilation.
      patternEntries: patternProperties
        ? Object.entries(patternProperties).map(([source, schema]) => [compilePattern(source), schema])
        : null,
      // The dependency keywords are iterated as entries, which `Object.entries`
      // would otherwise rebuild (array + one tuple per key) on every validation.
      dependentRequiredEntries: dependentRequired
        ? (Object.entries(dependentRequired).filter(([, deps]) => Array.isArray(deps)) as [string, string[]][])
        : null,
      dependentSchemasEntries: dependentSchemas ? Object.entries(dependentSchemas) : null,
      dependenciesEntries: dependencies ? Object.entries(dependencies) : null,
    }
    objectMetaCache.set(s, meta)
  }
  return meta
}

/** Emits the object-applicator keywords, inert for non-objects. */
const interpretObject = (
  ctx: InterpreterContext,
  s: Record<string, unknown>,
  node: NodeMeta,
  value: unknown,
  path: string,
  evalScope: Evaluation | null,
  depth: number,
  scope: DynamicScope,
): void => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return
  const obj = value as Record<string, unknown>

  const meta = getObjectMeta(s, node)
  const { properties, knownKeys, escapedKeys, requiredSet } = meta
  const emitErrors = ctx.emitErrors
  // `required`, `dependentRequired` and the property-count bounds are
  // validation-vocabulary; `properties`, `patternProperties`,
  // `additionalProperties`, `dependentSchemas` and `propertyNames` are
  // applicators and always apply.
  const asserts = ctx.assertsValidation

  const hasAdditional = node.hasAdditionalProperties
  const additional = node.additionalProperties
  const minProps = asserts ? node.minProperties : undefined
  const maxProps = asserts ? node.maxProperties : undefined

  if (properties && knownKeys && escapedKeys) {
    for (let i = 0; i < knownKeys.length; i++) {
      const key = knownKeys[i] as string
      // One read, reused. `hasProperty` spells the same rule for callers that
      // do not already hold the value; here the `!== undefined` half is free
      // off `pv`, so only the `hasOwn` half is left to ask.
      const pv = obj[key]
      const present = pv !== undefined && Object.hasOwn(obj, key)
      if (requiredSet.has(key)) {
        if (!present) {
          if (asserts) fail(ctx, `must have required property '${key}'`, path)
        } else {
          // Build the child path from the pre-escaped key (a bare concat, no
          // per-call scan), only in error mode where it is actually read.
          interpret(ctx, properties[key], pv, emitErrors ? `${path}/${escapedKeys[i]}` : path, null, depth + 1, scope)
          evalScope?.props.add(key)
        }
      } else if (present) {
        interpret(ctx, properties[key], pv, emitErrors ? `${path}/${escapedKeys[i]}` : path, null, depth + 1, scope)
        evalScope?.props.add(key)
      }
      if (ctx.failed) return
    }
  }

  // Required keys with no `properties` entry still need a presence check.
  if (asserts) {
    for (const key of meta.requiredNotInProps) {
      if (!hasProperty(obj, key)) {
        fail(ctx, `must have required property '${key}'`, path)
        if (ctx.failed) return
      }
    }
  }

  const dependentRequiredEntries = asserts ? meta.dependentRequiredEntries : null
  if (dependentRequiredEntries !== null) {
    for (const [trigger, deps] of dependentRequiredEntries) {
      if (!hasProperty(obj, trigger)) continue
      for (const dep of deps) {
        if (!hasProperty(obj, dep)) {
          fail(ctx, `must have property '${dep}' when '${trigger}' is present`, path)
          if (ctx.failed) return
        }
      }
    }
  }

  // `dependentSchemas` (2020-12): when a property is present, the whole object
  // must also match the associated subschema.
  const dependentSchemasEntries = meta.dependentSchemasEntries
  if (dependentSchemasEntries !== null) {
    for (const [trigger, subSchema] of dependentSchemasEntries) {
      if (!hasProperty(obj, trigger)) continue
      interpretInPlace(ctx, subSchema, obj, path, evalScope, depth, scope)
      if (ctx.failed) return
    }
  }

  // `dependencies` (draft-07): the dual-form predecessor of `dependentRequired`
  // + `dependentSchemas`. An array value requires the listed keys; a schema
  // value is applied to the whole object — both gated on the trigger's presence.
  const dependenciesEntries = meta.dependenciesEntries
  if (dependenciesEntries !== null) {
    for (const [trigger, dep] of dependenciesEntries) {
      if (!hasProperty(obj, trigger)) continue
      if (Array.isArray(dep)) {
        for (const key of dep as string[]) {
          if (!hasProperty(obj, key)) {
            fail(ctx, `must have property '${key}' when '${trigger}' is present`, path)
            if (ctx.failed) return
          }
        }
      } else {
        interpretInPlace(ctx, dep, obj, path, evalScope, depth, scope)
        if (ctx.failed) return
      }
    }
  }

  // `additionalProperties: true` validates nothing but still annotates every
  // additional property as evaluated (mirroring the `items: true` tail sweep), so
  // `unevaluatedProperties` must treat the whole object as covered. The schema and
  // `false` forms mark their keys inside the loop below; the `true` form skips it.
  if (hasAdditional && additional === true && evalScope) evalScope.allProps = true

  // Held in a local (rather than re-read as `meta.patternEntries ?? []`) so the
  // `additionalProperties`-only case does not allocate a throwaway empty array on
  // every validation just to iterate nothing.
  const patternEntries = meta.patternEntries
  const needsLoop = patternEntries !== null || (hasAdditional && additional !== true)
  if (needsLoop) {
    // Own keys only, for the reason `minProperties` spells out below: a bare
    // `for…in` walks the prototype chain, so an inherited key was validated as
    // though the instance carried it — and a polluted `Object.prototype` made
    // `additionalProperties: false` reject every object in the process.
    // `Object.keys`, not a guarded `for…in`: the benchmark recorded with
    // `minProperties` below measures the three forms on a 20-key object at 92M
    // ops/s for `Object.keys`, 19M for an unguarded `for…in` and 9.5M for a
    // guarded one — the key array costs less than a `hasOwn` call per key on
    // top of a prototype-chain enumeration.
    for (const k of Object.keys(obj)) {
      // `patternProperties` applies to every matching key independently of
      // `properties` — a key declared in both must satisfy both — so it runs even
      // when `k` is also a known property. Only `additionalProperties` is the
      // fallback for keys reached by neither.
      const inProps = properties !== undefined && Object.hasOwn(properties, k)
      let matched = false
      if (patternEntries !== null) {
        for (const [regex, patternSchema] of patternEntries) {
          if (regex.test(k)) {
            matched = true
            evalScope?.props.add(k)
            interpret(ctx, patternSchema, obj[k], childPath(ctx, path, k), null, depth + 1, scope)
            if (ctx.failed) return
          }
        }
      }

      if (inProps || matched || !hasAdditional) continue
      if (additional === false) {
        evalScope?.props.add(k)
        fail(ctx, 'must NOT have additional properties', childPath(ctx, path, k))
        if (ctx.failed) return
      } else if (isPlainObject(additional)) {
        evalScope?.props.add(k)
        interpret(ctx, additional, obj[k], childPath(ctx, path, k), null, depth + 1, scope)
        if (ctx.failed) return
      }
    }
  }

  if (minProps !== undefined || maxProps !== undefined) {
    // Own properties only, as the spec requires — and the measurement the
    // sweeps above cite. A bare `for…in` also walks the
    // prototype chain, so `Object.create({ inherited: 1 })` with one own key
    // counted as two and passed `minProperties: 2`. `Object.keys().length` looks
    // like the allocating option, but it measured the fastest of the three by a
    // wide margin (20-key object: 92M ops/s, versus 19M for the old unguarded
    // `for…in` and 9.5M for a `for…in` with an `Object.hasOwn` guard) — the engine
    // does not have to materialize a key array to answer `.length`.
    const count = Object.keys(obj).length
    if (minProps !== undefined && count < minProps) {
      fail(ctx, `must have at least ${minProps} properties`, path)
      if (ctx.failed) return
    }
    if (maxProps !== undefined && count > maxProps) {
      fail(ctx, `must have at most ${maxProps} properties`, path)
      if (ctx.failed) return
    }
  }

  // `propertyNames` — every property *key* (as a string) must match the schema.
  if (node.hasPropertyNames) {
    const nameSchema = node.propertyNames
    // One scratch context for the whole key loop instead of the fresh nine-field
    // one `matchesSchema` builds per call — on a 20-key object that was 20
    // context allocations for what is usually a one-keyword string check.
    // Reuse is safe because the only per-probe state is `failed` (we reset it):
    // the caches, ref stack and budget are shared by design, `errors` stays null
    // in boolean mode, and these probes cannot nest — the key is a string, so the
    // inner walk never reaches another `propertyNames` at this instance location.
    let probe: InterpreterContext | null = null
    // Own keys only — same reason, and the same form, as the sweep above.
    for (const k of Object.keys(obj)) {
      if (probe === null) probe = newBranchContext(ctx)
      else probe.failed = false
      interpret(probe, nameSchema, k, '', null, depth + 1, scope)
      if (probe.failed) {
        fail(ctx, `property name "${k}" is invalid`, childPath(ctx, path, k))
        if (ctx.failed) return
      }
    }
  }
}

/** Emits the array-applicator keywords, inert for non-arrays. */
const interpretArray = (
  ctx: InterpreterContext,
  node: NodeMeta,
  value: unknown,
  path: string,
  evalScope: Evaluation | null,
  depth: number,
  scope: DynamicScope,
): void => {
  if (!Array.isArray(value)) return
  const arr = value as unknown[]

  // The count bounds and `uniqueItems` are validation-vocabulary; `prefixItems`,
  // `items` and `contains` are applicators and always apply. The positional
  // schemas and their tail were sorted out once, when the node's
  // {@link NodeMeta} was built.
  const asserts = ctx.assertsValidation
  const minItems = asserts ? node.minItems : undefined
  const maxItems = asserts ? node.maxItems : undefined
  const uniqueRequired = asserts && node.uniqueItems

  const tuple = node.tuple
  const rest = node.rest
  const start = tuple ? tuple.length : 0

  if (minItems !== undefined && arr.length < minItems) {
    fail(ctx, `must have at least ${minItems} items`, path)
    if (ctx.failed) return
  }
  if (maxItems !== undefined && arr.length > maxItems) {
    fail(ctx, `must have at most ${maxItems} items`, path)
    if (ctx.failed) return
  }

  if (tuple) {
    for (let index = 0; index < tuple.length; index++) {
      if (arr.length > index) {
        interpret(ctx, tuple[index], arr[index], childPath(ctx, path, index), null, depth + 1, scope)
        evalScope?.items.add(index)
        if (ctx.failed) return
      }
    }
  }

  if (rest === false) {
    if (arr.length > start) {
      fail(ctx, `must NOT have more than ${start} items`, path)
      if (ctx.failed) return
    }
  } else if (rest !== undefined && rest !== true) {
    for (let i = start; i < arr.length; i++) {
      interpret(ctx, rest, arr[i], childPath(ctx, path, i), null, depth + 1, scope)
      if (ctx.failed) return
    }
    // A tail `items`/`additionalItems` schema sweeps every index from `start` on.
    if (evalScope) evalScope.allItems = true
  } else if (rest === true && evalScope) {
    // `items: true` likewise evaluates the whole tail.
    evalScope.allItems = true
  }

  if (uniqueRequired && !allUnique(ctx, arr)) {
    fail(ctx, 'must have unique items', path)
    if (ctx.failed) return
  }

  // `contains` — at least `minContains` (default 1) and at most `maxContains`
  // items must match the subschema. `minContains: 0` makes the lower bound
  // trivially satisfied (even for an empty array) while any `maxContains` still
  // applies. Branch matches are evaluated as booleans so they never leak errors.
  if (node.hasContains) {
    const containsSchema = node.contains
    // `minContains`/`maxContains` are validation-vocabulary; `contains` itself is
    // an applicator, and its own "at least one match" assertion stands either way.
    const min = asserts ? (node.minContains ?? 1) : 1
    const max = asserts ? node.maxContains : undefined
    // `maxContains` needs the exact total (it is an upper bound), and an active
    // annotation scope needs every match (not just the first `min`) — so only
    // when neither is in play can we stop early. Without this a 1000-element
    // array matching at index 0 cost the same as one matching at index 999.
    const needsExactCount = max !== undefined || evalScope !== null
    // The indices `contains` matched, which is the annotation it publishes for a
    // sibling `unevaluatedItems`. Collected only when something is listening, so
    // the ordinary `contains` check still allocates nothing.
    const matched: number[] | null = evalScope === null ? null : []
    let count = 0
    for (let i = 0; i < arr.length; i++) {
      if (!matchesSchema(ctx, containsSchema, arr[i], depth, scope)) continue
      count++
      matched?.push(i)
      if (!needsExactCount && count >= min) break
    }
    // A `contains` that is satisfied evaluates exactly the items it matched —
    // not the whole array. That distinction is the entire point of pairing
    // `contains` with `unevaluatedItems`, and it is one of the few places we
    // knowingly diverge from Ajv (which marks every index evaluated); see the
    // note in `differential.test.ts`.
    if (evalScope !== null && matched !== null && count >= min && (max === undefined || count <= max)) {
      for (const index of matched) evalScope.items.add(index)
    }
    if (count < min) {
      fail(ctx, `must contain at least ${min} matching items`, path)
      if (ctx.failed) return
    }
    if (max !== undefined && count > max) {
      fail(ctx, `must contain at most ${max} matching items`, path)
    }
  }
}

/** Emits the string constraints, inert for non-strings. */
const interpretString = (ctx: InterpreterContext, node: NodeMeta, value: unknown, path: string): void => {
  if (typeof value !== 'string') return

  // The length and pattern bounds are validation-vocabulary; `format` below is
  // its own vocabulary and survives a dialect that drops validation.
  if (ctx.assertsValidation) {
    // Length is measured in code points per spec, but `value.length` (UTF-16 code
    // units) is an upper bound on it — and equal unless the string holds a surrogate
    // pair. So the cheap unit count is authoritative except in a narrow band near
    // each bound, and the exact `codePointLength` scan is only paid there. This
    // keeps the common ASCII / short-string path allocation- and scan-free.
    const minLength = node.minLength
    if (minLength !== undefined) {
      const units = value.length
      // units < min ⇒ code points < min (fail). units >= 2·min ⇒ code points >= min
      // (each point is ≤ 2 units), so only the band [min, 2·min) needs the exact count.
      if (units < minLength || (units < 2 * minLength && codePointLength(value) < minLength)) {
        fail(ctx, `must have at least ${minLength} characters`, path)
        if (ctx.failed) return
      }
    }
    const maxLength = node.maxLength
    if (maxLength !== undefined) {
      // units <= max ⇒ code points <= max (pass); only an over-long unit count needs
      // the exact scan, where surrogate pairs may still bring it within bounds.
      if (value.length > maxLength && codePointLength(value) > maxLength) {
        fail(ctx, `must have at most ${maxLength} characters`, path)
        if (ctx.failed) return
      }
    }
    const pattern = node.pattern
    if (pattern !== undefined && !getRegex(ctx, pattern).test(value)) {
      fail(ctx, `must match pattern ${pattern}`, path)
      if (ctx.failed) return
    }
  }

  const format = node.format
  if (format !== undefined) {
    const enabled = ctx.formats === 'all' || ctx.formats.has(format)
    if (enabled) {
      // `regex` is the one format whose check is a compile, not a pattern match.
      if (format === 'regex') {
        if (!isValidRegex(value)) fail(ctx, `must match format "${format}"`, path)
      } else {
        // `Object.hasOwn`, not a bare index: the schema is runtime input, and
        // `format: "toString"` otherwise read `Function.prototype.toString` off
        // the prototype chain — truthy, with no `.test` — so an unknown format
        // that the spec says to ignore crashed the validator instead.
        //
        // Spelled out rather than calling `@amritk/helpers`' `readKey`: this
        // package takes no `@amritk/*` dependency by design, so the runtime
        // stays slim.
        const re = Object.hasOwn(FORMAT_CHECKS, format) ? FORMAT_CHECKS[format] : undefined
        if (re && !re.test(value)) fail(ctx, `must match format "${format}"`, path)
      }
    }
  }
}

/** Emits the numeric constraints, inert for non-numbers. */
const interpretNumber = (ctx: InterpreterContext, node: NodeMeta, value: unknown, path: string): void => {
  if (typeof value !== 'number') return

  // Bounds are written as *pass* conditions and negated so `NaN` — which compares
  // `false` against every operator — fails them, matching Ajv (its `strict:false`
  // oracle rejects `NaN` against a bound). A bare `type: 'number'` with no bound
  // still accepts non-finite numbers, as Ajv does; only a bound (or `multipleOf`)
  // rejects them. `±Infinity` follows the ordinary comparison (e.g. `Infinity`
  // passes `minimum: 0` but fails `maximum: 10`), again matching Ajv.
  const minimum = node.minimum
  if (minimum !== undefined) {
    // Draft-04 used a boolean `exclusiveMinimum: true` alongside `minimum` to
    // make the bound strict; draft-06+ replaced it with a standalone numeric
    // keyword (handled below). Honour both forms.
    const strict = node.strictMinimum
    if (!(strict ? value > minimum : value >= minimum)) {
      fail(ctx, strict ? `must be > ${minimum}` : `must be >= ${minimum}`, path)
      if (ctx.failed) return
    }
  }
  const maximum = node.maximum
  if (maximum !== undefined) {
    const strict = node.strictMaximum
    if (!(strict ? value < maximum : value <= maximum)) {
      fail(ctx, strict ? `must be < ${maximum}` : `must be <= ${maximum}`, path)
      if (ctx.failed) return
    }
  }
  const exclusiveMinimum = node.exclusiveMinimum
  if (exclusiveMinimum !== undefined && !(value > exclusiveMinimum)) {
    fail(ctx, `must be > ${exclusiveMinimum}`, path)
    if (ctx.failed) return
  }
  const exclusiveMaximum = node.exclusiveMaximum
  if (exclusiveMaximum !== undefined && !(value < exclusiveMaximum)) {
    fail(ctx, `must be < ${exclusiveMaximum}`, path)
    if (ctx.failed) return
  }
  const multipleOf = node.multipleOf
  if (multipleOf !== undefined && multipleOf > 0) {
    let ok: boolean
    if (Number.isInteger(multipleOf)) {
      // For an integer divisor `%` on doubles is exact, so this accepts huge true
      // multiples (`1e21 % 1 === 0`) that a quotient check would misjudge, and
      // rejects `NaN`/`±Infinity` (`Number.isInteger` is `false` for them), which
      // is Ajv's verdict for `multipleOf` on any non-finite value.
      ok = Number.isInteger(value) && value % multipleOf === 0
    } else {
      // Floating-point modulo is unreliable (`0.3 % 0.1 !== 0`), so divide and
      // measure the distance to the nearest integer. The tolerance tracks the
      // actual representation error in `q` (~`|q|·2⁻⁵²`); the previous `1e-8·|q|`
      // was ~10⁷× larger and accepted clear non-multiples like `1000000.005`
      // against `multipleOf: 0.01`. A non-finite value yields a `NaN` distance,
      // so the `<=` is `false` and it fails.
      const q = value / multipleOf
      const tolerance = 2 * Number.EPSILON * Math.max(1, Math.abs(q))
      ok = Math.abs(q - Math.round(q)) <= tolerance
    }
    if (!ok) fail(ctx, `must be a multiple of ${multipleOf}`, path)
  }
}

/**
 * Recurses into a `$ref` / `$dynamicRef` target while breaking reference cycles.
 * A ref that resolves to the same (schema node, value) pair already being
 * validated higher on the stack is an infinite loop no finite data can escape —
 * e.g. `{ $ref: '#' }`, or mutually recursive `$defs` — so re-entering it would
 * recurse forever and blow the stack. Legitimately deep *data* is unaffected:
 * each level carries a distinct `value`, so no pair repeats.
 *
 * What the cycle break guarantees: an outer frame is already checking this exact
 * node against this exact value, so a *conjunctive* re-entry (the value must
 * satisfy the node, and the outer frame is deciding that) adds nothing and the
 * verdict is unchanged.
 *
 * What it does *not* guarantee: inside a disjunction, returning without failing
 * is itself a verdict — the branch counts as matched. So
 * `{ $defs: { n: { anyOf: [{ type: 'string' }, { $ref: '#/$defs/n' }] } },
 * $ref: '#/$defs/n' }` accepts `123`, even though the only non-recursive branch
 * demands a string. This is the price of terminating at all on a schema whose
 * `anyOf` is genuinely unbounded; Ajv stack-overflows on the same input, so
 * "answers something" beats "crashes the process".
 */
const interpretRef = (
  ctx: InterpreterContext,
  target: unknown,
  value: unknown,
  path: string,
  evalScope: Evaluation | null,
  depth: number,
  scope: DynamicScope,
): void => {
  const stack = ctx.refStack
  for (let i = 0; i < stack.length; i += 2) {
    if (stack[i] === target && stack[i + 1] === value) return
  }
  stack.push(target, value)
  interpretInPlace(ctx, target, value, path, evalScope, depth, scope)
  stack.length -= 2
}

/**
 * Interprets an in-place applicator subschema (`$ref`/`$dynamicRef` target,
 * `allOf` item, `then`/`else`, `dependentSchemas`) with correct `unevaluated*`
 * scoping. The child evaluates into a FRESH annotation scope, so its own
 * `unevaluated*` keyword sees only what its own subtree evaluated — never the
 * parent's already-evaluated properties (the spec forbids that leak, and Ajv
 * agrees). The child's annotations are then merged UP into the parent so the
 * parent's `unevaluated*` still counts them. When no ancestor is tracking
 * annotations (`parentScope === null`) this is a plain `interpret`, so the common
 * unevaluated-free schema pays nothing. `anyOf`/`oneOf`/`if` already get this
 * isolation via {@link matchesSchema}.
 */
const interpretInPlace = (
  ctx: InterpreterContext,
  schema: unknown,
  value: unknown,
  path: string,
  parentScope: Evaluation | null,
  depth: number,
  scope: DynamicScope,
): void => {
  if (parentScope === null) {
    interpret(ctx, schema, value, path, null, depth + 1, scope)
    return
  }
  const childScope = newEvaluation()
  interpret(ctx, schema, value, path, childScope, depth + 1, scope)
  mergeEvaluation(parentScope, childScope)
}

/**
 * Validates `value` against a single (sub)schema, recording failures via
 * {@link fail}. This is the core recursive walker that every keyword funnels
 * through; the order of checks mirrors the schema's own keyword order so error
 * output is stable.
 */
export const interpret = (
  ctx: InterpreterContext,
  schema: unknown,
  value: unknown,
  path: string,
  evaluation: Evaluation | null = null,
  depth = 0,
  dynamicScope: DynamicScope = NO_DYNAMIC_SCOPE,
): void => {
  // In guard mode the first failure unwinds the whole walk; in error mode this
  // is never set, so every branch runs and collects.
  if (ctx.failed) return

  // Resource ceilings, checked before any work at this node. Depth guards a
  // recursive schema over deep data from overflowing the native stack; the step
  // budget guards exponential/quadratic blow-up. Both throw a ValidationLimitError.
  if (depth > ctx.maxDepth) {
    throw validationLimitError(
      `Validation exceeded its maximum depth of ${ctx.maxDepth} (deeply nested data against a recursive ` +
        'schema). Raise it with `limits: { maxDepth }` if the schema and data are trusted.',
    )
  }
  spend(ctx)

  // Boolean schemas: `true`/`{}` accept everything, `false` rejects everything.
  if (schema === true) return
  if (schema === false) {
    fail(ctx, 'must not be valid', path)
    return
  }
  if (!isPlainObject(schema)) return

  const s = schema
  // Every keyword this node carries, read once and memoized on the node itself —
  // see `node-meta.ts`. Everything below is a fixed-offset field load off `node`
  // instead of a dynamic-key lookup into the schema.
  const node = getNodeMeta(ctx.caches.nodeMeta, s)

  // OpenAPI 3.0 `nullable: true` — a `null` value is accepted regardless of the
  // declared `type` (and short-circuits every other keyword), matching how Ajv
  // is configured for OpenAPI schemas.
  if (node.nullable && value === null) return

  // An `$id` here opens a new schema resource: refs written below resolve
  // against its URI, and it joins the dynamic scope a `$dynamicRef` searches.
  // Gated on the registry so a document without a single `$id` — nearly all of
  // them — pays one null check per node and nothing else.
  const registry = ctx.registry
  const scope = registry !== null && node.hasId ? scopeAtNode(registry, s, dynamicScope) : dynamicScope

  // `unevaluated*` consults annotations gathered by every other keyword applied
  // to this same instance. Inherit the ancestor's tracker when one is in scope;
  // otherwise start one only if this node carries an `unevaluated*` keyword, so
  // schemas that never use them allocate nothing.
  const evalScope: Evaluation | null = evaluation ?? (node.hasUnevaluated ? newEvaluation() : null)

  // The three reference keywords, behind one flag: a node that carries none of
  // them — which is most of them — skips the whole block on a single test.
  if (node.hasRefs) {
    // $ref — validate against the resolved target. {@link interpretRef} breaks
    // reference cycles so a self- or mutually-recursive `$ref` cannot recurse
    // forever. Sibling keywords still apply per 2020-12, so we do not stop here.
    const ref = node.ref
    if (ref !== undefined) {
      const base = registry === null ? undefined : scope[scope.length - 1]
      if (registry === null || base === undefined) {
        interpretRef(ctx, resolvePlainRef(ctx, ref), value, path, evalScope, depth, scope)
      } else {
        const target = resolveScoped(ctx, registry, ref, base)
        interpretRef(ctx, target.value, value, path, evalScope, depth, enterResource(scope, target.base))
      }
      if (ctx.failed) return
    }

    // `$dynamicRef` (2020-12) — late-binds to a matching `$dynamicAnchor`. Like
    // `$ref`, sibling keywords still apply, so we do not stop here.
    const dynRef = node.dynamicRef
    if (dynRef !== undefined) {
      const base = registry === null ? undefined : scope[scope.length - 1]
      if (registry === null || base === undefined) {
        interpretRef(ctx, resolveDyn(ctx, dynRef), value, path, evalScope, depth, scope)
      } else {
        const target =
          resolveScopedDynamicRef(registry, dynRef, base, scope) ?? dynamicFallbackTarget(ctx, dynRef, base)
        interpretRef(ctx, target.value, value, path, evalScope, depth, enterResource(scope, target.base))
      }
      if (ctx.failed) return
    }

    // `$recursiveRef` (2019-09) — the predecessor of `$dynamicRef`. Its only legal
    // value is `"#"`: late-binds to the `$recursiveAnchor: true` subschema,
    // falling back to the document root.
    if (node.hasRecursiveRef) {
      interpretRef(ctx, resolveRec(ctx), value, path, evalScope, depth, scope)
      if (ctx.failed) return
    }
  }

  // `const`, `enum` and `type` below belong to the validation vocabulary, as do
  // some of the keywords the type-specific blocks read. A dialect that leaves
  // that vocabulary out keeps them as annotations — still legal to write, but
  // they never make an instance invalid. See `asserts-validation.ts`; the flag is
  // `true` for every ordinary schema, so this costs one boolean read.
  const asserts = ctx.assertsValidation

  if (asserts && node.hasConst) {
    const c = node.constValue
    if (isPrimitiveEnumValue(c)) {
      if (value !== c) fail(ctx, `must be equal to ${JSON.stringify(c)}`, path)
    } else if (!deepEqual(value, c)) {
      fail(ctx, 'must be equal to the expected constant', path)
    }
    if (ctx.failed) return
  }

  const enumValues = node.enumValues
  if (asserts && enumValues !== undefined) {
    const values = enumValues
    // Membership is memoized per schema node: an all-primitive enum resolves to a
    // `Set` for O(1) lookup instead of re-scanning `every(isPrimitiveEnumValue)`
    // and doing a linear `includes` on every validation (a 100-value enum on a hot
    // property previously cost ~200 comparisons per value).
    const primitiveSet = getEnumSet(s, values)
    let found: boolean
    if (primitiveSet !== null) {
      found = primitiveSet.has(value)
    } else {
      found = false
      for (const candidate of values) {
        if (deepEqual(value, candidate)) {
          found = true
          break
        }
      }
    }
    if (!found) {
      // Build the label only when something will actually read it. `fail` drops
      // the message in guard mode, and *every* `anyOf`/`oneOf` branch probe runs
      // in guard mode — so a discriminated union with `enum` discriminators paid a
      // full `map`/`join` for each branch it rejected, on the valid path. On a
      // 500-value enum that discarded string was ~99% of the whole validation.
      if (!ctx.emitErrors) {
        ctx.failed = true
        return
      }
      fail(ctx, `must be one of: ${values.map((v) => JSON.stringify(v)).join(', ')}`, path)
    }
  }

  const singleType = asserts ? node.type : undefined
  const types = asserts ? node.types : undefined
  if (singleType !== undefined) {
    // The common single-type case: check it directly without wrapping it in a
    // throwaway one-element array (which this hot path would otherwise allocate
    // on every typed node — exactly the cold-path cost we want to avoid).
    if (!matchesType(singleType, value)) fail(ctx, `must be ${singleType}`, path)
    if (ctx.failed) return
  } else if (types !== undefined) {
    let ok = false
    for (const t of types) {
      if (matchesType(t, value)) {
        ok = true
        break
      }
    }
    if (!ok) fail(ctx, `must be one of type: ${types.join(', ')}`, path)
    if (ctx.failed) return
  }

  // Type-specific keyword blocks. A value is only ever one of object / array /
  // string / number, and each block is inert for every other type, so we dispatch
  // on the value's type and run the at-most-one block that can do work — skipping
  // three guaranteed-inert calls per node. This is a pure value-side check (no
  // schema analysis, no allocation), so it costs the cold one-shot path nothing.
  if (typeof value === 'object') {
    if (value !== null) {
      // Each block is also skipped outright when the node declares none of its
      // keywords, which is the ordinary case for a leaf: a bare `{ type: 'string' }`
      // reaches no keyword block at all.
      if (Array.isArray(value)) {
        if (node.hasArrayKeywords) {
          interpretArray(ctx, node, value, path, evalScope, depth, scope)
          if (ctx.failed) return
        }
      } else if (node.hasObjectKeywords) {
        interpretObject(ctx, s, node, value, path, evalScope, depth, scope)
        if (ctx.failed) return
      }
    }
  } else if (typeof value === 'string') {
    if (node.hasStringKeywords) {
      interpretString(ctx, node, value, path)
      if (ctx.failed) return
    }
  } else if (typeof value === 'number') {
    // Every keyword `interpretNumber` reads is validation-vocabulary, so a
    // dialect without it skips the call outright.
    if (asserts && node.hasNumberKeywords) {
      interpretNumber(ctx, node, value, path)
      if (ctx.failed) return
    }
  }

  // The branching applicators, behind one flag for the same reason as the
  // reference block above: a leaf node skips all five on a single test.
  if (node.hasBranches) {
    const allOf = node.allOf
    if (allOf !== undefined) {
      for (const sub of allOf) {
        interpretInPlace(ctx, sub, value, path, evalScope, depth, scope)
        if (ctx.failed) return
      }
    }

    const anyOf = node.anyOf
    if (anyOf !== undefined) {
      let ok = false
      for (const sub of anyOf) {
        // When tracking annotations, evaluate every branch (each match contributes
        // its evaluated keys); otherwise short-circuit on the first match.
        if (matchesSchema(ctx, sub, value, depth, scope, evalScope)) {
          ok = true
          if (!evalScope) break
        }
      }
      if (!ok) {
        fail(ctx, 'must match a schema in anyOf', path)
        if (ctx.failed) return
      }
    }

    const oneOf = node.oneOf
    if (oneOf !== undefined) {
      let count = 0
      for (const sub of oneOf) {
        if (matchesSchema(ctx, sub, value, depth, scope, evalScope)) count++
      }
      if (count !== 1) {
        fail(ctx, 'must match exactly one schema in oneOf', path)
        if (ctx.failed) return
      }
    }

    if (node.hasNot) {
      // `not` produces no annotations — a passing inner schema means failure.
      if (matchesSchema(ctx, node.not, value, depth, scope)) {
        fail(ctx, 'must not match schema', path)
        if (ctx.failed) return
      }
    }

    if (node.hasIf) {
      if (matchesSchema(ctx, node.ifSchema, value, depth, scope, evalScope)) {
        if (node.hasThen) interpretInPlace(ctx, node.thenSchema, value, path, evalScope, depth, scope)
      } else if (node.hasElse) {
        interpretInPlace(ctx, node.elseSchema, value, path, evalScope, depth, scope)
      }
    }
  }

  // `unevaluatedProperties` / `unevaluatedItems` (2020-12) run last: every other
  // keyword above has recorded what it evaluated into `evalScope`, so these act
  // on exactly what is left over.
  if (node.hasUnevaluated && evalScope) interpretUnevaluated(ctx, node, value, path, evalScope, depth, scope)
}

/**
 * Applies `unevaluatedProperties` / `unevaluatedItems` against the leftovers in
 * `evalScope`. A `false` schema rejects any leftover; a real subschema validates
 * it (and marks it evaluated, so a further-out `unevaluated*` does not see it
 * again); `true` simply sweeps the rest.
 */
const interpretUnevaluated = (
  ctx: InterpreterContext,
  node: NodeMeta,
  value: unknown,
  path: string,
  evalScope: Evaluation,
  depth: number,
  scope: DynamicScope,
): void => {
  if (node.hasUnevaluatedProperties && typeof value === 'object' && value !== null && !Array.isArray(value)) {
    const up = node.unevaluatedProperties
    if (!evalScope.allProps) {
      const obj = value as Record<string, unknown>
      // Own keys only, matching every other property sweep in this file.
      for (const k of Object.keys(obj)) {
        if (evalScope.props.has(k)) continue
        if (up === false) {
          fail(ctx, 'must NOT have unevaluated properties', childPath(ctx, path, k))
        } else if (up !== true && isPlainObject(up)) {
          interpret(ctx, up, obj[k], childPath(ctx, path, k), null, depth + 1, scope)
        }
        evalScope.props.add(k)
        if (ctx.failed) return
      }
      if (up !== false) evalScope.allProps = true
    }
  }

  if (node.hasUnevaluatedItems && Array.isArray(value)) {
    const ui = node.unevaluatedItems
    if (!evalScope.allItems) {
      const arr = value as unknown[]
      for (let i = 0; i < arr.length; i++) {
        if (evalScope.items.has(i)) continue
        if (ui === false) {
          fail(ctx, 'must NOT have unevaluated items', childPath(ctx, path, i))
        } else if (ui !== true && isPlainObject(ui)) {
          interpret(ctx, ui, arr[i], childPath(ctx, path, i), null, depth + 1, scope)
        }
        evalScope.items.add(i)
        if (ctx.failed) return
      }
      if (ui !== false) evalScope.allItems = true
    }
  }
}
