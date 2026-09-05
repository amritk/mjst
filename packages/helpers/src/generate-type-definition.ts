import type { JSONSchema } from 'json-schema-typed/draft-2020-12'

import { assignKey } from './assign-key'
import { assertSchemaDepth, MAX_SCHEMA_DEPTH } from './max-schema-depth'
import { getMjstBrand, getMjstInstanceOf, getMjstPrimitive } from './mjst-extension'
import { readKey } from './read-key'
import { refToName } from './ref-to-name'
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

/** True for a fragment made of `properties` and `required` alone (see {@link NON_PLAIN_KEYWORDS}). */
const isPlainFragment = (schema: JSONSchema): schema is SchemaNode => {
  if (!isSchemaObject(schema)) return false
  const type = keywordOf(schema, 'type')
  if (type !== undefined && type !== 'object') return false
  return !Object.keys(schema).some((key) => NON_PLAIN_KEYWORDS.has(key))
}

/** The `required` list a fragment declares, or nothing when it declares none. */
const requiredOf = (schema: SchemaNode): readonly string[] => {
  const declared = keywordOf(schema, 'required')
  return Array.isArray(declared) ? declared.filter((key): key is string => typeof key === 'string') : []
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
      assignKey(properties, key, existing === undefined ? sub : { allOf: [existing, sub] })
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
 * The conditional definition an `allOf` member's local `$ref` points at, when
 * it points at one. OpenAPI's security scheme composes its per-type rules as
 * `allOf: [{ $ref: '#/$defs/type-http' }, …]`, each definition an `if`/`then`
 * on the `type` the composing schema enumerates; the definition's own file
 * cannot see that enumeration, so its conditional drops there and the ref would
 * name a type that says nothing. Reading the definition here is what lets the
 * composing type narrow on `type` the way the schema does.
 */
const referencedConditional = (entry: SchemaNode, options: TypeOptions): SchemaNode | undefined => {
  const ref = keywordOf(entry, '$ref')
  if (typeof ref !== 'string' || !ref.startsWith('#') || options.rootSchema === undefined) return undefined
  const resolved = resolveRef(ref, options.rootSchema) as JSONSchema | undefined
  return resolved !== undefined && isSchemaObject(resolved) && declares(resolved, 'if') ? resolved : undefined
}

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
  const source = isSchemaObject(entry)
    ? declares(entry, 'if')
      ? entry
      : referencedConditional(entry, options)
    : undefined
  if (source === undefined) return wrapUnion(getTypeScriptType(entry, options, depth + 1))
  const own = keywordMap(source, 'properties')
  const merged: Record<string, JSONSchema> = {}
  for (const block of [domain, own]) {
    if (block === undefined) continue
    for (const key of Object.keys(block)) assignKey(merged, key, readKey(block, key))
  }
  const conditional = conditionalMember(source, merged, options, depth + 1)
  const rest = source === entry ? withoutConditional(entry) : entry
  const remainder = wrapUnion(getTypeScriptType(rest, options, depth + 1))
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

/** Joins members with ` | `, dropping duplicates while preserving order. */
const unionOf = (members: readonly string[]): string => [...new Set(members)].join(' | ')

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
  return meaningful.join(' & ')
}

/** Wraps a `Record<...>` in `Readonly<...>` when readonly output is requested. */
const recordType = (keyType: string, valueType: string, options: TypeOptions): string =>
  options.readonly ? `Readonly<Record<${keyType}, ${valueType}>>` : `Record<${keyType}, ${valueType}>`

/**
 * Builds the `Record<…>` type for a schema's `patternProperties`. Every pattern's
 * value type is unioned (deduplicated) rather than only the first being used, so
 * `{ '^a': string-schema, '^b': number-schema }` becomes `Record<string, string |
 * number>` instead of silently dropping the second pattern. The template-literal
 * `` `x-${string}` `` key is kept only when the sole pattern is the `^x-` vendor
 * convention. Returns `undefined` when there are no usable patterns.
 */
const patternPropertiesRecordType = (
  patternProperties: Record<string, JSONSchema | boolean>,
  options: TypeOptions,
  depth: number,
): string | undefined => {
  const entries = Object.entries(patternProperties)
  if (entries.length === 0) return undefined

  const seen = new Set<string>()
  const valueTypes: string[] = []
  for (const [, value] of entries) {
    const valueType =
      typeof value === 'boolean' ? getBooleanSubSchemaType(value) : getTypeScriptType(value, options, depth + 1)
    if (!seen.has(valueType)) {
      seen.add(valueType)
      valueTypes.push(valueType)
    }
  }
  if (valueTypes.length === 0) return undefined

  const valueType = valueTypes.join(' | ')
  // The `^x-` vendor-extension convention maps to a template-literal key, but only
  // when it is the single pattern (a union of key patterns can't be expressed).
  const keyType = entries.length === 1 && entries[0]?.[0] === '^x-' ? '`x-${string}`' : 'string'
  return recordType(keyType, valueType, options)
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
 * The open-ended key signature a schema declares, or undefined when it declares
 * none. Only a *schema-valued* `additionalProperties` counts: `true` is the JSON
 * Schema default, so emitting `[key: string]: unknown` for it would widen nearly
 * every generated type into uselessness, and `false` is a closed object.
 */
const getIndexSignature = (
  schema: SchemaNode,
  options: TypeOptions,
  depth: number,
): { key: string; value: string } | undefined => {
  const additionalProperties = keywordOf(schema, 'additionalProperties')
  if (additionalProperties !== undefined && typeof additionalProperties !== 'boolean') {
    return { key: 'string', value: getTypeScriptType(additionalProperties as JSONSchema, options, depth + 1) }
  }

  const patternProperties = keywordOf(schema, 'patternProperties') as Record<string, JSONSchema> | undefined
  if (patternProperties && typeof patternProperties === 'object') {
    const entries = Object.entries(patternProperties)
    if (entries.length === 0) return undefined
    const valueTypes = entries.map(([, value]) =>
      typeof value === 'boolean' ? getBooleanSubSchemaType(value) : getTypeScriptType(value, options, depth + 1),
    )
    // The `^x-` vendor-extension convention maps to a template-literal key, but
    // only when it is the single pattern (a union of key patterns can't be expressed).
    const key = entries.length === 1 && entries[0]?.[0] === '^x-' ? '`x-${string}`' : 'string'
    return { key, value: unionOf(valueTypes) }
  }

  return undefined
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
  declaredTypes: readonly string[],
  hasOptionalProperty: boolean,
  options: TypeOptions,
): string => {
  const readonlyPrefix = options.readonly ? 'readonly ' : ''
  if (index.key !== 'string') return `${readonlyPrefix}[key: ${index.key}]: ${index.value}`
  const widened = unionOf([
    ...index.value.split(' | '),
    ...declaredTypes,
    ...(hasOptionalProperty ? ['undefined'] : []),
  ])
  return `${readonlyPrefix}[key: string]: ${widened}`
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
 * Renders an `object` schema: a property literal when it declares properties, a
 * `Record`/index type when it only declares open-ended keys, else the bare
 * `object`. Open-ended keys declared *alongside* properties become an index
 * signature inside the literal rather than being dropped.
 */
const objectTypeToTs = (schema: SchemaNode, options: TypeOptions, depth: number): string => {
  const index = getIndexSignature(schema, options, depth)
  const properties = keywordOf(schema, 'properties') as Record<string, JSONSchema> | undefined

  if (properties && Object.keys(properties).length > 0) {
    const readonlyPrefix = options.readonly ? 'readonly ' : ''
    // Build the required-key set once instead of an O(required) `includes`
    // per property (O(properties × required) for a wide object).
    const declaredRequired = keywordOf(schema, 'required')
    const requiredSet = new Set<string>(Array.isArray(declaredRequired) ? (declaredRequired as string[]) : [])
    const hasDescriptions = Object.values(properties).some((p) => propertyDescription(p) !== undefined)

    const declaredTypes: string[] = []
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
      declaredTypes.push(propType)
      const declaration = readonlyPrefix + safeKey(key) + optional + ': ' + propType
      if (!hasDescriptions) {
        entries.push(declaration)
        continue
      }
      const inlineDescription = propertyDescription(propSchema)
      entries.push((inlineDescription ? buildInlinePropertyComment(inlineDescription) : '') + '  ' + declaration + ';')
    }

    if (index) {
      const line = buildIndexSignatureLine(index, declaredTypes, hasOptionalProperty, options)
      entries.push(hasDescriptions ? '  ' + line + ';' : line)
    }

    // Descriptions force the multi-line layout — an inline `/** … */` per
    // property would otherwise run the whole literal together on one line.
    if (hasDescriptions) return '{\n' + entries.join('\n') + '\n}'
    return '{ ' + entries.join('; ') + ' }'
  }

  if (index) {
    return index.key === 'string' && !options.readonly
      ? recordType('string', index.value, options)
      : recordType(index.key, index.value, options)
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
    const index = getIndexSignature(schema, options, depth)
    if (index) return objectTypeToTs(schema, options, depth)

    const additionalProperties = keywordOf(schema, 'additionalProperties')
    if (typeof additionalProperties === 'boolean') {
      return recordType('string', getBooleanSubSchemaType(additionalProperties), options)
    }

    const properties = keywordOf(schema, 'properties')
    if (properties && Object.keys(properties).length > 0) return objectTypeToTs(schema, options, depth)

    const defaultValue = keywordOf(schema, 'default')
    if (defaultValue !== undefined) {
      if (typeof defaultValue === 'string') return 'string'
      if (typeof defaultValue === 'number') return 'number'
      if (typeof defaultValue === 'boolean') return 'boolean'
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
    const union = unionOf(unionBranches.map((branch) => getTypeScriptType(branch, options, depth + 1)))
    // A lone union is the whole type; alongside other members it is one factor
    // of an intersection and needs its own parentheses.
    if (members.length === 0 && !Array.isArray(allOf)) return union
    members.push(wrapUnion(union))
  }

  if (members.length === 0) return 'unknown'
  return intersectionOf(members)
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

  const allOf = keywordOf(schema, 'allOf')
  if (Array.isArray(allOf)) {
    const domain = keywordMap(schema, 'properties')
    for (const entry of allOf) members.push(allOfMember(entry as JSONSchema, domain, options, depth))
  }

  const ref = keywordOf(schema, '$ref')
  if (typeof ref === 'string') {
    members.push(refTypeName(ref, options))
  }

  const unionBranches = unionBranchesOf(schema)
  if (unionBranches) {
    members.push(wrapUnion(unionOf(unionBranches.map((branch) => getTypeScriptType(branch, options, depth + 1)))))
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

    // Handle objects with only patternProperties (no fixed properties)
    if (!hasProperties && hasPatternProperties) {
      const record = patternPropertiesRecordType(patternProperties, options, 0) ?? 'Record<string, unknown>'

      let result = ''
      if (jsDocTitle && jsDocDescription) {
        result += buildJsDocBlock(jsDocTitle, jsDocDescription)
      }
      result += `export type ${typeName} = ${record};`

      return result
    }

    // Handle objects with only additionalProperties (no fixed properties)
    if (!hasProperties && hasAdditionalProperties) {
      const additionalPropType = getTypeScriptType(additionalProperties as JSONSchema, options, 0)

      let result = ''
      if (jsDocTitle && jsDocDescription) {
        result += buildJsDocBlock(jsDocTitle, jsDocDescription)
      }
      result += `export type ${typeName} = {\n  ${readonlyPrefix}[key: string]: ${additionalPropType};\n};`

      return result
    }

    const schemaProps = declaredProperties ?? {}
    const declaredRequired = keywordOf(schema, 'required')
    const requiredSet = new Set<string>(Array.isArray(declaredRequired) ? (declaredRequired as string[]) : [])
    const declaredTypes: string[] = []
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
      declaredTypes.push(propType)
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
    const index = getIndexSignature(schema, options, 0)
    if (index) {
      appendLine('  ' + buildIndexSignatureLine(index, declaredTypes, hasOptionalProperty, options) + ';')
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
