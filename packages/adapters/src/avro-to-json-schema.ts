import type { JSONSchema } from 'json-schema-typed/draft-2020-12'

import type { AdapterOptions } from './adapter'
import { reportLossyConstructs } from './report-lossy-constructs'

/**
 * Which JSON shape the produced schema describes.
 *
 * Avro is a binary format with a *separately specified* JSON encoding, and the
 * two readings of "the JSON for this Avro schema" genuinely disagree — most
 * visibly on unions, where the spec wraps a value in its branch name
 * (`{"string": "hi"}`) and application code almost never does. One converter
 * cannot serve both silently, so the caller picks.
 *
 * - `'json'` (default) describes the **idiomatic** object an application sees
 *   after decoding: unions are plain `anyOf`, a `["null", T]` union is just a
 *   nullable `T`, and `bytes` is base64. This is the shape you want when
 *   generating TypeScript types and parsers.
 * - `'avro-json'` describes the **spec's JSON encoding** — the bytes that
 *   actually travel under the `application/vnd.apache.avro+json` media type.
 *   Unions become single-key wrapper objects and `bytes` is the spec's
 *   codepoint-per-byte string. This is the shape to validate an AsyncAPI
 *   `examples.payload` against.
 */
export type AvroEncoding = 'json' | 'avro-json'

/** Options for {@link avroToJsonSchema}; `encoding` is read by this adapter alone. */
export type AvroAdapterOptions = AdapterOptions & {
  /** Which JSON shape to describe. Defaults to `'json'` (idiomatic). */
  readonly encoding?: AvroEncoding
}

/**
 * The JSON Schema type names this adapter emits. Kept as a literal tuple so a
 * collapsed union (`{ type: ['string', 'null'] }`) type-checks against the
 * `type` keyword without a cast — a bare `string[]` does not.
 */
const JSON_TYPE_NAMES = ['null', 'boolean', 'integer', 'number', 'string', 'object', 'array'] as const

type JsonTypeName = (typeof JSON_TYPE_NAMES)[number]

/**
 * A single Avro name, per the spec: `[A-Za-z_][A-Za-z0-9_]*`. A fullname is one
 * or more of these joined by dots.
 *
 * Validated rather than trusted because a name lands verbatim in a `$defs` key
 * and in the `$ref` pointing at it. A name containing `/` or `~` silently
 * produced a *different*, broken JSON Pointer — `#/$defs/a~b/c` parses as
 * `$defs` -> `a~b` -> `c` — so the schema referenced a definition that was never
 * written. Rejecting is the only safe answer; the spec forbids such a name anyway.
 */
const NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/

/** Throws unless `fullname` is a dot-separated sequence of legal Avro names. */
const assertLegalFullname = (fullname: string, what: string): void => {
  const parts = fullname.split('.')
  if (parts.every((part) => NAME_PATTERN.test(part))) return

  throw new Error(
    `Avro adapter: ${what} "${fullname}" is not a legal Avro name. ` +
      'Each dot-separated part must match [A-Za-z_][A-Za-z0-9_]*.',
  )
}

/** Avro's eight primitive type names. */
const PRIMITIVES = new Set(['null', 'boolean', 'int', 'long', 'float', 'double', 'bytes', 'string'])

/** The named types — the ones that claim a fullname and can be referenced later. */
const NAMED_TYPES = new Set(['record', 'enum', 'fixed'])

/**
 * `int` is a 32-bit signed integer, and both bounds land exactly on a double, so
 * they are worth stating. `long` deliberately gets *no* bounds: its limits are
 * ±2^63, which no JSON number can hold — writing `9223372036854775807` into a
 * schema silently rounds it up to 2^63 and produces a `maximum` that is both
 * wrong and unreachable. A bare `integer` is the honest description, with the
 * caveat that a `long` past 2^53 cannot survive `JSON.parse` either way.
 */
const INT_MIN = -2147483648
const INT_MAX = 2147483647

/**
 * In Avro's JSON encoding a `bytes` (or `fixed`) value is a string in which each
 * character is the codepoint of one byte, so the whole value lives in U+0000–
 * U+00FF. That is exactly expressible as a pattern, which is worth doing: it is
 * the one check that catches a base64 payload pasted where the spec wants
 * latin-1.
 */
const BYTE_STRING_PATTERN = '^[\\u0000-\\u00ff]*$'

/** State threaded through the recursive walk. */
type Context = {
  /** The namespace unqualified names inside the current node resolve against. */
  readonly namespace: string | undefined
  /** Named types converted so far, keyed by fullname — becomes the root `$defs`. */
  readonly defs: Map<string, JSONSchema>
  /**
   * Fullnames of `fixed` definitions seen so far. Needed to decide whether a
   * field `default` is a byte string, which is a question about the *Avro* type
   * and cannot be answered from the converted JSON Schema once a named type has
   * collapsed to a `$ref`.
   */
  readonly byteTypes: Set<string>
  readonly encoding: AvroEncoding
  /** Constructs widened during conversion, reported once at the end. */
  readonly lossy: Set<string>
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** Reads an own string property, ignoring anything inherited or wrongly typed. */
const readString = (source: Record<string, unknown>, key: string): string | undefined => {
  if (!Object.hasOwn(source, key)) return undefined
  const value = source[key]
  return typeof value === 'string' ? value : undefined
}

/**
 * The namespace half of a fullname, or undefined when the name is unqualified.
 * Child nodes inherit this, which is how a record's fields may refer to a
 * sibling type by its short name.
 */
const namespaceOf = (fullname: string): string | undefined => {
  const lastDot = fullname.lastIndexOf('.')
  return lastDot === -1 ? undefined : fullname.slice(0, lastDot)
}

/**
 * Builds the fullname of a *definition*.
 *
 * The spec's precedence is worth spelling out because it is easy to get
 * backwards: a `name` that already contains a dot **is** a fullname and the
 * `namespace` attribute is ignored outright; only an unqualified name takes the
 * `namespace` attribute, and only when that attribute is absent does the name
 * fall back to the enclosing namespace. An explicit empty `namespace` is
 * meaningful — it puts the type in the null namespace, overriding the enclosing
 * one — so it is distinguished from an absent attribute rather than coalesced.
 */
const definitionFullname = (node: Record<string, unknown>, context: Context): string => {
  const name = readString(node, 'name')
  if (name === undefined || name === '') {
    throw new Error(`Avro adapter: a ${String(node['type'])} definition is missing its required "name".`)
  }
  const fullname = ((): string => {
    if (name.includes('.')) return name

    const declared = readString(node, 'namespace')
    if (declared !== undefined) return declared === '' ? name : `${declared}.${name}`

    return context.namespace === undefined ? name : `${context.namespace}.${name}`
  })()

  assertLegalFullname(fullname, 'the name')
  return fullname
}

/**
 * Resolves a *reference* to a previously defined type.
 *
 * A dotted reference is already a fullname. An unqualified one is tried against
 * the enclosing namespace first and only then as a null-namespace name, which is
 * the order the spec's resolution rules imply — a sibling in the same namespace
 * should win over an unrelated top-level type of the same short name.
 */
const resolveReference = (name: string, context: Context): string => {
  assertLegalFullname(name, 'the reference')
  if (name.includes('.')) return name

  const qualified = context.namespace === undefined ? undefined : `${context.namespace}.${name}`
  if (qualified !== undefined && context.defs.has(qualified)) return qualified

  return name
}

/** A `$ref` into the root `$defs`, which is where every named type lands. */
const refTo = (fullname: string): JSONSchema => ({ $ref: `#/$defs/${fullname}` })

/**
 * The single `type` keyword of a schema that carries nothing else, or undefined.
 *
 * Used to collapse a union of bare primitives into one `type` array, so the
 * overwhelmingly common `["null", "string"]` comes out as
 * `{ type: ['string', 'null'] }` instead of a two-branch `anyOf` that says the
 * same thing at three times the size.
 */
const soleTypeOf = (schema: JSONSchema): JsonTypeName | undefined => {
  if (!isRecord(schema)) return undefined
  const keys = Object.keys(schema)
  if (keys.length !== 1 || keys[0] !== 'type') return undefined
  const type = schema['type']
  return JSON_TYPE_NAMES.find((name): name is JsonTypeName => name === type)
}

/** Maps one of Avro's eight primitives onto its JSON Schema counterpart. */
const convertPrimitive = (type: string, context: Context): JSONSchema => {
  switch (type) {
    case 'null':
      return { type: 'null' }
    case 'boolean':
      return { type: 'boolean' }
    case 'int':
      return { type: 'integer', minimum: INT_MIN, maximum: INT_MAX }
    case 'long':
      return { type: 'integer' }
    case 'float':
    case 'double':
      return { type: 'number' }
    case 'string':
      return { type: 'string' }
    case 'bytes':
      return context.encoding === 'avro-json'
        ? { type: 'string', pattern: BYTE_STRING_PATTERN }
        : { type: 'string', contentEncoding: 'base64' }
    default:
      throw new Error(`Avro adapter: unknown primitive type "${type}".`)
  }
}

/**
 * Applies a `logicalType` on top of an already-converted base schema.
 *
 * This refines far less than people expect, and that is not an omission. Avro's
 * logical types annotate a base type without changing how it is encoded, so a
 * `timestamp-millis` is a `long` on the wire and in the JSON encoding alike —
 * emitting `format: 'date-time'` for it would describe a string that never
 * arrives. Only `uuid` genuinely narrows its base (a string that is a UUID).
 *
 * `decimal` and `duration` carry structure JSON Schema cannot express
 * (precision/scale; three unsigned 32-bit ints packed into 12 bytes), so they
 * degrade to their base type and are reported as widened.
 *
 * An unrecognised logical type falls through to the base type silently, which
 * the spec requires: a reader that does not understand a logical type "should
 * ignore it" and use the underlying Avro type.
 */
const applyLogicalType = (base: JSONSchema, logicalType: string, context: Context): JSONSchema => {
  switch (logicalType) {
    case 'uuid':
      // Narrow only a bare string. A `fixed` under `'json'` carries
      // contentEncoding, and a base64 blob is not a UUID by the `uuid` format.
      return soleTypeOf(base) === 'string' ? { ...(base as object), format: 'uuid' } : base
    case 'decimal':
      context.lossy.add('the decimal logical type (precision/scale)')
      return base
    case 'duration':
      context.lossy.add('the duration logical type')
      return base
    default:
      return base
  }
}

/**
 * Converts an Avro union.
 *
 * The two encodings diverge here more than anywhere else. Idiomatically a union
 * is just the choice between its branches. In the spec's JSON encoding every
 * non-null branch is wrapped in a single-key object naming the branch — the
 * *fullname* for a named type, the type name for a primitive — because JSON
 * alone cannot say which branch a value came from. `null` is the one exception:
 * it is written bare, unwrapped.
 */
const convertUnion = (branches: readonly unknown[], context: Context): JSONSchema => {
  if (branches.length === 0) {
    throw new Error('Avro adapter: a union must have at least one branch, but an empty array was found.')
  }

  if (context.encoding === 'avro-json') {
    const wrapped = branches.map((branch) => {
      const schema = convertSchema(branch, context)
      if (soleTypeOf(schema) === 'null') return schema

      const tag = avroJsonBranchName(branch, context)
      return {
        type: 'object',
        properties: { [tag]: schema },
        required: [tag],
        additionalProperties: false,
      } satisfies JSONSchema
    })
    return wrapped.length === 1 ? (wrapped[0] as JSONSchema) : { anyOf: wrapped }
  }

  const converted = branches.map((branch) => convertSchema(branch, context))
  if (converted.length === 1) return converted[0] as JSONSchema

  // Every branch a bare `{type: 'x'}` means the whole union is expressible as a
  // single `type` array, which reads far better for the `["null", T]` case that
  // dominates real schemas.
  const types = converted.map(soleTypeOf)
  if (types.every((type): type is JsonTypeName => type !== undefined)) {
    // De-duplicated, because two distinct Avro types can share one JSON Schema
    // type: `["float", "double"]` is a legal union (the spec only forbids two
    // branches of the *same* type) and both map to a bare `number`. Emitting
    // `{type: ['number', 'number']}` violates the metaschema, which requires the
    // members to be unique — Ajv refuses to compile it even in non-strict mode.
    // Null last: `string | null` is the conventional order, and the generators
    // render the array in the order given.
    const unique = [...new Set(types)]
    const ordered = [...unique.filter((type) => type !== 'null'), ...unique.filter((type) => type === 'null')]
    // A one-member array is legal but reads badly, and `soleTypeOf` would no
    // longer recognise the result as a bare type if it were nested again.
    const [only] = ordered
    return ordered.length === 1 && only !== undefined ? { type: only } : { type: ordered }
  }

  return { anyOf: converted }
}

/**
 * The key the spec's JSON encoding uses to tag a union branch: a named type's
 * fullname, or the plain type name for everything else.
 */
const avroJsonBranchName = (branch: unknown, context: Context): string => {
  if (typeof branch === 'string') {
    return PRIMITIVES.has(branch) ? branch : resolveReference(branch, context)
  }
  if (isRecord(branch)) {
    const type = readString(branch, 'type')
    if (type !== undefined && NAMED_TYPES.has(type)) return definitionFullname(branch, context)
    // An unnamed type is tagged by its type name; anything else is a reference
    // written in object form (`{"type": "MyEnum"}`) and is tagged by the
    // *fullname* it resolves to, exactly as the string spelling would be.
    // Returning it verbatim tagged `MyEnum` while the branch it wrapped pointed
    // at `#/$defs/ns.MyEnum`, so real wire data matched neither branch.
    if (type !== undefined) {
      return PRIMITIVES.has(type) || type === 'array' || type === 'map' ? type : resolveReference(type, context)
    }
  }
  throw new Error(`Avro adapter: cannot name the union branch ${JSON.stringify(branch)}.`)
}

/**
 * Whether an Avro type is one whose values are byte strings — `bytes`, a
 * `fixed`, or a reference to one.
 *
 * This asks about the *Avro* type rather than the converted schema on purpose.
 * The converted schema for a `fixed` is a `$ref`, and for a nullable byte field
 * it is an `anyOf`, so neither carries the `contentEncoding: 'base64'` marker
 * that an earlier check looked for at the top level — which is exactly how a
 * latin-1 default survived onto `["bytes", "null"]` while being dropped from a
 * plain `bytes`.
 */
const isByteType = (avroType: unknown, context: Context): boolean => {
  if (typeof avroType === 'string') {
    return avroType === 'bytes' || context.byteTypes.has(resolveReference(avroType, context))
  }
  if (!isRecord(avroType)) return false

  const type = readString(avroType, 'type')
  if (type === undefined) return false
  if (type === 'bytes' || type === 'fixed') return true
  // A reference written in object form; a builtin container never is one.
  if (PRIMITIVES.has(type) || NAMED_TYPES.has(type) || type === 'array' || type === 'map') return false
  return isByteType(type, context)
}

/**
 * Translates a field's Avro `default` into the encoding being described, or
 * reports that it cannot be carried at all.
 *
 * Avro states a union's default as a *bare* value of the union's **first**
 * branch — untagged, even though the data itself is tagged under the spec's JSON
 * encoding. So a default copied verbatim into `'avro-json'` output matched none
 * of the wrapper branches it sat beside: `{"type": ["string","null"], "default":
 * "hi"}` produced `default: "hi"` against branches accepting only
 * `{"string": …}` or `null`. Here it is wrapped to match.
 *
 * Under `'json'` the reverse problem: a byte default is written latin-1 and the
 * idiomatic shape is base64, so it is dropped rather than mistranslated. That
 * matters more than a stray annotation would, because `@amritk/generate-parsers`
 * coerces with `default` and would substitute the wrong bytes into real output.
 */
const encodeDefault = (
  avroType: unknown,
  value: unknown,
  context: Context,
): { readonly carried: true; readonly value: unknown } | { readonly carried: false } => {
  // A union states its default as a value of its first branch.
  const target = Array.isArray(avroType) ? avroType[0] : avroType

  if (context.encoding === 'json') {
    return isByteType(target, context) && typeof value === 'string' ? { carried: false } : { carried: true, value }
  }

  if (!Array.isArray(avroType)) return { carried: true, value }
  if (avroType.length === 0) return { carried: false }

  // Null is written bare under the spec's JSON encoding; everything else is
  // tagged with its branch name.
  if (target === 'null') return { carried: true, value }
  return { carried: true, value: { [avroJsonBranchName(target, context)]: value } }
}

/**
 * Converts a record's fields into `properties` / `required`.
 *
 * Avro has no optional fields: every field is present in the encoded data, and a
 * `default` is only consulted during schema resolution, when reading data
 * written against a *different* schema. So under `'avro-json'` every field is
 * required — that is what is actually on the wire.
 *
 * Under `'json'` a field with a `default` becomes optional, because that is the
 * shape application code deals with: a producer that omits `{"name": "x",
 * "type": ["null","string"], "default": null}` is the reason the default is
 * there, and generating `x: string | null` rather than `x?: string | null`
 * forces callers to write out a value the schema already supplies.
 */
const convertFields = (
  fields: readonly unknown[],
  context: Context,
): { properties: Record<string, JSONSchema>; required: string[] } => {
  // Collected in a Map and materialised with `Object.fromEntries`, never by
  // assigning `properties[name]`. A plain assignment of the key `__proto__` — a
  // legal Avro field name — invokes the `Object.prototype` setter instead of
  // creating an own property, so the field vanished from `properties` while
  // still being listed in `required`. With `additionalProperties: false` that
  // schema rejects *every* document: without the key `required` fails, with it
  // `additionalProperties` does. `Object.fromEntries` defines own properties.
  const properties = new Map<string, JSONSchema>()
  const required: string[] = []

  for (const field of fields) {
    if (!isRecord(field)) {
      throw new Error(`Avro adapter: a record field must be an object, but found ${JSON.stringify(field)}.`)
    }
    const name = readString(field, 'name')
    if (name === undefined || name === '') {
      throw new Error('Avro adapter: a record field is missing its required "name".')
    }

    const converted = convertSchema(field['type'], context)
    const doc = readString(field, 'doc')
    const hasDefault = Object.hasOwn(field, 'default')
    const encoded = hasDefault ? encodeDefault(field['type'], field['default'], context) : { carried: false as const }

    properties.set(name, {
      ...(converted as object),
      ...(doc === undefined ? {} : { description: doc }),
      ...(encoded.carried ? { default: encoded.value } : {}),
    } as JSONSchema)

    if (context.encoding === 'avro-json' || !hasDefault) required.push(name)
  }

  return { properties: Object.fromEntries(properties), required }
}

/**
 * Defines a named type (record, enum, fixed) into `$defs` and returns a `$ref`
 * to it.
 *
 * The placeholder written before the body is converted is what makes recursion
 * terminate: a record whose field refers back to itself finds its own fullname
 * already registered and emits a `$ref` instead of recursing forever. Every
 * occurrence — the definition included — comes back as a `$ref`, so a type
 * defined once and used five times is written once.
 */
const defineNamedType = (node: Record<string, unknown>, type: string, context: Context): JSONSchema => {
  const fullname = definitionFullname(node, context)
  if (context.defs.has(fullname)) {
    throw new Error(`Avro adapter: the name "${fullname}" is defined more than once.`)
  }
  context.defs.set(fullname, {})

  const inner: Context = { ...context, namespace: namespaceOf(fullname) }
  const doc = readString(node, 'doc')
  const annotations = {
    title: fullname.slice(fullname.lastIndexOf('.') + 1),
    ...(doc === undefined ? {} : { description: doc }),
  }

  if (type === 'fixed') context.byteTypes.add(fullname)

  // A `logicalType` on a named type has to be applied here, not in the
  // primitives branch of `convertSchema`, which a named type never reaches.
  // `duration` is defined *only* on a `fixed`, so routing it through here is
  // what makes its widening report reachable at all rather than dead code;
  // `decimal` is valid on `bytes` or `fixed`, and only the first half worked.
  const body = convertNamedBody(node, type, inner)
  const logicalType = readString(node, 'logicalType')
  const refined = logicalType === undefined ? body : applyLogicalType(body, logicalType, inner)

  context.defs.set(fullname, { ...annotations, ...(refined as object) } as JSONSchema)
  return refTo(fullname)
}

/** The body of a named type, without the shared name/doc annotations. */
const convertNamedBody = (node: Record<string, unknown>, type: string, context: Context): JSONSchema => {
  if (type === 'record') {
    const fields = node['fields']
    if (!Array.isArray(fields)) {
      throw new Error(`Avro adapter: record "${String(node['name'])}" is missing its required "fields" array.`)
    }
    const { properties, required } = convertFields(fields, context)
    return {
      type: 'object',
      properties,
      ...(required.length > 0 ? { required } : {}),
      // Avro records are closed: the encoding carries exactly the declared
      // fields, so an extra key is a genuine mismatch rather than a passenger.
      additionalProperties: false,
    }
  }

  if (type === 'enum') {
    const symbols = node['symbols']
    if (!Array.isArray(symbols) || !symbols.every((symbol) => typeof symbol === 'string')) {
      throw new Error(`Avro adapter: enum "${String(node['name'])}" needs a "symbols" array of strings.`)
    }
    const fallback = readString(node, 'default')
    return {
      type: 'string',
      enum: [...symbols],
      ...(fallback === undefined ? {} : { default: fallback }),
    }
  }

  // fixed
  const size = node['size']
  if (typeof size !== 'number' || !Number.isInteger(size) || size < 0) {
    throw new Error(`Avro adapter: fixed "${String(node['name'])}" needs a non-negative integer "size".`)
  }
  return context.encoding === 'avro-json'
    ? { type: 'string', pattern: BYTE_STRING_PATTERN, minLength: size, maxLength: size }
    : { type: 'string', contentEncoding: 'base64' }
}

/**
 * Converts any Avro schema node — a type-name string, a union array, or an
 * object — into JSON Schema. This is the recursive heart of the adapter.
 */
const convertSchema = (node: unknown, context: Context): JSONSchema => {
  if (typeof node === 'string') {
    if (PRIMITIVES.has(node)) return convertPrimitive(node, context)

    const fullname = resolveReference(node, context)
    if (!context.defs.has(fullname)) {
      throw new Error(
        `Avro adapter: "${node}" is neither a primitive type nor a name defined earlier in the schema. ` +
          'Avro requires a named type to be defined before it is referenced.',
      )
    }
    return refTo(fullname)
  }

  if (Array.isArray(node)) return convertUnion(node, context)

  if (!isRecord(node)) {
    throw new Error(`Avro adapter: expected a type name, union array, or schema object, but found ${typeof node}.`)
  }

  const type = node['type']
  // A `type` that is itself a schema is legal — it is how a field says
  // `{"type": {"type": "array", "items": "int"}}` — so recurse rather than
  // demanding a string here.
  if (typeof type !== 'string') return convertSchema(type, context)

  if (NAMED_TYPES.has(type)) return defineNamedType(node, type, context)

  if (type === 'array') {
    if (!Object.hasOwn(node, 'items')) {
      throw new Error('Avro adapter: an array type is missing its required "items".')
    }
    return { type: 'array', items: convertSchema(node['items'], context) }
  }

  if (type === 'map') {
    if (!Object.hasOwn(node, 'values')) {
      throw new Error('Avro adapter: a map type is missing its required "values".')
    }
    // No `propertyNames` constraint: a JSON object's keys are strings already,
    // and Avro places no further restriction on a map key.
    return { type: 'object', additionalProperties: convertSchema(node['values'], context) }
  }

  if (PRIMITIVES.has(type)) {
    const base = convertPrimitive(type, context)
    const logicalType = readString(node, 'logicalType')
    return logicalType === undefined ? base : applyLogicalType(base, logicalType, context)
  }

  // Not a builtin, so it is a reference written in object form.
  return convertSchema(type, context)
}

/**
 * Converts an Apache Avro schema (the parsed contents of a `.avsc` file) into a
 * Draft 2020-12 JSON Schema.
 *
 * Every named type — record, enum, fixed — is defined once under its **fullname**
 * in `$defs` and referenced by `$ref` everywhere it appears, including at its
 * own declaration. That keeps a recursive type finite, writes a shared type
 * once, and gives the mjst generators a named node per Avro type, so
 * `com.example.User` generates a `ComExampleUser` type rather than an inline
 * shape repeated at each use site.
 *
 * Two things this deliberately does *not* do, because doing them would describe
 * data that never arrives:
 *
 * - **A `long` gets no bounds.** Its range is ±2^63, which no JSON number can
 *   represent; a stated `maximum` would round to 2^63 and be both wrong and
 *   unreachable. Note that a `long` past 2^53 cannot survive `JSON.parse`
 *   intact either, whatever the schema says.
 * - **Date and time logical types stay integers.** Avro encodes
 *   `timestamp-millis` as a `long` in its JSON encoding as much as in binary, so
 *   `format: 'date-time'` would be a lie. Only `uuid` narrows its base type.
 *
 * Schema resolution features that describe how *two* schemas relate — `aliases`
 * and field `order` — have no place in a single document's shape and are
 * ignored.
 *
 * @example
 * ```ts
 * const avro = {
 *   type: 'record',
 *   name: 'User',
 *   namespace: 'com.example',
 *   fields: [
 *     { name: 'id', type: 'string' },
 *     { name: 'nickname', type: ['null', 'string'], default: null },
 *   ],
 * }
 *
 * avroToJsonSchema(avro)
 * // {
 * //   $ref: '#/$defs/com.example.User',
 * //   $defs: {
 * //     'com.example.User': {
 * //       title: 'User',
 * //       type: 'object',
 * //       properties: {
 * //         id: { type: 'string' },
 * //         nickname: { type: ['string', 'null'], default: null },
 * //       },
 * //       required: ['id'],
 * //       additionalProperties: false,
 * //     },
 * //   },
 * // }
 *
 * // The same schema as it travels under application/vnd.apache.avro+json:
 * avroToJsonSchema(avro, { encoding: 'avro-json' })
 * // nickname becomes anyOf: [{type:'null'}, {type:'object', properties:{string:…}}]
 * // and is required, because Avro's encoding carries every declared field.
 * ```
 */
export const avroToJsonSchema = (source: unknown, options?: AvroAdapterOptions): JSONSchema => {
  if (typeof source === 'string' && !PRIMITIVES.has(source)) {
    throw new Error(
      `Avro adapter: "${source}" is not an Avro primitive type name. ` +
        'Pass the parsed contents of the .avsc file, not the file text itself.',
    )
  }

  const context: Context = {
    namespace: undefined,
    defs: new Map(),
    byteTypes: new Set(),
    encoding: options?.encoding ?? 'json',
    lossy: new Set(),
  }

  const root = convertSchema(source, context)
  reportLossyConstructs('Avro', context.lossy, options?.strict)

  if (context.defs.size === 0) return root
  return { ...(root as object), $defs: Object.fromEntries(context.defs) } as JSONSchema
}
