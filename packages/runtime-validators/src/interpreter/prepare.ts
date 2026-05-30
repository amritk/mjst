import { type InterpreterContext, interpret } from '@/interpreter/interpret'
import type { ValidateOptions, ValidationResult } from '@/types'

/**
 * Caches one prepared validator per `(schema, mode, formats)`. The schema object
 * is the cache key (via a `WeakMap`), so asking for a validator for the same
 * schema twice — common when one is built per request or on a hot path —
 * returns the same closure, and with it the same warm regex/`$ref` caches.
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
 * Builds a validator closure that interprets `schema` on each call. There is no
 * compile step: the closure returns immediately, and the only reusable work —
 * compiling regexes and resolving `$ref`s — is memoized on first use in caches
 * captured here, so a reused validator pays for each at most once.
 */
const makeValidator = (
  schema: unknown,
  formats: 'all' | ReadonlySet<string>,
  emitErrors: boolean,
): ((input: unknown) => unknown) => {
  const regexCache = new Map<string, RegExp>()
  const refCache = new Map<string, unknown>()

  return (input: unknown): unknown => {
    const ctx: InterpreterContext = {
      root: schema,
      formats,
      emitErrors,
      regexCache,
      refCache,
      errors: null,
      failed: false,
    }
    interpret(ctx, schema, input, '')
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

  // Only object/array schemas can be WeakMap keys. Boolean schemas are trivial,
  // so skipping the cache for them costs nothing.
  if (typeof schema !== 'object' || schema === null) {
    return makeValidator(schema, formats, emitErrors)
  }

  let byKey = cache.get(schema)
  if (!byKey) {
    byKey = new Map()
    cache.set(schema, byKey)
  }

  const key = cacheKey(emitErrors, formats)
  const existing = byKey.get(key)
  if (existing) return existing

  const validator = makeValidator(schema, formats, emitErrors)
  byKey.set(key, validator)
  return validator
}
