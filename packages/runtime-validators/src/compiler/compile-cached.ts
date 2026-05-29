import { buildValidator } from '#compiler/build-validator'

import type { ValidateOptions } from '../types'

/**
 * Caches compiled validators per `(schema, mode, formats)`. The schema object
 * is the cache key (via a `WeakMap`), so requesting a validator for the same
 * schema twice — a common pattern when one is built on a hot path or per
 * request — returns the same wrapper instead of compiling again.
 */
const cache = new WeakMap<object, Map<string, (input: unknown) => unknown>>()

const normalizeFormats = (formats: ValidateOptions['formats']): 'all' | ReadonlySet<string> => {
  if (formats === 'all') return 'all'
  if (formats === undefined) return new Set()
  return new Set(formats)
}

const cacheKey = (emitErrors: boolean, formats: 'all' | ReadonlySet<string>): string => {
  const formatsKey = formats === 'all' ? '*' : [...formats].sort().join(',')
  return `${emitErrors ? 'e' : 'g'}|${formatsKey}`
}

/**
 * Wraps {@link buildValidator} so the expensive part — generating source and
 * handing it to `new Function` — is deferred until the validator is first
 * actually called.
 *
 * This is the core of keeping startup cost near zero: `validate` /
 * `validateGuard` return immediately, and an app that builds many validators up
 * front (a schema registry, a router, a config loader) only pays the JIT cost
 * for the ones it ends up using, spread across first use rather than bunched at
 * boot. After the first call the wrapper holds the real function directly, so
 * the steady-state overhead is a single, perfectly-predicted nullish check.
 */
const lazyValidator = (
  schema: unknown,
  formats: 'all' | ReadonlySet<string>,
  emitErrors: boolean,
): ((input: unknown) => unknown) => {
  let compiled: ((input: unknown) => unknown) | undefined
  return (input: unknown): unknown => {
    if (compiled === undefined) compiled = buildValidator(schema, formats, emitErrors)
    return compiled(input)
  }
}

/**
 * Returns a validator for the schema, reusing a cached one when the same schema
 * object and configuration have been requested before. Compilation itself is
 * lazy — see {@link lazyValidator}.
 */
export const compileCached = (
  schema: unknown,
  options: ValidateOptions | undefined,
  emitErrors: boolean,
): ((input: unknown) => unknown) => {
  const formats = normalizeFormats(options?.formats)

  // Only object/array schemas can be WeakMap keys. Boolean schemas are trivial,
  // so skipping the cache for them costs nothing.
  if (typeof schema !== 'object' || schema === null) {
    return lazyValidator(schema, formats, emitErrors)
  }

  let byKey = cache.get(schema)
  if (!byKey) {
    byKey = new Map()
    cache.set(schema, byKey)
  }

  const key = cacheKey(emitErrors, formats)
  const existing = byKey.get(key)
  if (existing) return existing

  const validator = lazyValidator(schema, formats, emitErrors)
  byKey.set(key, validator)
  return validator
}
