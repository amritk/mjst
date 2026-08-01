import { type InterpreterContext, interpret, NO_DYNAMIC_SCOPE, newValidatorCaches } from '@/interpreter/interpret'
import { limitsCacheKey, type ResolvedLimits, resolveLimits, screenSchema } from '@/interpreter/limits'
import { buildSchemaRegistry } from '@/interpreter/schema-registry'
import type { ValidateOptions, ValidationResult } from '@/types'

/**
 * Caches one prepared validator per `(schema, mode, formats)`. The schema object
 * is the cache key (via a `WeakMap`), so asking for a validator for the same
 * schema twice — common when one is built per request or on a hot path —
 * returns the same closure, and with it the same warm regex/`$ref` caches.
 */
const cache = new WeakMap<object, Map<string, (input: unknown) => unknown>>()

/**
 * How many distinct configurations we will remember per schema. The outer
 * `WeakMap` collects with the schema, but the inner `Map` lives as long as the
 * schema does, so an unbounded one is a leak: a caller deriving `limits` from
 * each request (a per-request `maxSteps`, say) mints a new key every call and
 * pins a validator forever — 200,000 distinct values cost ~85 MB. Past this many
 * variants we simply stop caching and hand back a fresh validator. That is the
 * right trade: a schema used with more than a handful of configurations is being
 * varied per call, which the cache could never have helped anyway, and building a
 * validator here is cheap (there is no compile step).
 */
const MAX_CACHED_VARIANTS = 16

const normalizeFormats = (formats: ValidateOptions['formats']): 'all' | ReadonlySet<string> => {
  if (formats === 'all') return 'all'
  if (formats === undefined) return new Set()
  return new Set(formats)
}

const cacheKey = (emitErrors: boolean, formats: 'all' | ReadonlySet<string>, limits: ResolvedLimits): string => {
  const formatsKey = formats === 'all' ? '*' : [...formats].sort().join(',')
  return `${emitErrors ? 'e' : 'g'}|${formatsKey}|${limitsCacheKey(limits)}`
}

/**
 * Builds a validator closure that interprets `schema` on each call. There is no
 * compile step: the closure returns immediately, and the only reusable work —
 * compiling regexes and resolving `$ref`s — is memoized on first use in caches
 * captured here, so a reused validator pays for each at most once.
 */
const makeValidator = (
  schema: unknown,
  formats: 'all' | ReadonlySet<string>,
  emitErrors: boolean,
  limits: ResolvedLimits,
): ((input: unknown) => unknown) => {
  // One walk of the schema, up front. It screens every
  // `pattern`/`patternProperties` source so a ReDoS-prone regex fails loudly
  // here (at build time) rather than mid-request, and it tells us whether the
  // document declares an `$id`.
  const screen = screenSchema(schema, limits.allowUnsafePatterns)

  // The `$id` resource registry costs a second walk, so it is built only for the
  // documents that actually need one — and once per validator, never per call.
  // For everything else `registry` stays `null` and the interpreter's whole
  // base-URI apparatus switches off.
  const registry = screen.declaresId ? buildSchemaRegistry(schema) : null
  const rootScope = registry === null ? NO_DYNAMIC_SCOPE : [registry.rootBase]

  // One caches holder, captured here and shared across every call of this
  // validator. Its maps stay null until the schema actually hits a `pattern` or
  // `$ref`, so a first validation of the common map-free schema allocates
  // nothing here beyond this tiny holder.
  const caches = newValidatorCaches()

  return (input: unknown): unknown => {
    const ctx: InterpreterContext = {
      root: schema,
      registry,
      formats,
      emitErrors,
      caches,
      errors: null,
      failed: false,
      refStack: [],
      maxDepth: limits.maxDepth,
      // A fresh budget per call: the ceiling is per-validation, not per-validator.
      budget: { steps: limits.maxSteps },
    }
    interpret(ctx, schema, input, '', null, 0, rootScope)
    if (emitErrors) {
      return (ctx.errors === null ? true : { valid: false, errors: ctx.errors }) satisfies ValidationResult
    }
    return !ctx.failed
  }
}

/**
 * Returns a validator for the schema, reusing a cached one when the same schema
 * object and configuration have been requested before.
 */
export const prepareValidator = (
  schema: unknown,
  options: ValidateOptions | undefined,
  emitErrors: boolean,
): ((input: unknown) => unknown) => {
  const formats = normalizeFormats(options?.formats)
  const limits = resolveLimits(options?.limits)

  // Only object/array schemas can be WeakMap keys. Boolean schemas are trivial,
  // so skipping the cache for them costs nothing.
  if (typeof schema !== 'object' || schema === null) {
    return makeValidator(schema, formats, emitErrors, limits)
  }

  let byKey = cache.get(schema)
  if (!byKey) {
    byKey = new Map()
    cache.set(schema, byKey)
  }

  const key = cacheKey(emitErrors, formats, limits)
  const existing = byKey.get(key)
  if (existing) return existing

  const validator = makeValidator(schema, formats, emitErrors, limits)
  if (byKey.size < MAX_CACHED_VARIANTS) byKey.set(key, validator)
  return validator
}
