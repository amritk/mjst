import { FORMAT_CHECKS } from '#interpreter/format-checks'
import { resolveDynamicRef } from '#interpreter/resolve-dynamic-ref'
import { resolveLocalRef } from '#interpreter/resolve-local-ref'

import type { ValidationError } from '../types'

/**
 * Mutable state threaded through a single validation run.
 *
 * Unlike a code-generating validator, the interpreter walks the schema afresh
 * on every call — there is no `new Function`, so it runs anywhere (a strict
 * CSP, Cloudflare Workers, React Native/Hermes) and costs nothing at startup.
 * The two genuinely reusable artifacts — compiled `RegExp`s and resolved
 * `$ref` targets — are cached on the context so a validator reused across calls
 * builds each at most once.
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
  /** Pattern/`patternProperties` regexes, compiled once and reused per call. */
  readonly regexCache: Map<string, RegExp>
  /** Resolved `$ref` targets, looked up once and reused per call. */
  readonly refCache: Map<string, unknown>
  /** Collected errors, lazily allocated so valid input never allocates. */
  errors: ValidationError[] | null
  /** Set in guard mode on the first failure so the walk can unwind. */
  failed: boolean
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isPrimitiveEnumValue = (value: unknown): boolean =>
  value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'

/**
 * Deep structural equality, matching the comparison the generated validator
 * used for `const`, `enum`, and `uniqueItems`: arrays compare element-wise,
 * objects compare own enumerable keys, everything else uses `===`.
 */
const deepEqual = (a: unknown, b: unknown): boolean => {
  if (a === b) return true
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false
  const aArr = Array.isArray(a)
  const bArr = Array.isArray(b)
  if (aArr !== bArr) return false
  if (aArr) {
    const aa = a as unknown[]
    const bb = b as unknown[]
    if (aa.length !== bb.length) return false
    for (let i = 0; i < aa.length; i++) if (!deepEqual(aa[i], bb[i])) return false
    return true
  }
  const ao = a as Record<string, unknown>
  const bo = b as Record<string, unknown>
  const keys = Object.keys(ao)
  if (keys.length !== Object.keys(bo).length) return false
  for (const k of keys) {
    if (!Object.hasOwn(bo, k) || !deepEqual(ao[k], bo[k])) return false
  }
  return true
}

/** True when every element of `arr` is distinct by {@link deepEqual}. */
const allUnique = (arr: readonly unknown[]): boolean => {
  const len = arr.length
  if (len < 2) return true
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
      // Unknown type keyword — treat as "always matches" so we never reject
      // valid data because of a type we do not model.
      return true
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

/** Returns a cached compiled `RegExp` for the given source. */
const getRegex = (ctx: InterpreterContext, source: string): RegExp => {
  let re = ctx.regexCache.get(source)
  if (re === undefined) {
    re = new RegExp(source)
    ctx.regexCache.set(source, re)
  }
  return re
}

/**
 * Resolves a local `$ref`, caching the target. Throws on an unresolvable ref —
 * the same loud failure the generated validator produced — so a bad pointer is
 * never silently treated as "anything goes".
 */
const resolveRef = (ctx: InterpreterContext, ref: string): unknown => {
  let resolved = ctx.refCache.get(ref)
  if (resolved === undefined) {
    resolved = resolveLocalRef(ref, ctx.root)
    if (resolved === undefined) {
      throw new Error(`Cannot resolve $ref "${ref}". Only local refs into the same document are supported.`)
    }
    ctx.refCache.set(ref, resolved)
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
  let resolved = ctx.refCache.get(key)
  if (resolved === undefined) {
    resolved = resolveDynamicRef(ref, ctx.root)
    if (resolved === undefined) {
      throw new Error(`Cannot resolve $dynamicRef "${ref}". Only local refs into the same document are supported.`)
    }
    ctx.refCache.set(key, resolved)
  }
  return resolved
}

/**
 * Evaluates a subschema in a pure boolean context — used for the branches of
 * `anyOf` / `oneOf` / `not` / `if`, where a failing branch is expected and must
 * not pollute the caller's error list. Shares the regex and ref caches so the
 * isolation costs nothing beyond a small context object.
 */
const matchesSchema = (ctx: InterpreterContext, schema: unknown, value: unknown): boolean => {
  const sub: InterpreterContext = {
    root: ctx.root,
    formats: ctx.formats,
    emitErrors: false,
    regexCache: ctx.regexCache,
    refCache: ctx.refCache,
    errors: null,
    failed: false,
  }
  interpret(sub, schema, value, '')
  return !sub.failed
}

/** Emits the object-applicator keywords, inert for non-objects. */
const interpretObject = (ctx: InterpreterContext, s: Record<string, unknown>, value: unknown, path: string): void => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return
  const obj = value as Record<string, unknown>

  const properties = isPlainObject(s['properties']) ? s['properties'] : undefined
  const patternProperties = isPlainObject(s['patternProperties']) ? s['patternProperties'] : undefined
  const hasAdditional = 'additionalProperties' in s
  const additional = s['additionalProperties']
  const required = Array.isArray(s['required']) ? (s['required'] as string[]) : []
  const dependentRequired = isPlainObject(s['dependentRequired']) ? s['dependentRequired'] : undefined
  const minProps = typeof s['minProperties'] === 'number' ? s['minProperties'] : undefined
  const maxProps = typeof s['maxProperties'] === 'number' ? s['maxProperties'] : undefined

  const requiredSet = new Set(required)
  const knownKeys = properties ? Object.keys(properties) : []
  const knownKeySet = new Set(knownKeys)

  if (properties) {
    for (const key of knownKeys) {
      const pv = obj[key]
      if (requiredSet.has(key)) {
        if (pv === undefined) fail(ctx, `must have required property '${key}'`, path)
        else interpret(ctx, properties[key], pv, `${path}/${key}`)
      } else if (pv !== undefined) {
        interpret(ctx, properties[key], pv, `${path}/${key}`)
      }
      if (ctx.failed) return
    }
  }

  // Required keys with no `properties` entry still need a presence check.
  for (const key of required) {
    if (properties && key in properties) continue
    if (obj[key] === undefined) {
      fail(ctx, `must have required property '${key}'`, path)
      if (ctx.failed) return
    }
  }

  if (dependentRequired) {
    for (const [trigger, deps] of Object.entries(dependentRequired)) {
      if (!Array.isArray(deps)) continue
      if (obj[trigger] === undefined) continue
      for (const dep of deps as string[]) {
        if (obj[dep] === undefined) {
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
      if (obj[trigger] === undefined) continue
      interpret(ctx, subSchema, obj, path)
      if (ctx.failed) return
    }
  }

  // `dependencies` (draft-07): the dual-form predecessor of `dependentRequired`
  // + `dependentSchemas`. An array value requires the listed keys; a schema
  // value is applied to the whole object — both gated on the trigger's presence.
  const dependencies = isPlainObject(s['dependencies']) ? s['dependencies'] : undefined
  if (dependencies) {
    for (const [trigger, dep] of Object.entries(dependencies)) {
      if (obj[trigger] === undefined) continue
      if (Array.isArray(dep)) {
        for (const key of dep as string[]) {
          if (obj[key] === undefined) {
            fail(ctx, `must have property '${key}' when '${trigger}' is present`, path)
            if (ctx.failed) return
          }
        }
      } else {
        interpret(ctx, dep, obj, path)
        if (ctx.failed) return
      }
    }
  }

  const needsLoop = patternProperties !== undefined || (hasAdditional && additional !== true)
  if (needsLoop) {
    const patternEntries = patternProperties ? Object.entries(patternProperties) : []
    for (const k in obj) {
      if (knownKeySet.has(k)) continue

      if (patternEntries.length > 0) {
        let matched = false
        for (const [source, patternSchema] of patternEntries) {
          if (getRegex(ctx, source).test(k)) {
            matched = true
            interpret(ctx, patternSchema, obj[k], `${path}/${k}`)
            if (ctx.failed) return
          }
        }
        if (!matched && hasAdditional && additional === false) {
          fail(ctx, 'must NOT have additional properties', `${path}/${k}`)
          if (ctx.failed) return
        } else if (!matched && hasAdditional && isPlainObject(additional)) {
          interpret(ctx, additional, obj[k], `${path}/${k}`)
          if (ctx.failed) return
        }
      } else if (hasAdditional && additional === false) {
        fail(ctx, 'must NOT have additional properties', `${path}/${k}`)
        if (ctx.failed) return
      } else if (hasAdditional && isPlainObject(additional)) {
        interpret(ctx, additional, obj[k], `${path}/${k}`)
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
        fail(ctx, `property name "${k}" is invalid`, `${path}/${k}`)
        if (ctx.failed) return
      }
    }
  }
}

/** Emits the array-applicator keywords, inert for non-arrays. */
const interpretArray = (ctx: InterpreterContext, s: Record<string, unknown>, value: unknown, path: string): void => {
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
        interpret(ctx, tuple[index], arr[index], `${path}/${index}`)
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
      interpret(ctx, rest, arr[i], `${path}/${i}`)
      if (ctx.failed) return
    }
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

  const minLength = s['minLength']
  if (typeof minLength === 'number' && value.length < minLength) {
    fail(ctx, `must have at least ${minLength} characters`, path)
    if (ctx.failed) return
  }
  const maxLength = s['maxLength']
  if (typeof maxLength === 'number' && value.length > maxLength) {
    fail(ctx, `must have at most ${maxLength} characters`, path)
    if (ctx.failed) return
  }
  const pattern = s['pattern']
  if (typeof pattern === 'string' && !getRegex(ctx, pattern).test(value)) {
    fail(ctx, `must match pattern ${pattern}`, path)
    if (ctx.failed) return
  }
  const format = s['format']
  if (typeof format === 'string') {
    const enabled = ctx.formats === 'all' || ctx.formats.has(format)
    const re = FORMAT_CHECKS[format]
    if (enabled && re && !re.test(value)) {
      fail(ctx, `must match format "${format}"`, path)
    }
  }
}

/** Emits the numeric constraints, inert for non-numbers. */
const interpretNumber = (ctx: InterpreterContext, s: Record<string, unknown>, value: unknown, path: string): void => {
  if (typeof value !== 'number') return

  const minimum = s['minimum']
  if (typeof minimum === 'number' && value < minimum) {
    fail(ctx, `must be >= ${minimum}`, path)
    if (ctx.failed) return
  }
  const maximum = s['maximum']
  if (typeof maximum === 'number' && value > maximum) {
    fail(ctx, `must be <= ${maximum}`, path)
    if (ctx.failed) return
  }
  const exclusiveMinimum = s['exclusiveMinimum']
  if (typeof exclusiveMinimum === 'number' && value <= exclusiveMinimum) {
    fail(ctx, `must be > ${exclusiveMinimum}`, path)
    if (ctx.failed) return
  }
  const exclusiveMaximum = s['exclusiveMaximum']
  if (typeof exclusiveMaximum === 'number' && value >= exclusiveMaximum) {
    fail(ctx, `must be < ${exclusiveMaximum}`, path)
    if (ctx.failed) return
  }
  const multipleOf = s['multipleOf']
  if (typeof multipleOf === 'number' && multipleOf > 0) {
    // Floating-point modulo is unreliable (0.3 % 0.1 !== 0), so divide and
    // measure the distance to the nearest integer instead.
    const q = value / multipleOf
    if (Math.abs(q - Math.round(q)) > 1e-8) {
      fail(ctx, `must be a multiple of ${multipleOf}`, path)
    }
  }
}

/**
 * Validates `value` against a single (sub)schema, recording failures via
 * {@link fail}. This is the core recursive walker that every keyword funnels
 * through; the order of checks mirrors the schema's own keyword order so error
 * output is stable.
 */
export const interpret = (ctx: InterpreterContext, schema: unknown, value: unknown, path: string): void => {
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

  // $ref — validate against the resolved target (handles recursion naturally,
  // since the data shrinks with each level). Sibling keywords still apply per
  // 2020-12, so we do not stop here.
  if (typeof s['$ref'] === 'string') {
    interpret(ctx, resolveRef(ctx, s['$ref']), value, path)
    if (ctx.failed) return
  }

  // `$dynamicRef` (2020-12) — late-binds to a matching `$dynamicAnchor`. Like
  // `$ref`, sibling keywords still apply, so we do not stop here.
  if (typeof s['$dynamicRef'] === 'string') {
    interpret(ctx, resolveDyn(ctx, s['$dynamicRef']), value, path)
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
    const label = values.map((v) => JSON.stringify(v)).join(', ')
    if (values.every(isPrimitiveEnumValue)) {
      if (!values.includes(value)) fail(ctx, `must be one of: ${label}`, path)
    } else {
      let found = false
      for (const candidate of values) {
        if (deepEqual(value, candidate)) {
          found = true
          break
        }
      }
      if (!found) fail(ctx, `must be one of: ${label}`, path)
    }
    if (ctx.failed) return
  }

  const rawType = s['type']
  const types = Array.isArray(rawType) ? (rawType as string[]) : typeof rawType === 'string' ? [rawType] : undefined
  if (types && types.length > 0) {
    let ok = false
    for (const t of types) {
      if (matchesType(t, value)) {
        ok = true
        break
      }
    }
    if (!ok) {
      const label = types.length === 1 ? `must be ${types[0]}` : `must be one of type: ${types.join(', ')}`
      fail(ctx, label, path)
    }
    if (ctx.failed) return
  }

  // Type-specific keyword blocks. Each self-guards on the value's type, so they
  // compose correctly with unions and with schemas that omit `type` entirely.
  interpretObject(ctx, s, value, path)
  if (ctx.failed) return
  interpretArray(ctx, s, value, path)
  if (ctx.failed) return
  interpretString(ctx, s, value, path)
  if (ctx.failed) return
  interpretNumber(ctx, s, value, path)
  if (ctx.failed) return

  if (Array.isArray(s['allOf'])) {
    for (const sub of s['allOf']) {
      interpret(ctx, sub, value, path)
      if (ctx.failed) return
    }
  }

  if (Array.isArray(s['anyOf']) && s['anyOf'].length > 0) {
    let ok = false
    for (const sub of s['anyOf']) {
      if (matchesSchema(ctx, sub, value)) {
        ok = true
        break
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
      if (matchesSchema(ctx, sub, value)) count++
    }
    if (count !== 1) {
      fail(ctx, 'must match exactly one schema in oneOf', path)
      if (ctx.failed) return
    }
  }

  if ('not' in s) {
    if (matchesSchema(ctx, s['not'], value)) {
      fail(ctx, 'must not match schema', path)
      if (ctx.failed) return
    }
  }

  if ('if' in s) {
    if (matchesSchema(ctx, s['if'], value)) {
      if ('then' in s) interpret(ctx, s['then'], value, path)
    } else if ('else' in s) {
      interpret(ctx, s['else'], value, path)
    }
  }
}
