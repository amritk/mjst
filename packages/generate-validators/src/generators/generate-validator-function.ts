import { regexFlagsFor, regexLiteral } from '@amritk/helpers/escape-regex-pattern'
import { getMjstInstanceOf, getMjstPrimitive, MJST_EXTENSION_KEY } from '@amritk/helpers/mjst-extension'
import { multipleOfFailExpr, multipleOfPassExpr } from '@amritk/helpers/multiple-of-check'
import { refToName } from '@amritk/helpers/ref-to-name'
import { safeAccessor } from '@amritk/helpers/safe-accessor'
import {
  hasAdditionalProperties,
  hasAllOf,
  hasAnyOf,
  hasConst,
  hasDependentRequired,
  hasEnum,
  hasExclusiveMaximum,
  hasExclusiveMinimum,
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
  hasProperties,
  hasPropertyNames,
  hasRef,
  hasRequired,
  hasStrictExclusiveMaximum,
  hasStrictExclusiveMinimum,
  hasType,
  hasUniqueItems,
  isObjectSchema,
  isSchemaObject,
} from '@amritk/helpers/schema-guards'
import {
  maxLengthFailExpr,
  maxLengthPassExpr,
  minLengthFailExpr,
  minLengthPassExpr,
} from '@amritk/helpers/string-length-check'
import { unknownKeyCheck } from '@amritk/helpers/unknown-key-check'
import type { JSONSchema } from 'json-schema-typed/draft-2020-12'

import { assertGeneratableRefs } from './assert-generatable-refs'
import { assertUnevaluatedGeneratable, UNPROVABLE_COVERAGE_MESSAGE } from './assert-unevaluated-generatable'
import { tupleShapeOf } from './tuple-shape'
import { type UnevaluatedMatchFn, unevaluatedItemsExpr, unevaluatedPropertiesExpr } from './unevaluated-match'

/**
 * Derives the validator function name from a type name.
 * e.g. "InfoObject" → "validateInfoObject"
 */
const validatorName = (typeName: string): string => `validate${typeName}`

/**
 * The generated expression that reads `key` off the object held in `objVar`.
 *
 * Delegates to the shared {@link safeAccessor} rather than emitting a bare
 * `obj["key"]`, because bracket notation walks the prototype chain exactly like a
 * dot does: `obj["constructor"]` on `{}` hands back `Object`'s constructor, so a
 * schema declaring a `constructor` / `toString` / `hasOwnProperty` property made
 * every valid document fail its type check. `safeAccessor` wraps those names in an
 * own-property guard and leaves every other key as a plain read.
 */
const propertyRead = (objVar: string, key: string): string => safeAccessor(objVar, key)

/**
 * Every name an ordinary object inherits from `Object.prototype`
 * (`constructor`, `toString`, `hasOwnProperty`, `__proto__`, …).
 *
 * Two things follow for a schema that declares one as a property name. Reading it
 * needs {@link safeAccessor}'s own-property guard, or the prototype's value
 * answers instead of the document's. And that guard is a *ternary*, which
 * TypeScript cannot narrow — so a constrained check like
 * `typeof X === 'string' && X.length < 3` would not compile with the read
 * inlined twice. {@link protoLocalName} gives such a key a local to be read into
 * once, which restores narrowing and pays the guard once per property instead of
 * once per check.
 */
const PROTOTYPE_MEMBERS = new Set(Object.getOwnPropertyNames(Object.prototype))

/**
 * The local a prototype-member property is read into. Every `Object.prototype`
 * name is a plain identifier, so the key can go straight into the variable name;
 * the depth keeps nested objects from colliding.
 */
const protoLocalName = (key: string, depth: number): string => `_own${depth}_${key}`

/**
 * The generated expression that is TRUE when `key` is present on the object held
 * in `objVar` — meaning present as an *own* property, never inherited.
 *
 * For a prototype-member name a bare `key in obj` was the obvious spelling and
 * the wrong one: `in` walks the prototype chain, so `'toString' in obj` is true
 * for every object and a `required: ["toString"]` could never be reported
 * missing. Those names get `Object.hasOwn`, which asks the question `required` /
 * `dependentRequired` actually mean and matches the runtime interpreter's
 * presence test.
 *
 * Every *other* name gets `in` back, because for them the two agree and the
 * difference is not free. `Object.hasOwn` is a call the engine cannot fold into
 * an inline cache the way it folds `in`; measured over the assert-loose shape
 * (ten presence checks), spelling all of them `hasOwn` cost about half the valid
 * throughput and a fifth of the invalid. A JSON document's object never inherits
 * `id` or `name`, so paying for that question at every site bought nothing. This
 * is the same split {@link PROTOTYPE_MEMBERS} already drives on the read side,
 * and the same one `@amritk/runtime-validators` makes with its `safeKeys` flag.
 *
 * The result binds tighter than `&&`, so it can be dropped straight into a
 * conjunction. It is *not* safe under a bare `!` — `!"k" in obj` parses as
 * `(!"k") in obj` — so negate it with {@link missingCheck} rather than by hand.
 */
const hasOwnCheck = (objVar: string, key: string): string => {
  if (PROTOTYPE_MEMBERS.has(key)) return `Object.hasOwn(${objVar}, ${JSON.stringify(key)})`
  return `${JSON.stringify(key)} in ${objVar}`
}

/**
 * The generated expression that is TRUE when `key` is absent — the negation of
 * {@link hasOwnCheck}, with the parentheses `in` needs under a `!`.
 */
const missingCheck = (objVar: string, key: string): string => `!(${hasOwnCheck(objVar, key)})`

/**
 * Returns the TypeScript typeof string for a JSON Schema primitive type.
 */
const typeofString = (type: string): string => {
  if (type === 'integer') return 'number'
  return type
}

/**
 * Generates the inline condition that is TRUE when `accessor` does NOT equal the
 * `const` value. Primitives compare with `!==`; objects/arrays compare with the
 * runtime `valuesEqual` helper so a reordered-but-equal value still matches (the
 * interpreter uses order-independent deep equality, and `JSON.stringify` would
 * disagree because it is key-order sensitive).
 */
const constMismatchCondition = (accessor: string, value: unknown): string => {
  if (value === null || typeof value !== 'object') {
    return `${accessor} !== ${JSON.stringify(value)}`
  }
  return `!valuesEqual(${accessor}, ${JSON.stringify(value)})`
}

/**
 * Builds the membership test for an `enum`, used by every enum site so the
 * validator, the boolean guard, and the array/dynamic-key paths all reach the
 * same verdict.
 *
 * Each member gets the cheapest comparison that is still exact for it, and the
 * results are OR-ed. A primitive compares with `===` — no per-call array
 * allocation and no linear scan, so the common case stays on the allocation-free
 * hot path. `NaN` gets `Number.isNaN`, the one primitive `===` cannot express.
 *
 * An object or array member compares *structurally*, via the `valuesEqual`
 * runtime helper. The old `.includes` was SameValueZero — reference equality for
 * objects — so `{ enum: [{ a: 1 }] }` could never match a freshly parsed
 * `{ a: 1 }`: the validator rejected a document Ajv and the interpreter both
 * accept, and `isX` was an unsound type guard built on the same expression.
 * `const` has always used `valuesEqual`; `enum` is that question asked once per
 * member.
 */
const enumMembershipExpr = (values: unknown[], acc: string): string => {
  // An empty `enum` matches nothing, and an empty `||` chain would not even parse.
  if (values.length === 0) return 'false'
  const parts = values.map((value) => {
    if (typeof value === 'number' && Number.isNaN(value)) return `Number.isNaN(${acc})`
    if (value !== null && typeof value === 'object') return `valuesEqual(${acc}, ${JSON.stringify(value)})`
    return `${acc} === ${JSON.stringify(value)}`
  })
  return `(${parts.join(' || ')})`
}

/**
 * What a `false` subschema reports when it is reached.
 *
 * `false` is the schema no instance satisfies, so arriving at it *is* the
 * failure — there is nothing more specific to say about the value. The wording
 * is Ajv's, which is the phrasing most people will already have seen for this.
 */
const FALSE_SCHEMA_MESSAGE = 'boolean schema is false'

const SCALAR_ITEM_TYPES = new Set(['string', 'number', 'integer', 'boolean', 'null'])

/**
 * True when a schema's values are provably JSON scalars — its `type` is present
 * and every listed type is a primitive. Conservative: a `$ref`, a boolean/absent
 * schema, an `object`/`array` type, or a missing `type` all fail this test.
 */
const schemaIsScalarOnly = (schema: unknown): boolean => {
  if (!isSchemaObject(schema as JSONSchema)) return false
  const t = (schema as Record<string, unknown>)['type']
  if (t === undefined) return false
  const types = Array.isArray(t) ? t : [t]
  return types.length > 0 && types.every((x) => typeof x === 'string' && SCALAR_ITEM_TYPES.has(x))
}

/**
 * True when an array's elements can only be JSON scalars, so a `uniqueItems`
 * check can dedupe by the cheap `JSON.stringify` projection. When items may be
 * objects or arrays this returns false, and the check must instead compare
 * structurally (the `allUnique` runtime helper): `JSON.stringify` is key-order
 * sensitive and would treat `{ a: 1, b: 2 }` and `{ b: 2, a: 1 }` as distinct,
 * disagreeing with the interpreter's order-independent deep equality.
 */
const arrayItemsAreScalarOnly = (schema: Record<string, unknown>): boolean => {
  const { tuple, tail, tailIsClosed } = tupleShapeOf(schema)
  if (tuple !== undefined) {
    if (!tuple.every((p) => schemaIsScalarOnly(p))) return false
    // A closed tuple has no tail to describe; otherwise the tail schema must
    // itself be scalar-only.
    if (tailIsClosed) return true
    return schemaIsScalarOnly(tail)
  }
  return schemaIsScalarOnly(tail)
}

/**
 * Generates the inline condition that is TRUE when a value is the wrong type.
 */
const wrongTypeCondition = (accessor: string, type: string): string => {
  switch (type) {
    case 'string':
      return `typeof ${accessor} !== 'string'`
    case 'number':
      return `typeof ${accessor} !== 'number'`
    case 'integer':
      return `typeof ${accessor} !== 'number' || !Number.isInteger(${accessor})`
    case 'boolean':
      return `typeof ${accessor} !== 'boolean'`
    case 'array':
      return `!Array.isArray(${accessor})`
    case 'null':
      return `${accessor} !== null`
    case 'object':
      return `typeof ${accessor} !== 'object' || ${accessor} === null || Array.isArray(${accessor})`
    default:
      return ''
  }
}

/**
 * Returns the list of type names when a schema's `type` is an array (the JSON
 * Schema multi-type / nullable idiom, e.g. `["string","null"]`), else `null`.
 * `hasType` only recognises a *string* `type`, so without special handling a
 * multi-type schema slips through every branch and emits NO check — not even a
 * required-presence check. A multi-type is validated as the *disjunction* of its
 * per-type checks (the value must match at least one).
 */
/**
 * True when a schema *declares* itself an object — a literal `type: "object"`.
 *
 * Deliberately narrower than `isObjectSchema`, which also answers true for a
 * schema that merely carries `properties`. Those are not the same claim: in JSON
 * Schema `{ "properties": { … } }` says nothing at all about a string or a
 * number, it only describes what an object must look like *if* the instance is
 * one. Routing on the declared type keeps the object fast path (the flat guard,
 * the hoisted known-key sets) for schemas that really mean "this is an object",
 * and sends everything else through the shared runtime-guarded emitters, where a
 * non-object is ignored instead of rejected.
 */
const declaresObjectType = (schema: JSONSchema): boolean => hasType(schema) && schema.type === 'object'

/**
 * True when a `type: "object"` node says nothing {@link generateObjectValidator}
 * cannot emit. That emitter walks the object keywords and nothing else, so a
 * `$ref`, a `const`/`enum` or an `x-mjst` hint sitting alongside them would be
 * dropped on the floor — those nodes belong on the general path.
 */
const objectRootIsSelfContained = (schema: JSONSchema): boolean =>
  !hasRef(schema) &&
  !hasConst(schema) &&
  !hasEnum(schema) &&
  getMjstInstanceOf(schema) === undefined &&
  getMjstPrimitive(schema) === undefined

const getTypeArray = (schema: JSONSchema): string[] | null => {
  if (!isSchemaObject(schema) || !('type' in schema) || !Array.isArray(schema.type)) return null
  return schema.type as string[]
}

/**
 * Every keyword this generator turns into a runtime check. Annotations
 * (`title`, `description`, `default`, `$defs`, `format`, …) are deliberately
 * absent: they change no verdict, so a node carrying only those is still "just"
 * whatever its one validation keyword says.
 */
const ENFORCED_KEYWORDS = new Set([
  '$ref',
  'type',
  'enum',
  'const',
  MJST_EXTENSION_KEY,
  'pattern',
  'minLength',
  'maxLength',
  'minimum',
  'maximum',
  'exclusiveMinimum',
  'exclusiveMaximum',
  'multipleOf',
  'items',
  'prefixItems',
  'additionalItems',
  'contains',
  'minContains',
  'maxContains',
  'minItems',
  'maxItems',
  'uniqueItems',
  'properties',
  'patternProperties',
  'additionalProperties',
  'required',
  'propertyNames',
  'dependentRequired',
  'dependentSchemas',
  'dependencies',
  'minProperties',
  'maxProperties',
  'allOf',
  'anyOf',
  'oneOf',
  'not',
  'if',
  'then',
  'else',
  'unevaluatedProperties',
  'unevaluatedItems',
])

/**
 * True when a node declares an enforced keyword outside the set an emitter
 * `owns`.
 *
 * The specialised emitters — the top-level `$ref` delegation, the `const` and
 * `enum` roots, the flat boolean guards — each recognise one keyword and write
 * out a shape built around it. That shape has nowhere to put a sibling, so every
 * one of them used to drop the siblings silently: `{ $ref, minLength: 3 }`
 * accepted `"q"`, `{ type: 'string', const: 1 }` accepted `1`. Asking this first
 * lets each of them keep its tight output for the node it really does describe,
 * and hand anything richer to the general path.
 */
const declaresKeywordOutside = (schema: JSONSchema, owned: readonly string[]): boolean => {
  if (!isSchemaObject(schema)) return false
  for (const keyword of Object.keys(schema as Record<string, unknown>)) {
    if (owned.includes(keyword)) continue
    if (ENFORCED_KEYWORDS.has(keyword)) return true
  }
  return false
}

/**
 * Where in the object tree the generated checks live. The root context reads
 * from `obj` and reports missing properties at `_path`; every inline nested
 * object gets its own narrowed variable and a longer static path, so checks
 * can recurse to any depth without variable or path collisions.
 */
type NestingContext = {
  /** Generated variable holding the object currently being checked. */
  objVar: string
  /** Template-literal body that evaluates to the current object's path. */
  pathPrefix: string
  /** Inline-object nesting depth, used to mint collision-free variable names. */
  depth: number
  /**
   * Module-level statements to emit before the validator function. Shared by
   * every nesting level of one validator so per-call work (like building a
   * known-keys Set) is paid once at module load instead of on every call.
   */
  hoisted: string[]
  /**
   * The whole document this schema came from, when the caller knows it. Only the
   * `unevaluated*` emitters need it: working out what a node's `$ref` evaluated
   * means reading the target's keywords, and a delegating `validateX(...)` call
   * cannot report that back.
   */
  rootSchema?: Record<string, unknown> | undefined
}

const createRootContext = (rootSchema?: Record<string, unknown>): NestingContext => ({
  objVar: 'obj',
  pathPrefix: '${_path}',
  depth: 0,
  hoisted: [],
  rootSchema,
})

/**
 * Renders a schema-controlled property name as a static error-path segment.
 *
 * The name is appended to a backtick template-literal path (`` `${_path}/…` ``),
 * so two independent escapings apply. First the JSON Pointer escape (`~`→`~0`,
 * `/`→`~1`, `~` first) so a key containing `/` or `~` reads back unambiguously —
 * matching the paths the runtime-validators interpreter emits. Then a
 * template-literal escape of `` ` ``, `\`, and `$`, so a key like `` a`b `` or
 * `${x}` cannot terminate the literal (a build failure) or inject an
 * interpolation (a runtime `ReferenceError` / arbitrary expression).
 */
const pointerSegment = (key: string): string =>
  key
    .replace(/~/g, '~0')
    .replace(/\//g, '~1')
    .replace(/[\\`$]/g, '\\$&')

/**
 * Returns the `patternProperties` regex sources, or an empty array when the
 * schema declares none. The keys of `patternProperties` are the patterns.
 */
const patternPropertySources = (schema: JSONSchema): string[] => {
  if (!isSchemaObject(schema) || !('patternProperties' in schema)) return []
  const patterns = schema.patternProperties
  if (typeof patterns !== 'object' || patterns === null) return []
  return Object.keys(patterns)
}

/**
 * Generates the unknown-key sweep for `additionalProperties: false`, mirroring
 * the interpreter's behaviour (same error message, one error per extra key).
 * The sweep uses `for...in` — the same allocation-free shape Ajv compiles to.
 * The per-key "is this declared" test comes from `unknownKeyCheck`, which
 * inlines `!==` comparisons for small key counts (faster than `Set.has` and
 * allocation-free) and hoists a known-keys `Set` only when the list is long.
 * When the schema also declares `patternProperties`, a key matching any pattern
 * is not "additional": the patterns are compiled once at module scope (the same
 * regex-caching the interpreter does) and a key survives the sweep if it is a
 * known key or matches any pattern.
 */
const generateStrictKeyChecks = (schema: JSONSchema, ctx: NestingContext): string[] => {
  if (!isSchemaObject(schema)) return []
  if (!hasAdditionalProperties(schema) || schema.additionalProperties !== false) return []

  const known = Object.keys(hasProperties(schema) ? schema.properties : {})
  const d = ctx.depth

  const check = unknownKeyCheck(known, `_knownKeys${ctx.hoisted.length}`)
  ctx.hoisted.push(...check.declarations)

  // A key that matches any `patternProperties` regex is allowed, so only keys
  // outside both the known keys and every pattern count as additional.
  const patterns = patternPropertySources(schema)
  let patternGuard = ''
  if (patterns.length > 0) {
    const patternsName = `_patterns${ctx.hoisted.length}`
    // Hoisted as `new RegExp` rather than literals because the sources are only
    // known as strings here; the flags still come from `regexFlagsFor`, so these
    // read `pattern` the same way every emitted literal does.
    const compiled = patterns.map((p) => `new RegExp(${JSON.stringify(p)}, ${JSON.stringify(regexFlagsFor(p))})`)
    ctx.hoisted.push(`const ${patternsName} = [${compiled.join(', ')}]`)
    patternGuard = ` && !${patternsName}.some((re) => re.test(_key${d}))`
  }

  return [
    `  for (const _key${d} in ${ctx.objVar}) {`,
    `    if (${check.isUnknown(`_key${d}`)}${patternGuard}) {`,
    `      errors.push({ message: 'must NOT have additional properties', path: \`${ctx.pathPrefix}/\${escapePointer(_key${d})}\` })`,
    `    }`,
    `  }`,
  ]
}

/**
 * Emits presence checks for `required` keys that have no `properties` entry.
 * Keys present in `properties` get their missing-property check from
 * {@link generatePropertyChecks}; a required key with no schema of its own would
 * otherwise go unchecked, so its presence is enforced here to match the
 * interpreter and Ajv.
 */
const generateMissingRequiredChecks = (schema: JSONSchema, ctx: NestingContext): string[] => {
  if (!isSchemaObject(schema) || !hasRequired(schema)) return []
  const props = hasProperties(schema) ? schema.properties : {}
  const parentPath = ctx.depth === 0 ? '_path' : `\`${ctx.pathPrefix}\``
  const lines: string[] = []
  for (const key of schema.required) {
    if (Object.hasOwn(props, key)) continue
    lines.push(`  if (${missingCheck(ctx.objVar, key)}) {`)
    lines.push(
      `    errors.push({ message: ${JSON.stringify(`must have required property '${key}'`)}, path: ${parentPath} })`,
    )
    lines.push(`  }`)
  }
  return lines
}

/**
 * Generates validation lines for a single property in an object schema, reading a
 * prototype-member key (`constructor`, `__proto__`, …) into a local first.
 *
 * That read is an own-property ternary (see {@link PROTOTYPE_MEMBERS}), and
 * TypeScript will not narrow a ternary — so inlining it into a constrained check
 * emits `X.length < 3` on an `unknown`, which does not compile. Binding it once
 * also stops the guard from re-running for every check on the same property.
 */
const generatePropertyChecks = (
  key: string,
  propSchema: JSONSchema,
  isRequired: boolean,
  suffix: string,
  ctx: NestingContext,
): string[] => {
  // A `false` property schema says the key may not appear at all, and it used to
  // emit nothing — so `{ properties: { b: false } }` accepted `{ "b": 1 }`. The
  // check only needs the key's *presence*, never a read of its value, so it is
  // built here rather than in the per-property emitter below. When the key is
  // `required` as well the object is unsatisfiable: absent fails `required`,
  // present fails `false`.
  if (propSchema === false) {
    const path = `\`${ctx.pathPrefix}/${pointerSegment(key)}\``
    const parentPath = ctx.depth === 0 ? '_path' : `\`${ctx.pathPrefix}\``
    if (isRequired) {
      return [
        `  if (${missingCheck(ctx.objVar, key)}) {`,
        `    errors.push({ message: ${JSON.stringify(`must have required property '${key}'`)}, path: ${parentPath} })`,
        `  } else {`,
        `    errors.push({ message: ${JSON.stringify(FALSE_SCHEMA_MESSAGE)}, path: ${path} })`,
        `  }`,
      ]
    }
    return [
      `  if (${hasOwnCheck(ctx.objVar, key)}) {`,
      `    errors.push({ message: ${JSON.stringify(FALSE_SCHEMA_MESSAGE)}, path: ${path} })`,
      `  }`,
    ]
  }

  const raw = PROTOTYPE_MEMBERS.has(key) ? protoLocalName(key, ctx.depth) : propertyRead(ctx.objVar, key)
  const lines = [
    ...generatePropertyCheckLines(key, propSchema, isRequired, suffix, ctx),
    // `unevaluated*` is a sibling of everything else the property declares, and
    // several of the branches above return early, so it is appended here rather
    // than emitted inside them. The checks carry their own runtime type guard, so
    // an absent optional property is inert and needs no presence gate.
    ...generateUnevaluatedChecks(raw, `\`${ctx.pathPrefix}/${pointerSegment(key)}\``, propSchema, suffix, ctx),
  ]
  if (lines.length === 0 || !PROTOTYPE_MEMBERS.has(key)) return lines
  return [`  const ${protoLocalName(key, ctx.depth)} = ${propertyRead(ctx.objVar, key)}`, ...lines]
}

/**
 * Recognises a check block that is exactly one `if` statement, handing back its
 * condition and body so a caller can fold it into the presence test in front of
 * it — `} else { if (c) { … } }` written as the `} else if (c) { … }` it is
 * equivalent to.
 *
 * This is cosmetic, and deliberately so: the one-keyword property is by far the
 * common case, and folding keeps its generated output exactly what the old
 * dispatch chain emitted, so the files that change shape are the ones whose
 * sibling keywords used to be dropped. Returns `null` for anything else —
 * including a condition spanning several physical lines (a combinator's match
 * IIFE), which is not worth the parsing.
 */
const singleIfBlock = (lines: readonly string[]): { condition: string; body: string[] } | null => {
  if (lines.length < 3) return null
  const opener = /^ {2}if \((.*)\) \{$/.exec(lines[0] as string)
  if (opener === null || lines[lines.length - 1] !== '  }') return null
  // A line back at the base indent in between is a second top-level statement,
  // and two statements cannot become one condition.
  for (let i = 1; i < lines.length - 1; i++) {
    if (!(lines[i] as string).startsWith('    ')) return null
  }
  return { condition: opener[1] as string, body: lines.slice(1, -1) }
}

/**
 * Every check a schema node's keywords call for, against a value held in `raw`.
 *
 * This is a *sequence*, not a dispatch chain, and that is the whole point. Each
 * keyword in a schema object is an independent assertion the instance has to
 * satisfy, so `{ "type": "string", "const": 1 }` is a schema nothing matches —
 * but the emitter used to be a chain of `if (keyword) { emit; return }`, where
 * the first keyword it recognised swallowed every sibling. That is how a
 * validator came to accept `1` for that schema, and how `{ $ref, minLength: 3 }`
 * came to accept `"q"`. Anything that returns early from here re-opens the hole.
 *
 * `presence` is `''` when the value is known to be present (the caller has
 * already gated on it), or the `x !== undefined && ` prefix each leaf check
 * wears when it has not. Constraint checks carry their own runtime-type guards,
 * so they never need it; combinators do, since an absent value would otherwise
 * be run through `not` / `anyOf` as if it were there.
 */
const generateKeywordChecks = (
  key: string,
  raw: string,
  path: string,
  schema: JSONSchema,
  suffix: string,
  ctx: NestingContext,
  presence: string,
): string[] => {
  if (!isSchemaObject(schema)) return []
  const lines: string[] = []

  // $ref — delegate to the imported validator. Per 2020-12 a `$ref`'s siblings
  // apply to the same value, so the delegation is one check among the rest
  // rather than the end of the story.
  if (hasRef(schema)) {
    const vName = validatorName(refToName(schema.$ref, suffix))
    const delegate = [`  const _r = ${vName}(${raw}, ${path})`, `  if (_r !== true) errors.push(..._r.errors)`]
    if (presence === '') lines.push(...delegate)
    else lines.push(`  if (${raw} !== undefined) {`, ...delegate.map((line) => `  ${line}`), `  }`)
  }

  // x-mjst instanceOf (e.g. Date) — value must be an instance of the class.
  const instanceOf = getMjstInstanceOf(schema)
  if (instanceOf) {
    lines.push(`  if (${presence}!(${raw} instanceof ${instanceOf})) {`)
    lines.push(`    errors.push({ message: 'must be ${instanceOf}', path: ${path} })`)
    lines.push(`  }`)
  }

  // x-mjst primitive (e.g. bigint) — value must satisfy a typeof check.
  const primitive = getMjstPrimitive(schema)
  if (primitive) {
    lines.push(`  if (${presence}typeof ${raw} !== "${primitive}") {`)
    lines.push(`    errors.push({ message: 'must be ${primitive}', path: ${path} })`)
    lines.push(`  }`)
  }

  // const — value must equal the fixed value exactly.
  if (hasConst(schema)) {
    const mismatch = constMismatchCondition(raw, schema.const)
    const msg = JSON.stringify(`must be ${JSON.stringify(schema.const)}`)
    lines.push(`  if (${presence}${mismatch}) {`)
    lines.push(`    errors.push({ message: ${msg}, path: ${path} })`)
    lines.push(`  }`)
  }

  // enum — value must be one of the listed members.
  if (hasEnum(schema)) {
    const label = (schema.enum as unknown[]).map((v) => JSON.stringify(v)).join(', ')
    lines.push(`  if (${presence}!${enumMembershipExpr(schema.enum as unknown[], raw)}) {`)
    lines.push(`    errors.push({ message: ${JSON.stringify(`must be one of: ${label}`)}, path: ${path} })`)
    lines.push(`  }`)
  }

  // An `x-mjst` runtime hint *replaces* the JSON type claim rather than joining
  // it: the adapters emit `{ 'x-mjst': { instanceOf: 'Date' } }` with the `type`
  // deleted, precisely because a `Date` is not a JSON string. So a hint
  // suppresses the type check — and only the type check; `const`, the bounds and
  // the combinators alongside it still mean what they say.
  if (instanceOf === undefined && primitive === undefined) {
    if (hasType(schema)) {
      const t = schema.type as string
      const wrongType = wrongTypeCondition(raw, t)
      if (wrongType) {
        lines.push(`  if (${presence === '' ? wrongType : `${presence}(${wrongType})`}) {`)
        lines.push(`    errors.push({ message: 'must be ${typeofString(t)}', path: ${path} })`)
        lines.push(`  }`)
      }
    }

    // Multi-type / nullable (array `type`, e.g. `["string","null"]`). `hasType`
    // only recognises a *string* `type`, so without this a multi-type node emits
    // no check at all — and an empty check list is how
    // {@link generateMatchesExpr} spells "matches everything", which made
    // `{ not: { type: ["integer","boolean"] } }` reject every instance. The value
    // is valid when it matches ANY listed type.
    const typeArray = getTypeArray(schema)
    if (typeArray) {
      const allWrong = typeArray
        .map((t) => wrongTypeCondition(raw, t))
        .filter((c) => c !== '')
        .map((c) => `(${c})`)
        .join(' && ')
      if (allWrong) {
        const label = typeArray.map((t) => typeofString(t)).join(' or ')
        lines.push(`  if (${presence === '' ? allWrong : `${presence}(${allWrong})`}) {`)
        lines.push(`    errors.push({ message: ${JSON.stringify(`must be ${label}`)}, path: ${path} })`)
        lines.push(`  }`)
      }
    }
  }

  lines.push(...generateConstraintChecks(key, raw, path, schema, suffix, ctx))

  const combinators = generateCombinatorChecks(key, raw, path, schema, suffix, ctx)
  if (combinators.length > 0) {
    if (presence === '') lines.push(...combinators)
    else lines.push(`  if (${raw} !== undefined) {`, ...combinators.map((line) => `  ${line}`), `  }`)
  }

  return lines
}

/**
 * The per-property checks themselves: the presence test a `required` key needs,
 * with every one of the property's own keyword checks composed beneath it.
 *
 * Hoisting presence out here is what lets the checks compose. Each branch of the
 * old dispatch chain emitted its own "must have required property" test, so
 * falling through them would have reported that error once per keyword — which
 * is why the chain returned early, and why every sibling keyword was lost. The
 * presence test is asked once now, and {@link generateKeywordChecks} answers
 * everything else.
 */
const generatePropertyCheckLines = (
  key: string,
  propSchema: JSONSchema,
  isRequired: boolean,
  suffix: string,
  ctx: NestingContext,
): string[] => {
  // Missing-property errors report at the parent object's path. At the root
  // that is the `_path` parameter itself; inside nested objects it is the
  // parent's accumulated static path.
  const parentPath = ctx.depth === 0 ? '_path' : `\`${ctx.pathPrefix}\``
  const missing = [
    `  if (${missingCheck(ctx.objVar, key)}) {`,
    `    errors.push({ message: ${JSON.stringify(`must have required property '${key}'`)}, path: ${parentPath} })`,
  ]

  if (!isSchemaObject(propSchema)) {
    // A boolean `true` (accept-anything) schema carries no shape checks, but a
    // required key must still be present. `false` never gets here —
    // {@link generatePropertyChecks} handles it before this point.
    if (isRequired && propSchema === true) return [...missing, `  }`]
    return []
  }

  const raw = PROTOTYPE_MEMBERS.has(key) ? protoLocalName(key, ctx.depth) : propertyRead(ctx.objVar, key)
  const path = `\`${ctx.pathPrefix}/${pointerSegment(key)}\``

  if (isRequired) {
    // Inside the `else` the value is known to be present, so the checks need no
    // presence prefix of their own.
    const valueLines = generateKeywordChecks(key, raw, path, propSchema, suffix, ctx, '')
    if (valueLines.length === 0) return [...missing, `  }`]
    const single = singleIfBlock(valueLines)
    if (single !== null) return [...missing, `  } else if (${single.condition}) {`, ...single.body, `  }`]
    return [...missing, `  } else {`, ...valueLines.map((line) => `  ${line}`), `  }`]
  }

  // An optional property is absent-or-valid, which each leaf check already says
  // for itself, so no wrapping block is needed here.
  return generateKeywordChecks(key, raw, path, propSchema, suffix, ctx, `${raw} !== undefined && `)
}

/**
 * Emits the value-shape constraints for a typed value: string (pattern,
 * min/maxLength), number/integer (bounds, multipleOf), typed/`$ref` array items,
 * and recursion into an inline nested object. Shared by the named-property path
 * ({@link generatePropertyChecks}) and the dynamic-key path
 * ({@link generateValueChecks}) so both enforce identical rules. `raw` and `path`
 * are arbitrary expressions, so the same logic serves a static `obj.key` and a
 * `patternProperties` / `additionalProperties` value read at a runtime key.
 */
const generateConstraintChecks = (
  key: string,
  raw: string,
  path: string,
  propSchema: JSONSchema,
  suffix: string,
  ctx: NestingContext,
): string[] => {
  if (!isSchemaObject(propSchema)) return []
  const sp = propSchema as Record<string, unknown>
  const lines: string[] = []

  // Each block is gated on the *presence of its keywords*, not a declared `type`,
  // and every emitted check carries its own runtime-type guard (`typeof` /
  // `Array.isArray`). So a type-less schema (e.g. an `allOf` / `anyOf` / `not`
  // branch that is just `{ required: [...] }` or `{ minItems: 2 }`) is validated
  // against the value's runtime type, matching the interpreter.

  // String constraints
  if (hasPattern(propSchema) || hasMinLength(propSchema) || hasMaxLength(propSchema)) {
    if (hasPattern(propSchema)) {
      const re = regexLiteral(propSchema.pattern)
      const msg = JSON.stringify(`must match pattern ${propSchema.pattern}`)
      lines.push(`  if (typeof ${raw} === 'string' && !${re}.test(${raw})) {`)
      lines.push(`    errors.push({ message: ${msg}, path: ${path} })`)
      lines.push(`  }`)
    }
    // Lengths are Unicode *code point* counts, not UTF-16 code units, so both
    // bounds go through the shared `string-length-check` emitter. A bare
    // `.length` counted `"💩"` as two characters — accepting it against
    // `minLength: 2` and rejecting `"💩💩"` against `maxLength: 2`, both of which
    // contradict Ajv and the runtime interpreter. The emitted expression keeps
    // `.length` as its first, short-circuiting term, so the scan is only paid by
    // the strings whose answer it could change.
    if (hasMinLength(propSchema)) {
      lines.push(`  if (typeof ${raw} === 'string' && ${minLengthFailExpr(raw, propSchema.minLength)}) {`)
      lines.push(`    errors.push({ message: 'must have at least ${propSchema.minLength} characters', path: ${path} })`)
      lines.push(`  }`)
    }
    if (hasMaxLength(propSchema)) {
      lines.push(`  if (typeof ${raw} === 'string' && ${maxLengthFailExpr(raw, propSchema.maxLength)}) {`)
      lines.push(`    errors.push({ message: 'must have at most ${propSchema.maxLength} characters', path: ${path} })`)
      lines.push(`  }`)
    }
  }

  // Number constraints
  if (
    hasMinimum(propSchema) ||
    hasMaximum(propSchema) ||
    hasExclusiveMinimum(propSchema) ||
    hasExclusiveMaximum(propSchema) ||
    hasMultipleOf(propSchema)
  ) {
    // Every bound is written as the *pass* condition, negated — `!(x >= min)`
    // rather than `x < min`. The two differ only for `NaN`, which compares
    // `false` against every operator: the direct form reads that as "no error"
    // and lets a `NaN` through a bounded number, while the interpreter (and
    // Ajv's `strict: false` oracle) reject it. `booleanLeafExpr` carries the
    // un-negated half of the same expression, so the fast path agrees.
    if (hasMinimum(propSchema)) {
      // Draft-04 `exclusiveMinimum: true` makes the paired `minimum` strict.
      const strict = hasStrictExclusiveMinimum(propSchema)
      const rel = strict ? '>' : '>='
      lines.push(`  if (typeof ${raw} === 'number' && !(${raw} ${rel} ${propSchema.minimum})) {`)
      lines.push(`    errors.push({ message: 'must be ${rel} ${propSchema.minimum}', path: ${path} })`)
      lines.push(`  }`)
    }
    if (hasMaximum(propSchema)) {
      const strict = hasStrictExclusiveMaximum(propSchema)
      const rel = strict ? '<' : '<='
      lines.push(`  if (typeof ${raw} === 'number' && !(${raw} ${rel} ${propSchema.maximum})) {`)
      lines.push(`    errors.push({ message: 'must be ${rel} ${propSchema.maximum}', path: ${path} })`)
      lines.push(`  }`)
    }
    if (hasExclusiveMinimum(propSchema)) {
      lines.push(`  if (typeof ${raw} === 'number' && !(${raw} > ${propSchema.exclusiveMinimum})) {`)
      lines.push(`    errors.push({ message: 'must be > ${propSchema.exclusiveMinimum}', path: ${path} })`)
      lines.push(`  }`)
    }
    if (hasExclusiveMaximum(propSchema)) {
      lines.push(`  if (typeof ${raw} === 'number' && !(${raw} < ${propSchema.exclusiveMaximum})) {`)
      lines.push(`    errors.push({ message: 'must be < ${propSchema.exclusiveMaximum}', path: ${path} })`)
      lines.push(`  }`)
    }
    if (hasMultipleOf(propSchema)) {
      lines.push(`  if (typeof ${raw} === 'number' && ${multipleOfFailExpr(raw, propSchema.multipleOf)}) {`)
      lines.push(`    errors.push({ message: 'must be a multiple of ${propSchema.multipleOf}', path: ${path} })`)
      lines.push(`  }`)
    }
  }

  // Array items. `$ref` items delegate to the referenced validator. Any other
  // item subschema is validated in full — matching the interpreter — but wrapped
  // in a per-item boolean fast-check (`booleanLeafExpr`): a valid item passes the
  // flat expression and skips the error-collecting body entirely, so the common
  // valid case stays allocation-free (the same hot/cold split the top-level
  // validator uses). This keeps array-heavy throughput close to a bare type check
  // while still fully validating every item. The loop variables carry the nesting
  // depth so item loops can nest (array-of-arrays) without colliding.
  //
  // In 2020-12 `items` is the *tail* schema: it applies only from
  // `prefixItems.length` onward, and the tuple block below owns the positions
  // before that. Starting the loop at 0 made `{ prefixItems: [{type:'string'}],
  // items: {type:'number'} }` demand a number at index 0 too, so `["a", 1, 2]` —
  // valid to Ajv, and accepted by the `[string?, ...number[]]` type this very
  // generator emits — was reported invalid by its own validator.
  //
  // `items` has two shapes, and only one of them is the tail. In draft-07 an
  // *array* `items` IS the tuple and `additionalItems` is the tail; 2020-12
  // renamed those to `prefixItems` and `items`. {@link tupleShapeOf} normalises
  // the pair so both dialects reach the same emitters — a draft-07 tuple used to
  // fall through every branch here and emit nothing at all, while the type
  // generator happily wrote out the tuple type, so the two disagreed.
  const { tuple, tail, tailIsClosed } = tupleShapeOf(sp)

  if (tail !== undefined) {
    const itemSchema = tail as JSONSchema
    const firstTailIndex = tuple !== undefined ? tuple.length : 0
    const iv = `_i${ctx.depth}`
    const itemPath = `\`${path.slice(1, -1)}/\${${iv}}\``
    // A bare `$ref` tail keeps the tight delegation loop; one carrying siblings
    // (`{ $ref, minLength: 3 }`) goes through the general value checks, which
    // emit the delegation *and* the siblings instead of only the first of them.
    if (hasRef(itemSchema) && !declaresKeywordOutside(itemSchema, ['$ref'])) {
      const vName = validatorName(refToName(itemSchema.$ref, suffix))
      lines.push(`  if (Array.isArray(${raw})) {`)
      lines.push(`    for (let ${iv} = ${firstTailIndex}; ${iv} < ${raw}.length; ${iv}++) {`)
      lines.push(`      const _ir = ${vName}(${raw}[${iv}], ${itemPath})`)
      lines.push(`      if (_ir !== true) errors.push(..._ir.errors)`)
      lines.push(`    }`)
      lines.push(`  }`)
    } else if (isSchemaObject(itemSchema)) {
      const itemVar = `_item${ctx.depth}`
      const detail = generateValueChecks('', itemVar, itemPath, itemSchema, suffix, ctx, true)
      if (detail.length > 0) {
        lines.push(`  if (Array.isArray(${raw})) {`)
        lines.push(`    for (let ${iv} = ${firstTailIndex}; ${iv} < ${raw}.length; ${iv}++) {`)
        lines.push(`      const ${itemVar} = ${raw}[${iv}]`)
        lines.push(...detail.map((l) => `    ${l}`))
        lines.push(`    }`)
        lines.push(`  }`)
      }
    }
  }

  // Array length / uniqueness. `uniqueItems` dedupes scalar items by a cheap
  // `JSON.stringify` projection (exact for primitives, what the type guard also
  // uses), but falls back to the structural `allUnique` helper when items may be
  // objects/arrays — `JSON.stringify` is key-order sensitive and would disagree
  // with the interpreter's order-independent deep equality.
  if (
    hasMinItems(propSchema) ||
    hasMaxItems(propSchema) ||
    (hasUniqueItems(propSchema) && propSchema.uniqueItems === true) ||
    'contains' in sp ||
    tuple !== undefined ||
    (tail === false && tuple === undefined)
  ) {
    // `items: false` with no `prefixItems` forbids every element, so the array
    // must be empty. (With `prefixItems`, the tuple block below caps the length
    // instead.) Without this the constraint was silently ignored.
    if (tail === false && tuple === undefined) {
      lines.push(`  if (Array.isArray(${raw}) && ${raw}.length > 0) {`)
      lines.push(`    errors.push({ message: 'must NOT have more than 0 items', path: ${path} })`)
      lines.push(`  }`)
    }
    if (hasMinItems(propSchema)) {
      lines.push(`  if (Array.isArray(${raw}) && ${raw}.length < ${propSchema.minItems}) {`)
      lines.push(`    errors.push({ message: 'must have at least ${propSchema.minItems} items', path: ${path} })`)
      lines.push(`  }`)
    }
    if (hasMaxItems(propSchema)) {
      lines.push(`  if (Array.isArray(${raw}) && ${raw}.length > ${propSchema.maxItems}) {`)
      lines.push(`    errors.push({ message: 'must have at most ${propSchema.maxItems} items', path: ${path} })`)
      lines.push(`  }`)
    }
    if (hasUniqueItems(propSchema) && propSchema.uniqueItems === true) {
      const dupCond = arrayItemsAreScalarOnly(sp)
        ? `new Set((${raw} as unknown[]).map((_u) => JSON.stringify(_u))).size !== ${raw}.length`
        : `!allUnique(${raw} as unknown[])`
      lines.push(`  if (Array.isArray(${raw}) && ${dupCond}) {`)
      lines.push(`    errors.push({ message: 'must NOT have duplicate items', path: ${path} })`)
      lines.push(`  }`)
    }

    // `contains` — at least `minContains` (default 1) and at most `maxContains`
    // items must match the subschema. `minContains: 0` makes any array (even
    // empty) satisfy the lower bound. A boolean `contains` counts too:
    // `contains: true` matches every item (so only an empty array fails) and
    // `contains: false` matches none (so every array fails).
    if ('contains' in sp) {
      const min = typeof sp['minContains'] === 'number' ? sp['minContains'] : 1
      const max = typeof sp['maxContains'] === 'number' ? (sp['maxContains'] as number) : undefined
      const matchExpr = generateMatchesExpr('_c', sp['contains'] as JSONSchema, suffix, ctx)
      const bound = max !== undefined ? `_cn < ${min} || _cn > ${max}` : `_cn < ${min}`
      lines.push(`  if (Array.isArray(${raw})) {`)
      lines.push(`    const _cn = (${raw} as unknown[]).filter((_c) => ${matchExpr}).length`)
      lines.push(`    if (${bound}) {`)
      lines.push(`      errors.push({ message: 'array does not contain the required matching items', path: ${path} })`)
      lines.push(`    }`)
      lines.push(`  }`)
    }

    // Tuple positions — each validated against its own subschema; a closed tail
    // (`items: false`, or draft-07 `additionalItems: false`) caps the length.
    if (tuple !== undefined) {
      lines.push(`  if (Array.isArray(${raw})) {`)
      for (let i = 0; i < tuple.length; i++) {
        const itemChecks = generateValueChecks(
          '',
          `${raw}[${i}]`,
          `\`${path.slice(1, -1)}/${i}\``,
          tuple[i] as JSONSchema,
          suffix,
          ctx,
        )
        if (itemChecks.length > 0) {
          lines.push(`    if (${raw}.length > ${i}) {`)
          lines.push(...itemChecks.map((l) => `    ${l}`))
          lines.push(`    }`)
        }
      }
      if (tailIsClosed) {
        lines.push(`    if (${raw}.length > ${tuple.length}) {`)
        lines.push(`      errors.push({ message: 'must NOT have more than ${tuple.length} items', path: ${path} })`)
        lines.push(`    }`)
      }
      lines.push(`  }`)
    }
  }

  // Inline nested object — recurse so the nested fields are actually validated.
  // Unconditional: `generateInlineObjectChecks` self-gates (returns `[]` when the
  // schema has no object keywords) and each check is guarded by an `isObject`
  // runtime check, so this is a no-op for non-object schemas.
  lines.push(...generateInlineObjectChecks(key, propSchema, raw, suffix, ctx))

  return lines
}

/**
 * Validates a value located at a *dynamic* key (a `patternProperties` or
 * `additionalProperties` value), an array item, a combinator branch, or a
 * `dependentSchemas` subschema against `propSchema`. `raw` and `path` are
 * caller-supplied expressions (e.g. `obj[_k]` and `` `${_path}/${_k}` ``) so the
 * checks read a runtime location. By default the leaf checks are
 * `!== undefined`-guarded (an absent optional value is valid); pass
 * `required = true` for values that must be present (array items — a sparse hole
 * reads as `undefined` and must fail), which drops that guard. `_key` is unused
 * (the location is fully encoded by `path`) but kept for positional-call parity
 * with the combinator generators.
 */
const generateValueChecks = (
  key: string,
  raw: string,
  path: string,
  propSchema: JSONSchema,
  suffix: string,
  ctx: NestingContext,
  required = false,
): string[] => [
  ...generateValueCheckLines(key, raw, path, propSchema, suffix, ctx, required),
  // Appended rather than folded into the checks above because several of those
  // branches (`$ref`, `const`, `enum`, x-mjst) return early: `unevaluated*` is a
  // sibling of whatever else the node declares, and dropping it would leave the
  // validator accepting documents the interpreter rejects.
  ...generateUnevaluatedChecks(raw, path, propSchema, suffix, ctx),
]

/** The body of {@link generateValueChecks}, minus the `unevaluated*` siblings. */
const generateValueCheckLines = (
  _key: string,
  raw: string,
  path: string,
  propSchema: JSONSchema,
  suffix: string,
  ctx: NestingContext,
  required = false,
): string[] => {
  const lines: string[] = []

  // `false` rejects every instance, so a value that reaches this position is
  // invalid simply by being there. Without this an `allOf: [false]`, a
  // `then: false`, or a `false` behind `patternProperties` emitted no check at
  // all and the branch that should have failed the instance passed it. `true`
  // (and a bare `{}`) accepts everything and falls through to the `[]` below.
  if (propSchema === false) {
    const report = `errors.push({ message: ${JSON.stringify(FALSE_SCHEMA_MESSAGE)}, path: ${path} })`
    if (required) return [`  ${report}`]
    return [`  if (${raw} !== undefined) {`, `    ${report}`, `  }`]
  }
  if (!isSchemaObject(propSchema)) return []

  // Optional values skip validation when absent, so their leaf checks are
  // `!== undefined`-guarded. Array items are unconditionally present — a sparse
  // hole reads as `undefined` and must FAIL its type/const/enum check — so
  // `required` drops the guard.
  const presence = required ? '' : `${raw} !== undefined && `

  // This value lives at `path` (a template literal), so anchor the recursion's
  // context there and one nesting level deeper: any nested object/array it emits
  // then builds paths relative to THIS value and mints collision-free variable
  // names, independent of the caller's context. `key` is intentionally dropped
  // (set to `''`) because `path` already locates the value.
  const valueCtx: NestingContext = {
    objVar: ctx.objVar,
    pathPrefix: path.slice(1, -1),
    depth: ctx.depth + 1,
    hoisted: ctx.hoisted,
    rootSchema: ctx.rootSchema,
  }

  lines.push(...generateKeywordChecks('', raw, path, propSchema, suffix, valueCtx, presence))

  return lines
}

/**
 * An accessor TypeScript will narrow: a plain identifier, a dotted member chain,
 * or an index by a numeric literal or a `const` variable. Anything else — an
 * accessor reading through a cast, above all — has to be bound to a local before
 * a `typeof` test in front of it means anything to the compiler.
 */
const NARROWABLE_REFERENCE = /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*|\[[A-Za-z_$][\w$]*\]|\[\d+\])*$/

/**
 * A boolean expression that is `true` when `raw` matches `sub`. Reuses the value
 * checks but collects their errors into a throwaway local buffer, so the same
 * logic that produces error messages also answers the yes/no question the
 * combinators (`anyOf`/`oneOf`/`not`/`if`) and `contains` need.
 */
const generateMatchesExpr = (raw: string, sub: JSONSchema, suffix: string, ctx: NestingContext): string => {
  if (sub === true) return 'true'
  if (sub === false) return 'false'
  if (!isSchemaObject(sub)) return 'true'
  // A `typeof` test narrows a stable *reference*, and almost every call site
  // passes one — `obj.a`, `_item0`, a `for…in` key index. The `unevaluated*`
  // coverage sweep does not: it reads through a cast, `(input as Record<…>)[k]`,
  // and TypeScript will not carry a narrowing across two spellings of that, so a
  // constrained check behind it emitted `.length` on `unknown` and the generated
  // file did not compile. The IIFE is somewhere to put a local, so bind it there.
  const value = NARROWABLE_REFERENCE.test(raw) ? raw : `_mv${ctx.depth}`
  const checks = generateValueChecks('', value, '`${_path}`', sub, suffix, ctx)
  if (checks.length === 0) return 'true'
  // The checks push to `errors`; redirect them to the IIFE-local `_m`. The outer
  // validator's `errors.push` → `(errors ??= [])` rewrite never sees these (they
  // are already `_m.push`), and nested match IIFEs each shadow their own `_m`.
  const body = checks.join('\n').replaceAll('errors.push(', '_m.push(')
  const binding = value === raw ? '' : `const ${value}: unknown = ${raw}\n`
  return `((): boolean => { const _m: ValidationError[] = []\n${binding}${body}\n    return _m.length === 0 })()`
}

/**
 * The matcher {@link unevaluatedPropertiesExpr} and {@link unevaluatedItemsExpr}
 * use to turn a branch (or the unevaluated subschema itself) into a boolean.
 * Each call gets a context one level deeper than the last so the locals inside
 * the nested match expressions cannot collide.
 */
const unevaluatedMatcher =
  (suffix: string, ctx: NestingContext): UnevaluatedMatchFn =>
  (accessor, schema, depth) =>
    generateMatchesExpr(accessor, schema, suffix, { ...ctx, depth: ctx.depth + depth + 1 })

/**
 * Emits `unevaluatedProperties` / `unevaluatedItems` for one schema node.
 *
 * Both keywords police whatever the node's *other* keywords left untouched, which
 * the runtime interpreter answers by collecting annotations as it walks. There is
 * no walk here, so `unevaluated-match.ts` computes the same thing as an
 * expression — per key (or index), is it covered? — and this wraps that in the
 * runtime type guard the keyword implies: `unevaluatedProperties` says nothing
 * about an array or a scalar, and `unevaluatedItems` says nothing about anything
 * but an array.
 *
 * The branch conditions come back as `const` declarations rather than inline
 * expressions so a per-key loop reads a boolean instead of re-running a whole
 * `anyOf` match once per key.
 *
 * Throws when the node's coverage cannot be proven inline. That is the same shape
 * {@link assertUnevaluatedGeneratable} refuses up front, so reaching it here means
 * the gate and the emitters disagree — better a loud failure than a validator that
 * quietly accepts what the interpreter rejects.
 */
const generateUnevaluatedChecks = (
  raw: string,
  path: string,
  schema: JSONSchema,
  suffix: string,
  ctx: NestingContext,
): string[] => {
  if (!isSchemaObject(schema)) return []
  const s = schema as Record<string, unknown>
  if (!('unevaluatedProperties' in s) && !('unevaluatedItems' in s)) return []

  const match = unevaluatedMatcher(suffix, ctx)
  const lines: string[] = []

  const properties = unevaluatedPropertiesExpr(raw, schema, ctx.rootSchema, ctx.depth, match)
  if (properties === null) throw new Error(UNPROVABLE_COVERAGE_MESSAGE('unevaluatedProperties'))
  if (properties !== undefined) {
    lines.push(`  if (typeof ${raw} === 'object' && ${raw} !== null && !Array.isArray(${raw})) {`)
    for (const statement of properties.setup) lines.push(`    ${statement}`)
    lines.push(`    if (!(${properties.expr})) {`)
    lines.push(`      errors.push({ message: 'must NOT have unevaluated properties', path: ${path} })`)
    lines.push(`    }`)
    lines.push(`  }`)
  }

  const items = unevaluatedItemsExpr(raw, schema, ctx.rootSchema, ctx.depth, match)
  if (items === null) throw new Error(UNPROVABLE_COVERAGE_MESSAGE('unevaluatedItems'))
  if (items !== undefined) {
    lines.push(`  if (Array.isArray(${raw})) {`)
    for (const statement of items.setup) lines.push(`    ${statement}`)
    lines.push(`    if (!(${items.expr})) {`)
    lines.push(`      errors.push({ message: 'must NOT have unevaluated items', path: ${path} })`)
    lines.push(`    }`)
    lines.push(`  }`)
  }

  return lines
}

/**
 * Emits the combinator keywords (`allOf`, `anyOf`, `oneOf`, `not`,
 * `if`/`then`/`else`). `allOf` surfaces each branch's errors directly; the others
 * evaluate branch membership as a boolean via {@link generateMatchesExpr}.
 */
const generateCombinatorChecks = (
  key: string,
  raw: string,
  path: string,
  schema: JSONSchema,
  suffix: string,
  ctx: NestingContext,
): string[] => {
  if (!isSchemaObject(schema)) return []
  const lines: string[] = []

  if (hasAllOf(schema)) {
    for (const branch of schema.allOf) lines.push(...generateValueChecks(key, raw, path, branch, suffix, ctx))
  }

  if (hasAnyOf(schema) && schema.anyOf.length > 0) {
    const conds = schema.anyOf.map((b) => generateMatchesExpr(raw, b, suffix, ctx))
    // A branch that matches everything (`true`, `{}`, an annotation-only schema)
    // makes the whole `anyOf` vacuous. Emitting it anyway produced
    // `if (!(… || true))`, whose body TypeScript knows is unreachable — 58
    // `TS7027`s across the two corpora, in output the repo compiles with
    // `allowUnreachableCode: false`.
    if (!conds.includes('true')) {
      lines.push(`  if (!(${conds.join(' || ')})) {`)
      lines.push(`    errors.push({ message: 'must match a schema in anyOf', path: ${path} })`)
      lines.push(`  }`)
    }
  }

  if (hasOneOf(schema) && schema.oneOf.length > 0) {
    const conds = schema.oneOf.map((b) => `(${generateMatchesExpr(raw, b, suffix, ctx)} ? 1 : 0)`)
    lines.push(`  if ((${conds.join(' + ')}) !== 1) {`)
    lines.push(`    errors.push({ message: 'must match exactly one schema in oneOf', path: ${path} })`)
    lines.push(`  }`)
  }

  const not = (schema as Record<string, unknown>)['not']
  if (not !== undefined && (isSchemaObject(not as JSONSchema) || typeof not === 'boolean')) {
    const cond = generateMatchesExpr(raw, not as JSONSchema, suffix, ctx)
    const report = `errors.push({ message: 'must NOT match the schema in not', path: ${path} })`
    // `not: false` matches nothing, so the instance always passes; `not: true`
    // (or `{}`) matches everything, so it never does. Wrapping either in its own
    // `if` left a branch TypeScript can prove dead.
    if (cond === 'true') {
      lines.push(`  ${report}`)
    } else if (cond !== 'false') {
      lines.push(`  if (${cond}) {`)
      lines.push(`    ${report}`)
      lines.push(`  }`)
    }
  }

  const ifSchema = (schema as Record<string, unknown>)['if']
  if (ifSchema !== undefined && (isSchemaObject(ifSchema as JSONSchema) || typeof ifSchema === 'boolean')) {
    const thenSchema = (schema as Record<string, unknown>)['then']
    const elseSchema = (schema as Record<string, unknown>)['else']
    const thenLines =
      thenSchema !== undefined ? generateValueChecks(key, raw, path, thenSchema as JSONSchema, suffix, ctx) : []
    const elseLines =
      elseSchema !== undefined ? generateValueChecks(key, raw, path, elseSchema as JSONSchema, suffix, ctx) : []
    if (thenLines.length > 0 || elseLines.length > 0) {
      // A statically-known `if` picks one arm, and emitting the other left it
      // provably unreachable. `if: true` / `if: {}` always takes `then`;
      // `if: false` always takes `else`.
      const cond = generateMatchesExpr(raw, ifSchema as JSONSchema, suffix, ctx)
      if (cond === 'true') {
        lines.push(...thenLines)
      } else if (cond === 'false') {
        lines.push(...elseLines)
      } else {
        lines.push(`  if (${cond}) {`)
        lines.push(...thenLines)
        lines.push(`  } else {`)
        lines.push(...elseLines)
        lines.push(`  }`)
      }
    }
  }

  return lines
}

/**
 * Emits validation for `patternProperties` and a schema-form
 * `additionalProperties` (the `false` form is handled by
 * {@link generateStrictKeyChecks}). For each object key, every matching
 * `patternProperties` subschema runs against the value; keys reached by neither
 * `properties` nor any pattern fall through to `additionalProperties`. This
 * mirrors the runtime interpreter, which validates these values rather than only
 * gating extra keys.
 */
const generatePatternAndAdditionalChecks = (schema: JSONSchema, suffix: string, ctx: NestingContext): string[] => {
  if (!isSchemaObject(schema)) return []
  const obj = ctx.objVar
  const d = ctx.depth
  const lines: string[] = []

  const patternsRecord =
    'patternProperties' in schema && typeof schema.patternProperties === 'object' && schema.patternProperties !== null
      ? (schema.patternProperties as Record<string, JSONSchema>)
      : {}
  const patternEntries = Object.entries(patternsRecord)

  for (const [pattern, sub] of patternEntries) {
    const re = regexLiteral(pattern)
    const kv = `_pk${d}`
    const valueChecks = generateValueChecks(
      `\${${kv}}`,
      `${obj}[${kv}]`,
      `\`${ctx.pathPrefix}/\${escapePointer(${kv})}\``,
      sub,
      suffix,
      ctx,
    )
    if (valueChecks.length === 0) continue
    lines.push(`  for (const ${kv} in ${obj}) {`)
    lines.push(`    if (${re}.test(${kv})) {`)
    lines.push(...valueChecks.map((line) => `    ${line}`))
    lines.push(`    }`)
    lines.push(`  }`)
  }

  // Schema-form `additionalProperties` validates every key reached by neither a
  // declared property nor any `patternProperties` regex.
  if (hasAdditionalProperties(schema) && isSchemaObject(schema.additionalProperties)) {
    const additional = schema.additionalProperties
    const kv = `_ak${d}`
    const valueChecks = generateValueChecks(
      `\${${kv}}`,
      `${obj}[${kv}]`,
      `\`${ctx.pathPrefix}/\${escapePointer(${kv})}\``,
      additional,
      suffix,
      ctx,
    )
    if (valueChecks.length > 0) {
      const known = Object.keys(hasProperties(schema) ? schema.properties : {})
      lines.push(`  for (const ${kv} in ${obj}) {`)
      if (known.length > 0) lines.push(`    if (${JSON.stringify(known)}.includes(${kv})) continue`)
      for (const pattern of Object.keys(patternsRecord)) {
        lines.push(`    if (${regexLiteral(pattern)}.test(${kv})) continue`)
      }
      lines.push(...valueChecks.map((line) => `    ${line}`))
      lines.push(`  }`)
    }
  }

  return lines
}

/**
 * Generates the recursive checks for an inline nested object property, i.e. an
 * object schema written directly under `properties` rather than referenced via
 * `$ref` (those delegate to the referenced validator instead). The value is
 * narrowed into its own block-scoped variable and each nested property runs
 * through the same per-property generator, so nesting works to any depth.
 */
const generateInlineObjectChecks = (
  key: string,
  propSchema: JSONSchema,
  raw: string,
  suffix: string,
  ctx: NestingContext,
): string[] => {
  if (!isSchemaObject(propSchema)) return []

  const child: NestingContext = {
    objVar: `_obj${ctx.depth + 1}`,
    // When `key` is empty the value is located AT `ctx.pathPrefix` already (e.g. an
    // inline object reached through a combinator branch or a dynamic-key value), so
    // appending `/${key}` would emit a spurious `//` or trailing `/` in error paths.
    pathPrefix: key === '' ? ctx.pathPrefix : `${ctx.pathPrefix}/${pointerSegment(key)}`,
    depth: ctx.depth + 1,
    hoisted: ctx.hoisted,
    rootSchema: ctx.rootSchema,
  }

  const required = new Set(hasRequired(propSchema) ? propSchema.required : [])
  const properties = hasProperties(propSchema) ? propSchema.properties : {}

  const innerLines: string[] = []

  for (const [childKey, childSchema] of Object.entries(properties)) {
    innerLines.push(
      ...generatePropertyChecks(childKey, childSchema as JSONSchema, required.has(childKey), suffix, child),
    )
  }

  innerLines.push(...generateMissingRequiredChecks(propSchema, child))
  innerLines.push(...generatePatternAndAdditionalChecks(propSchema, suffix, child))
  innerLines.push(...generateStrictKeyChecks(propSchema, child))
  innerLines.push(...generateDependentRequiredChecks(propSchema, child))
  innerLines.push(...generateDependentSchemasChecks(propSchema, suffix, child))
  innerLines.push(...generateDependenciesChecks(propSchema, suffix, child))
  innerLines.push(...generateMinMaxPropertiesChecks(propSchema, child))
  if (hasPropertyNames(propSchema)) {
    innerLines.push(...generatePropertyNameChecks(propSchema.propertyNames, suffix, child))
  }

  if (innerLines.length === 0) return []

  // The shape check for the property itself already ran (or the property is
  // optional), so re-guard here instead of assuming the value is an object.
  return [
    `  if (typeof ${raw} === 'object' && ${raw} !== null && !Array.isArray(${raw})) {`,
    `    const ${child.objVar} = ${raw} as Record<string, unknown>`,
    ...innerLines.map((line) => `  ${line}`),
    `  }`,
  ]
}

/**
 * Generates the `propertyNames` loop: every object key is a string, and the
 * *whole* subschema is validated against each key — not just the
 * `pattern`/length/`enum`/`const`/`$ref` subset. Delegating to
 * {@link generateValueChecks} keeps the generator in lockstep with the
 * interpreter, which runs `matchesSchema(nameSchema, key)` per key, so a
 * subschema carrying a combinator, `type`, `multipleOf`, etc. is enforced too.
 * A key is always a present string, so the value checks run in `required` mode
 * (no `!== undefined` guard) — which is also what makes a `propertyNames: false`
 * reject every key rather than emit nothing.
 */
const generatePropertyNameChecks = (nameSchema: JSONSchema, suffix: string, ctx: NestingContext): string[] => {
  const at = `\`${ctx.pathPrefix}/\${escapePointer(_name)}\``
  const nameCtx: NestingContext = {
    objVar: ctx.objVar,
    pathPrefix: `${ctx.pathPrefix}/\${escapePointer(_name)}`,
    depth: ctx.depth + 1,
    hoisted: ctx.hoisted,
    rootSchema: ctx.rootSchema,
  }
  const checks = generateValueChecks('', '_name', at, nameSchema, suffix, nameCtx, true)
  if (checks.length === 0) return []
  return [`  for (const _name of Object.keys(${ctx.objVar})) {`, ...checks.map((line) => `  ${line}`), `  }`]
}

/**
 * Emits `dependentRequired` checks: when a trigger key is present, each of its
 * declared dependencies must be present too. Reads the object and reports at the
 * current node via `ctx`, so it works at the root and inside nested objects.
 */
const generateDependentRequiredChecks = (schema: JSONSchema, ctx: NestingContext): string[] => {
  if (!isSchemaObject(schema) || !hasDependentRequired(schema)) return []
  const obj = ctx.objVar
  const at = ctx.depth === 0 ? '_path' : `\`${ctx.pathPrefix}\``
  const lines: string[] = []
  for (const [trigger, deps] of Object.entries(schema.dependentRequired)) {
    if (!Array.isArray(deps)) continue
    for (const dep of deps) {
      const msg = JSON.stringify(`must have property '${dep}' when '${trigger}' is present`)
      lines.push(`  if (${hasOwnCheck(obj, trigger)} && ${missingCheck(obj, dep)}) {`)
      lines.push(`    errors.push({ message: ${msg}, path: ${at} })`)
      lines.push(`  }`)
    }
  }
  return lines
}

/**
 * The local a `dependentSchemas` / `dependencies` subschema is applied through.
 *
 * Those subschemas apply to the *object itself*, and the object variable is
 * declared `Record<string, unknown>` — so a subschema carrying, say, `minLength`
 * emitted `typeof obj === 'string'`, which TypeScript narrows to `never` and then
 * rejects the `.length` behind it (`TS2367` + `TS2339`). The check is inert at
 * runtime either way, since the value really is an object; re-binding it as
 * `unknown` first is what makes the emitted file compile. Depth-scoped, and each
 * binding sits inside its own trigger block, so triggers cannot collide.
 */
const dependentSelfBinding = (objVar: string, depth: number): { name: string; declaration: string } => {
  const name = `_dep${depth}`
  return { name, declaration: `  const ${name}: unknown = ${objVar}` }
}

/**
 * Emits `dependentSchemas` checks (2020-12): when a trigger property is present,
 * the *whole object* must also match the associated subschema. Mirrors the
 * interpreter, which applies the subschema in place against the object. A `true`
 * subschema permits everything (no-op); a `false` subschema makes the trigger's
 * presence always invalid.
 */
const generateDependentSchemasChecks = (schema: JSONSchema, suffix: string, ctx: NestingContext): string[] => {
  if (!isSchemaObject(schema)) return []
  const dep = (schema as Record<string, unknown>)['dependentSchemas']
  if (typeof dep !== 'object' || dep === null || Array.isArray(dep)) return []

  const obj = ctx.objVar
  const at = ctx.depth === 0 ? '_path' : `\`${ctx.pathPrefix}\``
  const objPath = `\`${ctx.pathPrefix}\``
  const lines: string[] = []

  for (const [trigger, sub] of Object.entries(dep)) {
    if (sub === true) continue
    if (sub === false) {
      const msg = JSON.stringify(`must NOT have property '${trigger}'`)
      lines.push(`  if (${hasOwnCheck(obj, trigger)}) {`)
      lines.push(`    errors.push({ message: ${msg}, path: ${at} })`)
      lines.push(`  }`)
      continue
    }
    if (!isSchemaObject(sub as JSONSchema)) continue
    // The subschema applies to the object itself, so validate the current object
    // variable against it and gate the whole block on the trigger's presence.
    const self = dependentSelfBinding(obj, ctx.depth)
    const checks = generateValueChecks('', self.name, objPath, sub as JSONSchema, suffix, ctx)
    if (checks.length === 0) continue
    lines.push(`  if (${hasOwnCheck(obj, trigger)}) {`)
    lines.push(`  ${self.declaration}`)
    lines.push(...checks.map((line) => `  ${line}`))
    lines.push(`  }`)
  }
  return lines
}

/**
 * Emits draft-07 `dependencies` — the dual-form predecessor of
 * `dependentRequired` + `dependentSchemas`. When a trigger property is present,
 * an array value requires each listed key, and a schema value is applied to the
 * *whole object*. Mirrors the interpreter, which branches on the value's shape.
 * A `false` subschema makes the trigger's mere presence invalid; a `true`
 * subschema is a no-op.
 */
const generateDependenciesChecks = (schema: JSONSchema, suffix: string, ctx: NestingContext): string[] => {
  if (!isSchemaObject(schema)) return []
  const dep = (schema as Record<string, unknown>)['dependencies']
  if (typeof dep !== 'object' || dep === null || Array.isArray(dep)) return []

  const obj = ctx.objVar
  const at = ctx.depth === 0 ? '_path' : `\`${ctx.pathPrefix}\``
  const objPath = `\`${ctx.pathPrefix}\``
  const lines: string[] = []

  for (const [trigger, value] of Object.entries(dep)) {
    // Array form: each listed key must be present when the trigger is.
    if (Array.isArray(value)) {
      for (const key of value as unknown[]) {
        if (typeof key !== 'string') continue
        const msg = JSON.stringify(`must have property '${key}' when '${trigger}' is present`)
        lines.push(`  if (${hasOwnCheck(obj, trigger)} && ${missingCheck(obj, key)}) {`)
        lines.push(`    errors.push({ message: ${msg}, path: ${at} })`)
        lines.push(`  }`)
      }
      continue
    }
    // Schema form: the subschema applies to the object itself.
    if (value === true) continue
    if (value === false) {
      const msg = JSON.stringify(`must NOT have property '${trigger}'`)
      lines.push(`  if (${hasOwnCheck(obj, trigger)}) {`)
      lines.push(`    errors.push({ message: ${msg}, path: ${at} })`)
      lines.push(`  }`)
      continue
    }
    if (!isSchemaObject(value as JSONSchema)) continue
    const self = dependentSelfBinding(obj, ctx.depth)
    const checks = generateValueChecks('', self.name, objPath, value as JSONSchema, suffix, ctx)
    if (checks.length === 0) continue
    lines.push(`  if (${hasOwnCheck(obj, trigger)}) {`)
    lines.push(`  ${self.declaration}`)
    lines.push(...checks.map((line) => `  ${line}`))
    lines.push(`  }`)
  }
  return lines
}

/**
 * Emits `minProperties` / `maxProperties` bounds on the object's key count,
 * mirroring the interpreter (which counts the object's own enumerable keys and
 * reports at the object node). Counting once into a depth-scoped local keeps the
 * two bounds from re-walking the keys.
 */
const generateMinMaxPropertiesChecks = (schema: JSONSchema, ctx: NestingContext): string[] => {
  if (!isSchemaObject(schema)) return []
  const hasMin = hasMinProperties(schema)
  const hasMax = hasMaxProperties(schema)
  if (!hasMin && !hasMax) return []

  const obj = ctx.objVar
  const at = ctx.depth === 0 ? '_path' : `\`${ctx.pathPrefix}\``
  const count = `_pc${ctx.depth}`
  const lines: string[] = [`  const ${count} = Object.keys(${obj}).length`]

  if (hasMin) {
    const msg = JSON.stringify(`must have at least ${schema.minProperties} properties`)
    lines.push(`  if (${count} < ${schema.minProperties}) {`)
    lines.push(`    errors.push({ message: ${msg}, path: ${at} })`)
    lines.push(`  }`)
  }
  if (hasMax) {
    const msg = JSON.stringify(`must have at most ${schema.maxProperties} properties`)
    lines.push(`  if (${count} > ${schema.maxProperties}) {`)
    lines.push(`    errors.push({ message: ${msg}, path: ${at} })`)
    lines.push(`  }`)
  }
  return lines
}

/**
 * Builds the `&&` conditions that prove a single property is valid, or `null`
 * when the property carries any keyword the slow path enforces beyond a bare
 * type check (pattern, min/max, enum, const, `$ref`, items, x-mjst, …). A `null`
 * makes the whole guard bail so that input still flows through the slow,
 * error-collecting path — the guard only ever returns true for *provably* valid
 * input, never weakening a verdict. `objAcc` is the expression yielding the
 * parent object (already narrowed to a record); `key` indexes into it.
 */
/**
 * Whether an object schema carries a combinator keyword (`allOf`, `anyOf`,
 * `oneOf`, `not`, `if`) that the error-collecting slow path enforces but neither
 * flat guard can mirror. When present, both guards must bail so their early
 * `return true` never accepts a document the combinator would reject.
 */
const hasObjectLevelCombinator = (schema: JSONSchema): boolean => {
  if (!isSchemaObject(schema)) return false
  return hasAllOf(schema) || hasAnyOf(schema) || hasOneOf(schema) || 'not' in schema || 'if' in schema
}

/**
 * True when a node carries a *constraining* `unevaluatedProperties` /
 * `unevaluatedItems`. A `true` value permits everything, so it constrains
 * nothing and is not worth bailing a flat guard for.
 *
 * The flat guards cannot mirror these: the check they need is a per-key sweep
 * over coverage the guard has no way to express, so a guard that ignored one
 * would return `true` for a document `validateX` rejects.
 */
const carriesUnevaluated = (schema: JSONSchema): boolean => {
  if (!isSchemaObject(schema)) return false
  const s = schema as Record<string, unknown>
  return (
    ('unevaluatedProperties' in s && s['unevaluatedProperties'] !== true) ||
    ('unevaluatedItems' in s && s['unevaluatedItems'] !== true)
  )
}

const guardPropConditions = (key: string, propSchema: JSONSchema, objAcc: string): string[] | null => {
  if (!isSchemaObject(propSchema)) return null

  // Dotted access (`obj.number`) for identifier keys, bracket access otherwise.
  const raw = safeAccessor(objAcc, key)

  // Anything the slow path enforces past a typeof is cheaper to leave to the
  // slow path than to mirror here, so bail and keep the guard sound.
  if (
    hasRef(propSchema) ||
    hasEnum(propSchema) ||
    hasConst(propSchema) ||
    hasOneOf(propSchema) ||
    hasAnyOf(propSchema) ||
    hasAllOf(propSchema) ||
    'not' in propSchema ||
    'if' in propSchema ||
    getMjstInstanceOf(propSchema) !== undefined ||
    getMjstPrimitive(propSchema) !== undefined ||
    hasPattern(propSchema) ||
    hasMinLength(propSchema) ||
    hasMaxLength(propSchema) ||
    hasMinimum(propSchema) ||
    hasMaximum(propSchema) ||
    hasExclusiveMinimum(propSchema) ||
    hasExclusiveMaximum(propSchema) ||
    hasMultipleOf(propSchema) ||
    hasItems(propSchema) ||
    carriesUnevaluated(propSchema)
  ) {
    return null
  }

  if (!hasType(propSchema)) return null

  switch (propSchema.type as string) {
    case 'string':
      return [`typeof ${raw} === 'string'`]
    case 'number':
      return [`typeof ${raw} === 'number'`]
    case 'integer':
      return [`typeof ${raw} === 'number'`, `Number.isInteger(${raw})`]
    case 'boolean':
      return [`typeof ${raw} === 'boolean'`]
    case 'null':
      return [`${raw} === null`]
    case 'object':
      // Member access into the nested record is only reached after the shape
      // check ahead of it in the `&&` chain, so the cast is always safe.
      return guardObjectConditions(propSchema, raw, `(${raw} as Record<string, unknown>)`)
    // Arrays need a per-item loop the guard can't express, and any other type
    // (null, multi-type, untyped) is left to the slow path.
    default:
      return null
  }
}

/** A property key an array carries with a non-`undefined` value: `length`, or a
 * canonical array index. A required prop on one of these can't be used to rule
 * out arrays (an array's `length` is a number, an index can be anything). */
const ARRAY_INDEX_KEY = /^(0|[1-9]\d*)$/

/** Schema types whose guard is a `typeof` check `typeof undefined` never passes. */
const TYPEOF_CHECKABLE_TYPES = new Set(['string', 'number', 'integer', 'boolean', 'object'])

/**
 * Whether some required, typeof-guarded property proves the value can't be an
 * array — letting the object shape-check drop its `!Array.isArray(...)` term. An
 * array indexed by a normal key yields `undefined` (or an inherited method),
 * which no `typeof === 'string' | 'number' | 'boolean' | 'object'` accepts, so
 * that field check already rejects arrays. Keys an array does carry a real value
 * for (`length`, numeric indices) are excluded, since those could slip through.
 */
const arrayRejectedByRequiredProp = (
  keys: string[],
  required: Set<string>,
  properties: Record<string, JSONSchema>,
): boolean => {
  for (const key of keys) {
    if (!required.has(key) || key === 'length' || ARRAY_INDEX_KEY.test(key)) continue
    const propSchema = properties[key]
    if (
      propSchema !== undefined &&
      isSchemaObject(propSchema) &&
      hasType(propSchema) &&
      TYPEOF_CHECKABLE_TYPES.has(propSchema.type as string)
    ) {
      return true
    }
  }
  return false
}

/**
 * Builds the allocation-free boolean guard for an object schema as a list of
 * `&&` conditions, or `null` when the schema can't be proven valid by a cheap
 * expression. The conditions are ordered so every member access is guarded by
 * the object-shape check that precedes it in the `&&` chain.
 *
 * The guard only handles the happy path: every declared property must be
 * required and a bare-typed scalar or a likewise-guardable nested object. Any
 * optional property, object-level constraint the slow path enforces
 * (`patternProperties`, `propertyNames`, `dependentRequired`, an
 * `additionalProperties` *schema*), or unguardable property makes it bail, and
 * the validator falls back to its full error-collecting body.
 */
const guardObjectConditions = (schema: JSONSchema, raw: string, objAcc: string): string[] | null => {
  if (!isObjectSchema(schema)) return null
  if (hasDependentRequired(schema) || hasPropertyNames(schema) || 'dependentSchemas' in schema) return null
  if (hasMinProperties(schema) || hasMaxProperties(schema) || 'dependencies' in schema) return null
  if (isSchemaObject(schema) && 'patternProperties' in schema) return null
  // Object-level combinators are enforced by the slow path but cannot be mirrored
  // by this flat guard, so bail — otherwise the guard's early `return true` would
  // accept documents the combinators reject.
  if (hasObjectLevelCombinator(schema)) return null
  if (carriesUnevaluated(schema)) return null

  let strict = false
  if (hasAdditionalProperties(schema)) {
    // Only `additionalProperties: false` is guardable (via the key-count trick
    // below); an additional-properties *schema* needs per-key validation.
    if (schema.additionalProperties === false) strict = true
    else return null
  }

  const required = new Set(hasRequired(schema) ? schema.required : [])
  const properties = hasProperties(schema) ? schema.properties : {}
  const keys = Object.keys(properties)

  // A required key with no `properties` entry has no cheap guard condition, so
  // defer to the slow path (which checks its presence).
  for (const key of required) {
    if (!Object.hasOwn(properties, key)) return null
  }

  // The object shape-check only needs `!Array.isArray` when no required field
  // check would already reject an array (see `arrayRejectedByRequiredProp`).
  const arrayCheck = arrayRejectedByRequiredProp(keys, required, properties) ? '' : ` && !Array.isArray(${raw})`
  const conditions: string[] = [`typeof ${raw} === 'object' && ${raw} !== null${arrayCheck}`]

  for (const key of keys) {
    // An optional property would need an `=== undefined ||` branch and breaks
    // the key-count trick, so the guard only covers all-required objects.
    if (!required.has(key)) return null
    const propConditions = guardPropConditions(key, properties[key] as JSONSchema, objAcc)
    if (propConditions === null) return null
    conditions.push(...propConditions)
  }

  if (strict) {
    // `additionalProperties: false` with every declared property required: once
    // the typeof checks confirm each key is present, an exact key count proves
    // there are no extras — TypeBox's trick, with no loop and no Set.
    if (!keys.every((key) => required.has(key))) return null
    conditions.push(`Object.keys(${objAcc}).length === ${keys.length}`)
  }

  return conditions
}

/**
 * Generates a validator function body for an object schema, checking each
 * property's presence and type and collecting all errors.
 */
const generateObjectValidator = (
  schema: JSONSchema,
  typeName: string,
  suffix: string,
  rootSchema: Record<string, unknown> | undefined,
): string => {
  const vName = validatorName(typeName)
  const required = new Set(hasRequired(schema) ? schema.required : [])
  const properties = hasProperties(schema) ? schema.properties : {}
  const ctx = createRootContext(rootSchema)

  const propertyLines: string[] = []

  for (const [key, propSchema] of Object.entries(properties)) {
    const checks = generatePropertyChecks(key, propSchema as JSONSchema, required.has(key), suffix, ctx)
    if (checks.length > 0) {
      propertyLines.push(...checks)
    }
  }

  // Required keys with no `properties` entry still need a presence check.
  propertyLines.push(...generateMissingRequiredChecks(schema, ctx))

  // patternProperties values and a schema-form additionalProperties are
  // validated here (the `false` form is handled by generateStrictKeyChecks).
  propertyLines.push(...generatePatternAndAdditionalChecks(schema, suffix, ctx))

  // additionalProperties: false rejects every key not declared in properties
  propertyLines.push(...generateStrictKeyChecks(schema, ctx))

  // dependentRequired — when a trigger property is present, its dependencies must be too.
  propertyLines.push(...generateDependentRequiredChecks(schema, ctx))

  // dependentSchemas — when a trigger property is present, the whole object must
  // also match the associated subschema.
  propertyLines.push(...generateDependentSchemasChecks(schema, suffix, ctx))

  // dependencies (draft-07) — the dual-form predecessor of dependentRequired +
  // dependentSchemas.
  propertyLines.push(...generateDependenciesChecks(schema, suffix, ctx))

  // minProperties / maxProperties — bound the object's key count.
  propertyLines.push(...generateMinMaxPropertiesChecks(schema, ctx))

  // propertyNames — every key (always a string) must satisfy the subschema. This
  // mirrors the interpreter, which runs the full subschema against each key.
  if (hasPropertyNames(schema)) {
    propertyLines.push(...generatePropertyNameChecks(schema.propertyNames, suffix, ctx))
  }

  // Combinators declared alongside the object's properties (e.g. an object with
  // `allOf` refining it further) are validated against the object value itself —
  // read through `input`, the `unknown` parameter, rather than the narrowed `obj`.
  // A branch from another type family compares the value against a string or a
  // number (`{ type: 'object', oneOf: [{ enum: ['auto'] }, …] }` is a real
  // OpenAPI shape), and against a `Record<string, unknown>` that is a `TS2367`
  // followed by a cascade on `never`.
  // `input` itself will not do: the shape check at the top of the function has
  // already narrowed it to `object`, so a branch comparing the value against a
  // string is `TS2367` all over again. Re-widening it to `unknown` costs nothing
  // at runtime and is the same trick `dependentSelfBinding` plays.
  const objectCombinators = generateCombinatorChecks('', '_root', '`${_path}`', schema, suffix, ctx)
  if (objectCombinators.length > 0) {
    propertyLines.push(`  const _root: unknown = input`)
    propertyLines.push(...objectCombinators)
  }

  // Lazily allocate the errors array so a valid input never builds one — the same
  // allocation-free happy path the runtime interpreter uses. Each emitted
  // `errors.push(...)` becomes a create-on-first-use push; nothing is allocated
  // until the first actual error, so the common valid case stays alloc-free even
  // when the schema is too rich for the boolean guard.
  const body = (propertyLines.length > 0 ? '\n' + propertyLines.join('\n') + '\n' : '').replaceAll(
    'errors.push(',
    '(errors ??= []).push(',
  )

  // Hoisted statements (e.g. known-keys Sets) come first so every call of the
  // validator reuses them instead of rebuilding them.
  const hoistedBlock = ctx.hoisted.length > 0 ? `${ctx.hoisted.join('\n')}\n\n` : ''

  // A pure boolean guard for the happy path: when every property is present and
  // well-typed (and, for strict objects, there are no extras) it returns true
  // without allocating an `errors` array or touching the slow path. It returns
  // true only for provably valid input; anything it can't prove cheaply falls
  // through to the error-collecting path, which produces the same verdict and
  // full JSON-Pointer errors. Schemas with constraints the guard can't express
  // produce no guard at all (`null`), leaving behaviour unchanged.
  const guard = guardObjectConditions(schema, 'input', 'obj')

  // The cold, error-collecting body. When there's a guard this is a separate
  // (unexported) function reached only on failure; the hot path never enters it
  // unless input is actually invalid, so its size never costs the happy path.
  const collectBody = (name: string, exported: boolean): string =>
    [
      `${exported ? 'export ' : ''}const ${name} = (input: unknown, _path = ''): ValidationResult => {`,
      `  const obj = input as Record<string, unknown>`,
      `  if (typeof input !== 'object' || input === null || Array.isArray(input)) {`,
      `    return { valid: false, errors: [{ message: 'must be object', path: _path }] }`,
      `  }`,
      ``,
      `  let errors: ValidationError[] | undefined`,
      body,
      `  return errors !== undefined ? { valid: false, errors } : true`,
      `}`,
    ].join('\n')

  // No guard: the exported validator is the error-collecting function itself.
  if (!guard) {
    return `${hoistedBlock}${collectBody(vName, true)}`
  }

  // With a guard, keep the happy path inside the exported function — the guard
  // is inlined as an early `return true`, so a valid input never pays an extra
  // call — and move only the cold, error-collecting body into a separate
  // (unexported) function. That keeps `validateX` itself tiny (guard + a single
  // tail call) so V8 optimises it well, without the giant error body bloating
  // the hot path. The exported `(input, _path?) => ValidationResult` contract
  // is unchanged.
  const collectName = `${vName}Errors`
  return [
    `${hoistedBlock}${collectBody(collectName, false)}`,
    ``,
    `export const ${vName} = (input: unknown, _path = ''): ValidationResult => {`,
    `  const obj = input as Record<string, unknown>`,
    `  if (`,
    guard.map((condition) => `    ${condition}`).join(' &&\n'),
    `  ) {`,
    `    return true`,
    `  }`,
    `  return ${collectName}(input, _path)`,
    `}`,
  ].join('\n')
}

/**
 * Derives the boolean type-guard name from a type name.
 * e.g. "InfoObject" → "isInfoObject"
 */
const guardName = (typeName: string): string => `is${typeName}`

/**
 * Builds a boolean expression that is TRUE iff `acc` satisfies `schema`, with the
 * *exact same verdict* as the error-collecting validator — or `null` when the
 * schema carries something the flat form can't faithfully mirror ($ref, unions,
 * `const`, x-mjst, etc.), in which case the whole guard falls back to calling the
 * validator. Used for a property value or an array item; `acc` is the expression
 * yielding the value.
 */
const booleanLeafExpr = (schema: JSONSchema, acc: string, narrowable = true): string | null => {
  if (!isSchemaObject(schema)) return null

  /**
   * `acc`, spelled so a constrained check compiles.
   *
   * The guard is one `&&` chain and TypeScript narrows it by the `typeof` test in
   * front, but narrowing needs a stable *reference*. A nested member reads
   * through a cast — `(obj.a as Record<string, unknown>).b` — and TypeScript will
   * not carry a narrowing across two spellings of the same cast expression, so
   * `…b.length >= 2` came out as `Object is of type 'unknown'` and the generated
   * file did not compile for a schema as ordinary as a nested object with a
   * `minLength`. Where the reference cannot be narrowed the check says the type
   * itself, which is sound: the `typeof` that proves it is already ahead of it in
   * the same chain.
   */
  const typed = (type: string): string => (narrowable ? acc : `(${acc} as ${type})`)

  // Anything whose verdict the flat form can't mirror exactly: defer to the
  // validator (the caller turns a single `null` into a full fallback guard).
  if (
    hasRef(schema) ||
    hasConst(schema) ||
    hasOneOf(schema) ||
    'anyOf' in schema ||
    'allOf' in schema ||
    'not' in schema ||
    'if' in schema ||
    'contains' in schema ||
    'prefixItems' in schema ||
    // A draft-07 tuple: the fixed positions live in an *array* `items` and the
    // tail in `additionalItems`. Neither is expressible flat, and reading past
    // them let the guard accept tuples `validateX` rejects.
    Array.isArray((schema as Record<string, unknown>)['items']) ||
    'additionalItems' in schema ||
    carriesUnevaluated(schema) ||
    getMjstInstanceOf(schema) !== undefined ||
    getMjstPrimitive(schema) !== undefined
  ) {
    return null
  }

  // enum — the same membership test the validator uses, ANDed with whatever else
  // the node says rather than standing in for it. Returning it alone was unsound
  // (`{ enum: [1], type: 'string' }` is unsatisfiable, and the bare membership
  // test accepts `1`), but bailing outright would cost the flat guard on the
  // commonest shape in an OpenAPI document: a discriminator written
  // `{ type: 'string', enum: ['code_interpreter'] }`.
  const membership = hasEnum(schema) ? enumMembershipExpr(schema.enum as unknown[], acc) : null

  if (!hasType(schema)) {
    if (membership === null) return null
    // With no `type` there is no branch below to compose with, so membership has
    // to be the whole story — and it only is when nothing else constrains.
    return declaresKeywordOutside(schema, ['enum']) ? null : membership
  }
  const t = schema.type as string
  const withMembership = (expr: string | null): string | null =>
    expr === null || membership === null ? expr : `${expr} && ${membership}`

  switch (t) {
    // Each constraint is the exact negation of the validator's error condition,
    // so edge values — `NaN` above all, which compares `false` against every
    // operator — get the identical verdict on both paths. The numeric bounds are
    // written as the pass condition (`x >= min`) because the validator's error
    // condition is its negation; the length checks come from the same
    // `string-length-check` emitter the validator uses, for the same reason.
    case 'string': {
      const str = typed('string')
      const parts = [`typeof ${acc} === 'string'`]
      if (hasPattern(schema)) parts.push(`${regexLiteral(schema.pattern)}.test(${str})`)
      // The exact negations of the validator's length conditions, from the same
      // `string-length-check` emitter, so the guard counts code points too.
      if (hasMinLength(schema)) parts.push(minLengthPassExpr(str, schema.minLength))
      if (hasMaxLength(schema)) parts.push(maxLengthPassExpr(str, schema.maxLength))
      return withMembership(parts.join(' && '))
    }
    case 'number':
    case 'integer': {
      const num = typed('number')
      const parts = [`typeof ${acc} === 'number'`]
      if (t === 'integer') parts.push(`Number.isInteger(${acc})`)
      if (hasMinimum(schema)) parts.push(`${num} ${hasStrictExclusiveMinimum(schema) ? '>' : '>='} ${schema.minimum}`)
      if (hasMaximum(schema)) parts.push(`${num} ${hasStrictExclusiveMaximum(schema) ? '<' : '<='} ${schema.maximum}`)
      if (hasExclusiveMinimum(schema)) parts.push(`${num} > ${schema.exclusiveMinimum}`)
      if (hasExclusiveMaximum(schema)) parts.push(`${num} < ${schema.exclusiveMaximum}`)
      if (hasMultipleOf(schema)) parts.push(multipleOfPassExpr(num, schema.multipleOf))
      return withMembership(parts.join(' && '))
    }
    case 'boolean':
      return withMembership(`typeof ${acc} === 'boolean'`)
    case 'null':
      return withMembership(`${acc} === null`)
    case 'object': {
      // Members below this point read through the cast, so nothing under it can
      // be narrowed by the chain.
      const parts = booleanObjectParts(schema, acc, `(${acc} as Record<string, unknown>)`, false)
      return parts === null ? null : withMembership(parts.join(' && '))
    }
    case 'array':
      return withMembership(booleanArrayExpr(schema, acc, narrowable))
    default:
      return null
  }
}

/**
 * Boolean expression for an array value. Mirrors the validator: array shape,
 * `minItems`/`maxItems`/`uniqueItems`, and each item validated in full via
 * {@link booleanLeafExpr}. Returns `null` for `$ref` items, or when an item schema
 * can't be expressed flat, so the whole guard defers to the validator.
 *
 * Item iteration goes through `Array.from` rather than `Array.prototype.every`
 * because `every` *skips holes* in a sparse array (`[, 'x']`), whereas the
 * validator's index-based `for` loop reads a hole as `undefined` and rejects it.
 * Materialising the array first makes the guard's verdict match the slow path's
 * on sparse input — the guard must never accept what the slow path would reject.
 */
const booleanArrayExpr = (schema: JSONSchema, acc: string, narrowable = true): string | null => {
  // `Array.isArray` narrows a reference but not a cast expression — see the note
  // on `typed` in {@link booleanLeafExpr}.
  const arr = narrowable ? acc : `(${acc} as unknown[])`
  const parts = [`Array.isArray(${acc})`]
  // Length / uniqueness, mirroring the validator's checks exactly so the guard's
  // verdict matches the slow path's.
  if (hasMinItems(schema)) parts.push(`${arr}.length >= ${schema.minItems}`)
  if (hasMaxItems(schema)) parts.push(`${arr}.length <= ${schema.maxItems}`)
  if (hasUniqueItems(schema) && schema.uniqueItems === true) {
    // Same scalar-vs-structural split as the validator, so the guard's verdict
    // matches the slow path's for object items in a reordered key order.
    parts.push(
      arrayItemsAreScalarOnly(schema as Record<string, unknown>)
        ? `new Set((${acc} as unknown[]).map((_u) => JSON.stringify(_u))).size === ${arr}.length`
        : `allUnique(${acc} as unknown[])`,
    )
  }
  const base = parts.join(' && ')

  // `items: false` forbids every element, so the array has to be empty — which is
  // what the validator says with `must NOT have more than 0 items`. This is read
  // before `hasItems`, which is false for a boolean `items` and so used to send
  // the constraint straight past: `isX` accepted `[1]` for
  // `{ "type": "array", "items": false }` while `validateX` rejected it. (A tuple
  // never reaches here — `prefixItems` and an array `items` both bail in
  // {@link booleanLeafExpr}.)
  if ((schema as Record<string, unknown>)['items'] === false) return `${base} && ${arr}.length === 0`
  // `items: true`, and an absent `items`, constrain nothing.
  if (!hasItems(schema)) return base
  const items = schema.items
  if (!isSchemaObject(items)) return base
  if (hasRef(items)) return null
  // Validate each item in full, mirroring the validator's per-item checks so the
  // guard reaches the identical verdict. `booleanLeafExpr` returns `null` for item
  // schemas it can't express flat — bail so the validator decides, keeping the
  // guard from ever accepting what the slow path would reject.
  const itemExpr = booleanLeafExpr(items, '_it')
  if (itemExpr === null) return null
  return `${base} && Array.from(${acc} as unknown[]).every((_it) => (${itemExpr}))`
}

/**
 * Builds the `&&` conditions proving an object value is valid (same verdict as
 * the error-collecting validator), or `null` when any property or object-level
 * keyword can't be mirrored flat. `raw` yields the value (for the shape check);
 * `objAcc` is the same value narrowed to a record (for member access).
 */
const booleanObjectParts = (schema: JSONSchema, raw: string, objAcc: string, narrowable = true): string[] | null => {
  if (!isObjectSchema(schema)) return null
  // A `type: "object"` node can still carry a `$ref`, a `const`/`enum`, or an
  // `x-mjst` hint alongside its object keywords. None of them is in the parts
  // below, so mirroring only the object half would make the guard accept what
  // the validator rejects.
  if (hasRef(schema) || hasConst(schema) || hasEnum(schema)) return null
  if (getMjstInstanceOf(schema) !== undefined || getMjstPrimitive(schema) !== undefined) return null
  // These need per-key loops or cross-references the flat form can't express.
  if (hasDependentRequired(schema) || hasPropertyNames(schema) || 'dependentSchemas' in schema) return null
  if (hasMinProperties(schema) || hasMaxProperties(schema) || 'dependencies' in schema) return null
  if (isSchemaObject(schema) && 'patternProperties' in schema) return null
  // Object-level combinators change the verdict but can't be expressed flat, so
  // defer to the validator rather than emit a guard that ignores them.
  if (hasObjectLevelCombinator(schema)) return null
  if (carriesUnevaluated(schema)) return null

  let strict = false
  if (hasAdditionalProperties(schema)) {
    // Only `additionalProperties: false` is expressible; a schema needs per-key
    // validation, so defer to the validator.
    if (schema.additionalProperties === false) strict = true
    else return null
  }

  const required = new Set(hasRequired(schema) ? schema.required : [])
  const properties = hasProperties(schema) ? schema.properties : {}
  const keys = Object.keys(properties)

  // Drop the `!Array.isArray` term when a required, typeof-guarded property
  // already rejects arrays (an array's normal key is `undefined`, which no
  // `typeof` accepts) — the same sound optimisation the validator's hot guard
  // uses. Kept when no such property exists.
  const arrayCheck = arrayRejectedByRequiredProp(keys, required, properties) ? '' : ` && !Array.isArray(${raw})`
  const parts: string[] = [`typeof ${raw} === 'object' && ${raw} !== null${arrayCheck}`]

  for (const key of keys) {
    const propSchema = properties[key]
    if (propSchema === undefined || !isSchemaObject(propSchema)) return null
    // A prototype-member key reads through an own-property ternary, and this is a
    // pure *expression* — there is nowhere to bind it to a local, so a constrained
    // check would inline the un-narrowable ternary twice and fail to compile.
    // Defer the whole guard to `validateX`, which does bind it. Such a key is
    // pathological anyway, so losing the flat guard for it costs nothing real.
    if (PROTOTYPE_MEMBERS.has(key)) return null
    const member = safeAccessor(objAcc, key)
    const expr = booleanLeafExpr(propSchema, member, narrowable)
    if (expr === null) return null
    parts.push(required.has(key) ? expr : `(${member} === undefined || (${expr}))`)
  }

  // A `required` key with no `properties` entry has no type check to piggyback
  // on, but it still has to be *present* — the validator enforces exactly that,
  // with a bare presence test (see {@link generateMissingRequiredChecks}).
  // Leaving it out is the unsound direction: `isX({})` answered `true` for
  // `{ "type": "object", "required": ["a"] }` while `validateX({})` reported the
  // missing property. `hasOwnCheck` is the same expression the validator negates,
  // prototype-member names included, so the two cannot drift.
  for (const key of required) {
    if (Object.hasOwn(properties, key)) continue
    parts.push(hasOwnCheck(objAcc, key))
  }

  if (strict) {
    // `additionalProperties: false`: with every property required, an exact key
    // count proves no extras (the typeof checks above already proved presence);
    // otherwise sweep the keys against the declared set.
    if (keys.length === 0) {
      parts.push(`Object.keys(${objAcc}).length === 0`)
    } else if (keys.every((key) => required.has(key))) {
      parts.push(`Object.keys(${objAcc}).length === ${keys.length}`)
    } else {
      const known = keys.map((key) => `_k === ${JSON.stringify(key)}`).join(' || ')
      parts.push(`Object.keys(${objAcc}).every((_k) => ${known})`)
    }
  }

  return parts
}

/**
 * The keywords that describe an object without claiming the instance *is* one.
 * A schema carrying any of them but no `type` still emits a structured type,
 * because that is the only shape worth writing down — see
 * {@link typeDescribesEveryAcceptedValue} for what that costs the guard.
 */
const IMPLICIT_OBJECT_KEYWORDS = ['properties', 'patternProperties', 'additionalProperties'] as const

/**
 * True when every value `validateX` accepts is described by the emitted type — the
 * question that decides whether `isX` may be a type *predicate*.
 *
 * A `type`, an `enum`, or a `const` pins the instance to one JSON family, and the
 * emitted type says exactly that family, so the predicate is honest. A `$ref`
 * hands both the type and the verdict to the referenced schema, which answers the
 * question for itself.
 *
 * What is not honest is a schema like `{ properties: { a: { type: 'string' } } }`.
 * JSON Schema reads that as "*if* the instance is an object, its `a` is a string"
 * — `42` and `"x"` satisfy it — while the emitted type is `{ a: string }`. Both
 * halves are right on their own; together they make `input is Root` a lie, and a
 * lying predicate is worse than no predicate because it narrows silently at every
 * call site. So those schemas keep the same boolean check and drop the `is`, and a
 * caller who wants the object type asserts it deliberately.
 *
 * Widening the emitted type instead would be the better fix — it would keep the
 * narrowing *and* make it true — but that type comes from
 * `@amritk/helpers/generate-type-definition`, and `FromSchema`'s `ImplicitShape`
 * in `@amritk/runtime-validators` makes the same inference for the same schema, so
 * the two would have to move together.
 */
const typeDescribesEveryAcceptedValue = (schema: JSONSchema): boolean => {
  // A boolean schema has no shape to contradict: its type is `unknown`.
  if (!isSchemaObject(schema)) return true
  const s = schema as Record<string, unknown>
  if ('type' in s || 'enum' in s || 'const' in s || '$ref' in s) return true

  // The type of a combinator is built out of its branches, so it is as honest as
  // they are — a union of `{ type: 'string' }` and `{ type: 'number' }` describes
  // every value the validator accepts, while a branch carrying only `properties`
  // does not.
  for (const keyword of ['allOf', 'anyOf', 'oneOf'] as const) {
    const branches = s[keyword]
    if (!Array.isArray(branches)) continue
    if (!(branches as JSONSchema[]).every((branch) => typeDescribesEveryAcceptedValue(branch))) return false
  }

  return !IMPLICIT_OBJECT_KEYWORDS.some((keyword) => keyword in s)
}

/**
 * Generates the exported boolean guard `isTypeName`.
 *
 * Unlike `validateTypeName` (which returns rich `ValidationResult` errors), this
 * is a single flat boolean predicate — no error array, no cold-path call — so V8
 * inlines it like a hand-written `check`, matching the shape of TypeBox's
 * compiled checker. It returns the *same verdict* as the validator. When the
 * schema carries anything the flat form can't mirror exactly, it falls back to
 * `validateTypeName(input) === true`, which is always correct.
 *
 * The signature is `input is TypeName` whenever that narrowing is sound, and a
 * plain `boolean` when it is not — see {@link typeDescribesEveryAcceptedValue}.
 */
export const generateBooleanGuard = (schema: JSONSchema, typeName: string, _suffix = ''): string => {
  const name = guardName(typeName)
  const returns = typeDescribesEveryAcceptedValue(rewriteNullable(schema) as JSONSchema)
    ? `input is ${typeName}`
    : 'boolean'
  const fallback = `export const ${name} = (input: unknown): ${returns} => ${validatorName(typeName)}(input) === true`

  // Fold `nullable: true` into `anyOf` so the guard's verdict matches the
  // validator's (which applies the same rewrite). Without this a nullable node's
  // guard would reject `null` while the validator accepts it.
  const rewritten = rewriteNullable(schema) as JSONSchema

  // Only a schema that declares `type: "object"` gets the flat object guard. A
  // type-less schema carrying `properties` *ignores* non-objects — so does
  // `validateX` — and it can also carry keywords from other families alongside,
  // which the object parts do not model. Both would make the guard disagree with
  // the validator, and a guard that disagrees is worse than no guard, so those
  // fall back to calling `validateX`.
  if (declaresObjectType(rewritten) && objectRootIsSelfContained(rewritten)) {
    const parts = booleanObjectParts(rewritten, 'input', 'obj')
    if (parts === null) return fallback
    return [
      `export const ${name} = (input: unknown): ${returns} => {`,
      `  const obj = input as Record<string, unknown>`,
      `  return (`,
      parts.map((part) => `    ${part}`).join(' &&\n'),
      `  )`,
      `}`,
    ].join('\n')
  }

  // Non-object roots (scalar, enum, array) can often be expressed inline too.
  const expr = booleanLeafExpr(rewritten, 'input')
  if (expr === null) return fallback
  return `export const ${name} = (input: unknown): ${returns} => ${expr}`
}

/**
 * Generates a validator function for a non-object schema (primitive, array, enum, $ref).
 */
const generateScalarValidator = (
  schema: JSONSchema,
  typeName: string,
  suffix: string,
  rootSchema: Record<string, unknown> | undefined,
): string => {
  const vName = validatorName(typeName)

  // A boolean root. `false` is the schema no instance satisfies — it used to
  // share the `true` branch and accept everything, which is the one direction a
  // validator must never be wrong in. `true` really does accept everything.
  if (!isSchemaObject(schema)) {
    if (schema === false) {
      return [
        `export const ${vName} = (_input: unknown, _path = ''): ValidationResult => {`,
        `  return { valid: false, errors: [{ message: ${JSON.stringify(FALSE_SCHEMA_MESSAGE)}, path: _path }] }`,
        `}`,
      ].join('\n')
    }
    return [`export const ${vName} = (_input: unknown, _path = ''): ValidationResult => {`, `  return true`, `}`].join(
      '\n',
    )
  }

  // Each specialised root shape below owns exactly one keyword and has nowhere
  // to put a sibling, so a node that declares anything else goes to the general
  // emitter instead. That is the whole of the top-level half of the sibling bug:
  // `{ $ref: '#/$defs/s', minLength: 3 }` used to compile to a bare delegation
  // and accept `"q"`, contradicting this file's own note that a `$ref`'s
  // siblings still apply.
  const generalRoot = (): string => generateGeneralRootValidator(schema, typeName, suffix, rootSchema)

  // Top-level $ref — delegate entirely
  if (hasRef(schema)) {
    if (declaresKeywordOutside(schema, ['$ref'])) return generalRoot()
    const delegateName = validatorName(refToName(schema.$ref, suffix))
    return [
      `export const ${vName} = (input: unknown, _path = ''): ValidationResult => {`,
      `  return ${delegateName}(input, _path)`,
      `}`,
    ].join('\n')
  }

  // Top-level x-mjst instanceOf (e.g. a schema that is itself a Date). The hint
  // stands in for the `type`, so a `type` sibling is owned rather than dropped
  // — see {@link generateKeywordChecks}.
  const instanceOf = getMjstInstanceOf(schema)
  if (instanceOf) {
    if (declaresKeywordOutside(schema, [MJST_EXTENSION_KEY, 'type'])) return generalRoot()
    return [
      `export const ${vName} = (input: unknown, _path = ''): ValidationResult => {`,
      `  if (!(input instanceof ${instanceOf})) {`,
      `    return { valid: false, errors: [{ message: 'must be ${instanceOf}', path: _path }] }`,
      `  }`,
      `  return true`,
      `}`,
    ].join('\n')
  }

  // Top-level x-mjst primitive (e.g. a schema that is itself a bigint)
  const primitive = getMjstPrimitive(schema)
  if (primitive) {
    if (declaresKeywordOutside(schema, [MJST_EXTENSION_KEY, 'type'])) return generalRoot()
    return [
      `export const ${vName} = (input: unknown, _path = ''): ValidationResult => {`,
      `  if (typeof input !== "${primitive}") {`,
      `    return { valid: false, errors: [{ message: 'must be ${primitive}', path: _path }] }`,
      `  }`,
      `  return true`,
      `}`,
    ].join('\n')
  }

  // Top-level const
  if (hasConst(schema)) {
    if (declaresKeywordOutside(schema, ['const'])) return generalRoot()
    const mismatch = constMismatchCondition('input', schema.const)
    const msg = JSON.stringify(`must be ${JSON.stringify(schema.const)}`)
    return [
      `export const ${vName} = (input: unknown, _path = ''): ValidationResult => {`,
      `  if (${mismatch}) {`,
      `    return { valid: false, errors: [{ message: ${msg}, path: _path }] }`,
      `  }`,
      `  return true`,
      `}`,
    ].join('\n')
  }

  // Top-level enum
  if (hasEnum(schema)) {
    if (declaresKeywordOutside(schema, ['enum'])) return generalRoot()
    const label = (schema.enum as unknown[]).map((v) => JSON.stringify(v)).join(', ')
    return [
      `export const ${vName} = (input: unknown, _path = ''): ValidationResult => {`,
      `  if (!${enumMembershipExpr(schema.enum as unknown[], 'input')}) {`,
      `    return { valid: false, errors: [{ message: ${JSON.stringify(`must be one of: ${label}`)}, path: _path }] }`,
      `  }`,
      `  return true`,
      `}`,
    ].join('\n')
  }

  // oneOf — try each branch, return errors from all if none match
  // Top-level combinators (`allOf` / `anyOf` / `oneOf` / `not` / `if`), validated
  // against the input via the shared combinator generator — correct `oneOf`
  // (exactly one) and inline branches included, not just `$ref` branches.
  if (hasAllOf(schema) || hasAnyOf(schema) || hasOneOf(schema) || 'not' in schema || 'if' in schema) {
    const ctx = createRootContext(rootSchema)
    const checks: string[] = []
    // The root path expression the shared emitters use, as a template literal body.
    const rootPath = '`${_path}`'

    // A `type` (and its sibling value constraints) alongside a combinator still
    // applies — the value must satisfy BOTH. Emit the type/constraint checks first,
    // then the combinator checks, so a schema like `{ type: 'string', not: {…} }`
    // or `{ type: 'number', minimum: 10, allOf: [{ maximum: 100 }] }` no longer
    // drops the `type` check and its siblings.
    const rootTypeArray = getTypeArray(schema)
    if (rootTypeArray) {
      const allWrong = rootTypeArray
        .map((t) => wrongTypeCondition('input', t))
        .filter((c) => c !== '')
        .map((c) => `(${c})`)
        .join(' && ')
      if (allWrong) {
        const label = rootTypeArray.map((t) => typeofString(t)).join(' or ')
        checks.push(`  if (${allWrong}) {`)
        checks.push(`    errors.push({ message: ${JSON.stringify(`must be ${label}`)}, path: ${rootPath} })`)
        checks.push(`  }`)
      }
    } else if (hasType(schema)) {
      const t = schema.type as string
      const wrongType = wrongTypeCondition('input', t)
      if (wrongType) {
        checks.push(`  if (${wrongType}) {`)
        checks.push(`    errors.push({ message: 'must be ${typeofString(t)}', path: ${rootPath} })`)
        checks.push(`  }`)
      }
    }

    // Constraint checks run whether or not a `type` was declared — they gate on
    // keyword presence and carry their own runtime-type guards. Running them only
    // under a declared `type` is what let
    // `{ allOf: [{ prefixItems: [...] }], items: {...} }` drop its `items`
    // entirely: the schema has a combinator and no `type`, so nothing outside the
    // `allOf` was ever emitted.
    checks.push(...generateConstraintChecks('', 'input', rootPath, schema, suffix, ctx))
    checks.push(...generateCombinatorChecks('', 'input', rootPath, schema, suffix, ctx))
    const body = checks.join('\n').replaceAll('errors.push(', '(errors ??= []).push(')
    const hoistedBlock = ctx.hoisted.length > 0 ? `${ctx.hoisted.join('\n')}\n\n` : ''
    return [
      `${hoistedBlock}export const ${vName} = (input: unknown, _path = ''): ValidationResult => {`,
      `  let errors: ValidationError[] | undefined`,
      body,
      `  return errors !== undefined ? { valid: false, errors } : true`,
      `}`,
    ].join('\n')
  }

  // Top-level multi-type / nullable schema (array `type`, e.g. `["string","null"]`).
  // `hasType` is false for an array `type`, so without this a root multi-type
  // schema falls through to the final `return true` and validates NOTHING. The
  // value is valid when it matches any listed type.
  const rootTypeArray = getTypeArray(schema)
  if (rootTypeArray) {
    const ctx = createRootContext(rootSchema)
    const rootPath = '`${_path}`'
    const checks: string[] = []

    const allWrong = rootTypeArray
      .map((t) => wrongTypeCondition('input', t))
      .filter((c) => c !== '')
      .map((c) => `(${c})`)
      .join(' && ')
    if (allWrong) {
      const label = rootTypeArray.map((t) => typeofString(t)).join(' or ')
      checks.push(`  if (${allWrong}) {`)
      checks.push(`    errors.push({ message: ${JSON.stringify(`must be ${label}`)}, path: ${rootPath} })`)
      checks.push(`  }`)
    }

    // The sibling constraints apply too. Emitting only the type check is what let
    // `{ type: ['object', 'boolean'], properties: {…} }` — the shape the 2020-12
    // metaschema's own root is written in — accept every object going, because a
    // union `type` sent the schema down this path instead of the object one. The
    // shared emitters carry their own runtime-type guards, so a member of the
    // union the constraint does not apply to (a boolean, here) still passes.
    checks.push(...generateConstraintChecks('', 'input', rootPath, schema, suffix, ctx))

    if (checks.length === 0) {
      return [
        `export const ${vName} = (_input: unknown, _path = ''): ValidationResult => {`,
        `  return true`,
        `}`,
      ].join('\n')
    }

    const body = checks.join('\n').replaceAll('errors.push(', '(errors ??= []).push(')
    const hoistedBlock = ctx.hoisted.length > 0 ? `${ctx.hoisted.join('\n')}\n\n` : ''
    return [
      `${hoistedBlock}export const ${vName} = (input: unknown, _path = ''): ValidationResult => {`,
      `  let errors: ValidationError[] | undefined`,
      body,
      `  return errors !== undefined ? { valid: false, errors } : true`,
      `}`,
    ].join('\n')
  }

  // Top-level typed schema (string, number, boolean, array)
  if (hasType(schema)) {
    const t = schema.type as string
    const wrongType = wrongTypeCondition('input', t)
    const typLabel = typeofString(t)

    // Reuse the shared constraint emitter — the per-property path already handles
    // string (pattern, min/maxLength), number/integer (bounds, multipleOf) and
    // array (items, min/maxItems, uniqueItems, contains, prefixItems). The root
    // path previously only built string constraints, so a `{type:'number',
    // minimum:5}` or `{type:'array', minItems:2}` root accepted invalid input.
    // `raw` is `input`; `path` is the root `_path` (as a template so the shared
    // emitter's `path.slice(1,-1)` for array-item indices still works).
    const rootCtx = createRootContext(rootSchema)
    const constraintLines = generateConstraintChecks('', 'input', '`${_path}`', schema, suffix, rootCtx)

    if (!wrongType) {
      return [
        `export const ${vName} = (_input: unknown, _path = ''): ValidationResult => {`,
        `  return true`,
        `}`,
      ].join('\n')
    }

    if (constraintLines.length === 0) {
      return [
        `export const ${vName} = (input: unknown, _path = ''): ValidationResult => {`,
        `  if (${wrongType}) {`,
        `    return { valid: false, errors: [{ message: 'must be ${typLabel}', path: _path }] }`,
        `  }`,
        `  return true`,
        `}`,
      ].join('\n')
    }

    // Array-item / nested constraints can hoist module-level declarations (e.g. a
    // compiled known-keys set); emit them before the function so it references them.
    const hoistedBlock = rootCtx.hoisted.length > 0 ? `${rootCtx.hoisted.join('\n')}\n\n` : ''
    return [
      `${hoistedBlock}export const ${vName} = (input: unknown, _path = ''): ValidationResult => {`,
      `  if (${wrongType}) {`,
      `    return { valid: false, errors: [{ message: 'must be ${typLabel}', path: _path }] }`,
      `  }`,
      `  let errors: ValidationError[] | undefined`,
      constraintLines.join('\n').replaceAll('errors.push(', '(errors ??= []).push('),
      `  return errors !== undefined ? { valid: false, errors } : true`,
      `}`,
    ].join('\n')
  }

  // A schema with no `type` at all. It still constrains things: in JSON Schema a
  // keyword applies to the instances of *its own family* and ignores every other
  // one, so `{ minLength: 2 }` rejects `"a"` while accepting `42`, `[]` and
  // `null`. The generator used to hang every check off the declared `type` and so
  // emitted `validateRoot = () => true` here — the quietest way to be wrong, and
  // the single biggest gap in its conformance. The shared constraint emitter
  // already gates on keyword presence and guards each check with a runtime type
  // test (`typeof x === 'string'`, `Array.isArray(x)`, the object block's own
  // shape check), which is exactly the semantics needed, so hand it the whole
  // schema and let it decide what applies.
  const typelessCtx = createRootContext(rootSchema)
  const typelessChecks = generateConstraintChecks('', 'input', '`${_path}`', schema, suffix, typelessCtx)
  if (typelessChecks.length === 0) {
    return [`export const ${vName} = (_input: unknown, _path = ''): ValidationResult => {`, `  return true`, `}`].join(
      '\n',
    )
  }

  const typelessHoisted = typelessCtx.hoisted.length > 0 ? `${typelessCtx.hoisted.join('\n')}\n\n` : ''
  return [
    `${typelessHoisted}export const ${vName} = (input: unknown, _path = ''): ValidationResult => {`,
    `  let errors: ValidationError[] | undefined`,
    typelessChecks.join('\n').replaceAll('errors.push(', '(errors ??= []).push('),
    `  return errors !== undefined ? { valid: false, errors } : true`,
    `}`,
  ].join('\n')
}

/**
 * The general-case root validator: every keyword the root declares, composed.
 *
 * The specialised root emitters each own one shape — a `$ref`, a `const`, a
 * `type`, a combinator — and return early, so none of them is the right place to
 * hang a sibling keyword that applies to all of them. {@link generateValueChecks}
 * already validates an arbitrary schema against an arbitrary accessor, which is
 * exactly the general case, so a root too rich for any specialised shape is
 * emitted through it. The only cost is the object fast path, which such a schema
 * would mostly not have qualified for anyway.
 *
 * A root carrying `unevaluatedProperties` / `unevaluatedItems` always lands here,
 * since a coverage sweep is a sibling of whatever else the node says.
 */
const generateGeneralRootValidator = (
  schema: JSONSchema,
  typeName: string,
  suffix: string,
  rootSchema: Record<string, unknown> | undefined,
): string => {
  const ctx = createRootContext(rootSchema)
  const checks = generateValueChecks('', 'input', '`${_path}`', schema, suffix, ctx, true)
  const body = checks.join('\n').replaceAll('errors.push(', '(errors ??= []).push(')
  const hoistedBlock = ctx.hoisted.length > 0 ? `${ctx.hoisted.join('\n')}\n\n` : ''
  return [
    `${hoistedBlock}export const ${validatorName(typeName)} = (input: unknown, _path = ''): ValidationResult => {`,
    `  let errors: ValidationError[] | undefined`,
    body,
    `  return errors !== undefined ? { valid: false, errors } : true`,
    `}`,
  ].join('\n')
}

/** Keywords whose value is a single subschema (or a boolean schema). */
const SINGLE_SUBSCHEMA_KEYS = new Set([
  'additionalProperties',
  'additionalItems',
  'contains',
  'propertyNames',
  'not',
  'if',
  'then',
  'else',
  'unevaluatedProperties',
  'unevaluatedItems',
])
/** Keywords whose value is an array of subschemas. */
const SUBSCHEMA_LIST_KEYS = new Set(['allOf', 'anyOf', 'oneOf', 'prefixItems'])
/** Keywords whose value is a map of names to subschemas. */
const SUBSCHEMA_MAP_KEYS = new Set(['properties', 'patternProperties', 'dependentSchemas', '$defs', 'definitions'])

/**
 * Copies one entry onto a plain record, even when the key is `__proto__`.
 *
 * A plain `record['__proto__'] = value` invokes `Object.prototype`'s `__proto__`
 * setter instead of creating a property, so the entry silently disappears from
 * the copy. {@link rewriteNullable} runs over *every* schema (not only nullable
 * ones), which is how a schema declaring `properties: { "__proto__": {...} }`
 * used to reach the emitters with that property already gone — the generated
 * validator carried no checks for it at all, a straight validation bypass, and
 * `required: ["__proto__"]` degraded to a bare presence check. Defining the
 * property is the same fix `@amritk/helpers/validate-record` applies on the
 * runtime side.
 */
const defineEntry = (target: Record<string, unknown>, key: string, value: unknown): void => {
  if (key === '__proto__') {
    Object.defineProperty(target, key, { value, writable: true, enumerable: true, configurable: true })
    return
  }
  target[key] = value
}

/**
 * Rewrites OpenAPI 3.0 `nullable: true` into a form the generator already
 * enforces. A node `{ nullable: true, ...rest }` accepts a value iff the value is
 * `null` OR it matches `rest` — exactly `{ anyOf: [{ type: 'null' }, rest] }`.
 * Emitting that lets the existing `anyOf` machinery (and its guard bail-outs)
 * mirror the interpreter, which short-circuits every keyword when a `nullable`
 * node sees `null`.
 *
 * The walk descends only into genuine subschema positions (never into `enum` /
 * `const` / `default` data), so a data value that merely looks like a schema is
 * never rewritten. Returns a fresh tree; the caller's schema is untouched.
 */
const rewriteNullable = (node: unknown): unknown => {
  if (typeof node !== 'object' || node === null || Array.isArray(node)) return node
  const src = node as Record<string, unknown>

  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(src)) {
    if (key === 'nullable') continue // folded into the `anyOf` wrapper below
    if (SINGLE_SUBSCHEMA_KEYS.has(key)) {
      defineEntry(out, key, rewriteNullable(value))
    } else if (key === 'items') {
      // `items` is either a single subschema (2020-12) or a tuple array (draft).
      defineEntry(out, key, Array.isArray(value) ? value.map(rewriteNullable) : rewriteNullable(value))
    } else if (SUBSCHEMA_LIST_KEYS.has(key) && Array.isArray(value)) {
      defineEntry(out, key, value.map(rewriteNullable))
    } else if (SUBSCHEMA_MAP_KEYS.has(key) && typeof value === 'object' && value !== null) {
      const mapped: Record<string, unknown> = {}
      for (const [name, sub] of Object.entries(value as Record<string, unknown>)) {
        defineEntry(mapped, name, rewriteNullable(sub))
      }
      defineEntry(out, key, mapped)
    } else if (key === 'dependencies' && typeof value === 'object' && value !== null) {
      // Dual-form: an array value lists required keys (data), a schema value is a
      // subschema.
      const mapped: Record<string, unknown> = {}
      for (const [name, sub] of Object.entries(value as Record<string, unknown>)) {
        defineEntry(mapped, name, Array.isArray(sub) ? sub : rewriteNullable(sub))
      }
      defineEntry(out, key, mapped)
    } else {
      defineEntry(out, key, value)
    }
  }

  if (src['nullable'] === true) return { anyOf: [{ type: 'null' }, out] }
  return out
}

/**
 * Generates a TypeScript validator function from a JSON Schema.
 *
 * The generated function accepts `unknown` input and returns `true` if valid,
 * or `{ valid: false, errors }` with a list of errors if not.
 *
 * Object schemas check that required properties are present and that all
 * provided properties match their declared types. Non-object schemas (strings,
 * numbers, enums, $refs) emit an inline type check.
 *
 * @example
 * ```typescript
 * generateValidatorFunction({ type: 'object', properties: { name: { type: 'string' } }, required: ['name'] }, 'Info')
 * // export const validateInfo = (input: unknown, _path = ''): ValidationResult => {
 * //   if (typeof input !== 'object' || ...) return { valid: false, ... }
 * //   const errors: ValidationError[] = []
 * //   const obj = input as Record<string, unknown>
 * //   if (!('name' in obj)) { errors.push(...) } else if (typeof obj['name'] !== 'string') { errors.push(...) }
 * //   return errors.length > 0 ? { valid: false, errors } : true
 * // }
 * ```
 */
export const generateValidatorFunction = (
  schema: JSONSchema,
  typeName: string,
  suffix = '',
  rootSchema?: Record<string, unknown>,
): string => {
  assertGeneratableRefs(schema, typeName)

  // Fold OpenAPI `nullable: true` into the `anyOf` form the generator already
  // enforces, so the emitted checks match the interpreter's null short-circuit.
  const rewritten = rewriteNullable(schema) as JSONSchema

  // A node's own `$defs` are the document its `$ref`s resolve against when the
  // caller did not say otherwise — which is the case for a root schema generated
  // on its own, as every test and every single-file consumer does.
  const document = rootSchema ?? (schema as Record<string, unknown>)
  assertUnevaluatedGeneratable(rewritten, typeName, document, unevaluatedMatcher(suffix, createRootContext(document)))

  if (carriesUnevaluated(rewritten)) {
    return generateGeneralRootValidator(rewritten, typeName, suffix, document)
  }

  // The object emitter walks `properties` and friends and knows nothing about a
  // `$ref`, a `const`/`enum`, or an `x-mjst` hint the same node may declare, so a
  // `type: "object"` root carrying one of those goes down the scalar path — where
  // {@link declaresKeywordOutside} routes it on to the general emitter and every
  // keyword composes.
  if (declaresObjectType(rewritten) && objectRootIsSelfContained(rewritten)) {
    return generateObjectValidator(rewritten, typeName, suffix, document)
  }

  return generateScalarValidator(rewritten, typeName, suffix, document)
}
