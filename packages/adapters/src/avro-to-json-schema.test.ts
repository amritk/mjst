import { buildSchema } from '@amritk/generate-parsers'
import { describe, expect, it, vi } from 'vitest'

import { avroToJsonSchema } from './avro-to-json-schema'

/** Most cases only care about the one named type the schema defines. */
const rootDef = (schema: unknown): Record<string, unknown> => {
  const doc = schema as { $ref: string; $defs: Record<string, Record<string, unknown>> }
  const fullname = doc.$ref.replace('#/$defs/', '')
  return doc.$defs[fullname] as Record<string, unknown>
}

/** A one-field record, so field-level mappings can be asserted in isolation. */
const recordWith = (field: Record<string, unknown>) => ({
  type: 'record',
  name: 'Root',
  fields: [field],
})

const fieldSchema = (avro: unknown, options?: Parameters<typeof avroToJsonSchema>[1]): unknown =>
  (rootDef(avroToJsonSchema(avro, options))['properties'] as Record<string, unknown>)['value']

describe('avro-to-json-schema', () => {
  it('maps the eight primitive types', () => {
    const primitives = ['null', 'boolean', 'int', 'long', 'float', 'double', 'bytes', 'string']
    const converted = primitives.map((type) => fieldSchema(recordWith({ name: 'value', type })))

    expect(converted).toEqual([
      { type: 'null' },
      { type: 'boolean' },
      { type: 'integer', minimum: -2147483648, maximum: 2147483647 },
      { type: 'integer' },
      { type: 'number' },
      { type: 'number' },
      { type: 'string', contentEncoding: 'base64' },
      { type: 'string' },
    ])
  })

  // A `long` spans ±2^63, which no JSON number holds: a stated bound would round
  // to 2^63 and be both wrong and unreachable, so the schema states none.
  it('leaves a long unbounded while bounding an int exactly', () => {
    expect(fieldSchema(recordWith({ name: 'value', type: 'long' }))).toEqual({ type: 'integer' })
    expect(fieldSchema(recordWith({ name: 'value', type: 'int' }))).toHaveProperty('maximum', 2147483647)
  })

  it('encodes bytes as latin-1 under avro-json and base64 under json', () => {
    const avro = recordWith({ name: 'value', type: 'bytes' })

    expect(fieldSchema(avro, { encoding: 'avro-json' })).toEqual({
      type: 'string',
      pattern: '^[\\u0000-\\u00ff]*$',
    })
    expect(fieldSchema(avro)).toEqual({ type: 'string', contentEncoding: 'base64' })
  })

  it('converts a record into a closed object with its doc as a description', () => {
    const schema = avroToJsonSchema({
      type: 'record',
      name: 'User',
      doc: 'A person.',
      fields: [
        { name: 'id', type: 'string', doc: 'Stable identifier.' },
        { name: 'age', type: 'int' },
      ],
    })

    expect(rootDef(schema)).toEqual({
      title: 'User',
      description: 'A person.',
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Stable identifier.' },
        age: { type: 'integer', minimum: -2147483648, maximum: 2147483647 },
      },
      required: ['id', 'age'],
      additionalProperties: false,
    })
  })

  // The common `["null", T]` shape is expressible as one `type` array, which
  // reads far better than a two-branch anyOf saying the same thing.
  it('collapses a union of bare primitives into a single type array, null last', () => {
    expect(fieldSchema(recordWith({ name: 'value', type: ['null', 'string'] }))).toEqual({
      type: ['string', 'null'],
    })
    expect(fieldSchema(recordWith({ name: 'value', type: ['null', 'string', 'boolean'] }))).toEqual({
      type: ['string', 'boolean', 'null'],
    })
  })

  it('falls back to anyOf when a union branch is not a bare primitive', () => {
    const schema = avroToJsonSchema({
      type: 'record',
      name: 'Wrapper',
      fields: [
        { name: 'value', type: ['null', { type: 'record', name: 'Inner', fields: [{ name: 'x', type: 'int' }] }] },
      ],
    })

    expect((rootDef(schema)['properties'] as Record<string, unknown>)['value']).toEqual({
      anyOf: [{ type: 'null' }, { $ref: '#/$defs/Inner' }],
    })
  })

  it('unwraps a single-branch union', () => {
    expect(fieldSchema(recordWith({ name: 'value', type: ['string'] }))).toEqual({ type: 'string' })
  })

  it('rejects an empty union', () => {
    expect(() => avroToJsonSchema(recordWith({ name: 'value', type: [] }))).toThrow(/at least one branch/)
  })

  // Avro's JSON encoding cannot say which branch a value came from, so every
  // non-null branch is wrapped in a single-key object naming it. Null is bare.
  it('wraps union branches in their tag name under avro-json', () => {
    const schema = avroToJsonSchema(
      {
        type: 'record',
        name: 'Event',
        namespace: 'com.example',
        fields: [{ name: 'value', type: ['null', 'string', { type: 'enum', name: 'Kind', symbols: ['A'] }] }],
      },
      { encoding: 'avro-json' },
    )

    expect((rootDef(schema)['properties'] as Record<string, unknown>)['value']).toEqual({
      anyOf: [
        { type: 'null' },
        {
          type: 'object',
          properties: { string: { type: 'string' } },
          required: ['string'],
          additionalProperties: false,
        },
        {
          // A named branch is tagged with its fullname, not its short name.
          type: 'object',
          properties: { 'com.example.Kind': { $ref: '#/$defs/com.example.Kind' } },
          required: ['com.example.Kind'],
          additionalProperties: false,
        },
      ],
    })
  })

  // Avro has no optional fields — every declared field is present in the
  // encoding — so a default only makes a field optional in the idiomatic shape.
  it('makes a defaulted field optional under json but required under avro-json', () => {
    const avro = {
      type: 'record',
      name: 'User',
      fields: [
        { name: 'id', type: 'string' },
        { name: 'nickname', type: ['null', 'string'], default: null },
      ],
    }

    expect(rootDef(avroToJsonSchema(avro))['required']).toEqual(['id'])
    expect(rootDef(avroToJsonSchema(avro, { encoding: 'avro-json' }))['required']).toEqual(['id', 'nickname'])
  })

  it('carries a field default through', () => {
    const avro = recordWith({ name: 'value', type: 'int', default: 7 })
    expect(fieldSchema(avro)).toHaveProperty('default', 7)
  })

  // `default` is not annotation-only here: generate-parsers coerces with it, so
  // a latin-1 byte default would be substituted into base64-shaped output.
  it('drops a byte-string default under json but keeps it under avro-json', () => {
    const avro = recordWith({ name: 'value', type: 'bytes', default: 'ÿþ' })

    expect(fieldSchema(avro)).not.toHaveProperty('default')
    expect(fieldSchema(avro, { encoding: 'avro-json' })).toHaveProperty('default', 'ÿþ')
  })

  it('converts an enum, including its default symbol', () => {
    const schema = avroToJsonSchema({
      type: 'enum',
      name: 'Suit',
      symbols: ['HEARTS', 'SPADES'],
      default: 'HEARTS',
    })

    expect(rootDef(schema)).toEqual({
      title: 'Suit',
      type: 'string',
      enum: ['HEARTS', 'SPADES'],
      default: 'HEARTS',
    })
  })

  it('rejects an enum without string symbols', () => {
    expect(() => avroToJsonSchema({ type: 'enum', name: 'Bad', symbols: 'HEARTS' })).toThrow(/symbols/)
  })

  it('pins a fixed to its exact byte length under avro-json', () => {
    const avro = { type: 'fixed', name: 'Md5', size: 16 }

    expect(rootDef(avroToJsonSchema(avro, { encoding: 'avro-json' }))).toEqual({
      title: 'Md5',
      type: 'string',
      pattern: '^[\\u0000-\\u00ff]*$',
      minLength: 16,
      maxLength: 16,
    })
    expect(rootDef(avroToJsonSchema(avro))).toEqual({
      title: 'Md5',
      type: 'string',
      contentEncoding: 'base64',
    })
  })

  it('rejects a fixed without a valid size', () => {
    expect(() => avroToJsonSchema({ type: 'fixed', name: 'Bad', size: -1 })).toThrow(/size/)
  })

  it('converts arrays and maps', () => {
    expect(fieldSchema(recordWith({ name: 'value', type: { type: 'array', items: 'string' } }))).toEqual({
      type: 'array',
      items: { type: 'string' },
    })
    expect(fieldSchema(recordWith({ name: 'value', type: { type: 'map', values: 'int' } }))).toEqual({
      type: 'object',
      additionalProperties: { type: 'integer', minimum: -2147483648, maximum: 2147483647 },
    })
  })

  it('rejects an array or map missing its item schema', () => {
    expect(() => avroToJsonSchema(recordWith({ name: 'value', type: { type: 'array' } }))).toThrow(/items/)
    expect(() => avroToJsonSchema(recordWith({ name: 'value', type: { type: 'map' } }))).toThrow(/values/)
  })

  it('keys named types by fullname and inherits the namespace into children', () => {
    const schema = avroToJsonSchema({
      type: 'record',
      name: 'Order',
      namespace: 'com.shop',
      // The nested record declares no namespace, so it inherits com.shop, and
      // the sibling reference below finds it by its short name.
      fields: [
        { name: 'line', type: { type: 'record', name: 'Line', fields: [{ name: 'sku', type: 'string' }] } },
        { name: 'backup', type: 'Line' },
      ],
    }) as { $defs: Record<string, unknown> }

    expect(Object.keys(schema.$defs).sort()).toEqual(['com.shop.Line', 'com.shop.Order'])
    const properties = rootDef(schema)['properties'] as Record<string, unknown>
    expect(properties['line']).toEqual({ $ref: '#/$defs/com.shop.Line' })
    expect(properties['backup']).toEqual({ $ref: '#/$defs/com.shop.Line' })
  })

  // A dotted name *is* a fullname, and the spec says the namespace attribute is
  // then ignored outright — easy to get backwards.
  it('lets a dotted name override the namespace attribute', () => {
    const schema = avroToJsonSchema({
      type: 'record',
      name: 'other.ns.Thing',
      namespace: 'ignored',
      fields: [{ name: 'x', type: 'int' }],
    }) as { $defs: Record<string, unknown> }

    expect(Object.keys(schema.$defs)).toEqual(['other.ns.Thing'])
  })

  // An explicit empty namespace is meaningful: it puts the type in the null
  // namespace, overriding whatever it is nested inside.
  it('treats an empty namespace as the null namespace', () => {
    const schema = avroToJsonSchema({
      type: 'record',
      name: 'Outer',
      namespace: 'com.shop',
      fields: [{ name: 'inner', type: { type: 'record', name: 'Inner', namespace: '', fields: [] } }],
    }) as { $defs: Record<string, unknown> }

    expect(Object.keys(schema.$defs).sort()).toEqual(['Inner', 'com.shop.Outer'])
  })

  it('terminates on a recursive type by referencing the definition being built', () => {
    const schema = avroToJsonSchema({
      type: 'record',
      name: 'Node',
      fields: [{ name: 'next', type: ['null', 'Node'] }],
    }) as { $defs: Record<string, unknown> }

    expect(Object.keys(schema.$defs)).toEqual(['Node'])
    expect((rootDef(schema)['properties'] as Record<string, unknown>)['next']).toEqual({
      anyOf: [{ type: 'null' }, { $ref: '#/$defs/Node' }],
    })
  })

  it('rejects a name defined twice', () => {
    expect(() =>
      avroToJsonSchema({
        type: 'record',
        name: 'Dup',
        fields: [
          { name: 'a', type: { type: 'record', name: 'Inner', fields: [] } },
          { name: 'b', type: { type: 'record', name: 'Inner', fields: [] } },
        ],
      }),
    ).toThrow(/defined more than once/)
  })

  it('rejects a reference to a name that was never defined', () => {
    expect(() => avroToJsonSchema(recordWith({ name: 'value', type: 'Missing' }))).toThrow(/defined before it is/)
  })

  it('narrows a uuid logical type but leaves timestamps as integers', () => {
    expect(fieldSchema(recordWith({ name: 'value', type: { type: 'string', logicalType: 'uuid' } }))).toEqual({
      type: 'string',
      format: 'uuid',
    })

    // Avro encodes timestamp-millis as a long in JSON too, so `format:
    // 'date-time'` would describe a string that never arrives.
    expect(fieldSchema(recordWith({ name: 'value', type: { type: 'long', logicalType: 'timestamp-millis' } }))).toEqual(
      { type: 'integer' },
    )
  })

  // The spec requires a reader that does not recognise a logical type to fall
  // back to the underlying Avro type rather than fail.
  it('ignores an unrecognised logical type', () => {
    expect(fieldSchema(recordWith({ name: 'value', type: { type: 'string', logicalType: 'not-a-thing' } }))).toEqual({
      type: 'string',
    })
  })

  it('warns once for logical types it has to widen, naming each of them', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    avroToJsonSchema({
      type: 'record',
      name: 'Money',
      fields: [
        { name: 'amount', type: { type: 'bytes', logicalType: 'decimal', precision: 9, scale: 2 } },
        { name: 'span', type: { type: 'fixed', name: 'Span', size: 12, logicalType: 'duration' } },
      ],
    })

    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0]?.[0]).toContain('Avro adapter')
    // Both are asserted by name. Asserting only `decimal` let this test pass
    // while `duration` reported nothing at all: a logical type on a `fixed` was
    // dropped before it could be classified, and since `duration` is only ever
    // defined on a `fixed`, its whole branch was unreachable.
    expect(warn.mock.calls[0]?.[0]).toContain('decimal')
    expect(warn.mock.calls[0]?.[0]).toContain('duration')
    warn.mockRestore()
  })

  it('reports a logical type declared on a fixed, not only on a primitive', () => {
    expect(() =>
      avroToJsonSchema({ type: 'fixed', name: 'Span', size: 12, logicalType: 'duration' }, { strict: true }),
    ).toThrow(/duration/)
    expect(() =>
      avroToJsonSchema({ type: 'fixed', name: 'Dec', size: 8, logicalType: 'decimal' }, { strict: true }),
    ).toThrow(/decimal/)
  })

  it('throws on a widened logical type in strict mode', () => {
    expect(() =>
      avroToJsonSchema(recordWith({ name: 'value', type: { type: 'bytes', logicalType: 'decimal' } }), {
        strict: true,
      }),
    ).toThrow(/strict mode/)
  })

  it('converts a bare primitive schema with no named types', () => {
    expect(avroToJsonSchema('string')).toEqual({ type: 'string' })
  })

  // A `.avsc` file's *text* is a string too, and the resulting "unknown type"
  // would be baffling without saying what went wrong.
  it('explains that the file text is not the schema', () => {
    expect(() => avroToJsonSchema('{"type":"record"}')).toThrow(/not the file text itself/)
  })

  it('rejects a schema that is not a name, union, or object', () => {
    expect(() => avroToJsonSchema(42)).toThrow(/expected a type name/)
  })

  // `["float", "double"]` is a legal union — the spec forbids two branches of the
  // *same* type, and these are distinct — but both map to a bare `number`. An
  // undeduplicated `{type: ['number','number']}` violates the metaschema, which
  // requires the members to be unique, and Ajv refuses to compile it.
  it('de-duplicates a union whose branches share one JSON Schema type', () => {
    expect(fieldSchema(recordWith({ name: 'value', type: ['float', 'double'] }))).toEqual({ type: 'number' })
    expect(fieldSchema(recordWith({ name: 'value', type: ['null', 'float', 'double'] }))).toEqual({
      type: ['number', 'null'],
    })
  })

  // `__proto__` matches Avro's name pattern, so it is a legal field name. Built
  // by assignment it set the prototype instead of creating an own property: the
  // field vanished from `properties` but stayed in `required`, and with
  // `additionalProperties: false` the schema then rejected every document.
  it('keeps a field named __proto__ as a real property', () => {
    const schema = avroToJsonSchema(recordWith({ name: '__proto__', type: 'string' }))
    const properties = rootDef(schema)['properties'] as Record<string, unknown>

    expect(Object.hasOwn(properties, '__proto__')).toBe(true)
    expect(Object.keys(properties)).toEqual(['__proto__'])
    expect(rootDef(schema)['required']).toEqual(['__proto__'])
  })

  // Avro states a union's default as a bare value of its FIRST branch, but the
  // spec's JSON encoding tags the data. Copied verbatim the default matched none
  // of the wrapper branches it sat beside.
  it('wraps a union default to match the branch tagging under avro-json', () => {
    const wrapped = fieldSchema(recordWith({ name: 'value', type: ['string', 'null'], default: 'hi' }), {
      encoding: 'avro-json',
    })
    expect(wrapped).toHaveProperty('default', { string: 'hi' })

    // A null first branch is written bare, so it needs no wrapper.
    const bare = fieldSchema(recordWith({ name: 'value', type: ['null', 'string'], default: null }), {
      encoding: 'avro-json',
    })
    expect(bare).toHaveProperty('default', null)
  })

  // The byte-default guard used to look for `contentEncoding` at the top level of
  // the converted schema, which a nullable field (an `anyOf`) and a `fixed` (a
  // `$ref`) never carry — so the latin-1 default survived into base64 output.
  it('drops a latin-1 default from a nullable bytes or fixed field under json', () => {
    expect(fieldSchema(recordWith({ name: 'value', type: ['bytes', 'null'], default: 'ÿþ' }))).not.toHaveProperty(
      'default',
    )

    const viaFixed = avroToJsonSchema({
      type: 'record',
      name: 'R',
      fields: [{ name: 'value', type: [{ type: 'fixed', name: 'Md5', size: 16 }, 'null'], default: 'ÿþ' }],
    })
    expect((rootDef(viaFixed)['properties'] as Record<string, unknown>)['value']).not.toHaveProperty('default')
  })

  // A reference written in object form (`{"type": "E"}`) resolves to a fullname
  // everywhere else; the avro-json branch tag returned it verbatim, so the
  // wrapper key said `E` while the $ref it wrapped pointed at `#/$defs/ns.E`.
  it('tags an object-form reference in an avro-json union by its fullname', () => {
    const schema = avroToJsonSchema(
      {
        type: 'record',
        name: 'O',
        namespace: 'ns',
        fields: [
          { name: 'a', type: { type: 'enum', name: 'E', symbols: ['X'] } },
          { name: 'b', type: ['null', { type: 'E' }] },
        ],
      },
      { encoding: 'avro-json' },
    )

    expect((rootDef(schema)['properties'] as Record<string, unknown>)['b']).toEqual({
      anyOf: [
        { type: 'null' },
        {
          type: 'object',
          properties: { 'ns.E': { $ref: '#/$defs/ns.E' } },
          required: ['ns.E'],
          additionalProperties: false,
        },
      ],
    })
  })

  // A name is written straight into a `$defs` key and the `$ref` at it, so an
  // illegal one silently produced a different, broken JSON Pointer:
  // `#/$defs/a~b/c` resolves as `$defs` -> `a~b` -> `c`.
  it('rejects a name that is not a legal Avro name', () => {
    expect(() => avroToJsonSchema({ type: 'record', name: 'a~b/c', fields: [] })).toThrow(/not a legal Avro name/)
    expect(() => avroToJsonSchema({ type: 'record', name: '1bad', fields: [] })).toThrow(/not a legal Avro name/)
    expect(() => avroToJsonSchema({ type: 'record', name: 'ns./Thing', fields: [] })).toThrow(/not a legal Avro name/)
  })

  // `convertUnion` decides null-ness from the converted branch, so it emits the
  // object spelling bare too. Deciding the same question from the raw string
  // spelling wrapped the default as `{"null": null}`, matching neither branch.
  it('leaves a union default bare when the null branch is written in object form', () => {
    const objectForm = fieldSchema(recordWith({ name: 'value', type: [{ type: 'null' }, 'string'], default: null }), {
      encoding: 'avro-json',
    })
    expect(objectForm).toHaveProperty('default', null)
  })

  // A union nested inside a record, array, or map needs the same branch wrapper
  // the top level does; translating only the outermost level left it untagged.
  it('tags a union nested inside a record, array, or map default under avro-json', () => {
    const inRecord = fieldSchema(
      recordWith({
        name: 'value',
        type: { type: 'record', name: 'Cfg', fields: [{ name: 'host', type: ['string', 'null'] }] },
        default: { host: 'localhost' },
      }),
      { encoding: 'avro-json' },
    )
    expect(inRecord).toHaveProperty('default', { host: { string: 'localhost' } })

    const inArray = fieldSchema(
      recordWith({ name: 'value', type: { type: 'array', items: ['string', 'null'] }, default: ['hi'] }),
      { encoding: 'avro-json' },
    )
    expect(inArray).toHaveProperty('default', [{ string: 'hi' }])

    const inMap = fieldSchema(
      recordWith({ name: 'value', type: { type: 'map', values: ['string', 'null'] }, default: { k: 'hi' } }),
      { encoding: 'avro-json' },
    )
    expect(inMap).toHaveProperty('default', { k: { string: 'hi' } })
  })

  // The same depth problem in the other encoding: a latin-1 byte value nested in
  // a default is still latin-1, and a half-translated default is worse than none.
  it('drops a whole default when a nested byte value cannot be carried under json', () => {
    expect(
      fieldSchema(recordWith({ name: 'value', type: { type: 'array', items: 'bytes' }, default: ['ÿþ'] })),
    ).not.toHaveProperty('default')

    expect(
      fieldSchema(
        recordWith({
          name: 'value',
          type: { type: 'record', name: 'In', fields: [{ name: 'b', type: 'bytes' }] },
          default: { b: 'ÿþ' },
        }),
      ),
    ).not.toHaveProperty('default')
  })

  // A default reaching a named type by reference has to be walked through that
  // type's Avro definition, since the converted schema is only a `$ref` by then.
  it('follows a name reference when translating a default', () => {
    const schema = avroToJsonSchema(
      {
        type: 'record',
        name: 'Outer',
        fields: [
          { name: 'a', type: { type: 'record', name: 'Inner', fields: [{ name: 'v', type: ['string', 'null'] }] } },
          { name: 'b', type: 'Inner', default: { v: 'hi' } },
        ],
      },
      { encoding: 'avro-json' },
    )

    expect((rootDef(schema)['properties'] as Record<string, unknown>)['b']).toHaveProperty('default', {
      v: { string: 'hi' },
    })
  })

  // A logical type on a base the spec does not define it for is invalid, and the
  // spec says to ignore it. Reporting it claimed a loss that never happened.
  it('ignores a logical type declared on a base it is not defined for', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    expect(() =>
      avroToJsonSchema({ type: 'record', name: 'R', logicalType: 'decimal', fields: [] }, { strict: true }),
    ).not.toThrow()
    expect(() =>
      avroToJsonSchema({ type: 'enum', name: 'E', symbols: ['A'], logicalType: 'duration' }, { strict: true }),
    ).not.toThrow()
    // `uuid` is defined on a string; on a long it means nothing.
    expect(fieldSchema(recordWith({ name: 'value', type: { type: 'long', logicalType: 'uuid' } }))).toEqual({
      type: 'integer',
    })

    expect(warn).not.toHaveBeenCalled()
    warn.mockRestore()
  })

  // The point of the whole adapter: the output has to be valid generator input,
  // producing one named TypeScript type per Avro named type.
  it('produces schemas the mjst generators consume', async () => {
    const schema = avroToJsonSchema({
      type: 'record',
      name: 'User',
      namespace: 'com.example',
      fields: [
        { name: 'id', type: 'string' },
        { name: 'nickname', type: ['null', 'string'], default: null },
        { name: 'friend', type: ['null', 'com.example.User'], default: null },
      ],
    })

    const files = (await buildSchema(schema as never, 'User')) as { filename: string; content: string }[]
    const user = files.find((file) => file.filename === 'com.example.user.ts')

    expect(user?.content).toContain('export type ComExampleUser = {')
    expect(user?.content).toContain('id: string;')
    expect(user?.content).toContain('nickname?: string | null;')
    expect(user?.content).toContain('friend?: null | ComExampleUser;')
  })
})
