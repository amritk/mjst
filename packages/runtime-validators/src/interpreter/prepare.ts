import { assertsValidation } from '@/interpreter/asserts-validation'
import { compileNode, newCompiler } from '@/interpreter/compile'
import { limitsCacheKey, type ResolvedLimits, resolveLimits, screenSchema } from '@/interpreter/limits'
import { type InterpreterContext, NO_DYNAMIC_SCOPE, newValidatorCaches } from '@/interpreter/runtime'
import { buildSchemaRegistry, type SchemaDocuments } from '@/interpreter/schema-registry'
import type { ValidateOptions, ValidationResult } from '@/types'

/**
 * Caches one prepared validator per `(schema, mode, formats, limits, schemas)`.
 * The schema object is the cache key (via a `WeakMap`), so asking for a validator
 * for the same schema twice — common when one is built per request or on a hot
 * path — returns the same closure, and with it the same warm regex/`$ref` caches.
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

/**
 * A stable token per caller-supplied registry object. Two different registries
 * must never share a cache entry — the schema is the same, so nothing else in
 * the key would tell them apart, and handing back a validator built against
 * another registry would resolve a `$ref` to the wrong document and return a
 * silently wrong verdict.
 *
 * The token is issued by *identity*, in a `WeakMap` so it is collected with the
 * registry it describes.
 */
const registryTokens = new WeakMap<object, string>()
let registriesSeen = 0

/**
 * The registry's contribution to the cache key: its identity, plus the set of
 * URIs it currently holds.
 *
 * Identity alone would be the exact analogue of how the schema itself is keyed,
 * and the documented contract is that a registry is immutable once passed. The
 * URI list is the cheap tripwire for the mistake that contract invites anyway —
 * building the registry up across calls — so an added or removed document is a
 * cache miss rather than a stale validator. Swapping the *contents* of a URI in
 * place is still undetectable, exactly as mutating the schema object is.
 *
 * Costs nothing at all when no registry was supplied, which is the usual case.
 */
const registryKey = (schemas: SchemaDocuments | undefined): string => {
  if (schemas === undefined) return ''
  let token = registryTokens.get(schemas)
  if (token === undefined) {
    registriesSeen += 1
    token = `r${registriesSeen}`
    registryTokens.set(schemas, token)
  }
  return `${token}:${Object.keys(schemas).sort().join(',')}`
}

const cacheKey = (
  emitErrors: boolean,
  formats: 'all' | ReadonlySet<string>,
  limits: ResolvedLimits,
  schemas: SchemaDocuments | undefined,
): string => {
  const formatsKey = formats === 'all' ? '*' : [...formats].sort().join(',')
  return `${emitErrors ? 'e' : 'g'}|${formatsKey}|${limitsCacheKey(limits)}|${registryKey(schemas)}`
}

/**
 * Builds a validator closure for `schema`. There is still no compile step in the
 * sense that matters — the closure returns immediately, having read nothing but
 * the root's `$id` and `$schema` — because each schema node is specialized into
 * its own step (see `compile.ts`) the first time a validation actually reaches
 * it. A one-shot validation therefore pays only for the nodes it visits, and a
 * reused validator pays for each of them exactly once.
 */
const makeValidator = (
  schema: unknown,
  formats: 'all' | ReadonlySet<string>,
  emitErrors: boolean,
  limits: ResolvedLimits,
  schemas: SchemaDocuments | undefined,
): ((input: unknown) => unknown) => {
  // One walk of the schema, up front. It screens every
  // `pattern`/`patternProperties` source so a ReDoS-prone regex fails loudly
  // here (at build time) rather than mid-request, and it tells us whether the
  // document declares an `$id`.
  const screen = screenSchema(schema, limits.allowUnsafePatterns)

  // Registered documents are schemas the validator will really run, so they get
  // the same up-front regex screen. A ReDoS-prone `pattern` hiding in a document
  // the caller loaded from elsewhere is exactly the case worth catching here.
  if (schemas !== undefined) {
    for (const uri of Object.keys(schemas)) screenSchema(schemas[uri], limits.allowUnsafePatterns)
  }

  // The `$id` resource registry costs a second walk, so it is built only for the
  // documents that actually need one — and once per validator, never per call.
  // For everything else `registry` stays `null` and the interpreter's whole
  // base-URI apparatus switches off. A caller-supplied registry always needs one:
  // the schema may declare no `$id` of its own and still `$ref` a document by URI.
  const registry = screen.declaresId || schemas !== undefined ? buildSchemaRegistry(schema, schemas) : null
  const rootScope = registry === null ? NO_DYNAMIC_SCOPE : [registry.rootBase]

  // A registered metaschema can switch the validation vocabulary off for this
  // document. Read once, here — with no registry there is nothing to read, so
  // the ordinary schema pays a single null check.
  const asserts = assertsValidation(schema, registry)

  // One caches holder, captured here and shared across every call of this
  // validator. Its maps stay null until the schema actually follows a `$ref`, so
  // a first validation of the common ref-free schema allocates nothing here
  // beyond this tiny holder.
  const caches = newValidatorCaches()

  // The compiler and the root's node record. Neither reads the schema: asking
  // for a node hands back an empty record, and the step behind it is built the
  // first time a validation reaches that node. So building a validator stays
  // free, and a schema is only ever specialized as far as the data goes.
  const compiler = newCompiler(schema, registry, asserts, formats)
  const root = compileNode(compiler, schema)

  // One run context for the life of the validator, reset per call rather than
  // rebuilt. A validation is synchronous and the interpreter never calls back
  // into user code, so two runs of one validator can never overlap, and the
  // context, its budget holder, its ref stack and (in error mode) its branch
  // probe context are safe to keep. That took three allocations off every
  // call, which on a small schema was a measurable share of the whole run. The
  // error list is the one thing handed to the caller, and it is dropped from
  // the context at the start of the next run, so no two results share one.
  const ctx: InterpreterContext = {
    root: schema,
    registry,
    emitErrors,
    caches,
    errors: null,
    failed: false,
    refStack: [],
    maxDepth: limits.maxDepth,
    budget: { steps: limits.maxSteps },
    branch: null,
  }
  const maxSteps = limits.maxSteps

  return (input: unknown): unknown => {
    ctx.errors = null
    ctx.failed = false
    // A run that threw (a limit, an unresolvable ref) unwound past its
    // balanced pops, so the stack is cleared here rather than trusted.
    if (ctx.refStack.length !== 0) ctx.refStack.length = 0
    // A fresh budget per call: the ceiling is per-validation, not per-validator.
    ctx.budget.steps = maxSteps
    root.run(ctx, input, '', null, 0, rootScope)
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
  const schemas = options?.schemas

  // Only object/array schemas can be WeakMap keys. Boolean schemas are trivial,
  // so skipping the cache for them costs nothing.
  if (typeof schema !== 'object' || schema === null) {
    return makeValidator(schema, formats, emitErrors, limits, schemas)
  }

  let byKey = cache.get(schema)
  if (!byKey) {
    byKey = new Map()
    cache.set(schema, byKey)
  }

  const key = cacheKey(emitErrors, formats, limits, schemas)
  const existing = byKey.get(key)
  if (existing) return existing

  const validator = makeValidator(schema, formats, emitErrors, limits, schemas)
  if (byKey.size < MAX_CACHED_VARIANTS) byKey.set(key, validator)
  return validator
}
