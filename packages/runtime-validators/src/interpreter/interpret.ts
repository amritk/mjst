import { FORMAT_CHECKS, isValidRegex } from '@/interpreter/format-checks'
import { resolveDynamicRef, resolveRecursiveRef } from '@/interpreter/resolve-dynamic-ref'
import { resolveLocalRef } from '@/interpreter/resolve-local-ref'
import type { ValidationError } from '@/types'

/**
 * The two genuinely reusable artifacts of a validation — compiled `RegExp`s and
 * resolved `$ref` targets — held in one place and shared across a run and its
 * nested branch contexts. Each map is allocated lazily on first use, so the
 * common schema that has neither a `pattern` nor a `$ref` never allocates them —
 * which is what a single (first-run) validation is most sensitive to.
 */
export type ValidatorCaches = {
  regex: Map<string, RegExp> | null
  ref: Map<string, unknown> | null
}

export const newValidatorCaches = (): ValidatorCaches => ({ regex: null, ref: null })

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

/** True when every element of `arr` is distinct by {@link deepEqual}. */
const allUnique = (arr: readonly unknown[]): boolean => {
  const len = arr.length
  if (len < 2) return true

  // Fast path: when every element is a primitive, dedupe in one linear pass via
  // a native Set. Set membership is SameValueZero, which is already type-sensitive
  // (1, "1", and true are three distinct entries), so it matches JSON Schema's
  // equality for primitives without allocating a stringified key per element.
  // Objects/arrays fall back to the exact structural comparison below.
  let allPrimitive = true
  for (let i = 0; i < len; i++) {
    const v = arr[i]
    if (v !== null && typeof v === 'object') {
      allPrimitive = false
      break
    }
  }
  if (allPrimitive) return new Set(arr).size === len

  for (let i = 0; i < len; i++) for (let j = i + 1; j < len; j++) if (deepEqual(arr[i], arr[j])) return false
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
 * Resolves a local `$ref`, caching the target. Throws on an unresolvable ref —
 * the same loud failure the generated validator produced — so a bad pointer is
 * never silently treated as "anything goes".
 */
const resolveRef = (ctx: InterpreterContext, ref: string): unknown => {
  let cache = ctx.caches.ref
  if (cache === null) {
    cache = new Map()
    ctx.caches.ref = cache
  }
  let resolved = cache.get(ref)
  if (resolved === undefined) {
    resolved = resolveLocalRef(ref, ctx.root)
    if (resolved === undefined) {
      throw new Error(`Cannot resolve $ref "${ref}". Only local refs into the same document are supported.`)
    }
    cache.set(ref, resolved)
  }
  return resolved
}

/**
 * Resolves a `$dynamicRef` target, caching it. Keyed separately from `$ref`
 * (the `dyn:` prefix) because the same fragment can resolve differently as a
 * dynamic anchor than as a static pointer. Throws on an unresolvable ref, the
 * same loud failure {@link resolveRef} produces.
 */
const resolveDyn = (ctx: InterpreterContext, ref: string): unknown => {
  const key = `dyn:${ref}`
  let cache = ctx.caches.ref
  if (cache === null) {
    cache = new Map()
    ctx.caches.ref = cache
  }
  let resolved = cache.get(key)
  if (resolved === undefined) {
    resolved = resolveDynamicRef(ref, ctx.root)
    if (resolved === undefined) {
      throw new Error(`Cannot resolve $dynamicRef "${ref}". Only local refs into the same document are supported.`)
    }
    cache.set(key, resolved)
  }
  return resolved
}

/**
 * Resolves the document's `$recursiveRef` target, caching it. There is only one
 * possible target per document (the `$recursiveAnchor: true` subschema, or the
 * root), so a single cache slot suffices. Never fails: the root is always a
 * valid fallback per 2019-09.
 */
const resolveRec = (ctx: InterpreterContext): unknown => {
  const key = 'rec:#'
  let cache = ctx.caches.ref
  if (cache === null) {
    cache = new Map()
    ctx.caches.ref = cache
  }
  let resolved = cache.get(key)
  if (resolved === undefined) {
    resolved = resolveRecursiveRef(ctx.root)
    cache.set(key, resolved)
  }
  return resolved
}

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
  collect?: Evaluation | null,
): boolean => {
  const sub: InterpreterContext = {
    root: ctx.root,
    formats: ctx.formats,
    emitErrors: false,
    caches: ctx.caches,
    errors: null,
    failed: false,
    refStack: ctx.refStack,
  }
  // When the caller is tracking annotations, evaluate the branch into a private
  // tracker and fold it in only if the branch matched — annotations from a
  // failing branch never count toward `unevaluated*`.
  const branchEval = collect ? newEvaluation() : null
  interpret(sub, schema, value, '', branchEval)
  const ok = !sub.failed
  if (ok && collect && branchEval) mergeEvaluation(collect, branchEval)
  return ok
}

/**
 * The allocation-heavy, reusable parts of an object schema node: its property
 * keys, the `required` membership set, the leftover required keys not covered by
 * `properties`, and the compiled `patternProperties` entries. These are a pure
 * function of the schema node, so they are computed once and memoized per node
 * (keyed on the node object) instead of rebuilt on every validation.
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
   * True when none of this node's declared/required keys is a name inherited from
   * `Object.prototype` (`constructor`, `toString`, `__proto__`, …). For such keys
   * presence can be tested with the cheap `obj[key] !== undefined` — a JSON object
   * never inherits them — instead of the slower `Object.hasOwn`. Only a schema
   * that actually declares a prototype-member key pays the `hasOwn` cost.
   */
  safeKeys: boolean
}

/**
 * Names reachable on a plain object via its prototype chain, for which a bare
 * `obj[key]` read could return an inherited value and wrongly report presence.
 */
const PROTO_MEMBER_NAMES = new Set<string>([
  '__proto__',
  'constructor',
  'prototype',
  'toString',
  'toLocaleString',
  'valueOf',
  'hasOwnProperty',
  'isPrototypeOf',
  'propertyIsEnumerable',
  '__defineGetter__',
  '__defineSetter__',
  '__lookupGetter__',
  '__lookupSetter__',
])

/**
 * Uniform property-presence test, matching how `required`/`properties` decide a
 * key is present (Ajv's default `!== undefined`, so `{ a: undefined }` counts as
 * absent). A prototype-member name is checked with `Object.hasOwn` so an inherited
 * `toString`/`constructor` is never mistaken for a real property. Used by the
 * presence-gated dependency keywords (`dependentRequired`, `dependentSchemas`,
 * `dependencies`) so they agree with `required`/`properties` instead of splitting
 * between `!== undefined` and `hasOwn`. (`required` itself keeps its precomputed
 * `safeKeys` fast path, which is equivalent to this for its declared keys.)
 */
const hasProperty = (obj: Record<string, unknown>, key: string): boolean =>
  PROTO_MEMBER_NAMES.has(key) ? Object.hasOwn(obj, key) : obj[key] !== undefined

/**
 * Memoized enum membership. An all-primitive enum resolves to a `Set` (SameValueZero,
 * so type-sensitive) for O(1) lookup; a mixed/structural enum returns `null`, and
 * the caller falls back to `deepEqual`. Keyed on the schema node so the scan runs
 * once per node rather than once per validation. `null` set means "not all
 * primitive"; an entry is always present after the first touch.
 */
const enumSetCache = new WeakMap<object, Set<unknown> | null>()

const getEnumSet = (s: object, values: unknown[]): Set<unknown> | null => {
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

const getObjectMeta = (s: Record<string, unknown>): ObjectMeta => {
  let meta = objectMetaCache.get(s)
  if (meta === undefined) {
    const properties = isPlainObject(s['properties']) ? s['properties'] : undefined
    const patternProperties = isPlainObject(s['patternProperties']) ? s['patternProperties'] : undefined
    const required = Array.isArray(s['required']) ? (s['required'] as string[]) : []
    const knownKeys = properties ? Object.keys(properties) : undefined
    meta = {
      properties,
      knownKeys,
      escapedKeys: knownKeys?.map(escapePointer),
      requiredSet: new Set(required),
      requiredNotInProps: required.filter((k) => !(properties !== undefined && k in properties)),
      // Compile each `patternProperties` regex once here (a stateless RegExp is
      // safe to share across contexts) so the per-key loop below skips both the
      // shared-cache Map lookup and recompilation.
      patternEntries: patternProperties
        ? Object.entries(patternProperties).map(([source, schema]) => [compilePattern(source), schema])
        : null,
      safeKeys:
        (knownKeys === undefined || knownKeys.every((k) => !PROTO_MEMBER_NAMES.has(k))) &&
        required.every((k) => !PROTO_MEMBER_NAMES.has(k)),
    }
    objectMetaCache.set(s, meta)
  }
  return meta
}

/** Emits the object-applicator keywords, inert for non-objects. */
const interpretObject = (
  ctx: InterpreterContext,
  s: Record<string, unknown>,
  value: unknown,
  path: string,
  evalScope: Evaluation | null,
): void => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return
  const obj = value as Record<string, unknown>

  const meta = getObjectMeta(s)
  const { properties, knownKeys, escapedKeys, requiredSet, safeKeys } = meta
  const emitErrors = ctx.emitErrors

  const hasAdditional = 'additionalProperties' in s
  const additional = s['additionalProperties']
  const dependentRequired = isPlainObject(s['dependentRequired']) ? s['dependentRequired'] : undefined
  const minProps = typeof s['minProperties'] === 'number' ? s['minProperties'] : undefined
  const maxProps = typeof s['maxProperties'] === 'number' ? s['maxProperties'] : undefined

  if (properties && knownKeys && escapedKeys) {
    for (let i = 0; i < knownKeys.length; i++) {
      const key = knownKeys[i] as string
      // Read the value once and reuse it. Presence is own-property membership:
      // `Object.hasOwn` is authoritative but has call overhead, so when no declared
      // key is a prototype member (the common case, precomputed as `safeKeys`) the
      // cheap `pv !== undefined` is equivalent — a JSON object can't inherit a
      // non-prototype-member name.
      const pv = obj[key]
      const present = safeKeys ? pv !== undefined : Object.hasOwn(obj, key)
      if (requiredSet.has(key)) {
        if (!present) fail(ctx, `must have required property '${key}'`, path)
        else {
          // Build the child path from the pre-escaped key (a bare concat, no
          // per-call scan), only in error mode where it is actually read.
          interpret(ctx, properties[key], pv, emitErrors ? `${path}/${escapedKeys[i]}` : path)
          evalScope?.props.add(key)
        }
      } else if (present) {
        interpret(ctx, properties[key], pv, emitErrors ? `${path}/${escapedKeys[i]}` : path)
        evalScope?.props.add(key)
      }
      if (ctx.failed) return
    }
  }

  // Required keys with no `properties` entry still need a presence check.
  for (const key of meta.requiredNotInProps) {
    if (safeKeys ? obj[key] === undefined : !Object.hasOwn(obj, key)) {
      fail(ctx, `must have required property '${key}'`, path)
      if (ctx.failed) return
    }
  }

  if (dependentRequired) {
    for (const [trigger, deps] of Object.entries(dependentRequired)) {
      if (!Array.isArray(deps)) continue
      if (!hasProperty(obj, trigger)) continue
      for (const dep of deps as string[]) {
        if (!hasProperty(obj, dep)) {
          fail(ctx, `must have property '${dep}' when '${trigger}' is present`, path)
          if (ctx.failed) return
        }
      }
    }
  }

  // `dependentSchemas` (2020-12): when a property is present, the whole object
  // must also match the associated subschema.
  const dependentSchemas = isPlainObject(s['dependentSchemas']) ? s['dependentSchemas'] : undefined
  if (dependentSchemas) {
    for (const [trigger, subSchema] of Object.entries(dependentSchemas)) {
      if (!hasProperty(obj, trigger)) continue
      interpretInPlace(ctx, subSchema, obj, path, evalScope)
      if (ctx.failed) return
    }
  }

  // `dependencies` (draft-07): the dual-form predecessor of `dependentRequired`
  // + `dependentSchemas`. An array value requires the listed keys; a schema
  // value is applied to the whole object — both gated on the trigger's presence.
  const dependencies = isPlainObject(s['dependencies']) ? s['dependencies'] : undefined
  if (dependencies) {
    for (const [trigger, dep] of Object.entries(dependencies)) {
      if (!hasProperty(obj, trigger)) continue
      if (Array.isArray(dep)) {
        for (const key of dep as string[]) {
          if (!hasProperty(obj, key)) {
            fail(ctx, `must have property '${key}' when '${trigger}' is present`, path)
            if (ctx.failed) return
          }
        }
      } else {
        interpretInPlace(ctx, dep, obj, path, evalScope)
        if (ctx.failed) return
      }
    }
  }

  // `additionalProperties: true` validates nothing but still annotates every
  // additional property as evaluated (mirroring the `items: true` tail sweep), so
  // `unevaluatedProperties` must treat the whole object as covered. The schema and
  // `false` forms mark their keys inside the loop below; the `true` form skips it.
  if (hasAdditional && additional === true && evalScope) evalScope.allProps = true

  const needsLoop = meta.patternEntries !== null || (hasAdditional && additional !== true)
  if (needsLoop) {
    const patternEntries = meta.patternEntries ?? []
    for (const k in obj) {
      // `patternProperties` applies to every matching key independently of
      // `properties` — a key declared in both must satisfy both — so it runs even
      // when `k` is also a known property. Only `additionalProperties` is the
      // fallback for keys reached by neither.
      const inProps = properties !== undefined && Object.hasOwn(properties, k)
      let matched = false
      for (const [regex, patternSchema] of patternEntries) {
        if (regex.test(k)) {
          matched = true
          evalScope?.props.add(k)
          interpret(ctx, patternSchema, obj[k], childPath(ctx, path, k))
          if (ctx.failed) return
        }
      }

      if (inProps || matched || !hasAdditional) continue
      if (additional === false) {
        evalScope?.props.add(k)
        fail(ctx, 'must NOT have additional properties', childPath(ctx, path, k))
        if (ctx.failed) return
      } else if (isPlainObject(additional)) {
        evalScope?.props.add(k)
        interpret(ctx, additional, obj[k], childPath(ctx, path, k))
        if (ctx.failed) return
      }
    }
  }

  if (minProps !== undefined || maxProps !== undefined) {
    let count = 0
    for (const _k in obj) count++
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
  if ('propertyNames' in s) {
    const nameSchema = s['propertyNames']
    for (const k in obj) {
      if (!matchesSchema(ctx, nameSchema, k)) {
        fail(ctx, `property name "${k}" is invalid`, childPath(ctx, path, k))
        if (ctx.failed) return
      }
    }
  }
}

/** Emits the array-applicator keywords, inert for non-arrays. */
const interpretArray = (
  ctx: InterpreterContext,
  s: Record<string, unknown>,
  value: unknown,
  path: string,
  evalScope: Evaluation | null,
): void => {
  if (!Array.isArray(value)) return
  const arr = value as unknown[]

  const minItems = typeof s['minItems'] === 'number' ? s['minItems'] : undefined
  const maxItems = typeof s['maxItems'] === 'number' ? s['maxItems'] : undefined
  const uniqueRequired = s['uniqueItems'] === true

  let tuple: unknown[] | undefined
  let rest: unknown
  if (Array.isArray(s['prefixItems'])) {
    tuple = s['prefixItems'] as unknown[]
    rest = s['items']
  } else if (Array.isArray(s['items'])) {
    tuple = s['items'] as unknown[]
    rest = s['additionalItems']
  } else {
    rest = s['items']
  }
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
        interpret(ctx, tuple[index], arr[index], childPath(ctx, path, index))
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
      interpret(ctx, rest, arr[i], childPath(ctx, path, i))
      if (ctx.failed) return
    }
    // A tail `items`/`additionalItems` schema sweeps every index from `start` on.
    if (evalScope) evalScope.allItems = true
  } else if (rest === true && evalScope) {
    // `items: true` likewise evaluates the whole tail.
    evalScope.allItems = true
  }

  if (uniqueRequired && !allUnique(arr)) {
    fail(ctx, 'must have unique items', path)
    if (ctx.failed) return
  }

  // `contains` — at least `minContains` (default 1) and at most `maxContains`
  // items must match the subschema. `minContains: 0` makes the lower bound
  // trivially satisfied (even for an empty array) while any `maxContains` still
  // applies. Branch matches are evaluated as booleans so they never leak errors.
  if ('contains' in s) {
    const containsSchema = s['contains']
    const min = typeof s['minContains'] === 'number' ? s['minContains'] : 1
    const max = typeof s['maxContains'] === 'number' ? s['maxContains'] : undefined
    let count = 0
    for (const item of arr) if (matchesSchema(ctx, containsSchema, item)) count++
    // Ajv parity for `unevaluatedItems`: a satisfied `contains` marks the *whole*
    // array as evaluated, not just the matching items — but `minContains: 0` opts
    // out of contributing any evaluated-item annotation at all. (This intentionally
    // tracks Ajv, the package's differential oracle, over the stricter spec letter.)
    if (evalScope && min !== 0 && count >= min && (max === undefined || count <= max)) {
      evalScope.allItems = true
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
const interpretString = (ctx: InterpreterContext, s: Record<string, unknown>, value: unknown, path: string): void => {
  if (typeof value !== 'string') return

  // Length is measured in code points per spec, but `value.length` (UTF-16 code
  // units) is an upper bound on it — and equal unless the string holds a surrogate
  // pair. So the cheap unit count is authoritative except in a narrow band near
  // each bound, and the exact `codePointLength` scan is only paid there. This
  // keeps the common ASCII / short-string path allocation- and scan-free.
  const minLength = s['minLength']
  if (typeof minLength === 'number') {
    const units = value.length
    // units < min ⇒ code points < min (fail). units >= 2·min ⇒ code points >= min
    // (each point is ≤ 2 units), so only the band [min, 2·min) needs the exact count.
    if (units < minLength || (units < 2 * minLength && codePointLength(value) < minLength)) {
      fail(ctx, `must have at least ${minLength} characters`, path)
      if (ctx.failed) return
    }
  }
  const maxLength = s['maxLength']
  if (typeof maxLength === 'number') {
    // units <= max ⇒ code points <= max (pass); only an over-long unit count needs
    // the exact scan, where surrogate pairs may still bring it within bounds.
    if (value.length > maxLength && codePointLength(value) > maxLength) {
      fail(ctx, `must have at most ${maxLength} characters`, path)
      if (ctx.failed) return
    }
  }
  const pattern = s['pattern']
  if (typeof pattern === 'string' && !getRegex(ctx, pattern).test(value)) {
    fail(ctx, `must match pattern ${pattern}`, path)
    if (ctx.failed) return
  }
  const format = s['format']
  if (typeof format === 'string') {
    const enabled = ctx.formats === 'all' || ctx.formats.has(format)
    if (enabled) {
      // `regex` is the one format whose check is a compile, not a pattern match.
      if (format === 'regex') {
        if (!isValidRegex(value)) fail(ctx, `must match format "${format}"`, path)
      } else {
        const re = FORMAT_CHECKS[format]
        if (re && !re.test(value)) fail(ctx, `must match format "${format}"`, path)
      }
    }
  }
}

/** Emits the numeric constraints, inert for non-numbers. */
const interpretNumber = (ctx: InterpreterContext, s: Record<string, unknown>, value: unknown, path: string): void => {
  if (typeof value !== 'number') return

  // Bounds are written as *pass* conditions and negated so `NaN` — which compares
  // `false` against every operator — fails them, matching Ajv (its `strict:false`
  // oracle rejects `NaN` against a bound). A bare `type: 'number'` with no bound
  // still accepts non-finite numbers, as Ajv does; only a bound (or `multipleOf`)
  // rejects them. `±Infinity` follows the ordinary comparison (e.g. `Infinity`
  // passes `minimum: 0` but fails `maximum: 10`), again matching Ajv.
  const minimum = s['minimum']
  if (typeof minimum === 'number') {
    // Draft-04 used a boolean `exclusiveMinimum: true` alongside `minimum` to
    // make the bound strict; draft-06+ replaced it with a standalone numeric
    // keyword (handled below). Honour both forms.
    const strict = s['exclusiveMinimum'] === true
    if (!(strict ? value > minimum : value >= minimum)) {
      fail(ctx, strict ? `must be > ${minimum}` : `must be >= ${minimum}`, path)
      if (ctx.failed) return
    }
  }
  const maximum = s['maximum']
  if (typeof maximum === 'number') {
    const strict = s['exclusiveMaximum'] === true
    if (!(strict ? value < maximum : value <= maximum)) {
      fail(ctx, strict ? `must be < ${maximum}` : `must be <= ${maximum}`, path)
      if (ctx.failed) return
    }
  }
  const exclusiveMinimum = s['exclusiveMinimum']
  if (typeof exclusiveMinimum === 'number' && !(value > exclusiveMinimum)) {
    fail(ctx, `must be > ${exclusiveMinimum}`, path)
    if (ctx.failed) return
  }
  const exclusiveMaximum = s['exclusiveMaximum']
  if (typeof exclusiveMaximum === 'number' && !(value < exclusiveMaximum)) {
    fail(ctx, `must be < ${exclusiveMaximum}`, path)
    if (ctx.failed) return
  }
  const multipleOf = s['multipleOf']
  if (typeof multipleOf === 'number' && multipleOf > 0) {
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
 * recurse forever and blow the stack. Because the outer frame is already checking
 * that exact node against that exact value, stopping here changes no verdict; it
 * only avoids the non-terminating re-descent. Legitimately deep *data* is
 * unaffected: each level carries a distinct `value`, so no pair repeats.
 */
const interpretRef = (
  ctx: InterpreterContext,
  target: unknown,
  value: unknown,
  path: string,
  evalScope: Evaluation | null,
): void => {
  const stack = ctx.refStack
  for (let i = 0; i < stack.length; i += 2) {
    if (stack[i] === target && stack[i + 1] === value) return
  }
  stack.push(target, value)
  interpretInPlace(ctx, target, value, path, evalScope)
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
): void => {
  if (parentScope === null) {
    interpret(ctx, schema, value, path, null)
    return
  }
  const childScope = newEvaluation()
  interpret(ctx, schema, value, path, childScope)
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
): void => {
  // In guard mode the first failure unwinds the whole walk; in error mode this
  // is never set, so every branch runs and collects.
  if (ctx.failed) return

  // Boolean schemas: `true`/`{}` accept everything, `false` rejects everything.
  if (schema === true) return
  if (schema === false) {
    fail(ctx, 'must not be valid', path)
    return
  }
  if (!isPlainObject(schema)) return

  const s = schema

  // OpenAPI 3.0 `nullable: true` — a `null` value is accepted regardless of the
  // declared `type` (and short-circuits every other keyword), matching how Ajv
  // is configured for OpenAPI schemas.
  if (s['nullable'] === true && value === null) return

  // `unevaluated*` consults annotations gathered by every other keyword applied
  // to this same instance. Inherit the ancestor's tracker when one is in scope;
  // otherwise start one only if this node carries an `unevaluated*` keyword, so
  // schemas that never use them allocate nothing.
  const nodeUnevaluated = 'unevaluatedProperties' in s || 'unevaluatedItems' in s
  const evalScope: Evaluation | null = evaluation ?? (nodeUnevaluated ? newEvaluation() : null)

  // $ref — validate against the resolved target. {@link interpretRef} breaks
  // reference cycles so a self- or mutually-recursive `$ref` cannot recurse
  // forever. Sibling keywords still apply per 2020-12, so we do not stop here.
  const ref = s['$ref']
  if (typeof ref === 'string') {
    interpretRef(ctx, resolveRef(ctx, ref), value, path, evalScope)
    if (ctx.failed) return
  }

  // `$dynamicRef` (2020-12) — late-binds to a matching `$dynamicAnchor`. Like
  // `$ref`, sibling keywords still apply, so we do not stop here.
  const dynRef = s['$dynamicRef']
  if (typeof dynRef === 'string') {
    interpretRef(ctx, resolveDyn(ctx, dynRef), value, path, evalScope)
    if (ctx.failed) return
  }

  // `$recursiveRef` (2019-09) — the predecessor of `$dynamicRef`. Its only legal
  // value is `"#"`: late-binds to the `$recursiveAnchor: true` subschema,
  // falling back to the document root.
  if (typeof s['$recursiveRef'] === 'string') {
    interpretRef(ctx, resolveRec(ctx), value, path, evalScope)
    if (ctx.failed) return
  }

  if ('const' in s) {
    const c = s['const']
    if (isPrimitiveEnumValue(c)) {
      if (value !== c) fail(ctx, `must be equal to ${JSON.stringify(c)}`, path)
    } else if (!deepEqual(value, c)) {
      fail(ctx, 'must be equal to the expected constant', path)
    }
    if (ctx.failed) return
  }

  if (Array.isArray(s['enum'])) {
    const values = s['enum'] as unknown[]
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
      // Build the label only on failure — the success path is the common case and
      // this `map`/`join` would otherwise allocate on every value, hurting cold.
      const label = values.map((v) => JSON.stringify(v)).join(', ')
      fail(ctx, `must be one of: ${label}`, path)
      if (ctx.failed) return
    }
  }

  const rawType = s['type']
  if (typeof rawType === 'string') {
    // The common single-type case: check it directly without wrapping it in a
    // throwaway one-element array (which this hot path would otherwise allocate
    // on every typed node — exactly the cold-path cost we want to avoid).
    if (!matchesType(rawType, value)) fail(ctx, `must be ${rawType}`, path)
    if (ctx.failed) return
  } else if (Array.isArray(rawType) && rawType.length > 0) {
    const types = rawType as string[]
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
      if (Array.isArray(value)) interpretArray(ctx, s, value, path, evalScope)
      else interpretObject(ctx, s, value, path, evalScope)
      if (ctx.failed) return
    }
  } else if (typeof value === 'string') {
    interpretString(ctx, s, value, path)
    if (ctx.failed) return
  } else if (typeof value === 'number') {
    interpretNumber(ctx, s, value, path)
    if (ctx.failed) return
  }

  if (Array.isArray(s['allOf'])) {
    for (const sub of s['allOf']) {
      interpretInPlace(ctx, sub, value, path, evalScope)
      if (ctx.failed) return
    }
  }

  if (Array.isArray(s['anyOf']) && s['anyOf'].length > 0) {
    let ok = false
    for (const sub of s['anyOf']) {
      // When tracking annotations, evaluate every branch (each match contributes
      // its evaluated keys); otherwise short-circuit on the first match.
      if (matchesSchema(ctx, sub, value, evalScope)) {
        ok = true
        if (!evalScope) break
      }
    }
    if (!ok) {
      fail(ctx, 'must match a schema in anyOf', path)
      if (ctx.failed) return
    }
  }

  if (Array.isArray(s['oneOf']) && s['oneOf'].length > 0) {
    let count = 0
    for (const sub of s['oneOf']) {
      if (matchesSchema(ctx, sub, value, evalScope)) count++
    }
    if (count !== 1) {
      fail(ctx, 'must match exactly one schema in oneOf', path)
      if (ctx.failed) return
    }
  }

  if ('not' in s) {
    // `not` produces no annotations — a passing inner schema means failure.
    if (matchesSchema(ctx, s['not'], value)) {
      fail(ctx, 'must not match schema', path)
      if (ctx.failed) return
    }
  }

  if ('if' in s) {
    if (matchesSchema(ctx, s['if'], value, evalScope)) {
      if ('then' in s) interpretInPlace(ctx, s['then'], value, path, evalScope)
    } else if ('else' in s) {
      interpretInPlace(ctx, s['else'], value, path, evalScope)
    }
  }

  // `unevaluatedProperties` / `unevaluatedItems` (2020-12) run last: every other
  // keyword above has recorded what it evaluated into `evalScope`, so these act
  // on exactly what is left over.
  if (nodeUnevaluated && evalScope) interpretUnevaluated(ctx, s, value, path, evalScope)
}

/**
 * Applies `unevaluatedProperties` / `unevaluatedItems` against the leftovers in
 * `evalScope`. A `false` schema rejects any leftover; a real subschema validates
 * it (and marks it evaluated, so a further-out `unevaluated*` does not see it
 * again); `true` simply sweeps the rest.
 */
const interpretUnevaluated = (
  ctx: InterpreterContext,
  s: Record<string, unknown>,
  value: unknown,
  path: string,
  evalScope: Evaluation,
): void => {
  if ('unevaluatedProperties' in s && typeof value === 'object' && value !== null && !Array.isArray(value)) {
    const up = s['unevaluatedProperties']
    if (!evalScope.allProps) {
      const obj = value as Record<string, unknown>
      for (const k in obj) {
        if (evalScope.props.has(k)) continue
        if (up === false) {
          fail(ctx, 'must NOT have unevaluated properties', childPath(ctx, path, k))
        } else if (up !== true && isPlainObject(up)) {
          interpret(ctx, up, obj[k], childPath(ctx, path, k))
        }
        evalScope.props.add(k)
        if (ctx.failed) return
      }
      if (up !== false) evalScope.allProps = true
    }
  }

  if ('unevaluatedItems' in s && Array.isArray(value)) {
    const ui = s['unevaluatedItems']
    if (!evalScope.allItems) {
      const arr = value as unknown[]
      for (let i = 0; i < arr.length; i++) {
        if (evalScope.items.has(i)) continue
        if (ui === false) {
          fail(ctx, 'must NOT have unevaluated items', childPath(ctx, path, i))
        } else if (ui !== true && isPlainObject(ui)) {
          interpret(ctx, ui, arr[i], childPath(ctx, path, i))
        }
        evalScope.items.add(i)
        if (ctx.failed) return
      }
      if (ui !== false) evalScope.allItems = true
    }
  }
}
