import type { JSONSchema } from 'json-schema-typed/draft-2020-12'

import { assignKey } from './assign-key'
import { assertSchemaDepth, MAX_SCHEMA_DEPTH } from './max-schema-depth'
import { getMjstBrand, getMjstInstanceOf, getMjstPrimitive, hasMjstHint, MJST_EXTENSION_KEY } from './mjst-extension'
import { readKey } from './read-key'
import { refToName } from './ref-to-name'
import { referencedConditional } from './referenced-conditional'
import { resolveRef } from './resolve-ref'
import { safeKey } from './safe-accessor'
import { isObjectSchema, isSchemaObject } from './schema-guards'

/**
 * Any schema that is not a boolean shorthand. Broader than `JSONSchema.Object`,
 * which narrows `type` to `'object'` and so hides array keywords like `items`.
 */
type SchemaNode = Exclude<JSONSchema, boolean>

/**
 * One keyword read off a schema node — own properties only, and `undefined` for
 * anything the node does not itself declare.
 *
 * A plain `schema.items` walks the prototype chain, and these schemas come from
 * the caller: with `Object.prototype.additionalProperties` set by any
 * dependency, a bare `{ type: 'string' }` generated `{ [key: string]: number }`,
 * and an inherited `if`/`then` pair sent the renderer recursing until the stack
 * ran out. `schema-guards` asks this question correctly for the guards it
 * exports; this is the same question for the reads in between, which is most of
 * this file.
 */
const keywordOf = (schema: SchemaNode, name: string): unknown => readKey(schema as Record<string, unknown>, name)

/**
 * One keyword whose value is meant to be a map of names to schemas
 * (`properties`, `patternProperties`), or `undefined` when the node declares
 * something else there.
 *
 * The `undefined` check a caller reaches for first is not enough on its own:
 * `typeof null === 'object'`, so a document with `{"patternProperties": null}`
 * walked straight into `Object.keys(null)` and took the whole generation run
 * down with a `TypeError`. Schemas come from the caller and malformed ones are
 * ordinary input, so a keyword that is not a map is treated as absent rather
 * than as a crash.
 */
const keywordMap = (schema: SchemaNode, name: string): Record<string, JSONSchema> | undefined => {
  const value = keywordOf(schema, name)
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  return value as Record<string, JSONSchema>
}

/**
 * How deep a schema may nest before rendering gives up.
 *
 * Lower than {@link MAX_SCHEMA_DEPTH} because rendering one level costs about
 * five stack frames — type → unbranded → local shape → single type → object
 * body → type again — where the document walkers cost one. At the shared cap the
 * stack ran out first, at around 900 levels, so the cap never fired and the bare
 * `RangeError` it exists to replace came back. A fifth of the shared budget puts
 * this pass's frame count where the walkers' sits, and is still two orders of
 * magnitude past anything a real schema nests.
 */
const MAX_TYPE_DEPTH = Math.floor(MAX_SCHEMA_DEPTH / 5)

/** True when the node itself declares `name`, inherited values excluded. */
const declares = (schema: SchemaNode, name: string): boolean => Object.hasOwn(schema as Record<string, unknown>, name)

/**
 * Keywords that hand a node's type to another schema: whatever they resolve to
 * is the answer, so nothing local should be guessed alongside them.
 */
const COMPOSITION_KEYWORDS = ['$ref', '$dynamicRef', 'allOf', 'anyOf', 'oneOf', 'if', 'not'] as const

/** True when a node delegates its type to a composed schema (see {@link COMPOSITION_KEYWORDS}). */
const composes = (schema: SchemaNode): boolean => COMPOSITION_KEYWORDS.some((keyword) => declares(schema, keyword))

/** Options controlling generated type output. */
export type TypeOptions = {
  /** When true, every property, array, and record in the generated types is emitted as readonly. */
  readonly readonly?: boolean
  /**
   * Suffix appended to every generated type name derived from a `$ref`.
   * Defaults to `''` (no suffix). Set to e.g. `'Object'` to emit `ContactObject`.
   */
  readonly typeSuffix?: string
  /**
   * The root document, used to decide whether a URI `$ref` names a type the
   * generator also emits a file for. Without it such refs stay `unknown` — the
   * conservative reading, since an unresolvable ref has no generated file to
   * name. Pass it whenever the caller also emits imports for those refs, so the
   * type and the import agree.
   */
  readonly rootSchema?: Record<string, unknown>
  /**
   * Conditional definitions this render is already inlining, so a cycle through
   * one terminates. Internal: callers never set it, `allOfMember` grows it as it
   * descends.
   */
  readonly inliningRefs?: ReadonlySet<string>
}

/**
 * The type name for a `$ref`, or `unknown` when no file is generated for it.
 *
 * Internal refs always name a generated type. A URI ref does too — but only
 * when it resolves inside the root document, which is precisely the rule
 * `collectImports` uses to decide whether to import it. Keeping the two in step
 * is what stops a file from importing `Channel` while typing the property that
 * uses it as `unknown`.
 */
const refTypeName = (ref: string, options: TypeOptions): string => {
  if (ref.startsWith('#')) return refToName(ref, options.typeSuffix)
  if (ref.includes('#/properties/')) return 'unknown'
  if (options.rootSchema && resolveRef(ref, options.rootSchema)) return refToName(ref, options.typeSuffix)
  return 'unknown'
}

/**
 * Keywords that give a schema fragment a shape of its own beyond a property
 * block. A fragment declaring none of them is "plain": `properties`, `required`
 * and annotations only, which is how nearly every `if`/`then` pair is written
 * and the one form two fragments can be folded into a single object literal.
 */
const NON_PLAIN_KEYWORDS: ReadonlySet<string> = new Set([
  '$ref',
  '$dynamicRef',
  'allOf',
  'anyOf',
  'oneOf',
  'not',
  'if',
  'then',
  'else',
  'additionalProperties',
  'patternProperties',
  'items',
  'prefixItems',
  'const',
  'enum',
  'nullable',
  'x-mjst',
])

/**
 * True for a fragment made of `properties` and `required` alone (see
 * {@link NON_PLAIN_KEYWORDS}). An `x-mjst` counts only when it carries a
 * generator hint: one holding nothing but docs settings shapes no type.
 */
const isPlainFragment = (schema: JSONSchema): schema is SchemaNode => {
  if (!isSchemaObject(schema)) return false
  const type = keywordOf(schema, 'type')
  if (type !== undefined && type !== 'object') return false
  return !Object.keys(schema).some(
    (key) => NON_PLAIN_KEYWORDS.has(key) && (key !== MJST_EXTENSION_KEY || hasMjstHint(schema)),
  )
}

/** The `required` list a fragment declares, or nothing when it declares none. */
const requiredOf = (schema: SchemaNode): readonly string[] => {
  const declared = keywordOf(schema, 'required')
  return Array.isArray(declared) ? declared.filter((key): key is string => typeof key === 'string') : []
}

/** The description (or `$comment` fallback) to emit as JSDoc above a property. */
const propertyDescription = (propSchema: JSONSchema): string | undefined => {
  if (!isSchemaObject(propSchema)) return undefined
  const description = keywordOf(propSchema, 'description')
  if (typeof description === 'string') return description
  const comment = keywordOf(propSchema, '$comment')
  if (typeof comment === 'string') return comment
  return undefined
}

/**
 * Two things a schema says about the same key, folded into one property.
 *
 * Both are kept — each may constrain the value differently — but the `allOf`
 * node holding them says nothing itself, and the JSDoc above a property is read
 * off the node this returns. So the merge carries a description forward, taking
 * the more specific fragment's first. Without that, folding two fragments
 * silently deleted the docs the schema wrote: a required property inside an
 * `anyOf` branch is seeded with `true` before the branch's own `properties` are
 * merged in, so every one of them arrived here as a pair and came out
 * undocumented, while the optional properties beside it kept their comments.
 */
const intersectProperties = (existing: JSONSchema | undefined, sub: JSONSchema): JSONSchema => {
  // `true` admits every value, so intersecting it only hides what the other
  // fragment says — including its annotations.
  if (existing === undefined || existing === true) return sub
  if (sub === true) return existing
  const description = propertyDescription(sub) ?? propertyDescription(existing)
  return description === undefined ? { allOf: [existing, sub] } : { allOf: [existing, sub], description }
}

/**
 * Every value a schema admits, when that set is finite and spelled out —
 * a `const`, an `enum`, or a `boolean`/`null` type (with the nullable idioms
 * adding `null`). Undefined for anything open-ended, such as a string.
 *
 * This is what makes the *negation* of a condition expressible: "`a` is not
 * `true`" can only be written as a type when the values `a` may hold are known.
 */
const literalDomain = (schema: JSONSchema | undefined): readonly unknown[] | undefined => {
  if (schema === undefined || !isSchemaObject(schema)) return undefined
  if (declares(schema, 'const')) return [keywordOf(schema, 'const')]
  const enumValues = keywordOf(schema, 'enum')
  if (Array.isArray(enumValues)) return enumValues
  const type = keywordOf(schema, 'type')
  const members = Array.isArray(type) ? type : [type]
  const values: unknown[] = []
  for (const member of members) {
    if (member === 'boolean') values.push(true, false)
    else if (member === 'null') values.push(null)
    else return undefined
  }
  if (isNullableSchema(schema)) values.push(null)
  return values
}

/** Literal equality the way `enum` and `const` define it: by JSON value. */
const sameLiteral = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b)

/**
 * The ways an instance can *fail* an `if` test, each as a type, or undefined
 * when TypeScript cannot spell them. An empty list is a test nothing can fail.
 *
 * A plain test fails when some tested property holds a value the test rejects,
 * or some property the test requires is absent — one member per way of
 * failing. A rejected value can only be named against the finite `domain` of
 * values the enclosing schema lets the property hold: with `a: { type: 'boolean'
 * }` declared, failing `a: { const: true }` is `{ a?: false }` (absent, or
 * false). Against an open-ended property there is no such type, and the answer
 * is honestly "cannot say", which the caller turns into dropping the conditional
 * rather than guessing.
 */
const negateCondition = (
  condition: SchemaNode,
  domain: Record<string, JSONSchema> | undefined,
  options: TypeOptions,
): readonly string[] | undefined => {
  if (!isPlainFragment(condition)) return undefined
  const tested = keywordMap(condition, 'properties') ?? {}
  const required = new Set(requiredOf(condition))
  const readonlyPrefix = options.readonly ? 'readonly ' : ''
  const absent = (key: string): string => `{ ${readonlyPrefix}${safeKey(key)}?: never }`

  const failures: string[] = []
  for (const key of Object.keys(tested)) {
    const test = readKey(tested, key) as JSONSchema
    // A test that admits every value cannot fail on its own; only its absence
    // can, and only when the condition also requires the key.
    const accepted = literalDomain(test)
    if (accepted === undefined) {
      const vacuous = test === true || (isSchemaObject(test) && Object.keys(test).length === 0)
      if (!vacuous) return undefined
      if (required.has(key)) failures.push(absent(key))
      continue
    }
    const possible = domain === undefined ? undefined : literalDomain(readKey(domain, key) as JSONSchema | undefined)
    if (possible === undefined) return undefined
    const rejected = possible.filter((value) => !accepted.some((match) => sameLiteral(value, match)))
    if (rejected.length === 0) {
      if (required.has(key)) failures.push(absent(key))
      continue
    }
    const literal = unionOf(rejected.map((value) => JSON.stringify(value)))
    failures.push(`{ ${readonlyPrefix}${safeKey(key)}${required.has(key) ? '?' : ''}: ${literal} }`)
  }
  for (const key of required) {
    if (!Object.hasOwn(tested, key)) failures.push(absent(key))
  }
  return failures
}

/**
 * Renders the type of an instance that satisfies every fragment given: the
 * `if` and `then` of a conditional read together, or its `else` alone.
 *
 * Plain fragments fold into one object literal — `{ type: "http"; scheme: string
 * }` rather than `{ type: "http" } & { scheme: string }` — with a key both
 * declare intersected, and a key only `required` names present with any value.
 * Only the keys a fragment's `required` lists are required: `if.properties`
 * is a test, not a requirement, and the `then` keys were required only where
 * `then` says so. Anything else (a `$ref`, a composition) is rendered on its own
 * and intersected.
 */
const branchOf = (fragments: readonly JSONSchema[], options: TypeOptions, depth: number): string => {
  const members: string[] = []
  const properties: Record<string, JSONSchema> = {}
  const required = new Set<string>()
  for (const fragment of fragments) {
    if (!isPlainFragment(fragment)) {
      members.push(wrapUnion(getTypeScriptType(fragment, options, depth + 1)))
      continue
    }
    const declared = keywordMap(fragment, 'properties') ?? {}
    for (const key of Object.keys(declared)) {
      const sub = readKey(declared, key) as JSONSchema
      const existing = readKey(properties, key) as JSONSchema | undefined
      assignKey(properties, key, intersectProperties(existing, sub))
    }
    for (const key of requiredOf(fragment)) required.add(key)
  }
  for (const key of required) {
    if (!Object.hasOwn(properties, key)) assignKey(properties, key, true)
  }
  if (Object.keys(properties).length > 0) {
    const merged: JSONSchema = { type: 'object', properties, required: [...required] }
    members.unshift(objectTypeToTs(merged, options, depth))
  }
  return wrapIntersection(intersectionOf(members))
}

/**
 * The type an `if`/`then`/`else` conditional contributes to the schema carrying
 * it, or undefined when it can soundly contribute nothing.
 *
 * An instance either passes the test — and must satisfy `then` — or fails it
 * and must satisfy `else`; the conditional is the union of the two: `(if ∧ then)
 * | (¬if ∧ else)`. The first member is always writable. The second needs either
 * an `else` or a negation {@link negateCondition} can spell; with neither, the
 * failing instances are unconstrained, the union is `unknown`, and the honest
 * rendering is to leave the conditional out. That is lossy but sound. The old
 * rendering folded `if` and `then` into the type as required properties, which
 * rejected every instance the test did not match — `{}` failed to type-check
 * against a schema that accepts it.
 *
 * `domain` is the property block the negation reads value sets from: the
 * schema's own `properties`, or the composing schema's when the conditional is
 * an inline `allOf` member.
 */
const conditionalMember = (
  schema: SchemaNode,
  domain: Record<string, JSONSchema> | undefined,
  options: TypeOptions,
  depth: number,
): string | undefined => {
  if (!declares(schema, 'if')) return undefined
  const condition = keywordOf(schema, 'if') as JSONSchema
  const thenSchema = declares(schema, 'then') ? (keywordOf(schema, 'then') as JSONSchema) : undefined
  const elseSchema = declares(schema, 'else') ? (keywordOf(schema, 'else') as JSONSchema) : undefined
  // An `if` with no branch asserts nothing.
  if (thenSchema === undefined && elseSchema === undefined) return undefined

  const branch = (sub: JSONSchema | undefined): string =>
    sub === undefined ? 'unknown' : branchOf([sub], options, depth)
  // The boolean tests are decided: `true` always takes `then`, `false` `else`.
  if (condition === true) return thenSchema === undefined ? undefined : branch(thenSchema)
  if (condition === false) return elseSchema === undefined ? undefined : branch(elseSchema)
  if (!isSchemaObject(condition)) return undefined

  const matched = branchOf(thenSchema === undefined ? [condition] : [condition, thenSchema], options, depth)
  const failures = negateCondition(condition, domain, options)
  // Nothing can fail a test that tests nothing: the conditional is its `then`.
  if (failures !== undefined && failures.length === 0) return matched === 'unknown' ? undefined : matched
  const elseType = branch(elseSchema)
  // Bracketed by how many ways there are to fail, not by the text: a single
  // failure can carry a union of its own (`{ a?: false | null }`) and needs none.
  const negated = failures === undefined ? undefined : unionOf(failures)
  const bracketed = failures !== undefined && failures.length > 1 ? `(${negated})` : negated
  const unmatched =
    elseType === 'unknown'
      ? (negated ?? 'unknown')
      : bracketed === undefined
        ? elseType
        : `(${bracketed} & ${elseType})`
  if (unmatched === 'unknown' || matched === 'unknown') return undefined
  return unionOf([matched, unmatched])
}

/** The schema with its conditional keywords removed, for rendering the rest of it. */
const withoutConditional = (schema: SchemaNode): SchemaNode => {
  const rest: Record<string, unknown> = {}
  for (const key of Object.keys(schema)) {
    if (key !== 'if' && key !== 'then' && key !== 'else')
      assignKey(rest, key, readKey(schema as Record<string, unknown>, key))
  }
  return rest as SchemaNode
}

/**
 * {@link referencedConditional}, bound to the root document these options carry.
 * Shared with the import collectors, which have to import exactly the names this
 * inlining puts in the file.
 */
const referencedConditionalOf = (entry: SchemaNode, options: TypeOptions): SchemaNode | undefined =>
  referencedConditional(entry, options.rootSchema) as SchemaNode | undefined

/**
 * Renders one `allOf` member against the schema composing it.
 *
 * A member that is itself a conditional — inline, or a `$ref` to one — tests
 * the composing schema's properties: `allOf: [{ if: { a: true }, then: { b:
 * true } }]` next to `properties: { a, b }` is the usual way "`b` requires `a`"
 * is written. So its negation is spelled against that schema's property block,
 * where the value sets live; rendered on its own it would see no domain at all
 * and drop. A referenced conditional keeps its type name in the intersection
 * too, so the emitted import stays used and whatever else the definition
 * declares still applies.
 */
const allOfMember = (
  entry: JSONSchema,
  domain: Record<string, JSONSchema> | undefined,
  options: TypeOptions,
  depth: number,
): string => {
  // A definition already being inlined further up is not inlined again: OpenAPI's
  // security scheme composes conditionals that never cycle, but a conditional
  // whose own `then` composes it does, and the render recursed until the depth
  // cap refused the whole document. Naming the type instead is less precise and
  // terminates — the same answer this reaches for any member it cannot read.
  const ref = isSchemaObject(entry) ? keywordOf(entry, '$ref') : undefined
  const inlining = typeof ref === 'string' && options.inliningRefs?.has(ref) === true
  const source =
    isSchemaObject(entry) && !inlining
      ? declares(entry, 'if')
        ? entry
        : referencedConditionalOf(entry, options)
      : undefined
  if (source === undefined) return wrapUnion(getTypeScriptType(entry, options, depth + 1))
  const inner: TypeOptions =
    typeof ref === 'string' ? { ...options, inliningRefs: new Set([...(options.inliningRefs ?? []), ref]) } : options
  const own = keywordMap(source, 'properties')
  const merged: Record<string, JSONSchema> = {}
  for (const block of [domain, own]) {
    if (block === undefined) continue
    for (const key of Object.keys(block)) assignKey(merged, key, readKey(block, key))
  }
  const conditional = conditionalMember(source, merged, inner, depth + 1)
  const rest = source === entry ? withoutConditional(entry) : entry
  const remainder = wrapUnion(getTypeScriptType(rest, inner, depth + 1))
  // Each member is already parenthesized where it is a union, so the result is
  // safe as one factor of the composing intersection as it stands.
  return intersectionOf([remainder, ...(conditional === undefined ? [] : [wrapUnion(conditional)])])
}

const isObjectLikeSchema = (schema: JSONSchema): schema is JSONSchema.Object => {
  if (!isSchemaObject(schema)) {
    return false
  }

  if (isObjectSchema(schema)) {
    return true
  }

  return (
    declares(schema, 'patternProperties') ||
    declares(schema, 'additionalProperties') ||
    (declares(schema, 'if') && declares(schema, 'then'))
  )
}

const getBooleanSubSchemaType = (schema: boolean): string => {
  return schema ? 'unknown' : 'never'
}

/**
 * Neutralizes comment terminators inside schema-authored prose. A description
 * holding a star-slash pair — a glob like `**\/*.ts`, a C-style code sample —
 * would close the JSDoc block early and leave the rest of the generated file
 * unparseable. Escaping the slash is the conventional fix: editors and TypeDoc
 * still render the original text, but the comment can no longer end there.
 */
const escapeCommentText = (text: string): string => text.replace(/\*\//g, '*\\/')

/**
 * Renders a possibly multi-line description as JSDoc body lines, prefixing each
 * line with `${indent}* `. Blank lines become a bare `${indent}*` so we never
 * emit trailing whitespace. Without this, embedded newlines would leave
 * continuation lines unprefixed and break the comment block.
 */
const renderJsDocBody = (description: string, indent: string): string =>
  escapeCommentText(description)
    .split('\n')
    .map((line) => (line.length > 0 ? `${indent}* ${line}\n` : `${indent}*\n`))
    .join('')

const buildJsDocBlock = (title: string, description: string): string =>
  `/**\n* ${title}\n*\n${renderJsDocBody(description, '')}*/\n`

/**
 * Builds the inline JSDoc comment that precedes a generated property. A
 * single-line description stays compact (`  /** text *\/`); a multi-line
 * description expands into an asterisk-prefixed block so every line is
 * commented. The returned string always ends with a newline, ready for the
 * property declaration to follow.
 */
const buildInlinePropertyComment = (description: string): string => {
  if (!description.includes('\n')) {
    return `  /** ${escapeCommentText(description)} */\n`
  }
  return `  /**\n${renderJsDocBody(description, '   ')}   */\n`
}

/**
 * Converts a JSON Schema type to its TypeScript equivalent, applying any
 * `x-mjst` brand. Branding is type-level only, so we compute the underlying
 * type and intersect it with a unique brand marker. This is the recursion entry
 * point, so branded nested fields are wrapped too.
 */
const getTypeScriptType = (schema: JSONSchema, options: TypeOptions, depth: number): string => {
  assertSchemaDepth(depth, 'generateTypeDefinition', MAX_TYPE_DEPTH)
  const base = getUnbrandedType(schema, options, depth)
  const brand = getMjstBrand(schema)
  const branded = brand ? `(${base} & { readonly __brand: '${brand}' })` : base
  // OpenAPI 3.0 spells nullability as a sibling flag instead of a `null` member
  // of `type`. Without this widening the emitted type claims the value can never
  // be null while the document says it can — and `generate-validators` builds an
  // `input is T` predicate on top of a validator that *does* accept null, so the
  // narrowing would be unsound.
  return isNullableSchema(schema) ? withNull(branded) : branded
}

/** True for the OpenAPI 3.0 `nullable: true` widening (JSON Schema has no such keyword). */
const isNullableSchema = (schema: JSONSchema): boolean =>
  isSchemaObject(schema) && keywordOf(schema, 'nullable') === true

/**
 * True when a rendered type is a union at its own top level — a ` | ` that no
 * bracket encloses.
 *
 * `includes(' | ')` cannot tell `A | B` from `Record<string, A | B>`, which is
 * why {@link wrapUnion} parenthesizes conservatively: over-wrapping only costs a
 * pair of brackets. Deciding whether a member *needs* wrapping is the other
 * direction, where a wrong answer is a wrong type, so it gets the exact test.
 */
const isTopLevelUnion = (type: string): boolean => {
  let depth = 0
  // A rendered type carries author data verbatim — a `const` or `enum` member is
  // emitted as a JSON string literal, and `enum: ['a | b']` puts a bar inside
  // quotes that means nothing to the parser. Quoted runs are skipped whole so
  // the scan only ever sees syntax.
  let quote: string | undefined
  for (let i = 0; i < type.length; i++) {
    const char = type[i]
    if (quote !== undefined) {
      if (char === '\\') i++
      else if (char === quote) quote = undefined
      continue
    }
    // Comments belong to the same scan as quotes, not to a pass before it. A
    // `const` of `x/*y` renders as a quoted literal whose characters open a
    // comment, and a regex pre-pass paired that with the *next* property's JSDoc
    // terminator and blanked everything between — hiding the top-level bar and
    // putting back the precedence defect the bracketing exists to prevent.
    if (char === '/' && type[i + 1] === '*') {
      const end = type.indexOf('*/', i + 2)
      // Nothing closes it, so nothing after it is syntax either.
      if (end === -1) return false
      i = end + 1
      continue
    }
    if (char === '"' || char === "'" || char === '`') quote = char
    else if (char === '(' || char === '<' || char === '[' || char === '{') depth++
    else if (char === ')' || char === '>' || char === ']' || char === '}') depth--
    else if (char === '|' && depth === 0) return true
  }
  return false
}

/** Parenthesizes a union so it composes safely inside `[]`, `&`, or an optional marker. */
const wrapUnion = (type: string): string => (type.includes(' | ') ? `(${type})` : type)

/**
 * Parenthesizes an intersection so it reads as one branch of a union. `A & B |
 * C` parses the way it is meant to, but a reader has to know the precedence
 * table to see it.
 */
const wrapIntersection = (type: string): string => (type.includes(' & ') ? `(${type})` : type)

/** Appends `| null` unless the rendered type already admits null. */
const withNull = (type: string): string => (type.split(' | ').includes('null') ? type : `${type} | null`)

/**
 * Joins members with ` | `, dropping duplicates while preserving order.
 *
 * A single `unknown` member takes the whole union: `X | unknown` *is* `unknown`,
 * and emitting both reads as though `X` still constrained something. OpenAPI
 * 3.0's `SchemaXORContent` rendered `{ schema: unknown } | unknown`, which says
 * nothing while looking like it says the `schema` branch survived.
 */
const unionOf = (members: readonly string[]): string => {
  const unique = [...new Set(members)]
  return unique.includes('unknown') ? 'unknown' : unique.join(' | ')
}

/**
 * Joins members with ` & `, dropping duplicates and any `unknown` member —
 * `X & unknown` is just `X`, and composition keywords routinely contribute one
 * (a `oneOf` branch that only lists `required`, say). Returns `unknown` when
 * every member was dropped.
 */
const intersectionOf = (members: readonly string[]): string => {
  const kept = [...new Set(members)].filter((member) => member !== 'unknown')
  if (kept.length === 0) return 'unknown'
  // `X & object` is `X` for any object type, and a schema that declares
  // `type: 'object'` next to a `oneOf` contributes exactly that bare member.
  const meaningful = kept.length > 1 ? kept.filter((member) => member !== 'object') : kept
  if (meaningful.length === 0) return 'object'
  if (meaningful.length === 1) return meaningful[0] as string
  // `&` binds tighter than `|`, so a member that is itself a union has to be
  // bracketed or it stops being one factor: the array-form `type` of the JSON
  // Schema meta-schema renders `{…} | boolean`, and joining that raw produced
  // `{…} | boolean & Core & Applicator & …` — read as `{…} | (boolean & …)`,
  // which is a different type and, since nothing satisfies the second branch,
  // silently threw away every keyword the meta-schema defines. Most call sites
  // already `wrapUnion` what they push; doing it here covers the ones that
  // cannot know they are about to be intersected.
  return meaningful.map((member) => (isTopLevelUnion(member) ? `(${member})` : member)).join(' & ')
}

/** Wraps a `Record<...>` in `Readonly<...>` when readonly output is requested. */
const recordType = (keyType: string, valueType: string, options: TypeOptions): string =>
  options.readonly ? `Readonly<Record<${keyType}, ${valueType}>>` : `Record<${keyType}, ${valueType}>`

/**
 * The key type a single `patternProperties` pattern contributes, or `'string'`
 * for any pattern whose key set cannot be narrowed.
 *
 * A pattern anchored at the start and made of ordinary characters — `^x-`, `^/`
 * — matches exactly the keys carrying that prefix, which is a template literal
 * type. Narrowing it is what lets a composed extension record survive: keyed on
 * `string`, an index signature covers `x-foo` too and forces it to the mapped
 * value type, so intersecting `Record<\`x-${string}\`, unknown>` onto it changes
 * nothing and the Paths Object rejected the very extensions the schema allows.
 * Keyed on `\`/${string}\`` the two key spaces are disjoint and both apply.
 *
 * Only for a lone pattern: a union of key patterns is not a key type.
 */
const REGEX_SYNTAX: ReadonlySet<string> = new Set([
  '\\',
  '^',
  '$',
  '.',
  '|',
  '?',
  '*',
  '+',
  '(',
  ')',
  '[',
  ']',
  '{',
  '}',
])

/** A quantifier that can match its atom zero or one times, so the atom is not a prefix. */
const startsOptional = (rest: string): boolean => /^[*?{]/.test(rest)

/**
 * The single characters a `[...]` class matches, or undefined when it is
 * negated, escaped, open-ended or simply too large to be worth naming.
 */
const characterClassMembers = (body: string): readonly string[] | undefined => {
  if (body === '' || body.startsWith('^') || body.includes('\\')) return undefined
  const members: string[] = []
  for (let i = 0; i < body.length; i++) {
    const char = body[i] as string
    if (body[i + 1] === '-' && i + 2 < body.length) {
      const from = char.codePointAt(0) as number
      const to = (body[i + 2] as string).codePointAt(0) as number
      if (to < from || to - from > 64) return undefined
      for (let code = from; code <= to; code++) members.push(String.fromCodePoint(code))
      i += 2
      continue
    }
    members.push(char)
  }
  return members.length > 0 && members.length <= 64 ? members : undefined
}

/** True for a `|` that splits the whole pattern rather than sitting inside a group or class. */
const hasTopLevelAlternation = (pattern: string): boolean => {
  let depth = 0
  for (let i = 0; i < pattern.length; i++) {
    const char = pattern[i]
    if (char === '\\') i++
    else if (char === '(' || char === '[') depth++
    else if (char === ')' || char === ']') depth--
    else if (char === '|' && depth <= 0) return true
  }
  return false
}

/**
 * The prefixes every key a pattern matches must start with, or undefined when
 * the pattern puts no bound on its first characters.
 *
 * This is deliberately a *superset* of the pattern's key set — `^[1-5](?:[0-9]{2}|XX)$`
 * answers `1`…`5`, not the 505 status codes it really matches. A key type built
 * from it therefore never rejects a key the schema accepts, which is the
 * direction that has to be right. What it buys is that the key space stops being
 * all of `string`: `x-owner` is outside it, so a composed extension record is no
 * longer swallowed by the index signature and can apply on its own.
 */
const leadingPrefixes = (pattern: string): readonly string[] | undefined => {
  if (!pattern.startsWith('^')) return undefined
  const rest = pattern.slice(1)
  // A top-level alternation has a second key space this scan never reaches:
  // reading `^/|^x-` as the prefix `/` answers with a *subset*, and the whole
  // point of the answer is that it is a superset. Only a bar inside a group or a
  // class belongs to an atom rather than to the pattern.
  if (hasTopLevelAlternation(rest)) return undefined

  let run = ''
  let cursor = 0
  while (cursor < rest.length) {
    const char = rest[cursor] as string
    // `\/` and `\.` are literal characters spelled defensively — common in a
    // path pattern. `\d` and friends are classes, so only punctuation escapes.
    if (char === '\\') {
      const escaped = rest[cursor + 1]
      if (escaped === undefined || /[A-Za-z0-9]/.test(escaped)) break
      run += escaped
      cursor += 2
      continue
    }
    if (REGEX_SYNTAX.has(char)) break
    run += char
    cursor += 1
  }
  // `^ab*` matches `a`, not `ab`: a quantifier binds to the character before it,
  // so that one is not part of the prefix.
  if (run !== '' && startsOptional(rest.slice(cursor))) run = run.slice(0, -1)
  if (run !== '') return [run]

  if (!rest.startsWith('[')) return undefined
  const close = rest.indexOf(']')
  if (close === -1 || startsOptional(rest.slice(close + 1))) return undefined
  return characterClassMembers(rest.slice(1, close))
}

/**
 * The key type one `patternProperties` pattern contributes, or `'string'` when
 * its keys cannot be narrowed.
 *
 * Narrowing is what lets a composed extension record survive. Keyed on `string`,
 * an index signature covers `x-foo` as well and forces it to the mapped value
 * type, so intersecting `Record<`x-${string}`, unknown>` onto it changes
 * nothing — the Paths and Responses Objects went on rejecting the very
 * extensions the schema allows. Keyed on what the pattern can actually start
 * with, the two key spaces are disjoint and both apply.
 */
const patternKeyType = (pattern: string): string => {
  const prefixes = leadingPrefixes(pattern)
  // A prefix goes into a template literal type verbatim, so anything that is
  // syntax there has to take the pattern back to `string` rather than emit a
  // file that does not parse: a backslash (`^\\x` renders `\x`, read as a
  // hex escape), a backtick (which closes the literal), and `$` (which starts
  // an interpolation).
  if (prefixes === undefined || prefixes.some((prefix) => /[`\\$]/.test(prefix))) return 'string'
  return prefixes.map((prefix) => `\`${prefix}\${string}\``).join(' | ')
}

/**
 * One index signature per `patternProperties` pattern — or, when any pattern's
 * keys cannot be narrowed, the single `string`-keyed signature carrying every
 * pattern's value type.
 *
 * Separate signatures are what a multi-pattern block actually says: OpenAPI 3.0
 * spells its Paths Object `{ '^\\/': PathItem, '^x-': {} }`, and collapsing that
 * to one `string` key had to union the two value types, which put `PathItem` on
 * `x-` keys and `unknown` on paths. Keeping them apart is both narrower and the
 * only shape in which the extension keys stay extensions. Falling back together
 * is still right when a key set is unknown: overlapping signatures TypeScript
 * cannot order are worse than one honest wide one.
 */
const patternIndexSignatures = (
  patternProperties: Record<string, JSONSchema | boolean>,
  options: TypeOptions,
  depth: number,
): readonly { key: string; value: string }[] => {
  const entries = Object.entries(patternProperties)
  if (entries.length === 0) return []
  const signatures = entries.map(([pattern, value]) => ({
    key: patternKeyType(pattern),
    value: typeof value === 'boolean' ? getBooleanSubSchemaType(value) : getTypeScriptType(value, options, depth + 1),
  }))
  const widened = [{ key: 'string', value: unionOf(signatures.map((signature) => signature.value)) }]
  if (signatures.length === 1) return signatures
  if (signatures.some((signature) => signature.key === 'string')) return widened

  // Two patterns can still name one key space, and then only one signature may
  // carry it: `^x-` twice over is a duplicate key.
  const byKey = new Map<string, string[]>()
  for (const { key, value } of signatures) byKey.set(key, [...(byKey.get(key) ?? []), value])
  const grouped = [...byKey].map(([key, values]) => ({ key, value: unionOf(values) }))

  // Distinct keys are not yet disjoint ones: `^x-` and `^x-a` narrow to
  // `` `x-${string}` `` and `` `x-a${string}` ``, and TypeScript holds the second
  // to the first's value type (`TS2413`) because every key it admits the first
  // admits too. Only patterns that cannot collide keep their own signature.
  return overlappingKeys(grouped.map((signature) => signature.key)) ? widened : grouped
}

/**
 * The type for a schema whose keys all come from index signatures.
 *
 * `asBlock` keeps the two spellings these have always had: `additionalProperties`
 * renders as a property block and a lone `patternProperties` pattern as a
 * `Record<…>`. They mean the same type, and swapping either would churn every
 * consumer's generated output for nothing. Several signatures need the block
 * either way, since `Record<…>` holds only one key type.
 */
const indexSignaturesType = (
  indexes: readonly { key: string; value: string }[],
  options: TypeOptions,
  asBlock: boolean,
): string => {
  const only = indexes[0] as { key: string; value: string }
  if (!asBlock && indexes.length === 1) return recordType(only.key, only.value, options)
  const readonlyPrefix = options.readonly ? 'readonly ' : ''
  return `{\n${indexes.map(({ key, value }) => `  ${readonlyPrefix}[key: ${key}]: ${value};`).join('\n')}\n}`
}

/**
 * The tuple positions a schema declares: 2020-12 `prefixItems`, or the draft-07
 * array form of `items`. Returns undefined for a plain (homogeneous) array.
 *
 * A `prefixItems` that is *present* takes the positions, empty or not. Requiring
 * a non-empty one let an empty `prefixItems` fall through to the array `items`
 * behind it, so `{ "prefixItems": [], "items": [{"type":"string"}] }` typed as
 * `[string?, ...unknown[]]` while `@amritk/runtime-validators` and
 * `@amritk/generate-validators` both read the `prefixItems` and enforced nothing
 * — the type claimed a shape neither validator would hold anyone to. 2020-12
 * has no array `items` at all, so once `prefixItems` is on the node the draft-07
 * spelling beside it is not a tuple this schema declares.
 *
 * An empty *array* `items` still falls through, and that is not the same case:
 * with no `prefixItems` it is a draft-07 tuple of no positions, whose every
 * index answers to `additionalItems` — `unknown[]` here, which is a widening
 * rather than a claim.
 */
const getTuplePositions = (schema: SchemaNode): readonly JSONSchema[] | undefined => {
  const prefixItems = keywordOf(schema, 'prefixItems')
  if (Array.isArray(prefixItems)) return prefixItems.length > 0 ? (prefixItems as JSONSchema[]) : undefined
  const items = keywordOf(schema, 'items')
  if (Array.isArray(items) && items.length > 0) return items as JSONSchema[]
  return undefined
}

/**
 * Renders a tuple type for a schema carrying `prefixItems` (or the draft-07
 * array `items`). A position is only required when `minItems` reaches it — JSON
 * Schema lets a tuple stop short unless told otherwise — so the rest are
 * emitted optional. Extra elements past the declared positions are typed from
 * the sibling `items` (`additionalItems` in the draft-07 spelling) and dropped
 * entirely when that sibling is `false`.
 */
const tupleTypeToTs = (
  schema: SchemaNode,
  positions: readonly JSONSchema[],
  options: TypeOptions,
  depth: number,
): string => {
  const items = keywordOf(schema, 'items')
  // With the draft-07 spelling `items` *is* the tuple, so the rest schema is
  // `additionalItems`; with `prefixItems` it is the sibling `items`.
  const rest = Array.isArray(items) ? keywordOf(schema, 'additionalItems') : items
  const declaredMin = keywordOf(schema, 'minItems')
  const minItems = typeof declaredMin === 'number' ? declaredMin : 0

  const parts: string[] = []
  for (let i = 0; i < positions.length; i++) {
    const positionType = wrapUnion(getTypeScriptType(positions[i] as JSONSchema, options, depth + 1))
    parts.push(i < minItems ? positionType : `${positionType}?`)
  }

  if (rest !== false) {
    const restType =
      rest === undefined || rest === true
        ? 'unknown'
        : wrapUnion(getTypeScriptType(rest as JSONSchema, options, depth + 1))
    parts.push(`...${restType}[]`)
  }

  const tuple = `[${parts.join(', ')}]`
  return options.readonly ? `readonly ${tuple}` : tuple
}

/** Renders the TypeScript type for an `array` schema — tuple, typed list, or bare list. */
const arrayTypeToTs = (schema: SchemaNode, options: TypeOptions, depth: number): string => {
  const positions = getTuplePositions(schema)
  if (positions) return tupleTypeToTs(schema, positions, options, depth)

  const items = keywordOf(schema, 'items')
  if (items !== undefined && !Array.isArray(items)) {
    const itemType = getTypeScriptType(items as JSONSchema, options, depth + 1)
    // Wrap union types in parentheses so `(A | B)[]` is not misread as `A | B[]`
    const wrappedItemType = wrapUnion(itemType)
    return options.readonly ? `readonly ${wrappedItemType}[]` : `${wrappedItemType}[]`
  }
  return options.readonly ? 'readonly unknown[]' : 'unknown[]'
}

/**
 * The literal key names an anchored alternation of plain literals matches, or
 * undefined for any pattern that is not one.
 *
 * `^(?:schemas|responses|…)$` can match those names and nothing else. Anything
 * carrying regex syntax — a quantifier, a class, a wildcard — matches an open
 * set of keys and is not this.
 */
const literalPatternKeys = (pattern: string): readonly string[] | undefined => {
  const anchored = /^\^\((?:\?:)?([^()[\]{}.*+?^$\\|]+(?:\|[^()[\]{}.*+?^$\\|]+)*)\)\$$/.exec(pattern)
  const bare = /^\^([^()[\]{}.*+?^$\\|]+)\$$/.exec(pattern)
  const body = anchored?.[1] ?? bare?.[1]
  return body === undefined ? undefined : body.split('|')
}

/**
 * The `patternProperties` entries that say something the declared `properties`
 * do not.
 *
 * A pattern that can only match keys the schema already declares constrains
 * nothing new, and turning it into an index signature is actively worse than
 * dropping it: the signature has to widen to cover every declared property, so
 * `[key: string]: unknown | …` lands on the type and excess-property checking
 * stops working for the whole object. OpenAPI's Components Object is exactly
 * this — it re-lists all ten of its property names as an alternation, and the
 * schema's own `$comment` says the enumeration is there so
 * `unevaluatedProperties` works, not to describe any key.
 */
const openPatternProperties = (
  schema: SchemaNode,
  patternProperties: Record<string, JSONSchema>,
): Record<string, JSONSchema> => {
  const declared = keywordMap(schema, 'properties')
  if (declared === undefined) return patternProperties
  const kept: Record<string, JSONSchema> = {}
  for (const [pattern, value] of Object.entries(patternProperties)) {
    const keys = literalPatternKeys(pattern)
    if (keys?.every((key) => Object.hasOwn(declared, key))) continue
    assignKey(kept, pattern, value)
  }
  return kept
}

/**
 * Whether a schema declares open-ended keys at all — the cheap question, asked
 * where only the yes/no matters. {@link getIndexSignatures} answers it by
 * rendering every value type, which is the whole recursive walk again.
 */
const declaresOpenKeys = (schema: SchemaNode): boolean => {
  const additionalProperties = keywordOf(schema, 'additionalProperties')
  if (additionalProperties !== undefined && typeof additionalProperties !== 'boolean') return true
  const declaredPatterns = keywordMap(schema, 'patternProperties')
  return declaredPatterns !== undefined && Object.keys(openPatternProperties(schema, declaredPatterns)).length > 0
}

/**
 * The open-ended key signatures a schema declares — one per `patternProperties`
 * pattern, or one for a schema-valued `additionalProperties` — and none when it
 * declares no open keys at all. Only a *schema-valued* `additionalProperties`
 * counts: `true` is the JSON Schema default, so emitting `[key: string]:
 * unknown` for it would widen nearly every generated type into uselessness, and
 * `false` is a closed object.
 *
 * A schema-valued `additionalProperties` wins outright, and that costs
 * something TypeScript cannot give back. Where both are declared, JSON Schema
 * reads `additionalProperties` as covering only the keys `patternProperties`
 * did not — so OpenAPI 3.0's Callback Object, `{ additionalProperties: PathItem,
 * patternProperties: { '^x-': {} } }`, accepts `x-anything`. Writing that needs
 * `[key: string]: PathItem` beside `[key: `x-${string}`]: unknown`, and a
 * `string` index has to be a supertype of every other, so the pair is `TS2411`.
 * Between a type that takes every ordinary key and one that takes only the
 * extensions, the first is the object's purpose.
 */
const getIndexSignatures = (
  schema: SchemaNode,
  options: TypeOptions,
  depth: number,
): readonly { key: string; value: string }[] => {
  const additionalProperties = keywordOf(schema, 'additionalProperties')
  if (additionalProperties !== undefined && typeof additionalProperties !== 'boolean') {
    return [{ key: 'string', value: getTypeScriptType(additionalProperties as JSONSchema, options, depth + 1) }]
  }

  const declaredPatterns = keywordMap(schema, 'patternProperties')
  if (declaredPatterns !== undefined) {
    return patternIndexSignatures(openPatternProperties(schema, declaredPatterns), options, depth)
  }

  return []
}

/**
 * Renders the index-signature line to sit alongside declared properties.
 *
 * A `string` index must accept every declared property's type or TypeScript
 * rejects the whole type (TS2411), so the signature is widened with them — and
 * with `undefined` when any declared property is optional. A template-literal
 * key (`` `x-${string}` ``) constrains a disjoint set of keys, so it needs no
 * widening.
 */
const buildIndexSignatureLine = (
  index: { key: string; value: string },
  declared: readonly { name: string; type: string }[],
  hasOptionalProperty: boolean,
  options: TypeOptions,
): string => {
  const readonlyPrefix = options.readonly ? 'readonly ' : ''
  // Which declared properties this key actually covers. A `string` key covers
  // them all; a template-literal one covers the names carrying its prefix —
  // `[key: `x-${string}`]` beside a declared `x-internal` is the same `TS2411`
  // the widening exists to prevent, and a key narrow enough to miss every
  // declared name needs no widening at all.
  const covered =
    index.key === 'string' ? declared : declared.filter((property) => matchesKeyType(index.key, property.name))
  if (covered.length === 0) return `${readonlyPrefix}[key: ${index.key}]: ${index.value}`
  const widened = unionOf([
    ...index.value.split(' | '),
    ...covered.map((property) => property.type),
    ...(hasOptionalProperty ? ['undefined'] : []),
  ])
  return `${readonlyPrefix}[key: ${index.key}]: ${widened}`
}

/**
 * Whether a rendered key type admits a literal property name. Only the two forms
 * this file emits are asked about: `string`, and a union of `` `prefix${string}` ``
 * template literals.
 */
const matchesKeyType = (key: string, name: string): boolean => {
  const prefixes = keyTypePrefixes(key)
  return prefixes === undefined || prefixes.some((prefix) => name.startsWith(prefix))
}

/**
 * The prefixes a rendered key type admits, or undefined for `string` — which
 * admits everything and so has no prefix list.
 */
const keyTypePrefixes = (key: string): readonly string[] | undefined => {
  if (key === 'string') return undefined
  const prefixes: string[] = []
  for (const member of key.split(' | ')) {
    const prefix = /^`(.*)\$\{string\}`$/.exec(member)?.[1]
    if (prefix === undefined) return undefined
    prefixes.push(prefix)
  }
  return prefixes
}

/** True when two of these key types admit a key in common. */
const overlappingKeys = (keys: readonly string[]): boolean => {
  const prefixLists = keys.map((key) => keyTypePrefixes(key))
  if (prefixLists.some((prefixes) => prefixes === undefined)) return true
  for (let i = 0; i < prefixLists.length; i++) {
    for (let j = i + 1; j < prefixLists.length; j++) {
      const left = prefixLists[i] as readonly string[]
      const right = prefixLists[j] as readonly string[]
      // One prefix extending another means every key the longer admits the
      // shorter admits as well.
      if (left.some((a) => right.some((b) => a.startsWith(b) || b.startsWith(a)))) return true
    }
  }
  return false
}

/**
 * Renders an `object` schema: a property literal when it declares properties, a
 * `Record`/index type when it only declares open-ended keys, else the bare
 * `object`. Open-ended keys declared *alongside* properties become an index
 * signature inside the literal rather than being dropped.
 */
const objectTypeToTs = (schema: SchemaNode, options: TypeOptions, depth: number): string => {
  const indexes = getIndexSignatures(schema, options, depth)
  const properties = keywordOf(schema, 'properties') as Record<string, JSONSchema> | undefined

  if (properties && Object.keys(properties).length > 0) {
    const readonlyPrefix = options.readonly ? 'readonly ' : ''
    // Build the required-key set once instead of an O(required) `includes`
    // per property (O(properties × required) for a wide object).
    const declaredRequired = keywordOf(schema, 'required')
    const requiredSet = new Set<string>(Array.isArray(declaredRequired) ? (declaredRequired as string[]) : [])
    const hasDescriptions = Object.values(properties).some((p) => propertyDescription(p) !== undefined)

    const declared: { name: string; type: string }[] = []
    let hasOptionalProperty = false
    // Entries are emitted ready to place: multi-line layout wants each
    // declaration indented and `;`-terminated (with its JSDoc block already
    // carrying its own indent), the compact one wants bare declarations.
    const entries: string[] = []
    for (const key of Object.keys(properties)) {
      // properties[key] is safe: key comes from iterating properties
      const propSchema = properties[key] as JSONSchema
      const isRequired = requiredSet.has(key)
      const optional = isRequired ? '' : '?'
      if (!isRequired) hasOptionalProperty = true
      const propType = getTypeScriptType(propSchema, options, depth + 1)
      declared.push({ name: key, type: propType })
      const declaration = readonlyPrefix + safeKey(key) + optional + ': ' + propType
      if (!hasDescriptions) {
        entries.push(declaration)
        continue
      }
      const inlineDescription = propertyDescription(propSchema)
      entries.push((inlineDescription ? buildInlinePropertyComment(inlineDescription) : '') + '  ' + declaration + ';')
    }

    for (const index of indexes) {
      const line = buildIndexSignatureLine(index, declared, hasOptionalProperty, options)
      entries.push(hasDescriptions ? '  ' + line + ';' : line)
    }

    // Descriptions force the multi-line layout — an inline `/** … */` per
    // property would otherwise run the whole literal together on one line.
    if (hasDescriptions) return '{\n' + entries.join('\n') + '\n}'
    return '{ ' + entries.join('; ') + ' }'
  }

  const only = indexes[0]
  if (only !== undefined && indexes.length === 1) {
    return only.key === 'string' && !options.readonly
      ? recordType('string', only.value, options)
      : recordType(only.key, only.value, options)
  }
  if (indexes.length > 1) {
    const readonlyPrefix = options.readonly ? 'readonly ' : ''
    return `{ ${indexes.map(({ key, value }) => `${readonlyPrefix}[key: ${key}]: ${value}`).join('; ')} }`
  }

  return 'object'
}

/**
 * Renders the shape a schema declares *itself* — its `type`, or the record
 * keywords it carries without one. Returns undefined when the schema declares
 * no shape of its own (so composition keywords alone decide the type).
 */
const getLocalShapeType = (schema: SchemaNode, options: TypeOptions, depth: number): string | undefined => {
  const type = keywordOf(schema, 'type')
  if (!type) {
    // A predicate, not the signatures themselves: `objectTypeToTs` builds them
    // again, and building one renders every pattern's value type through the
    // whole recursive walk.
    if (declaresOpenKeys(schema)) return objectTypeToTs(schema, options, depth)

    // Declared properties first. A boolean `additionalProperties` says what to do
    // with the keys *not* declared, so reading it ahead of them answered
    // `Record<string, never>` for a schema that names properties — reachable
    // once `openPatternProperties` started dropping a pattern that only re-lists
    // those same names, which is what left nothing for `declaresOpenKeys` above.
    const properties = keywordOf(schema, 'properties')
    if (properties && Object.keys(properties).length > 0) return objectTypeToTs(schema, options, depth)

    const additionalProperties = keywordOf(schema, 'additionalProperties')
    if (typeof additionalProperties === 'boolean') {
      return recordType('string', getBooleanSubSchemaType(additionalProperties), options)
    }

    // Last resort for a schema that says nothing else: guess the type from the
    // shape of its `default`. A `default` is an annotation, not a constraint, so
    // this only holds while nothing better is on offer — next to a composition
    // keyword the guess is both redundant and wrong, and it gets *intersected*
    // with what the composition says. OpenAPI 3.0's `additionalProperties`
    // property is `{ oneOf: [Schema, Reference, { type: 'boolean' }], default:
    // true }`, which came out as `boolean & (SchemaObject | ReferenceObject |
    // boolean)` — every branch but `boolean` annihilated, so the ordinary
    // `additionalProperties: { type: 'string' }` no longer type-checked.
    if (!composes(schema)) {
      const defaultValue = keywordOf(schema, 'default')
      if (defaultValue !== undefined) {
        if (typeof defaultValue === 'string') return 'string'
        if (typeof defaultValue === 'number') return 'number'
        if (typeof defaultValue === 'boolean') return 'boolean'
      }
    }

    return undefined
  }

  // Array-form `type` (the multi-type / nullable idiom, e.g. `["object","null"]`)
  // is a union of the per-type renderings. Each member is rendered from the SAME
  // schema, so a nullable object keeps its properties and a nullable array keeps
  // its item type instead of collapsing to `Record<string, unknown>` / `unknown[]`.
  if (Array.isArray(type)) {
    return unionOf(type.map((member) => singleTypeToTs(schema, member as JSONSchema.TypeValue, options, depth)))
  }

  return singleTypeToTs(schema, type as JSONSchema.TypeValue, options, depth)
}

/** Renders one JSON Schema `type` value against the schema that declared it. */
const singleTypeToTs = (
  schema: SchemaNode,
  type: JSONSchema.TypeValue,
  options: TypeOptions,
  depth: number,
): string => {
  switch (type) {
    case 'string':
      return 'string'
    case 'number':
    case 'integer':
      return 'number'
    case 'boolean':
      return 'boolean'
    case 'null':
      return 'null'
    case 'array':
      return arrayTypeToTs(schema, options, depth)
    case 'object': {
      const rendered = objectTypeToTs(schema, options, depth)
      // A shapeless object inside a union reads better as an indexable record
      // than as the bare `object`, which cannot be indexed at all.
      return rendered === 'object' && Array.isArray(keywordOf(schema, 'type'))
        ? recordType('string', 'unknown', options)
        : rendered
    }
    default:
      return 'unknown'
  }
}

/**
 * Converts a JSON Schema type to its TypeScript equivalent, ignoring any brand.
 * Recursively handles nested objects and arrays.
 */
const getUnbrandedType = (schema: JSONSchema, options: TypeOptions, depth: number): string => {
  // Boolean schema: `true` means any value is valid (unknown), `false` means no value is valid (never)
  if (typeof schema === 'boolean') {
    return getBooleanSubSchemaType(schema)
  }

  // Check if schema is an object (not a boolean schema)
  if (typeof schema !== 'object' || schema === null) {
    return 'unknown'
  }

  // An x-mjst instanceOf hint means the value is a runtime class (e.g. Date)
  // that JSON Schema cannot describe — emit the class name as the type directly.
  const instanceOf = getMjstInstanceOf(schema)
  if (instanceOf) {
    return instanceOf
  }

  // An x-mjst primitive hint (e.g. bigint) names a non-JSON primitive — emit it
  // directly as the TypeScript type.
  const primitive = getMjstPrimitive(schema)
  if (primitive) {
    return primitive
  }

  // Handle $ref
  const ref = keywordOf(schema, '$ref')
  if (typeof ref === 'string' && ref !== '') {
    return refTypeName(ref, options)
  }

  // A `$dynamicRef` should never reach here: `resolveDynamicRefs` rewrites every
  // one of them to a concrete `$ref` before generation, and fails the build for
  // any it cannot bind. If one does survive — a caller reaching into a raw
  // subschema, say — it names no generated file, so `unknown` is the only honest
  // answer. Naming the type after the anchor is what used to turn a root
  // `$dynamicAnchor: "node"` into a reference to the DOM's `Node` interface: no
  // file, no import, and a clean compile under any tsconfig that includes `DOM`.
  // The `#meta` special case that lived here was a hand-patch of the same hole
  // for the one anchor name OpenAPI happens to use.
  if (keywordOf(schema, '$dynamicRef')) {
    return 'unknown'
  }

  // Handle const - literal type
  if (declares(schema, 'const')) {
    return JSON.stringify(keywordOf(schema, 'const'))
  }

  // Handle enum - union of literal types
  const enumValues = keywordOf(schema, 'enum')
  if (Array.isArray(enumValues) && enumValues.length > 0) {
    return unionOf(enumValues.map((value) => JSON.stringify(value)))
  }

  // A schema may declare a shape of its own *and* compose others. Returning
  // either alone silently drops half of what the document says, so the local
  // shape, the conditional, the `oneOf`/`anyOf` union, and every `allOf` member
  // are combined into one intersection.
  const members: string[] = []
  const localType = getLocalShapeType(schema, options, depth)
  if (localType !== undefined) members.push(localType)

  const domain = keywordMap(schema, 'properties')
  const conditional = conditionalMember(schema, domain, options, depth)
  if (conditional !== undefined) members.push(wrapUnion(conditional))

  const allOf = keywordOf(schema, 'allOf')
  if (Array.isArray(allOf)) {
    for (const entry of allOf) members.push(allOfMember(entry as JSONSchema, domain, options, depth))
  }

  const unionBranches = unionBranchesOf(schema)
  if (unionBranches) {
    const union = unionOf(unionBranches.map((branch) => unionBranchType(branch, domain, options, depth)))
    // A lone union is the whole type; alongside other members it is one factor
    // of an intersection and needs its own parentheses.
    if (members.length === 0 && !Array.isArray(allOf)) return union
    members.push(wrapUnion(union))
  }

  if (members.length === 0) return 'unknown'
  return intersectionOf(members)
}

/**
 * One `oneOf`/`anyOf` branch, rendered against the schema composing it.
 *
 * A branch that only lists `required` is not a shape of its own — it is a
 * constraint on the *composing* schema's properties, which is how "exactly one
 * of these keys" is written. Rendered on its own it declares nothing, came out
 * `unknown`, and was then dropped from the intersection as a member that says
 * nothing: OpenAPI's `oneOf: [{ required: ['schema'] }, { required: ['content']
 * }]` left a Parameter with both keys optional and no way to tell the two forms
 * apart. Read against the property block it becomes `{ schema: SchemaObject } |
 * { content: ContentObject }`, which is the constraint the schema states and a
 * union TypeScript can narrow.
 *
 * `domain` is that property block, and supplies each required key's type; a key
 * it does not declare is required with nothing said about it.
 */
const unionBranchType = (
  branch: JSONSchema,
  domain: Record<string, JSONSchema> | undefined,
  options: TypeOptions,
  depth: number,
): string => {
  const standalone = (): string => getTypeScriptType(branch, options, depth + 1)
  // Anything carrying a shape of its own — a `$ref`, a composition, a `type`
  // other than object — already renders to what it means.
  if (!isPlainFragment(branch)) return standalone()
  const required = requiredOf(branch)
  const own = keywordMap(branch, 'properties')
  if (required.length === 0) return standalone()

  const declaredBy = (key: string): JSONSchema | undefined =>
    domain === undefined ? undefined : (readKey(domain, key) as JSONSchema | undefined)

  // The branch's own property block comes first, so the literal reads in the
  // order the schema writes it rather than required keys first.
  const properties: Record<string, JSONSchema> = {}
  if (own !== undefined) {
    for (const key of Object.keys(own)) {
      assignKey(properties, key, intersectProperties(declaredBy(key), readKey(own, key) as JSONSchema))
    }
  }
  // A key only `required` names takes the composing schema's declaration, and
  // is present with any value when that schema does not declare it either.
  for (const key of required) {
    if (Object.hasOwn(properties, key)) continue
    assignKey(properties, key, declaredBy(key) ?? true)
  }
  return objectTypeToTs({ type: 'object', properties, required: [...required] } as SchemaNode, options, depth)
}

/**
 * The branch list a schema unions over: its `oneOf`, else its `anyOf`. Both are
 * rendered the same way here — the generated *type* is the union either way; it
 * is the validators that hold `oneOf` to exactly one match.
 */
const unionBranchesOf = (schema: SchemaNode): readonly JSONSchema[] | undefined => {
  const oneOf = keywordOf(schema, 'oneOf')
  if (Array.isArray(oneOf) && oneOf.length > 0) return oneOf as JSONSchema[]
  const anyOf = keywordOf(schema, 'anyOf')
  if (Array.isArray(anyOf) && anyOf.length > 0) return anyOf as JSONSchema[]
  return undefined
}

/**
 * The types a schema composes alongside its own property block: every `allOf`
 * member, a sibling `$ref` (2019-09+ allows one next to other keywords), and a
 * sibling `oneOf`/`anyOf` union. Each is intersected onto the body — an `allOf`
 * member written inline rather than as a `$ref` used to be dropped outright,
 * taking its properties and its `required` list with it.
 */
const getCompositionMembers = (schema: JSONSchema, options: TypeOptions, depth: number): string[] => {
  if (!isSchemaObject(schema)) return []
  const members: string[] = []
  // The property block both `allOf` conditionals and `oneOf`/`anyOf` branches are
  // read against: each is a constraint on *these* properties, not a shape apart
  // from them.
  const domain = keywordMap(schema, 'properties')

  const allOf = keywordOf(schema, 'allOf')
  if (Array.isArray(allOf)) {
    for (const entry of allOf) members.push(allOfMember(entry as JSONSchema, domain, options, depth))
  }

  const ref = keywordOf(schema, '$ref')
  if (typeof ref === 'string') {
    members.push(refTypeName(ref, options))
  }

  const unionBranches = unionBranchesOf(schema)
  if (unionBranches) {
    members.push(wrapUnion(unionOf(unionBranches.map((branch) => unionBranchType(branch, domain, options, depth)))))
  }

  // `X & unknown` is `X`: a branch that only lists `required`, or a ref with no
  // generated file, contributes nothing and would just add noise.
  return [...new Set(members)].filter((member) => member !== 'unknown')
}

/**
 * Generates a TypeScript type definition from a JSON Schema.
 * Handles required vs optional properties based on the schema's required array.
 * Uses $comment as inline JSDoc description when present.
 */
export const generateTypeDefinition = (schema: JSONSchema, typeName: string, options: TypeOptions = {}): string => {
  const readonlyPrefix = options.readonly ? 'readonly ' : ''

  // Handle non-object schemas first. An array-form `type` goes here too: it is a
  // union (`{ … } | null`), not a single object body, so it cannot be emitted as
  // a property block even when one of its members is an object.
  if (!isObjectLikeSchema(schema) || (isSchemaObject(schema) && Array.isArray(keywordOf(schema, 'type')))) {
    const tsType = getTypeScriptType(schema, options, 0)
    let result = ''

    const topLevelComment = isSchemaObject(schema) ? propertyDescription(schema) : undefined
    if (topLevelComment) {
      result += buildJsDocBlock(typeName, topLevelComment)
    }

    result += `export type ${typeName} = ${tsType};`
    return result
  }

  if (isObjectLikeSchema(schema)) {
    let jsDocTitle: string | undefined
    let jsDocDescription: string | undefined

    const topLevelComment = isSchemaObject(schema) ? propertyDescription(schema) : undefined
    if (topLevelComment) {
      jsDocTitle = typeName
      jsDocDescription = topLevelComment
    }

    const declaredProperties = keywordMap(schema, 'properties')
    const additionalProperties = keywordOf(schema, 'additionalProperties')
    const patternProperties = keywordMap(schema, 'patternProperties')

    const hasProperties = declaredProperties !== undefined && Object.keys(declaredProperties).length > 0
    const hasAdditionalProperties = typeof additionalProperties === 'object' && additionalProperties !== null
    const hasPatternProperties = patternProperties !== undefined && Object.keys(patternProperties).length > 0

    // A map shape composes like any other. Returning the map alone dropped every
    // `allOf` member and sibling `$ref` the schema also declares — which for the
    // Paths Object is the `$ref` to specification-extensions, so the type
    // rejected the `x-` keys the schema allows (and the file imported a name it
    // then never used).
    const composed = (body: string): string =>
      [body, ...getCompositionMembers(schema, options, 0)].filter((member) => member !== 'unknown').join(' & ')

    // An object whose keys all come from `patternProperties` / `additionalProperties`.
    // `getIndexSignatures` decides between them rather than this branch: reading
    // `patternProperties` first and returning meant OpenAPI 3.0's Callback Object
    // — `{ additionalProperties: PathItem, patternProperties: { '^x-': {} } }` —
    // rendered as the extension record alone, dropping the Path Item map and
    // with it every callback-expression key the object exists to carry.
    if (!hasProperties && (hasPatternProperties || hasAdditionalProperties)) {
      const indexes = getIndexSignatures(schema, options, 0)
      if (indexes.length > 0) {
        const body = indexSignaturesType(indexes, options, hasAdditionalProperties)

        let result = ''
        if (jsDocTitle && jsDocDescription) {
          result += buildJsDocBlock(jsDocTitle, jsDocDescription)
        }
        result += `export type ${typeName} = ${composed(body)};`

        return result
      }
    }

    const schemaProps = declaredProperties ?? {}
    const declaredRequired = keywordOf(schema, 'required')
    const requiredSet = new Set<string>(Array.isArray(declaredRequired) ? (declaredRequired as string[]) : [])
    const declared: { name: string; type: string }[] = []
    let hasOptionalProperty = false
    let properties = ''
    let isFirstProp = true
    const appendLine = (line: string): void => {
      if (!isFirstProp) properties += '\n'
      isFirstProp = false
      properties += line
    }
    for (const key of Object.keys(schemaProps)) {
      // schemaProps[key] is safe: key comes from iterating schemaProps
      const propSchema = schemaProps[key]!
      const isRequired = requiredSet.has(key)
      const optional = isRequired ? '' : '?'
      if (!isRequired) hasOptionalProperty = true
      const propType = getTypeScriptType(propSchema, options, 0)
      declared.push({ name: key, type: propType })
      const quotedKey = readonlyPrefix + safeKey(key)

      // Add JSDoc comment from $comment or description if available
      const inlineDescription = propertyDescription(propSchema)
      appendLine(
        inlineDescription
          ? buildInlinePropertyComment(inlineDescription) + '  ' + quotedKey + optional + ': ' + propType + ';'
          : '  ' + quotedKey + optional + ': ' + propType + ';',
      )
    }

    // Open-ended keys declared alongside fixed properties become an index
    // signature inside the same body — dropping them used to erase everything a
    // schema said about the keys it does not name.
    for (const index of getIndexSignatures(schema, options, 0)) {
      appendLine('  ' + buildIndexSignatureLine(index, declared, hasOptionalProperty, options) + ';')
    }

    let result = ''
    if (jsDocTitle && jsDocDescription) {
      result += buildJsDocBlock(jsDocTitle, jsDocDescription)
    }

    const conditional = conditionalMember(schema, declaredProperties, options, 0)
    const intersected = [
      ...(conditional === undefined ? [] : [wrapUnion(conditional)]),
      ...getCompositionMembers(schema, options, 0),
    ]

    // A body with nothing in it says nothing an intersection member does not
    // already say — `{} & X` is `X` — so a schema that is only its conditional
    // or its composition is rendered as those alone.
    let typeBody = properties === '' ? '{}' : '{\n' + properties + '\n}'
    if (properties === '' && intersected.length > 0) typeBody = intersected.join(' & ')
    else for (const intersectionType of intersected) typeBody += ' & ' + intersectionType

    if (isNullableSchema(schema)) typeBody = withNull(typeBody)

    result += 'export type ' + typeName + ' = ' + typeBody + ';'

    return result
  }

  return 'export type ' + typeName + ' = unknown;'
}
