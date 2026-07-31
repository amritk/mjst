import type { JSONSchema } from 'json-schema-typed/draft-2020-12'

import { getMjstBrand, getMjstInstanceOf, getMjstPrimitive } from './mjst-extension'
import { refToName } from './ref-to-name'
import { resolveRef } from './resolve-ref'
import { safeKey } from './safe-accessor'
import { isObjectSchema, isSchemaObject } from './schema-guards'

/**
 * Any schema that is not a boolean shorthand. Broader than `JSONSchema.Object`,
 * which narrows `type` to `'object'` and so hides array keywords like `items`.
 */
type SchemaNode = Exclude<JSONSchema, boolean>

type ConditionalObjectResult = {
  schema: JSONSchema.Object
  thenRef: string | null
}

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

const getConditionalObjectSchema = (schema: JSONSchema): ConditionalObjectResult | null => {
  if (!isSchemaObject(schema)) {
    return null
  }

  if (!('if' in schema) || !('then' in schema)) {
    return null
  }

  const ifSchema = schema.if
  const thenSchema = schema.then

  if (!isSchemaObject(ifSchema) || !isSchemaObject(thenSchema)) {
    return null
  }

  const ownProperties = schema.properties
  const ifProperties = ifSchema.properties
  const thenProperties = thenSchema.properties
  const hasOwnProperties = ownProperties && typeof ownProperties === 'object'
  const hasIfProperties = ifProperties && typeof ifProperties === 'object'
  const hasThenProperties = thenProperties && typeof thenProperties === 'object'

  if (!hasIfProperties && !hasThenProperties) {
    return null
  }

  // The conditional fragments are merged *onto* the schema's own properties —
  // a schema is allowed to declare `properties` alongside `if`/`then`, and
  // reading only the conditional halves silently dropped everything it declared
  // unconditionally.
  const properties = {
    ...(hasOwnProperties ? ownProperties : {}),
    ...(hasIfProperties ? ifProperties : {}),
    ...(hasThenProperties ? thenProperties : {}),
  }

  const required = new Set<string>()

  if (Array.isArray(schema.required)) {
    for (const key of schema.required) {
      required.add(key)
    }
  }

  if (Array.isArray(ifSchema.required)) {
    for (const key of ifSchema.required) {
      required.add(key)
    }
  }

  if (hasIfProperties) {
    for (const key in ifProperties) {
      required.add(key)
    }
  }

  if (Array.isArray(thenSchema.required)) {
    for (const key of thenSchema.required) {
      required.add(key)
    }
  }

  if (hasThenProperties) {
    for (const key in thenProperties) {
      required.add(key)
    }
  }

  const thenRef = typeof thenSchema.$ref === 'string' ? thenSchema.$ref : null

  return {
    schema: {
      type: 'object',
      properties,
      ...(required.size > 0 ? { required: Array.from(required) } : {}),
    },
    thenRef,
  }
}

const isObjectLikeSchema = (schema: JSONSchema): schema is JSONSchema.Object => {
  if (!isSchemaObject(schema)) {
    return false
  }

  if (isObjectSchema(schema)) {
    return true
  }

  return 'patternProperties' in schema || 'additionalProperties' in schema || ('if' in schema && 'then' in schema)
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

const buildJsDocBlock = (title: string, description: string, commentUrl?: string): string => {
  let block = `/**\n`
  block += `* ${title}\n`
  block += `*\n`
  block += renderJsDocBody(description, '')
  if (commentUrl?.startsWith('http')) {
    block += `* \n`
    block += `* @see {@link ${commentUrl}}\n`
  }
  block += `*/\n`
  return block
}

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
const getTypeScriptType = (schema: JSONSchema, options: TypeOptions = {}): string => {
  const base = getUnbrandedType(schema, options)
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
  isSchemaObject(schema) && (schema as Record<string, unknown>)['nullable'] === true

/** Parenthesizes a union so it composes safely inside `[]`, `&`, or an optional marker. */
const wrapUnion = (type: string): string => (type.includes(' | ') ? `(${type})` : type)

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
): string | undefined => {
  const entries = Object.entries(patternProperties)
  if (entries.length === 0) return undefined

  const seen = new Set<string>()
  const valueTypes: string[] = []
  for (const [, value] of entries) {
    const valueType = typeof value === 'boolean' ? getBooleanSubSchemaType(value) : getTypeScriptType(value, options)
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
 */
const getTuplePositions = (schema: SchemaNode): readonly JSONSchema[] | undefined => {
  const record = schema as Record<string, unknown>
  const prefixItems = record['prefixItems']
  if (Array.isArray(prefixItems) && prefixItems.length > 0) return prefixItems as JSONSchema[]
  if (Array.isArray(schema.items) && schema.items.length > 0) return schema.items as JSONSchema[]
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
const tupleTypeToTs = (schema: SchemaNode, positions: readonly JSONSchema[], options: TypeOptions): string => {
  const record = schema as Record<string, unknown>
  // With the draft-07 spelling `items` *is* the tuple, so the rest schema is
  // `additionalItems`; with `prefixItems` it is the sibling `items`.
  const rest = Array.isArray(schema.items) ? record['additionalItems'] : record['items']
  const minItems = typeof schema.minItems === 'number' ? schema.minItems : 0

  const parts: string[] = []
  for (let i = 0; i < positions.length; i++) {
    const positionType = wrapUnion(getTypeScriptType(positions[i] as JSONSchema, options))
    parts.push(i < minItems ? positionType : `${positionType}?`)
  }

  if (rest !== false) {
    const restType =
      rest === undefined || rest === true ? 'unknown' : wrapUnion(getTypeScriptType(rest as JSONSchema, options))
    parts.push(`...${restType}[]`)
  }

  const tuple = `[${parts.join(', ')}]`
  return options.readonly ? `readonly ${tuple}` : tuple
}

/** Renders the TypeScript type for an `array` schema — tuple, typed list, or bare list. */
const arrayTypeToTs = (schema: SchemaNode, options: TypeOptions): string => {
  const positions = getTuplePositions(schema)
  if (positions) return tupleTypeToTs(schema, positions, options)

  if (schema.items !== undefined && !Array.isArray(schema.items)) {
    const itemType = getTypeScriptType(schema.items, options)
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
const getIndexSignature = (schema: SchemaNode, options: TypeOptions): { key: string; value: string } | undefined => {
  const additionalProperties = schema.additionalProperties
  if (additionalProperties !== undefined && typeof additionalProperties !== 'boolean') {
    return { key: 'string', value: getTypeScriptType(additionalProperties, options) }
  }

  const patternProperties = schema.patternProperties
  if (patternProperties && typeof patternProperties === 'object') {
    const entries = Object.entries(patternProperties)
    if (entries.length === 0) return undefined
    const valueTypes = entries.map(([, value]) =>
      typeof value === 'boolean' ? getBooleanSubSchemaType(value) : getTypeScriptType(value, options),
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
  if (typeof propSchema.description === 'string') return propSchema.description
  if (typeof propSchema.$comment === 'string') return propSchema.$comment
  return undefined
}

/**
 * Renders an `object` schema: a property literal when it declares properties, a
 * `Record`/index type when it only declares open-ended keys, else the bare
 * `object`. Open-ended keys declared *alongside* properties become an index
 * signature inside the literal rather than being dropped.
 */
const objectTypeToTs = (schema: SchemaNode, options: TypeOptions): string => {
  const index = getIndexSignature(schema, options)

  if (schema.properties && Object.keys(schema.properties).length > 0) {
    const readonlyPrefix = options.readonly ? 'readonly ' : ''
    // Build the required-key set once instead of an O(required) `includes`
    // per property (O(properties × required) for a wide object).
    const requiredSet = new Set<string>(Array.isArray(schema.required) ? schema.required : [])
    const hasDescriptions = Object.values(schema.properties).some((p) => propertyDescription(p) !== undefined)

    const declaredTypes: string[] = []
    let hasOptionalProperty = false
    // Entries are emitted ready to place: multi-line layout wants each
    // declaration indented and `;`-terminated (with its JSDoc block already
    // carrying its own indent), the compact one wants bare declarations.
    const entries: string[] = []
    for (const key in schema.properties) {
      // schema.properties[key] is safe: key comes from iterating schema.properties
      const propSchema = schema.properties[key] as JSONSchema
      const isRequired = requiredSet.has(key)
      const optional = isRequired ? '' : '?'
      if (!isRequired) hasOptionalProperty = true
      const propType = getTypeScriptType(propSchema, options)
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
const getLocalShapeType = (schema: SchemaNode, options: TypeOptions): string | undefined => {
  // Object-like conditional schemas (`if`/`then`) describe one merged shape.
  const conditionalResult = getConditionalObjectSchema(schema)
  if (conditionalResult) {
    const baseType = objectTypeToTs(conditionalResult.schema, options)
    return conditionalResult.thenRef
      ? `(${baseType}) & ${refToName(conditionalResult.thenRef, options.typeSuffix)}`
      : baseType
  }

  if (!schema.type) {
    const index = getIndexSignature(schema, options)
    if (index) return objectTypeToTs(schema, options)

    if (schema.additionalProperties !== undefined && typeof schema.additionalProperties === 'boolean') {
      return recordType('string', getBooleanSubSchemaType(schema.additionalProperties), options)
    }

    if (schema.properties && Object.keys(schema.properties).length > 0) return objectTypeToTs(schema, options)

    if (schema.default !== undefined) {
      if (typeof schema.default === 'string') return 'string'
      if (typeof schema.default === 'number') return 'number'
      if (typeof schema.default === 'boolean') return 'boolean'
    }

    return undefined
  }

  // Array-form `type` (the multi-type / nullable idiom, e.g. `["object","null"]`)
  // is a union of the per-type renderings. Each member is rendered from the SAME
  // schema, so a nullable object keeps its properties and a nullable array keeps
  // its item type instead of collapsing to `Record<string, unknown>` / `unknown[]`.
  if (Array.isArray(schema.type)) {
    return unionOf(schema.type.map((type) => singleTypeToTs(schema, type, options)))
  }

  return singleTypeToTs(schema, schema.type, options)
}

/** Renders one JSON Schema `type` value against the schema that declared it. */
const singleTypeToTs = (schema: SchemaNode, type: JSONSchema.TypeValue, options: TypeOptions): string => {
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
      return arrayTypeToTs(schema, options)
    case 'object': {
      const rendered = objectTypeToTs(schema, options)
      // A shapeless object inside a union reads better as an indexable record
      // than as the bare `object`, which cannot be indexed at all.
      return rendered === 'object' && Array.isArray(schema.type) ? recordType('string', 'unknown', options) : rendered
    }
    default:
      return 'unknown'
  }
}

/**
 * Converts a JSON Schema type to its TypeScript equivalent, ignoring any brand.
 * Recursively handles nested objects and arrays.
 */
const getUnbrandedType = (schema: JSONSchema, options: TypeOptions = {}): string => {
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
  if (schema.$ref) {
    return refTypeName(schema.$ref, options)
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
  if (schema.$dynamicRef) {
    return 'unknown'
  }

  // Handle const - literal type
  if (schema.const !== undefined) {
    return JSON.stringify(schema.const)
  }

  // Handle enum - union of literal types
  if (schema.enum && schema.enum.length > 0) {
    return unionOf(schema.enum.map((value) => JSON.stringify(value)))
  }

  // A schema may declare a shape of its own *and* compose others. Returning
  // either alone silently drops half of what the document says, so the local
  // shape, the `oneOf`/`anyOf` union, and every `allOf` member are combined into
  // one intersection.
  const members: string[] = []
  const localType = getLocalShapeType(schema, options)
  if (localType !== undefined) members.push(localType)

  if (Array.isArray(schema.allOf)) {
    for (const entry of schema.allOf) members.push(wrapUnion(getTypeScriptType(entry, options)))
  }

  const branches = Array.isArray(schema.oneOf) && schema.oneOf.length > 0 ? schema.oneOf : undefined
  const anyBranches = Array.isArray(schema.anyOf) && schema.anyOf.length > 0 ? schema.anyOf : undefined
  const unionBranches = branches ?? anyBranches
  if (unionBranches) {
    const union = unionOf(unionBranches.map((branch) => getTypeScriptType(branch, options)))
    // A lone union is the whole type; alongside other members it is one factor
    // of an intersection and needs its own parentheses.
    if (members.length === 0 && !Array.isArray(schema.allOf)) return union
    members.push(wrapUnion(union))
  }

  if (members.length === 0) return 'unknown'
  return intersectionOf(members)
}

/**
 * The types a schema composes alongside its own property block: every `allOf`
 * member, a sibling `$ref` (2019-09+ allows one next to other keywords), and a
 * sibling `oneOf`/`anyOf` union. Each is intersected onto the body — an `allOf`
 * member written inline rather than as a `$ref` used to be dropped outright,
 * taking its properties and its `required` list with it.
 */
const getCompositionMembers = (schema: JSONSchema, options: TypeOptions): string[] => {
  if (!isSchemaObject(schema)) return []
  const members: string[] = []

  if (Array.isArray(schema.allOf)) {
    for (const entry of schema.allOf) members.push(wrapUnion(getTypeScriptType(entry, options)))
  }

  if (typeof schema.$ref === 'string') {
    members.push(refTypeName(schema.$ref, options))
  }

  const unionBranches =
    Array.isArray(schema.oneOf) && schema.oneOf.length > 0
      ? schema.oneOf
      : Array.isArray(schema.anyOf) && schema.anyOf.length > 0
        ? schema.anyOf
        : undefined
  if (unionBranches) {
    members.push(wrapUnion(unionOf(unionBranches.map((branch) => getTypeScriptType(branch, options)))))
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
  if (!isObjectLikeSchema(schema) || (isSchemaObject(schema) && Array.isArray(schema.type))) {
    const tsType = getTypeScriptType(schema, options)
    let result = ''

    const topLevelComment =
      (isSchemaObject(schema) && typeof schema.description === 'string' && schema.description) ||
      (isSchemaObject(schema) && typeof schema.$comment === 'string' && schema.$comment) ||
      undefined
    if (topLevelComment) {
      result += buildJsDocBlock(typeName, topLevelComment)
    }

    result += `export type ${typeName} = ${tsType};`
    return result
  }

  if (isObjectLikeSchema(schema)) {
    const conditionalResult = getConditionalObjectSchema(schema)
    const normalizedSchema = conditionalResult?.schema ?? schema
    const conditionalThenRef = conditionalResult?.thenRef ?? null
    let jsDocTitle: string | undefined
    let jsDocDescription: string | undefined

    const topLevelComment =
      (isSchemaObject(schema) && typeof schema.description === 'string' && schema.description) ||
      (isSchemaObject(schema) && typeof schema.$comment === 'string' && schema.$comment) ||
      undefined
    if (topLevelComment) {
      jsDocTitle = typeName
      jsDocDescription = topLevelComment
    }

    const hasProperties = normalizedSchema.properties && Object.keys(normalizedSchema.properties).length > 0
    const hasAdditionalProperties =
      normalizedSchema.additionalProperties && typeof normalizedSchema.additionalProperties === 'object'
    const hasPatternProperties =
      normalizedSchema.patternProperties &&
      typeof normalizedSchema.patternProperties === 'object' &&
      Object.keys(normalizedSchema.patternProperties).length > 0

    // Handle objects with only patternProperties (no fixed properties)
    if (!hasProperties && hasPatternProperties && normalizedSchema.patternProperties) {
      const record =
        patternPropertiesRecordType(normalizedSchema.patternProperties, options) ?? 'Record<string, unknown>'

      let result = ''
      if (jsDocTitle && jsDocDescription) {
        result += buildJsDocBlock(jsDocTitle, jsDocDescription)
      }
      result += `export type ${typeName} = ${record};`

      return result
    }

    // Handle objects with only additionalProperties (no fixed properties)
    if (!hasProperties && hasAdditionalProperties && normalizedSchema.additionalProperties) {
      const additionalPropType = getTypeScriptType(normalizedSchema.additionalProperties, options)

      let result = ''
      if (jsDocTitle && jsDocDescription) {
        result += buildJsDocBlock(jsDocTitle, jsDocDescription)
      }
      result += `export type ${typeName} = {\n  ${readonlyPrefix}[key: string]: ${additionalPropType};\n};`

      return result
    }

    const schemaProps = normalizedSchema.properties ?? {}
    const requiredSet = new Set<string>(Array.isArray(normalizedSchema.required) ? normalizedSchema.required : [])
    const declaredTypes: string[] = []
    let hasOptionalProperty = false
    let properties = ''
    let isFirstProp = true
    const appendLine = (line: string): void => {
      if (!isFirstProp) properties += '\n'
      isFirstProp = false
      properties += line
    }
    for (const key in schemaProps) {
      // schemaProps[key] is safe: key comes from iterating schemaProps
      const propSchema = schemaProps[key]!
      const isRequired = requiredSet.has(key)
      const optional = isRequired ? '' : '?'
      if (!isRequired) hasOptionalProperty = true
      const propType = getTypeScriptType(propSchema, options)
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
    const index = getIndexSignature(normalizedSchema, options)
    if (index) {
      appendLine('  ' + buildIndexSignatureLine(index, declaredTypes, hasOptionalProperty, options) + ';')
    }

    let result = ''
    if (jsDocTitle && jsDocDescription) {
      result += buildJsDocBlock(jsDocTitle, jsDocDescription)
    }

    let typeBody = properties === '' ? '{}' : '{\n' + properties + '\n}'

    if (conditionalThenRef) {
      typeBody += ' & ' + refToName(conditionalThenRef, options.typeSuffix)
    }

    for (const intersectionType of getCompositionMembers(schema, options)) {
      typeBody += ' & ' + intersectionType
    }

    if (isNullableSchema(schema)) typeBody = withNull(typeBody)

    result += 'export type ' + typeName + ' = ' + typeBody + ';'

    return result
  }

  return 'export type ' + typeName + ' = unknown;'
}
