import { getMjstInstanceOf, getMjstPrimitive } from '@amritk/helpers/mjst-extension'
import { readKey } from '@amritk/helpers/read-key'
import { resolveRef } from '@amritk/helpers/resolve-ref'
import {
  hasAdditionalProperties,
  hasAllOf,
  hasAnyOf,
  hasConst,
  hasDefault,
  hasDependentRequired,
  hasDependentSchemas,
  hasEnum,
  hasExamples,
  hasExclusiveMaximum,
  hasExclusiveMinimum,
  hasFormat,
  hasItems,
  hasMaxItems,
  hasMaximum,
  hasMaxLength,
  hasMaxProperties,
  hasMinItems,
  hasMinimum,
  hasMinLength,
  hasMinProperties,
  hasMultipleOf,
  hasOneOf,
  hasPattern,
  hasPatternProperties,
  hasProperties,
  hasPropertyNames,
  hasRef,
  hasRequired,
  hasType,
  hasUniqueItems,
  isSchemaObject,
} from '@amritk/helpers/schema-guards'
import type { JSONSchema } from 'json-schema-typed/draft-2020-12'

import { satisfiesScalarConstraints } from './satisfies-scalar-constraints'
import { makeInstanceCheck, needsValidationFilter } from './schema-validation'

/** Lowercases the first character of a name. e.g. "User" → "user" */
const lowerFirst = (name: string): string => name.charAt(0).toLowerCase() + name.slice(1)

/** Derives the example const name from a type name. e.g. "User" → "userExample" */
const exampleName = (typeName: string): string => `${lowerFirst(typeName)}Example`

/** A representative character for a single regex atom (class body / escape). */
const charForClass = (inner: string): string => {
  if (/a-z/.test(inner)) return 'a'
  if (/A-Z/.test(inner)) return 'A'
  if (/0-9|\\d/.test(inner)) return '5'
  const first = inner.replace(/^\^/, '')[0]
  return first && first !== '\\' ? first : 'a'
}
/**
 * The control characters a regex escape stands for. Without these, `\n` sampled
 * as the literal letter `n` — so a pattern like `a\nb` produced `"anb"`, which
 * fails its own regex and quietly shipped as the example.
 */
const CONTROL_ESCAPES: Readonly<Record<string, string>> = {
  n: '\n',
  r: '\r',
  t: '\t',
  f: '\f',
  v: '\v',
}

const charForEscape = (esc: string): string => {
  if (esc === '\\d') return '5'
  if (esc === '\\w') return 'a'
  if (esc === '\\s') return ' '
  const char = esc[1]
  if (char === undefined) return 'a'
  return CONTROL_ESCAPES[char] ?? char
}

/** Splits `s` on top-level `|`, respecting `[...]` and `(...)` nesting. */
const topLevelAlternatives = (s: string): string[] => {
  const parts: string[] = []
  let depth = 0
  let inClass = false
  let cur = ''
  for (let i = 0; i < s.length; i++) {
    const c = s[i] as string
    if (c === '\\') {
      cur += c + (s[i + 1] ?? '')
      i++
      continue
    }
    if (inClass) {
      cur += c
      if (c === ']') inClass = false
      continue
    }
    if (c === '[') inClass = true
    else if (c === '(') depth++
    else if (c === ')') depth--
    else if (c === '|' && depth === 0) {
      parts.push(cur)
      cur = ''
      continue
    }
    cur += c
  }
  parts.push(cur)
  return parts
}

/**
 * Whether `value` satisfies `pattern`, treating an uncompilable pattern as
 * unsatisfied rather than fatal. A schema may carry a `pattern` that is not a
 * valid JavaScript regex, and the sampler can still return a candidate for one
 * — so compiling it here threw a bare `SyntaxError` out of the generator and
 * ended the run. Falling through instead emits the plain fallback string, and
 * the invalid pattern surfaces where invalid schemas are reported. The
 * `patternProperties` compile in `deriveObject` already made this choice.
 */
const matchesPattern = (pattern: string, value: string): boolean => {
  try {
    return new RegExp(pattern).test(value)
  } catch {
    return false
  }
}

/**
 * Best-effort generator of a string matching a `pattern`, via recursive descent:
 * anchors, literals, `.`, escapes (`\d`/`\w`/`\s`), character classes, groups
 * (capturing / non-capturing / named), alternation (`a|b` — picks the first
 * usable branch), and the `+`/`*`/`?`/`{n}`/`{n,m}` quantifiers. Lookarounds and
 * backreferences fall through to `undefined`. The caller verifies the result
 * against the real regex and only uses it on a match, so a partial sampler never
 * makes the example worse — it just upgrades the cases it understands.
 */
const sampleFromPattern = (pattern: string, minLength: number): string | undefined => {
  let body = pattern
  if (body.startsWith('^')) body = body.slice(1)
  if (body.endsWith('$') && !body.endsWith('\\$')) body = body.slice(0, -1)

  // Samples one alternation, preferring the first branch that samples cleanly.
  const sampleAlt = (s: string): string | undefined => {
    for (const alt of topLevelAlternatives(s)) {
      const r = sampleSeq(alt)
      if (r !== undefined) return r
    }
    return undefined
  }

  // Samples one concatenation (no top-level `|`).
  const sampleSeq = (seq: string): string | undefined => {
    let out = ''
    let i = 0
    while (i < seq.length) {
      let unit: string | undefined
      const c = seq[i] as string
      if (c === '(') {
        // Find the matching close paren.
        let depth = 1
        let j = i + 1
        for (; j < seq.length && depth > 0; j++) {
          const cj = seq[j]
          if (cj === '\\') {
            j++
            continue
          }
          if (cj === '(') depth++
          else if (cj === ')') depth--
        }
        if (depth !== 0) return undefined
        let inner = seq.slice(i + 1, j - 1)
        if (/^\?[=!]/.test(inner) || /^\?<[=!]/.test(inner)) return undefined // lookaround
        inner = inner.replace(/^\?:/, '').replace(/^\?<[^>]*>/, '')
        unit = sampleAlt(inner)
        if (unit === undefined) return undefined
        i = j
      } else if (c === '[') {
        const end = seq.indexOf(']', i + 1)
        if (end === -1) return undefined
        unit = charForClass(seq.slice(i + 1, end))
        i = end + 1
      } else if (c === '\\') {
        const esc = seq.slice(i, i + 2)
        if (/\d/.test(esc[1] ?? '')) return undefined // backreference
        unit = charForEscape(esc)
        i += 2
      } else if (c === '.') {
        unit = 'a'
        i++
      } else {
        unit = c
        i++
      }

      // Optional quantifier.
      let reps = 1
      const q = seq[i]
      if (q === '+') {
        reps = Math.max(1, minLength)
        i++
      } else if (q === '*') {
        reps = Math.max(0, minLength)
        i++
      } else if (q === '?') {
        reps = 1
        i++
      } else if (q === '{') {
        const end = seq.indexOf('}', i + 1)
        if (end === -1) return undefined
        reps = Number.parseInt(seq.slice(i + 1, end), 10) || 0
        i = end + 1
      }
      out += unit.repeat(reps)
    }
    return out
  }

  return sampleAlt(body)
}

/**
 * A canonical instance of each string `format` we can produce one for. The list
 * tracks `@amritk/runtime-validators`' `FORMAT_CHECKS`, since that interpreter is
 * what decides whether an emitted example is accepted — a format missing here
 * falls back to the bare `"string"`, which almost never satisfies its own format.
 */
const FORMAT_EXAMPLES: Readonly<Record<string, string>> = {
  email: 'user@example.com',
  'idn-email': 'user@example.com',
  uuid: '00000000-0000-0000-0000-000000000000',
  uri: 'https://example.com',
  iri: 'https://example.com',
  // `url` is not a JSON Schema format, but OpenAPI documents use it constantly.
  url: 'https://example.com',
  'uri-reference': 'https://example.com',
  'iri-reference': 'https://example.com',
  'uri-template': 'https://example.com/{id}',
  'date-time': '1970-01-01T00:00:00.000Z',
  date: '1970-01-01',
  time: '00:00:00.000Z',
  duration: 'P1D',
  'json-pointer': '/example',
  'relative-json-pointer': '0/example',
  hostname: 'example.com',
  'idn-hostname': 'example.com',
  ipv4: '127.0.0.1',
  ipv6: '::1',
  // The `regex` format asks for a string that *compiles* as a regular expression.
  regex: '^example$',
}

/**
 * How many characters, elements, or properties a single derived value may carry.
 *
 * The `min*` keywords are schema *input*, so a document can ask for a 50-million
 * character string or a million-key object — and the deriver would faithfully
 * build it, then serialize it into a TypeScript file nobody can open. Worse, the
 * cost is not always linear: synthesized property names grow with the key count,
 * so a large `minProperties` used to cost quadratic time *and* memory
 * (`minProperties: 6000` derived 90 MB in three seconds, and it only got worse
 * from there). No fixture needs anything near this many, so a value past the cap
 * is a malformed or hostile document rather than a real requirement.
 *
 * Capping makes the example fall short of its own `minLength`/`minItems`/
 * `minProperties`, which is exactly the "no derivable instance" case the package
 * already handles: {@link generateExampleConst} validates the result and warns.
 * The generated `FooArbitrary` still honours the real bound. This is the same
 * bargain `@amritk/helpers`' `MAX_SCHEMA_DEPTH` strikes one level down.
 */
const MAX_DERIVED_SIZE = 10_000

/** Returns a representative string honouring `format`, `pattern`, and length. */
const exampleString = (schema: JSONSchema): string => {
  if (hasFormat(schema)) {
    // `Object.hasOwn`, not a bare index: `format` is schema input, and a
    // format naming an `Object.prototype` member resolved to a `Function` —
    // which is not a string, so the emitted `fooExample` carried `undefined`
    // for that property and the generated file failed to type-check.
    const formatted = readKey(FORMAT_EXAMPLES, schema.format)
    if (formatted !== undefined) return formatted
  }

  const minLength = Math.min(hasMinLength(schema) ? schema.minLength : 0, MAX_DERIVED_SIZE)
  if (hasPattern(schema)) {
    const sampled = sampleFromPattern(schema.pattern, minLength)
    // Only trust the sampler when it actually matches *and* fits both length
    // bounds. `minLength` used to be checked on the way in (as a repeat count)
    // but never on the way out, so `{ pattern: '^ab$', minLength: 5 }` happily
    // returned `"ab"`. Falling through instead lets the caller notice that
    // nothing satisfies the schema rather than emitting a value that does not.
    if (sampled !== undefined && sampled.length >= minLength && matchesPattern(schema.pattern, sampled)) {
      if (!(hasMaxLength(schema) && sampled.length > schema.maxLength)) return sampled
    }
  }

  let value = 'string'
  if (value.length < minLength) value = value.padEnd(minLength, 'x')
  if (hasMaxLength(schema) && value.length > schema.maxLength) value = value.slice(0, schema.maxLength)
  return value
}

/**
 * The per-root-document state `deriveExample` threads through its recursion.
 *
 * `values` is the whole point: a `$ref` reachable by several paths used to be
 * re-derived once *per path*, so any fan-out in the definition graph cost
 * exponential time — a 25-definition graph with three refs per definition took
 * ~20s, and adding two more definitions roughly quadrupled that.
 * `@amritk/helpers/walk-ref-graph` memoizes `resolveRef`/`extractRefs` per root
 * document for the same reason; this is the same idea one layer up.
 *
 * `active` is the cycle guard the path-scoped `seen` set used to be: it holds
 * exactly the refs on the current derivation path, so a recursive definition
 * still short-circuits to `null`. As one shared mutable set it also drops the
 * `new Set([...seen, ref])` copy that made every node cost O(depth) on its own.
 *
 * `undeclaredKey` records that some object gained a key its *generated type* will
 * not declare — see {@link generateExampleConst}, which needs the answer and
 * cannot recompute it without re-walking the schema the way the deriver did.
 * Like a cycle-truncated value it is a property of the derivation, so it travels
 * with the memo rather than being recomputed on a cache hit.
 *
 * `cycleBroken` is what makes the two safe together. A value produced by cutting
 * a cycle depends on *where* the cut fell, so it must not be memoized: any
 * short-circuit raises the flag, and a ref is only recorded in `values` when its
 * own subtree derived without one. That is also why the memo survives between
 * top-level calls — if `R`'s expansion could ever reach an ancestor of `R`, that
 * ancestor is on a cycle with `R` and the flag would have been raised the first
 * time `R` was derived, so `R` would never have been cached at all.
 */
type DeriveContext = {
  readonly rootSchema: Record<string, unknown> | undefined
  readonly values: Map<string, { value: unknown; undeclaredKey: boolean }>
  readonly active: Set<string>
  cycleBroken: boolean
  undeclaredKey: boolean
}

/**
 * One context per root document, dropped as soon as the caller releases the
 * schema. JSON Schema inputs are treated as immutable here (exactly as
 * `walk-ref-graph` does), so a run that emits hundreds of files from one loaded
 * document derives each definition once instead of once per referencing file.
 */
const contexts = new WeakMap<object, DeriveContext>()

const newContext = (rootSchema: Record<string, unknown> | undefined): DeriveContext => ({
  rootSchema,
  values: new Map(),
  active: new Set(),
  cycleBroken: false,
  undeclaredKey: false,
})

const contextFor = (rootSchema: Record<string, unknown> | undefined): DeriveContext => {
  if (rootSchema === undefined) return newContext(undefined)
  const existing = contexts.get(rootSchema)
  if (existing) return existing
  const created = newContext(rootSchema)
  contexts.set(rootSchema, created)
  return created
}

/**
 * Derives a single concrete, schema-valid value from a JSON Schema.
 *
 * Prefers explicit hints in this order: `const`, `examples[0]`, `default`,
 * `enum[0]`; otherwise produces a canonical value for the declared type.
 * `$ref`s are resolved and inlined by value; a recursive ref short-circuits to
 * `null` where the cycle closes.
 *
 * Derived values are memoized per `$ref` per root document, so the returned
 * value may share sub-objects with a value returned for a sibling schema. That
 * is safe for the generator (it serializes and never mutates), but treat the
 * result as read-only.
 *
 * Some schemas have no derivable instance (an unsatisfiable `pattern` +
 * `minLength`, a `oneOf` every candidate matches twice); this returns the
 * closest structural value it built. {@link generateExampleConst} validates the
 * final value and warns when that happens, rather than letting an invalid
 * example ship silently.
 */
export const deriveExample = (schema: JSONSchema, rootSchema?: Record<string, unknown>): unknown =>
  deriveReported(schema, rootSchema).value

/**
 * {@link deriveExample} plus the one fact about *how* the value was built that
 * the emitter needs: whether any object in it gained a key the generated type
 * will not declare.
 */
const deriveReported = (
  schema: JSONSchema,
  rootSchema?: Record<string, unknown>,
): { value: unknown; undeclaredKey: boolean } => {
  const ctx = contextFor(rootSchema)
  // A previous call can only have left `active` dirty by unwinding through an
  // exception, but a stale ancestor there would silently truncate this
  // derivation — so start every top-level call from a clean path.
  ctx.active.clear()
  ctx.cycleBroken = false
  ctx.undeclaredKey = false
  const value = derive(schema, ctx)
  return { value, undeclaredKey: ctx.undeclaredKey }
}

/** The recursive entry point, threading the shared {@link DeriveContext}. */
const derive = (schema: JSONSchema, ctx: DeriveContext): unknown => {
  if (!isSchemaObject(schema)) return null
  const base = deriveBase(schema, ctx)
  // Keywords the structural deriver can't fully honour (`if`/`then`/`else`,
  // `not`, `oneOf` exclusivity) are reconciled by validating candidates against a
  // real validator and picking the first that passes.
  return needsValidationFilter(schema) ? refineExample(schema, base, ctx) : base
}

/**
 * Resolves a `$ref` and derives its value, reusing the memo when the ref has
 * already been derived cycle-free. See {@link DeriveContext} for why a
 * cycle-truncated result is deliberately left out of the memo.
 */
const deriveRef = (ref: string, ctx: DeriveContext): unknown => {
  if (ctx.active.has(ref)) {
    ctx.cycleBroken = true
    return null
  }
  const memoized = ctx.values.get(ref)
  if (memoized !== undefined) {
    if (memoized.undeclaredKey) ctx.undeclaredKey = true
    return memoized.value
  }
  if (!ctx.rootSchema) return null
  const resolved = resolveRef(ref, ctx.rootSchema)
  if (!resolved) return null

  const outerBroken = ctx.cycleBroken
  const outerUndeclared = ctx.undeclaredKey
  ctx.cycleBroken = false
  ctx.undeclaredKey = false
  ctx.active.add(ref)
  try {
    const value = derive(resolved as JSONSchema, ctx)
    if (!ctx.cycleBroken) ctx.values.set(ref, { value, undeclaredKey: ctx.undeclaredKey })
    ctx.cycleBroken = outerBroken || ctx.cycleBroken
    ctx.undeclaredKey = outerUndeclared || ctx.undeclaredKey
    return value
  } finally {
    ctx.active.delete(ref)
  }
}

/**
 * The value a schema author offers as its own example, in preference order:
 * `examples[0]`, then `default`. Wrapped rather than returned bare, so a hint
 * that legitimately *is* `undefined` stays distinguishable from "no hint".
 */
const authoredHint = (schema: JSONSchema): { value: unknown } | undefined => {
  if (hasExamples(schema) && Array.isArray(schema.examples) && schema.examples.length > 0) {
    return { value: schema.examples[0] }
  }
  if (hasDefault(schema)) return { value: schema.default }
  return undefined
}

/** Structural derivation for a node, before any validating refinement. */
const deriveBase = (schema: JSONSchema, ctx: DeriveContext): unknown => {
  if (!isSchemaObject(schema)) return null
  // `const` needs no check: the generated type is the const's own literal type,
  // so the two agree however odd the schema is.
  if (hasConst(schema)) return schema.const

  // An authored `examples`/`default` is only worth preferring when it actually
  // satisfies the schema it sits in. Real documents carry plenty that do not —
  // `{ type: 'string', default: 42 }`, an `examples` entry left behind by an
  // edit, an object `default` of `{}` under a `required` — and the generated
  // type comes from the schema, not the hint, so emitting one verbatim produced
  // `const fooExample: string = 42`: a file that does not compile. Falling
  // through to structural derivation gives a value that at least matches its own
  // declared type.
  const hint = authoredHint(schema)
  if (hint !== undefined && makeInstanceCheck(schema, ctx.rootSchema)(hint.value)) return hint.value
  if (hasEnum(schema) && schema.enum.length > 0) {
    // Prefer the first member that also satisfies any sibling length/range
    // constraints (e.g. `enum` + `minLength`), falling back to the first member.
    const fitting = schema.enum.find((value) => satisfiesScalarConstraints(schema, value))
    return fitting !== undefined ? fitting : schema.enum[0]
  }

  if (hasRef(schema)) return deriveRef(schema.$ref, ctx)

  const instanceOf = getMjstInstanceOf(schema)
  if (instanceOf === 'Date') return new Date(0)
  const primitive = getMjstPrimitive(schema)
  if (primitive === 'bigint') return 0n

  // `allOf` must satisfy every branch at once, so derive from a single schema
  // that merges the branches (and the node's own keywords) rather than picking
  // one branch — picking one would ignore the others' constraints.
  if (hasAllOf(schema)) return derive(mergeAllOf(schema), ctx)

  if (hasOneOf(schema) && schema.oneOf[0] !== undefined) return derive(schema.oneOf[0], ctx)
  if (hasAnyOf(schema) && schema.anyOf[0] !== undefined) return derive(schema.anyOf[0], ctx)

  if (hasType(schema)) return deriveForType(schema.type, schema, ctx)

  // Multi-type schemas (`type: ['string', 'null']`) derive from their first
  // member type; `hasType` only matches a single string `type`.
  if (Array.isArray(schema.type) && schema.type.length > 0) {
    return deriveForType(schema.type[0] as string, schema, ctx)
  }

  return null
}

/** The applicator keywords whose satisfaction is reconciled by {@link refineExample}. */
const REFINED_APPLICATORS = ['if', 'then', 'else', 'not', 'oneOf'] as const

/** A shallow copy of `schema` with the refined applicator keywords removed. */
const structuralOnly = (schema: JSONSchema): JSONSchema => {
  const clone = { ...(schema as Record<string, unknown>) }
  for (const key of REFINED_APPLICATORS) delete clone[key]
  return clone as JSONSchema
}

/**
 * Nudges a value away from itself so it can escape a `not`. Only the shapes with
 * an obvious "next" value are perturbed — a suffixed string, a stepped number, a
 * flipped boolean, `null` swapped for a plain string — because the point is to
 * clear a narrow exclusion (`not: { const: 'string' }`), not to search the space.
 * The caller validates the result, so a perturbation that does not help is
 * simply discarded.
 */
const perturb = (value: unknown): unknown[] => {
  if (typeof value === 'string') return [`${value}-1`, '']
  if (typeof value === 'number') return [value + 1, value - 1]
  if (typeof value === 'boolean') return [!value]
  if (value === null) return ['string', 0]
  if (Array.isArray(value)) return [[], [...value, null]]
  if (typeof value === 'object') return [{}]
  return []
}

/**
 * Reconciles keywords the structural deriver can't satisfy on its own
 * (`if`/`then`/`else`, `not`, `oneOf` exclusivity). It validates the structural
 * `base` against the full schema and, if it fails, tries alternative candidates —
 * each `oneOf` branch, the `then`/`else` branches merged with the structural
 * siblings, and (for `not`) a perturbation of `base` — returning the first that
 * validates.
 *
 * When nothing validates it returns `base` unchanged. That is the honest answer
 * for a schema with no derivable instance, but it is *not* silent:
 * {@link generateExampleConst} re-validates the final value and warns.
 */
const refineExample = (schema: JSONSchema, base: unknown, ctx: DeriveContext): unknown => {
  const check = makeInstanceCheck(schema, ctx.rootSchema)
  if (check(base)) return base

  const raw = schema as Record<string, unknown>
  const structural = structuralOnly(schema)
  const combine = (branch: unknown): unknown => derive({ allOf: [structural, branch as JSONSchema] } as JSONSchema, ctx)

  const candidates: unknown[] = []
  if (hasOneOf(schema)) {
    for (const branch of schema.oneOf) if (branch !== undefined) candidates.push(combine(branch))
  }
  if ('if' in raw) {
    if (raw['then'] !== undefined) candidates.push(combine(raw['then']))
    if (raw['else'] !== undefined) candidates.push(combine(raw['else']))
    // `if` failing (so neither `then` nor a matched `else` applies) is also valid.
    candidates.push(derive(structural, ctx))
  }
  // A `not` had no candidate at all, so the canonical value it forbids (the
  // very common `not: { const: 'string' }` / `not: { enum: [...] }`) was handed
  // back verbatim. Offer the nudged values instead.
  if ('not' in raw) candidates.push(...perturb(base))

  for (const candidate of candidates) if (check(candidate)) return candidate
  return base
}

/** Derives a canonical value for a single declared `type`. */
const deriveForType = (type: string, schema: JSONSchema, ctx: DeriveContext): unknown => {
  switch (type) {
    case 'string':
      return exampleString(schema)
    case 'number':
    case 'integer':
      return deriveNumber(schema, type === 'integer')
    case 'boolean':
      return true
    case 'null':
      return null
    case 'array':
      return deriveArray(schema, ctx)
    case 'object':
      return deriveObject(schema, ctx)
    default:
      return null
  }
}

/**
 * Records a derived property on the value being built.
 *
 * A plain `out[key] = value` is a trap for exactly one key: `__proto__` resolves
 * to `Object.prototype`'s prototype *setter*, so the assignment creates no own
 * property (and, for an object value, silently reparents `out`). A schema with a
 * `__proto__` property therefore emitted an example missing the very key its
 * generated type declares as required. `defineProperty` writes a normal own
 * property, and every other key keeps the fast path.
 */
const setProperty = (out: Record<string, unknown>, key: string, value: unknown): void => {
  if (key === '__proto__') {
    Object.defineProperty(out, key, { value, writable: true, enumerable: true, configurable: true })
    return
  }
  out[key] = value
}

/**
 * Builds an object value honouring `properties`/`required`/`additionalProperties`
 * plus the presence-gated and key-shaped keywords: `patternProperties` and
 * `additionalProperties` pick the value schema for synthesized keys,
 * `propertyNames` constrains those keys, `dependentRequired`/`dependentSchemas`
 * add keys once their trigger is present, and `minProperties`/`maxProperties`
 * bound the key count.
 */
const deriveObject = (schema: JSONSchema, ctx: DeriveContext): Record<string, unknown> => {
  const out: Record<string, unknown> = {}

  const patternEntries: Array<[RegExp, JSONSchema]> = hasPatternProperties(schema)
    ? Object.entries(schema.patternProperties).flatMap(([source, sub]) => {
        try {
          return [[new RegExp(source), sub]] as Array<[RegExp, JSONSchema]>
        } catch {
          return []
        }
      })
    : []
  const additional = hasAdditionalProperties(schema) ? schema.additionalProperties : false
  const additionalSchema = isSchemaObject(additional) ? additional : undefined
  const additionalClosed = hasAdditionalProperties(schema) && schema.additionalProperties === false
  // With `additionalProperties: false`, extra keys are still allowed when they
  // match a `patternProperties` entry; only a fully closed object forbids all.
  const extrasAllowed = !additionalClosed || patternEntries.length > 0
  const nameCheck = hasPropertyNames(schema) ? makeInstanceCheck(schema.propertyNames, ctx.rootSchema) : undefined

  // The generated type declares exactly the `properties` keys, widened by an
  // index signature when `additionalProperties`/`patternProperties` supply one.
  // Every *other* key this function invents — a `required` name with no
  // `properties` entry, a dependency key, a `minProperties` filler — is a key
  // the type has no room for, and an object literal carrying it is an excess
  // property TypeScript rejects outright. Note when that happens so
  // `generateExampleConst` can emit a value that still compiles.
  const declaredKeys = new Set(hasProperties(schema) ? Object.keys(schema.properties) : [])
  const hasIndexSignature =
    additionalSchema !== undefined || (hasPatternProperties(schema) && Object.keys(schema.patternProperties).length > 0)
  const noteKey = (key: string): void => {
    if (!hasIndexSignature && !declaredKeys.has(key)) ctx.undeclaredKey = true
  }

  // The value schema for a key not declared in `properties`: the matching
  // `patternProperties` (intersected when several match), else `additionalProperties`.
  const valueSchemaFor = (key: string): JSONSchema | undefined => {
    const matches = patternEntries.filter(([re]) => re.test(key)).map(([, sub]) => sub)
    if (matches.length === 1) return matches[0]
    if (matches.length > 1) return { allOf: matches } as JSONSchema
    return additionalSchema
  }
  // A key that is neither declared in `properties` nor matched by a
  // `patternProperties` entry cannot legally be invented on a closed object, so
  // do not: `{ properties: { a }, required: ['a', 'b'], additionalProperties:
  // false }` used to gain a `"b": null` that `additionalProperties: false` then
  // rejected. Such a schema has no valid instance at all; leaving the key out
  // keeps the example as close to valid as it can get, and the final check in
  // `generateExampleConst` reports the schema rather than papering over it.
  const addKey = (key: string): void => {
    const sub = valueSchemaFor(key)
    if (sub === undefined && additionalClosed) return
    noteKey(key)
    setProperty(out, key, sub !== undefined ? derive(sub, ctx) : null)
  }

  if (hasProperties(schema)) {
    for (const [key, propSchema] of Object.entries(schema.properties)) {
      setProperty(out, key, derive(propSchema, ctx))
    }
  }
  // A required key with no `properties` entry still needs a value.
  if (hasRequired(schema)) {
    for (const key of schema.required) if (!Object.hasOwn(out, key)) addKey(key)
  }
  // `dependentRequired`: once a trigger key is present, its dependencies must be too.
  if (hasDependentRequired(schema)) {
    for (const [trigger, deps] of Object.entries(schema.dependentRequired)) {
      if (!Object.hasOwn(out, trigger)) continue
      for (const dep of deps) if (!Object.hasOwn(out, dep)) addKey(dep)
    }
  }
  // `dependentSchemas`: once a trigger key is present, the object must also
  // satisfy the dependency subschema — apply its `properties`/`required`.
  if (hasDependentSchemas(schema)) {
    for (const [trigger, sub] of Object.entries(schema.dependentSchemas)) {
      if (Object.hasOwn(out, trigger) && isSchemaObject(sub)) applyDependentSchema(out, sub, ctx, noteKey)
    }
  }
  // Synthesize filler keys to reach `minProperties` when extras are allowed.
  // `Object.keys(out).length` is counted once and then tracked, rather than
  // recomputed per iteration: rebuilding the key list on every pass made filling
  // a large `minProperties` quadratic on its own.
  if (hasMinProperties(schema) && extrasAllowed) {
    const target = Math.min(schema.minProperties, MAX_DERIVED_SIZE)
    let count = Object.keys(out).length
    let n = 0
    // Each attempt may be rejected (a duplicate, or a name `propertyNames`
    // refuses), so allow a fixed slack of extra attempts before giving up rather
    // than looping forever on a schema whose keys cannot be synthesized.
    let attempts = 0
    while (count < target && attempts++ < target + 50) {
      const key = synthKey(n++, patternEntries, schema, nameCheck)
      // No candidate name satisfies the schema's key constraints, and a larger
      // index will not change that — stop rather than burn the attempt budget.
      if (key === undefined) break
      if (Object.hasOwn(out, key)) continue
      addKey(key)
      if (Object.hasOwn(out, key)) count++
    }
  }
  // Enforce `maxProperties` by dropping keys that aren't required (directly or via
  // a present `dependentRequired` trigger) until the count fits.
  if (hasMaxProperties(schema)) enforceMaxProperties(out, schema, schema.maxProperties)

  return out
}

/**
 * Applies a `dependentSchemas` branch's object shape (`properties`/`required`) in
 * place. `noteKey` reports each added key to the parent, whose `properties` — not
 * the branch's — are what the generated type was built from.
 */
const applyDependentSchema = (
  out: Record<string, unknown>,
  sub: JSONSchema,
  ctx: DeriveContext,
  noteKey: (key: string) => void,
): void => {
  const add = (key: string, propSchema: JSONSchema | undefined): void => {
    noteKey(key)
    setProperty(out, key, propSchema !== undefined ? derive(propSchema, ctx) : null)
  }
  if (hasProperties(sub)) {
    for (const [key, propSchema] of Object.entries(sub.properties)) {
      if (!Object.hasOwn(out, key)) add(key, propSchema)
    }
  }
  if (hasRequired(sub)) {
    const propSchemas = hasProperties(sub) ? sub.properties : {}
    for (const key of sub.required) {
      if (Object.hasOwn(out, key)) continue
      add(key, propSchemas[key])
    }
  }
}

/**
 * How long a synthesized property name may get.
 *
 * The repetition fallback below lengthens the key by one seed per property, so
 * without a ceiling the n-th key is n seeds long and filling a wide object costs
 * quadratic memory. Past this length we are no longer naming a property, we are
 * building a haystack — so {@link synthKey} gives up instead and the caller stops
 * inventing keys. Far above any property name a real document uses.
 */
const MAX_SYNTH_KEY_LENGTH = 64

/**
 * Produces a candidate key name for the i-th synthesized property. Prefers a key
 * matching a `patternProperties` entry (so the entry supplies its value schema),
 * then one matching `propertyNames`, then a plain `extra`. Returns `undefined`
 * when no candidate can satisfy the schema's key constraints — the caller reads
 * that as "this schema's key space is exhausted" and stops.
 */
const synthKey = (
  i: number,
  patternEntries: ReadonlyArray<readonly [RegExp, JSONSchema]>,
  schema: JSONSchema,
  nameCheck: ((value: unknown) => boolean) | undefined,
): string | undefined => {
  // Two ways to vary a seed into a distinct key, cheapest first. A digit suffix
  // keeps every key the same short length, which is what makes filling a wide
  // object linear rather than quadratic. *Repeating* the seed (`x-` → `x-x-`) is
  // the fallback, because it is far likelier to keep matching a key pattern
  // (`^[a-z]+$`, `^x-`) that a digit suffix would break.
  const variants = (seed: string): string[] =>
    i === 0 ? [seed] : [`${seed}${i}`, seed.repeat(i + 1)].filter((key) => key.length <= MAX_SYNTH_KEY_LENGTH)

  // Each seed carries the key test it has to keep passing: a seed sampled from a
  // `patternProperties` entry is only worth using while it still matches that
  // entry, since matching is what earns the key its value schema.
  const seeds: Array<{ seed: string; matches: (key: string) => boolean }> = []
  for (const [re] of patternEntries) {
    const sampled = sampleFromPattern(re.source, 0)
    if (sampled !== undefined && sampled.length > 0) {
      seeds.push({ seed: sampled, matches: (key) => re.test(key) })
    }
  }
  const propertyNames = isSchemaObject(schema) && hasPropertyNames(schema) ? schema.propertyNames : undefined
  if (propertyNames !== undefined && isSchemaObject(propertyNames) && hasPattern(propertyNames)) {
    const sampled = sampleFromPattern(propertyNames.pattern, 0)
    if (sampled !== undefined && sampled.length > 0) seeds.push({ seed: sampled, matches: () => true })
  }
  seeds.push({ seed: 'extra', matches: () => true })

  for (const { seed, matches } of seeds) {
    for (const key of variants(seed)) {
      if (matches(key) && (!nameCheck || nameCheck(key))) return key
    }
  }
  return undefined
}

/** Drops non-required keys until `out` has at most `max` properties. */
const enforceMaxProperties = (out: Record<string, unknown>, schema: JSONSchema, max: number): void => {
  // Snapshot the keys once and track the count, rather than asking
  // `Object.keys(out).length` again for every deletion — that rebuilt the whole
  // key list per key removed, which is quadratic on a wide object.
  const keys = Object.keys(out)
  let count = keys.length
  if (count <= max) return

  const protectedKeys = new Set<string>(hasRequired(schema) ? schema.required : [])
  if (hasDependentRequired(schema)) {
    for (const [trigger, deps] of Object.entries(schema.dependentRequired)) {
      if (Object.hasOwn(out, trigger)) for (const dep of deps) protectedKeys.add(dep)
    }
  }
  for (const key of keys) {
    if (count <= max) break
    if (protectedKeys.has(key)) continue
    delete out[key]
    count--
  }
}

/**
 * Picks a number satisfying the node's bounds and `multipleOf`. Starts at the
 * lower bound (or 0 when unbounded), nudges past an exclusive bound, then rounds
 * up to the nearest multiple. An unsatisfiable range (e.g. `minimum > maximum`)
 * can't be met and falls back to the lower bound.
 */
const deriveNumber = (schema: JSONSchema, isInteger: boolean): number => {
  const step = isInteger ? 1 : 0.5
  let lo = -Infinity
  if (hasMinimum(schema)) lo = Math.max(lo, schema.minimum)
  if (hasExclusiveMinimum(schema)) lo = Math.max(lo, schema.exclusiveMinimum + step)
  const hi = hasMaximum(schema)
    ? schema.maximum
    : hasExclusiveMaximum(schema)
      ? schema.exclusiveMaximum - step
      : Number.POSITIVE_INFINITY

  // Base candidate: the lower bound, or 0 (or the upper bound) when unbounded below.
  let value = Number.isFinite(lo) ? lo : Number.isFinite(hi) ? Math.min(0, hi) : 0
  if (isInteger) value = Math.ceil(value)

  if (hasMultipleOf(schema) && schema.multipleOf > 0) {
    const m = schema.multipleOf
    value = Math.ceil(value / m - 1e-9) * m
    // Rounding up can overshoot the upper bound; drop to the largest multiple
    // that fits. (If even that falls below `lo`, the range has no multiple — an
    // unsatisfiable schema — and we return the in-range candidate as best effort.)
    if (value > hi && Number.isFinite(hi)) value = Math.floor(hi / m + 1e-9) * m
  }
  // `+ 0` normalizes a `-0` (which `Math.ceil`/`Math.floor` can produce) to `0`.
  return (isInteger ? Math.round(value) : value) + 0
}

/**
 * Derives an array value. A tuple schema (`prefixItems`, or the draft-07
 * array-form `items`) derives one value per position; a uniform array repeats a
 * single item value. The count is clamped into `[minItems, maxItems]` so a
 * `maxItems: 0` yields `[]` and a `minItems` is always met.
 */
const deriveArray = (schema: JSONSchema, ctx: DeriveContext): unknown[] => {
  const items = hasItems(schema) ? schema.items : undefined
  const prefixItems = (schema as Record<string, unknown>)['prefixItems']
  // A tuple is `prefixItems` (2020-12) or the draft-07 array-form `items`.
  const prefix = Array.isArray(prefixItems)
    ? (prefixItems as JSONSchema[])
    : Array.isArray(items)
      ? (items as JSONSchema[])
      : undefined

  const min = hasMinItems(schema) ? schema.minItems : 0
  const max = hasMaxItems(schema) ? schema.maxItems : Number.POSITIVE_INFINITY
  // The rest/uniform element schema (the singular object-form `items`). A boolean
  // `items` (`true`/`false`) is not a value-producing schema, so it is not `rest`.
  const rest = items !== undefined && !Array.isArray(items) && isSchemaObject(items) ? items : undefined

  if (prefix) {
    const tuple = prefix.map((item) => derive(item, ctx))
    // Pad up to `minItems`: with the rest schema when one is present, otherwise
    // (in 2020-12 additional items past `prefixItems` are unconstrained unless
    // `items: false`) with a plain `null`.
    const itemsClosed = (schema as Record<string, unknown>)['items'] === false
    while (tuple.length < min && tuple.length < max) {
      if (rest !== undefined) tuple.push(derive(rest, ctx))
      else if (itemsClosed) break
      else tuple.push(null)
    }
    return tuple.length > max ? tuple.slice(0, max) : tuple
  }

  const raw = schema as Record<string, unknown>
  const containsRaw = raw['contains'] as JSONSchema | undefined
  const contains = containsRaw !== undefined && isSchemaObject(containsRaw) ? containsRaw : undefined
  const minContains =
    contains !== undefined ? (typeof raw['minContains'] === 'number' ? (raw['minContains'] as number) : 1) : 0
  const unique = hasUniqueItems(schema) && schema.uniqueItems === true
  // The element schema: the uniform `items`, else the `contains` subschema.
  const elem = rest ?? contains

  // With `uniqueItems` over a closed value set, walk the set instead of
  // perturbing one value: `distinctify` would push `'a'` to `'a1'`, which the
  // set (`enum: ['a', 'b']`, `type: 'boolean'`) does not contain.
  const choices = unique && contains === undefined ? closedValueSet(elem) : undefined

  // Prefer a non-empty example, satisfy `minItems` and `minContains`, never exceed
  // `maxItems` — and never build more elements than {@link MAX_DERIVED_SIZE}, so a
  // document asking for a million-element array does not become a million-element
  // TypeScript literal.
  const wanted = Math.min(Math.max(min, minContains, max === 0 ? 0 : 1), max, MAX_DERIVED_SIZE)
  // A set of N values cannot fill more than N distinct slots. When `minItems`
  // asks for more (`minItems: 3` over booleans) the schema has no valid
  // instance; stopping at N keeps the array at least *unique*, and the final
  // check in `generateExampleConst` reports the schema.
  const count = choices !== undefined ? Math.min(wanted, choices.length) : wanted

  const result: unknown[] = []
  for (let i = 0; i < count; i++) {
    if (choices !== undefined) {
      result.push(choices[i])
      continue
    }
    // Make the first `minContains` items satisfy `contains`; the rest use `items`.
    const itemSchema = contains !== undefined && i < minContains ? contains : elem
    const base = itemSchema !== undefined ? derive(itemSchema, ctx) : null
    result.push(unique ? distinctify(base, i, itemSchema) : base)
  }
  return result
}

/**
 * The complete set of values an item schema admits, when that set is finite and
 * small enough to enumerate: `const`, `enum`, `boolean`, `null`. `uniqueItems`
 * needs distinct elements, and for these schemas the {@link distinctify}
 * perturbation would step straight out of the schema, so the caller walks this
 * set instead. `undefined` means the value space is open and perturbing is fine.
 */
const closedValueSet = (schema: JSONSchema | undefined): unknown[] | undefined => {
  if (schema === undefined || !isSchemaObject(schema)) return undefined
  if (hasConst(schema)) return [schema.const]
  if (hasEnum(schema)) {
    const fitting = schema.enum.filter((value) => satisfiesScalarConstraints(schema, value))
    return fitting.length > 0 ? fitting : [...schema.enum]
  }
  if (hasType(schema) && schema.type === 'boolean') return [true, false]
  if (hasType(schema) && schema.type === 'null') return [null]
  return undefined
}

/**
 * Returns a value distinct from earlier ones for index `i`, used to satisfy
 * `uniqueItems`, while staying within the item schema's constraints: numbers step
 * by `multipleOf` (so the perturbed values remain valid multiples) rather than by
 * 1, strings are suffixed, booleans alternated. Values that can't be cheaply
 * varied are returned as-is (a best-effort the generated `fast-check` arbitrary
 * covers fully).
 */
const distinctify = (base: unknown, i: number, itemSchema: JSONSchema | undefined): unknown => {
  if (i === 0) return base
  if (typeof base === 'number') {
    const step =
      itemSchema && isSchemaObject(itemSchema) && hasMultipleOf(itemSchema) && itemSchema.multipleOf > 0
        ? itemSchema.multipleOf
        : 1
    return base + i * step
  }
  if (typeof base === 'string') return `${base}${i}`
  if (typeof base === 'boolean') return i % 2 === 1 ? !base : base
  return base
}

/**
 * Flattens an `allOf` into a single schema: object `properties` are merged and
 * `required` unioned across branches, while scalar keywords from later branches
 * (and the node's own keywords) win. `allOf` itself is dropped so the merged
 * schema derives directly.
 */
const TIGHTEST = new Map<string, 'max' | 'min'>([
  ['minimum', 'max'],
  ['exclusiveMinimum', 'max'],
  ['minLength', 'max'],
  ['minItems', 'max'],
  ['minProperties', 'max'],
  ['maximum', 'min'],
  ['exclusiveMaximum', 'min'],
  ['maxLength', 'min'],
  ['maxItems', 'min'],
  ['maxProperties', 'min'],
])

export const mergeAllOf = (schema: JSONSchema): JSONSchema => {
  const branches = hasAllOf(schema) ? schema.allOf : []
  const merged: Record<string, unknown> = {}
  const properties: Record<string, unknown[]> = {}
  const required = new Set<string>()

  for (const branch of [...branches, schema]) {
    if (!isSchemaObject(branch)) continue
    for (const [key, value] of Object.entries(branch)) {
      if (key === 'allOf') continue
      if (key === 'properties' && value && typeof value === 'object') {
        // The same property constrained by several branches must satisfy all of
        // them, so collect each schema and combine them below rather than letting
        // a later branch's schema silently replace an earlier one.
        for (const [prop, propSchema] of Object.entries(value)) {
          const bucket = properties[prop]
          if (bucket) bucket.push(propSchema)
          else properties[prop] = [propSchema]
        }
      } else if (key === 'required' && Array.isArray(value)) {
        for (const r of value) required.add(r as string)
      } else if (key === 'enum' && Array.isArray(value)) {
        // A value must be in *every* branch's enum, so intersect rather than let
        // a later branch's enum replace an earlier one (which could pick a member
        // the earlier branch rejects).
        merged['enum'] = Array.isArray(merged['enum'])
          ? (merged['enum'] as unknown[]).filter((member) => value.includes(member))
          : value
      } else if (TIGHTEST.has(key) && typeof value === 'number' && typeof merged[key] === 'number') {
        // Numeric bounds from different branches combine to the tightest one.
        merged[key] = TIGHTEST.get(key) === 'max' ? Math.max(merged[key], value) : Math.min(merged[key], value)
      } else {
        merged[key] = value
      }
    }
  }

  const mergedProps: Record<string, unknown> = {}
  for (const [prop, schemas] of Object.entries(properties)) {
    mergedProps[prop] = schemas.length === 1 ? schemas[0] : { allOf: schemas }
  }
  if (Object.keys(mergedProps).length > 0) merged['properties'] = mergedProps
  if (required.size > 0) merged['required'] = [...required]
  return merged as JSONSchema
}

/**
 * Object-literal key form that survives the one runtime-dangerous name,
 * `__proto__`. Quoting does not help: `{ "__proto__": v }` is still the
 * prototype-setter syntax, so the emitted example would lose the key (and take
 * `v` as its prototype) no matter how carefully we derived it. The computed form
 * `{ ["__proto__"]: v }` defines a normal own property — the same fix
 * `generate-parsers` applies in `safeLiteralKey`.
 */
const serializeKey = (key: string): string => (key === '__proto__' ? '["__proto__"]' : JSON.stringify(key))

/**
 * Serializes a derived value into a TypeScript source expression. Handles the
 * non-JSON values `deriveExample` can produce (`Date`, `bigint`) in addition to
 * plain JSON.
 */
export const serializeValue = (value: unknown): string => {
  if (typeof value === 'bigint') return `${value}n`
  if (value instanceof Date) return `new Date(${JSON.stringify(value.toISOString())})`
  if (Array.isArray(value)) return `[${value.map(serializeValue).join(', ')}]`
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value)
      .filter(([, v]) => v !== undefined)
      .map(([key, v]) => `${serializeKey(key)}: ${serializeValue(v)}`)
    return `{ ${entries.join(', ')} }`
  }
  return JSON.stringify(value)
}

/** The arbitrary that stays trustworthy when an example cannot be derived. */
const arbitraryName = (typeName: string): string => `${typeName}Arbitrary`

/**
 * How much of the offending value to quote. Enough to recognize it in the emitted
 * file; a real-world schema can derive a value tens of kilobytes wide, and a
 * warning nobody can read is barely better than no warning at all.
 */
const WARNING_VALUE_LIMIT = 240

/**
 * Reports an example that does not satisfy the schema it was derived from.
 *
 * The deriver is best-effort by construction — some schemas have no derivable
 * instance (`{ pattern: '^ab$', minLength: 5 }`), some have no instance at all
 * (a `oneOf` whose branches every value matches twice), and some use a keyword
 * no structural rule can honour. Returning the closest value is fine; returning
 * it *quietly* is not, because an example that fails its own schema goes on to
 * seed fixtures, tests, and docs where it reads as authoritative. So say so, and
 * point at the value, once per generated file.
 */
const warnInvalidExample = (
  schema: JSONSchema,
  typeName: string,
  value: unknown,
  rootSchema?: Record<string, unknown>,
): void => {
  const check = makeInstanceCheck(schema, rootSchema, { checkFormats: true })
  if (check(value)) return
  const serialized = serializeValue(value)
  const quoted = serialized.length > WARNING_VALUE_LIMIT ? `${serialized.slice(0, WARNING_VALUE_LIMIT)}…` : serialized
  console.warn(
    `Warning: the derived example for ${typeName} does not validate against its own schema — ` +
      `${quoted}. It is emitted anyway so the file still compiles, but treat it as a placeholder: ` +
      `either the schema has no instance, or it uses a constraint the deriver cannot satisfy ` +
      `structurally (see the README's "Known limits"). ${arbitraryName(typeName)} is unaffected.`,
  )
}

/**
 * Generates an exported const holding a concrete, schema-valid example value.
 *
 * The derived value is validated against its own schema before being emitted; a
 * value that fails is still written (so the generated file compiles) but is
 * reported via `console.warn` rather than shipping as a silently-wrong fixture.
 *
 * @example
 * ```typescript
 * generateExampleConst({ type: 'object', properties: { name: { type: 'string' } } }, 'Info')
 * // export const infoExample: Info = { "name": "string" }
 * ```
 */
export const generateExampleConst = (
  schema: JSONSchema,
  typeName: string,
  rootSchema?: Record<string, unknown>,
): string => {
  const { value, undeclaredKey } = deriveReported(schema, rootSchema)
  warnInvalidExample(schema, typeName, value, rootSchema)
  const literal = serializeValue(value)
  // A schema can require a key its generated type never declares — `required`
  // naming something absent from `properties`, a `dependentRequired` /
  // `dependentSchemas` dependency, a `minProperties` filler on an object with no
  // index signature. Dropping the key would emit a fixture that is *invalid data*
  // (it is missing something the schema demands); keeping it in a bare literal is
  // an excess property, and TypeScript rejects the whole file over it. So keep
  // the key and assert. `satisfies` would not do: it runs the very same
  // excess-property check, which is the thing in the way.
  const expression = undeclaredKey ? `${literal} as ${typeName}` : literal
  return `export const ${exampleName(typeName)}: ${typeName} = ${expression}`
}
