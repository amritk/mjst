import { extractRefs } from '@amritk/helpers/extract-refs'
import { isSchemaObject } from '@amritk/helpers/schema-guards'
import { validateGuard } from '@amritk/runtime-validators'
import type { JSONSchema } from 'json-schema-typed/draft-2020-12'

/**
 * Keywords the direct generators can't fully honour on their own, so a value they
 * produce must be re-checked against a real validator. `oneOf` is included because
 * neither path enforces its *exactly-one* exclusivity; `anyOf`/`allOf` are not,
 * since a single satisfied branch (already how they are generated) is enough.
 */
const FILTER_KEYWORDS = new Set([
  'if',
  'then',
  'else',
  'not',
  'oneOf',
  'patternProperties',
  'propertyNames',
  'dependentRequired',
  'dependentSchemas',
  'dependencies',
  'minProperties',
  'maxProperties',
  'contains',
])

/**
 * Keys whose values are *data* (or reference targets), not applied subschemas, so
 * a `not`/`if`/… appearing inside them must not be mistaken for an applicator.
 * `$defs`/`definitions` hold *unapplied* definitions — a hard keyword there only
 * matters once referenced, and each referenced def gets its own generated file.
 */
const SKIP_RECURSE = new Set([
  // The data keywords, matching `@amritk/helpers`' `DATA_KEYWORDS` —
  // `example` is OpenAPI 3.0's singular spelling and belongs with `examples`.
  'enum',
  'const',
  'examples',
  'example',
  'default',
  // Plus this walker's own additions, which are not data but are equally not
  // applied here.
  '$ref',
  'required',
  '$defs',
  'definitions',
])

/**
 * Memoized per schema object. The answer is a property of the (immutable) schema
 * and is asked at *every* node of a derivation, so without this a deep document
 * re-walks each subtree once per ancestor.
 */
const filterAnswers = new WeakMap<object, boolean>()

/**
 * True when `schema` (anywhere in its applied subschema tree) uses a keyword the
 * direct generators can't guarantee, so the generated value must be run through a
 * validating filter. `$ref`s are not followed — a referenced definition is emitted
 * as its own self-validating file.
 */
export const needsValidationFilter = (schema: JSONSchema): boolean => {
  const walk = (node: unknown): boolean => {
    if (Array.isArray(node)) return node.some(walk)
    if (node === null || typeof node !== 'object') return false
    const obj = node as Record<string, unknown>
    for (const key of Object.keys(obj)) {
      if (FILTER_KEYWORDS.has(key)) return true
    }
    for (const [key, value] of Object.entries(obj)) {
      if (SKIP_RECURSE.has(key)) continue
      if (walk(value)) return true
    }
    return false
  }

  if (typeof schema !== 'object' || schema === null) return walk(schema)
  const cached = filterAnswers.get(schema)
  if (cached !== undefined) return cached
  const answer = walk(schema)
  filterAnswers.set(schema, answer)
  return answer
}

/** The containers a root document keeps its reusable definitions in. */
type DefContainer = '$defs' | 'definitions'

/**
 * Which definition a `$ref` needs, so only that one has to travel with the
 * schema. `'all'` means the ref cannot be mapped to a single definition name —
 * an `$anchor` reference (`#contact`) may be declared inside any of them — and
 * `null` means the definition splice could never satisfy it anyway (a pointer
 * into something other than `$defs`/`definitions`, e.g. `#/components/schemas/x`).
 *
 * The URI form matches how `@amritk/helpers/resolve-ref` treats it: the base URI
 * is looked up as a literal *key* of `$defs`.
 */
const defTargetFor = (ref: string): { container: DefContainer; name: string } | 'all' | null => {
  if (ref.startsWith('#')) {
    const fragment = ref.slice(1)
    if (fragment === '') return null
    if (!fragment.startsWith('/')) return 'all'
    const [container, name] = fragment.slice(1).split('/')
    if (name === undefined || (container !== '$defs' && container !== 'definitions')) return null
    // JSON Pointer escaping: `~1` is `/` and `~0` is `~`, in that order.
    return { container, name: name.replace(/~1/g, '/').replace(/~0/g, '~') }
  }
  const hash = ref.indexOf('#')
  return { container: '$defs', name: hash === -1 ? ref : ref.slice(0, hash) }
}

/**
 * The reference keywords whose target is chosen at *validation* time, out of the
 * dynamic scope, rather than from a lexical pointer anyone could follow ahead of
 * time. `$dynamicRef: '#node'` binds to the outermost `$dynamicAnchor: 'node'`
 * still in scope, and `$recursiveRef: '#'` to the outermost `$recursiveAnchor`;
 * neither names a definition we could pick out of `$defs`.
 */
const DYNAMIC_REF_KEYWORDS = new Set(['$dynamicRef', '$recursiveRef'])

/** Memoized per node, for the same reason {@link filterAnswers} is. */
const dynamicRefAnswers = new WeakMap<object, boolean>()

/**
 * True when a dynamic reference appears anywhere beneath `node`.
 *
 * This is deliberately a *full* walk — every key, `$defs` and `enum` included —
 * rather than one that follows only applicator keywords. The point is to decide
 * whether the reachability analysis below can be trusted at all, so anything it
 * skips is exactly what would make it wrong: a `$dynamicRef` hiding in an
 * unwalked corner still resolves at validation time against an anchor that could
 * be declared in *any* definition, so the only safe answer is to carry them all.
 */
const usesDynamicRef = (node: unknown): boolean => {
  if (node === null || typeof node !== 'object') return false
  const cached = dynamicRefAnswers.get(node)
  if (cached !== undefined) return cached
  const answer = Array.isArray(node)
    ? node.some(usesDynamicRef)
    : Object.entries(node as Record<string, unknown>).some(
        ([key, value]) => (DYNAMIC_REF_KEYWORDS.has(key) && typeof value === 'string') || usesDynamicRef(value),
      )
  dynamicRefAnswers.set(node, answer)
  return answer
}

/**
 * The definitions a schema can actually reach, or `'all'` when we cannot tell.
 *
 * Reachability is walked over `$ref` alone, which is the whole story only for a
 * schema without dynamic references. A `$dynamicRef`/`$recursiveRef` names an
 * anchor rather than a definition, so it contributes nothing to the walk and a
 * schema whose *only* reference is dynamic would otherwise travel with an empty
 * `$defs` — the validator then cannot resolve the anchor, the guard fails to
 * build, and the filter quietly degrades to accept-all. So the moment one shows
 * up, in the schema or in any definition it drags along, we hand back `'all'`
 * and splice the root's whole `$defs` the way this used to unconditionally.
 */
const reachableDefs = (
  schema: JSONSchema,
  rootSchema: Record<string, unknown>,
): Record<DefContainer, Record<string, unknown>> | 'all' => {
  if (usesDynamicRef(schema)) return 'all'

  // Null-prototype holders so a definition literally named `__proto__` lands as
  // a real own property instead of reassigning the holder's prototype.
  const picked: Record<DefContainer, Record<string, unknown>> = {
    $defs: Object.create(null) as Record<string, unknown>,
    definitions: Object.create(null) as Record<string, unknown>,
  }

  const seen = new Set<string>()
  const queue = [...extractRefs(schema)]
  // A read cursor rather than `shift()`, whose O(n) element move would make
  // draining a wide ref graph quadratic.
  for (let head = 0; head < queue.length; head++) {
    const ref = queue[head]
    if (ref === undefined || seen.has(ref)) continue
    seen.add(ref)

    const target = defTargetFor(ref)
    if (target === 'all') return 'all'
    if (target === null) continue

    const container = rootSchema[target.container]
    if (container === null || typeof container !== 'object') continue
    const definition = (container as Record<string, unknown>)[target.name]
    if (definition === undefined || Object.hasOwn(picked[target.container], target.name)) continue
    // A definition can introduce a dynamic reference the schema itself never
    // mentioned, and it resolves against the *whole* document's anchors.
    if (usesDynamicRef(definition)) return 'all'

    picked[target.container][target.name] = definition
    for (const nested of extractRefs(definition as JSONSchema)) {
      if (!seen.has(nested)) queue.push(nested)
    }
  }
  return picked
}

/**
 * Memoized per (root document, schema) pair. Two things depend on it: the guard
 * built in {@link makeInstanceCheck} — `@amritk/runtime-validators` caches its
 * prepared validator (and its up-front ReDoS screen of every `pattern` in the
 * document) on the schema *object*, so a stable identity turns a repeat call
 * into a lookup — and the JSON the arbitrary generator embeds in its output.
 */
const resolvableCache = new WeakMap<object, WeakMap<object, Record<string, unknown>>>()

/**
 * Returns `schema` augmented with the definitions its local `$ref`s need, so it
 * can be validated (or embedded in generated output) on its own.
 *
 * Only the *reachable* definitions come along. Splicing in the root's entire
 * `$defs` used to make every check quadratic in the size of the document — the
 * validator screens every `pattern` in whatever it is handed, so a 959-definition
 * OpenAPI schema paid for all 959 on each of the thousand-odd checks a single
 * generation run makes — and it also embedded the whole document into every
 * generated file that carries a validating filter. A ref we cannot pin to one
 * definition (an `$anchor` name, or any `$dynamicRef`/`$recursiveRef`) still
 * falls back to the full set, since correctness beats size. The schema's own
 * definitions win on collision.
 */
export const withResolvableDefs = (
  schema: JSONSchema,
  rootSchema?: Record<string, unknown>,
): Record<string, unknown> => {
  if (!rootSchema || typeof schema !== 'object' || schema === null) return spliceDefs(schema, rootSchema)

  const perRoot = resolvableCache.get(rootSchema) ?? new WeakMap<object, Record<string, unknown>>()
  resolvableCache.set(rootSchema, perRoot)
  const existing = perRoot.get(schema)
  if (existing) return existing

  const spliced = spliceDefs(schema, rootSchema)
  perRoot.set(schema, spliced)
  return spliced
}

const spliceDefs = (schema: JSONSchema, rootSchema?: Record<string, unknown>): Record<string, unknown> => {
  const base = isSchemaObject(schema) ? { ...schema } : { const: schema }
  if (!rootSchema) return base

  const reachable = reachableDefs(schema, rootSchema)
  for (const key of ['$defs', 'definitions'] as const) {
    const rootDefs = reachable === 'all' ? rootSchema[key] : reachable[key]
    if (!rootDefs || typeof rootDefs !== 'object') continue
    if (reachable !== 'all' && Object.keys(rootDefs).length === 0 && base[key] === undefined) continue
    base[key] = { ...(rootDefs as object), ...((base[key] as object) ?? {}) }
  }
  return base
}

/**
 * How strictly a check judges a candidate value.
 *
 * `format` is off for the checks that *steer* derivation (`refineExample` picks
 * among candidates; rejecting one over a format it cannot influence would only
 * discard a better value), and on for the final audit of an emitted example,
 * where an unsupported `format` falling back to the bare `"string"` is exactly
 * the kind of quiet wrongness worth reporting.
 */
export type InstanceCheckOptions = {
  readonly checkFormats?: boolean
}

/**
 * How much of the offending schema to quote. Enough to recognize which subschema
 * lost its filter, without one warning filling the terminal — a real-world
 * definition serializes to tens of kilobytes once its `$defs` travel with it.
 */
const WARNING_SCHEMA_LIMIT = 240

/**
 * Warn at most once per (schema, reason) pair. `makeInstanceCheck` is called at
 * practically every node of every derivation, so warning unconditionally would
 * print the same line hundreds of times for a single bad `pattern` and bury
 * everything else the run has to say.
 */
const reportedGuardFailures = new Set<string>()

/** A short, recognizable rendering of a schema for a warning message. */
const describeSchema = (schema: Record<string, unknown>): string => {
  const serialized = ((): string => {
    try {
      return JSON.stringify(schema) ?? String(schema)
    } catch {
      // A schema we cannot even serialize is exactly the sort we are warning
      // about, so fall back rather than throwing from the reporting path.
      return String(schema)
    }
  })()
  return serialized.length > WARNING_SCHEMA_LIMIT ? `${serialized.slice(0, WARNING_SCHEMA_LIMIT)}…` : serialized
}

/**
 * Reports a validity filter that could not be built, or that blew up on a value.
 *
 * Falling back to "everything is valid" keeps a generation run alive, and that is
 * the right call — an undecidable schema is not grounds for discarding otherwise
 * reasonable examples. Doing it *silently* is not: the whole point of the filter
 * is to catch `oneOf`/`not`/`pattern` violations the deriver cannot honour
 * structurally, so when it switches itself off, every example under that
 * subschema stops being checked and nothing downstream can tell. Say so once,
 * name the schema and the reason, and let the run finish.
 */
const warnUndecidableSchema = (schema: Record<string, unknown>, reason: unknown): void => {
  const described = describeSchema(schema)
  const message = reason instanceof Error ? reason.message : String(reason)
  const key = `${message}\n${described}`
  if (reportedGuardFailures.has(key)) return
  reportedGuardFailures.add(key)
  console.warn(
    `Warning: cannot validate generated values against ${described} — ${message}. ` +
      `Every candidate value is accepted for this subschema, so constraints only the validator ` +
      `enforces (\`oneOf\`, \`not\`, \`pattern\`, \`if\`/\`then\`, …) go unchecked there and the ` +
      `emitted example may not satisfy its own schema. Generation continues regardless; the usual ` +
      `causes are a \`$ref\` pointing outside this fragment and a \`pattern\` the ReDoS screen rejects.`,
  )
}

/** Builds the guard, or `undefined` when the interpreter refuses this schema. */
const tryGuard = (
  schema: Record<string, unknown>,
  checkFormats: boolean,
): ((input: unknown) => unknown) | undefined => {
  try {
    return checkFormats ? validateGuard(schema, { formats: 'all' }) : validateGuard(schema)
  } catch (error) {
    warnUndecidableSchema(schema, error)
    return undefined
  }
}

/**
 * Compiles a boolean validator for `schema` (with the definitions its `$ref`s
 * need spliced in). Used at generation time to accept/reject candidate example
 * values for keywords the deriver can't satisfy structurally.
 *
 * A schema the interpreter refuses — a `$ref` pointing outside the document
 * (`#/components/schemas/…` in a bare OpenAPI fragment), or a `pattern` its
 * ReDoS screen rejects — answers `true` for everything instead of throwing.
 * This check is an *opinion* about a candidate value; it must never be the
 * reason a whole generation run dies, and an undecidable schema is not grounds
 * for discarding an otherwise reasonable example. It does warn on the way past,
 * though — a filter that turns itself off without saying so is indistinguishable
 * from one that ran and approved of everything.
 */
export const makeInstanceCheck = (
  schema: JSONSchema,
  rootSchema?: Record<string, unknown>,
  options?: InstanceCheckOptions,
): ((value: unknown) => boolean) => {
  const resolved = withResolvableDefs(schema, rootSchema)
  const guard = tryGuard(resolved, options?.checkFormats === true)
  if (guard === undefined) return () => true
  return (value: unknown) => {
    try {
      return guard(value) === true
    } catch (error) {
      warnUndecidableSchema(resolved, error)
      return true
    }
  }
}
