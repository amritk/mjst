import { describe, expect, it } from 'vitest'

import type { ValidationError } from './types'
import { validate } from './validate'

/** Pulls the error list out of a result, or `[]` when the result is `true`. */
const errorsOf = (result: ReturnType<ReturnType<typeof validate>>): ValidationError[] =>
  result === true ? [] : result.errors

describe('validate', () => {
  it('accepts a valid object and returns true', () => {
    const validator = validate({
      type: 'object',
      properties: { name: { type: 'string' }, age: { type: 'integer' } },
      required: ['name'],
    })

    expect(validator({ name: 'Ada', age: 36 })).toBe(true)
  })

  it('validates through a $dynamicRef bound to its $dynamicAnchor', () => {
    // Mirrors the OpenAPI 3.1 pattern: a property late-binds to the document's
    // schema dialect via `$dynamicRef: "#meta"`.
    const validator = validate({
      type: 'object',
      properties: { payload: { $dynamicRef: '#meta' } },
      $defs: {
        meta: { $dynamicAnchor: 'meta', type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
      },
    })

    expect(validator({ payload: { id: 'abc' } })).toBe(true)
    expect(validator({ payload: { id: 42 } })).toEqual({
      valid: false,
      errors: [{ message: 'must be string', path: '/payload/id' }],
    })
  })

  it('reports a missing required property with its path', () => {
    const validator = validate({
      type: 'object',
      properties: { name: { type: 'string' } },
      required: ['name'],
    })

    expect(validator({})).toEqual({
      valid: false,
      errors: [{ message: "must have required property 'name'", path: '' }],
    })
  })

  it('collects every error rather than stopping at the first', () => {
    const validator = validate({
      type: 'object',
      properties: { a: { type: 'string' }, b: { type: 'number' } },
      required: ['a', 'b'],
    })

    const errors = errorsOf(validator({ a: 1, b: 'x' }))
    expect(errors).toHaveLength(2)
  })

  it('rejects a non-object at the root', () => {
    const validator = validate({ type: 'object' })
    expect(validator('nope')).toEqual({ valid: false, errors: [{ message: 'must be object', path: '' }] })
    expect(validator(null)).toEqual({ valid: false, errors: [{ message: 'must be object', path: '' }] })
    expect(validator([])).toEqual({ valid: false, errors: [{ message: 'must be object', path: '' }] })
  })

  it('distinguishes integer from number', () => {
    const validator = validate({ type: 'integer' })
    expect(validator(3)).toBe(true)
    expect(validator(3.5)).not.toBe(true)
    expect(validator('3')).not.toBe(true)
  })

  it('treats null as its own type', () => {
    const validator = validate({ type: 'null' })
    expect(validator(null)).toBe(true)
    expect(validator(0)).not.toBe(true)
    expect(validator(undefined)).not.toBe(true)
  })

  it('supports a union of types', () => {
    const validator = validate({ type: ['string', 'null'] })
    expect(validator('hi')).toBe(true)
    expect(validator(null)).toBe(true)
    expect(validator(42)).not.toBe(true)
  })

  it('enforces string length and pattern constraints', () => {
    const validator = validate({ type: 'string', minLength: 2, maxLength: 4, pattern: '^[a-z]+$' })
    expect(validator('abc')).toBe(true)
    expect(validator('a')).not.toBe(true)
    expect(validator('abcde')).not.toBe(true)
    expect(validator('AB')).not.toBe(true)
  })

  it('enforces numeric bounds including exclusive bounds and multipleOf', () => {
    const validator = validate({ type: 'number', minimum: 0, exclusiveMaximum: 10, multipleOf: 0.5 })
    expect(validator(0)).toBe(true)
    expect(validator(9.5)).toBe(true)
    expect(validator(-1)).not.toBe(true)
    expect(validator(10)).not.toBe(true)
    expect(validator(0.3)).not.toBe(true)
  })

  it('honours the draft-04 boolean exclusiveMinimum/exclusiveMaximum form', () => {
    const min = validate({ type: 'number', minimum: 0, exclusiveMinimum: true })
    expect(min(0)).not.toBe(true)
    expect(min(0.1)).toBe(true)

    const max = validate({ type: 'number', maximum: 10, exclusiveMaximum: true })
    expect(max(10)).not.toBe(true)
    expect(max(9.9)).toBe(true)

    // `exclusiveMinimum: false` leaves the bound inclusive.
    const inclusive = validate({ type: 'number', minimum: 0, exclusiveMinimum: false })
    expect(inclusive(0)).toBe(true)
  })

  it('handles multipleOf with floating point values correctly', () => {
    const validator = validate({ type: 'number', multipleOf: 0.1 })
    expect(validator(0.3)).toBe(true)
    expect(validator(0.30000000000000004)).toBe(true)
    expect(validator(0.35)).not.toBe(true)
  })

  it('validates enum membership', () => {
    const validator = validate({ enum: ['a', 'b', 3, null] })
    expect(validator('a')).toBe(true)
    expect(validator(3)).toBe(true)
    expect(validator(null)).toBe(true)
    expect(validator('c')).not.toBe(true)
  })

  it('validates const for primitives and objects', () => {
    expect(validate({ const: 'fixed' })('fixed')).toBe(true)
    expect(validate({ const: 'fixed' })('other')).not.toBe(true)

    const objConst = validate({ const: { a: 1, b: [2, 3] } })
    expect(objConst({ a: 1, b: [2, 3] })).toBe(true)
    expect(objConst({ a: 1, b: [2, 4] })).not.toBe(true)
  })

  it('validates array items and reports the offending index', () => {
    const validator = validate({ type: 'array', items: { type: 'number' } })
    expect(validator([1, 2, 3])).toBe(true)
    expect(validator([1, 'two', 3])).toEqual({
      valid: false,
      errors: [{ message: 'must be number', path: '/1' }],
    })
  })

  it('enforces minItems, maxItems, and uniqueItems', () => {
    const validator = validate({ type: 'array', minItems: 1, maxItems: 3, uniqueItems: true })
    expect(validator([1, 2])).toBe(true)
    expect(validator([])).not.toBe(true)
    expect(validator([1, 2, 3, 4])).not.toBe(true)
    expect(validator([1, 1])).not.toBe(true)
  })

  it('treats uniqueItems by deep equality, not reference', () => {
    const validator = validate({ type: 'array', uniqueItems: true })
    expect(validator([{ a: 1 }, { a: 2 }])).toBe(true)
    expect(validator([{ a: 1 }, { a: 1 }])).not.toBe(true)
  })

  it('validates tuples via prefixItems with a typed rest', () => {
    const validator = validate({
      type: 'array',
      prefixItems: [{ type: 'string' }, { type: 'number' }],
      items: { type: 'boolean' },
    })
    expect(validator(['a', 1, true, false])).toBe(true)
    expect(validator([1, 1])).not.toBe(true)
    expect(validator(['a', 1, 'x'])).not.toBe(true)
  })

  it('supports draft-07 array tuples with additionalItems', () => {
    const validator = validate({
      type: 'array',
      items: [{ type: 'string' }, { type: 'number' }],
      additionalItems: false,
    })
    expect(validator(['a', 1])).toBe(true)
    expect(validator(['a', 1, 'extra'])).not.toBe(true)
  })

  it('forbids extra keys when additionalProperties is false', () => {
    const validator = validate({
      type: 'object',
      properties: { a: { type: 'string' } },
      additionalProperties: false,
    })
    expect(validator({ a: 'x' })).toBe(true)
    expect(validator({ a: 'x', b: 1 })).toEqual({
      valid: false,
      errors: [{ message: 'must NOT have additional properties', path: '/b' }],
    })
  })

  it('validates extra keys against an additionalProperties schema', () => {
    const validator = validate({
      type: 'object',
      properties: { a: { type: 'string' } },
      additionalProperties: { type: 'number' },
    })
    expect(validator({ a: 'x', b: 1, c: 2 })).toBe(true)
    expect(validator({ a: 'x', b: 'not a number' })).not.toBe(true)
  })

  it('validates patternProperties', () => {
    const validator = validate({
      type: 'object',
      patternProperties: { '^num_': { type: 'number' } },
      additionalProperties: false,
    })
    expect(validator({ num_a: 1, num_b: 2 })).toBe(true)
    expect(validator({ num_a: 'x' })).not.toBe(true)
    expect(validator({ other: 1 })).not.toBe(true)
  })

  it('enforces minProperties and maxProperties', () => {
    const validator = validate({ type: 'object', minProperties: 1, maxProperties: 2 })
    expect(validator({ a: 1 })).toBe(true)
    expect(validator({})).not.toBe(true)
    expect(validator({ a: 1, b: 2, c: 3 })).not.toBe(true)
  })

  it('enforces dependentRequired', () => {
    const validator = validate({
      type: 'object',
      properties: { creditCard: { type: 'number' }, billingAddress: { type: 'string' } },
      dependentRequired: { creditCard: ['billingAddress'] },
    })
    expect(validator({})).toBe(true)
    expect(validator({ creditCard: 123, billingAddress: 'x' })).toBe(true)
    expect(validator({ creditCard: 123 })).not.toBe(true)
  })

  it('resolves local $ref including recursion', () => {
    const validator = validate({
      type: 'object',
      properties: {
        value: { type: 'number' },
        children: { type: 'array', items: { $ref: '#' } },
      },
      required: ['value'],
    })

    expect(validator({ value: 1, children: [{ value: 2 }, { value: 3, children: [{ value: 4 }] }] })).toBe(true)
    expect(validator({ value: 1, children: [{ value: 'nope' }] })).toEqual({
      valid: false,
      errors: [{ message: 'must be number', path: '/children/0/value' }],
    })
  })

  it('resolves $ref into $defs', () => {
    const validator = validate({
      type: 'object',
      properties: { user: { $ref: '#/$defs/user' } },
      required: ['user'],
      $defs: {
        user: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
      },
    })
    expect(validator({ user: { name: 'Ada' } })).toBe(true)
    expect(validator({ user: {} })).not.toBe(true)
  })

  it('validates contains with min/maxContains', () => {
    const atLeastOne = validate({ type: 'array', contains: { type: 'number' } })
    expect(atLeastOne([1, 'a'])).toBe(true)
    expect(atLeastOne(['a', 'b'])).not.toBe(true)
    expect(atLeastOne([])).not.toBe(true)

    const between = validate({ type: 'array', contains: { type: 'number' }, minContains: 2, maxContains: 3 })
    expect(between(['a', 1, 2])).toBe(true)
    expect(between([1])).not.toBe(true)
    expect(between([1, 2, 3, 4])).not.toBe(true)

    // minContains: 0 makes the lower bound trivially satisfied, even when empty.
    const zero = validate({ type: 'array', contains: { type: 'number' }, minContains: 0, maxContains: 1 })
    expect(zero([])).toBe(true)
    expect(zero(['a'])).toBe(true)
    expect(zero([1, 2])).not.toBe(true)
  })

  it('validates propertyNames against a schema', () => {
    const validator = validate({ type: 'object', propertyNames: { pattern: '^[a-z]+$' } })
    expect(validator({ foo: 1, bar: 2 })).toBe(true)
    expect(validator({ Foo: 1 })).toEqual({
      valid: false,
      errors: [{ message: 'property name "Foo" is invalid', path: '/Foo' }],
    })
  })

  it('applies dependentSchemas when the trigger property is present', () => {
    const validator = validate({
      type: 'object',
      properties: { creditCard: { type: 'number' } },
      dependentSchemas: {
        creditCard: { required: ['billingAddress'], properties: { billingAddress: { type: 'string' } } },
      },
    })
    expect(validator({})).toBe(true) // trigger absent → no dependency
    expect(validator({ creditCard: 1, billingAddress: 'x' })).toBe(true)
    expect(validator({ creditCard: 1 })).not.toBe(true) // missing dependent
  })

  it('supports the draft-07 dependencies keyword (array and schema forms)', () => {
    const arrayForm = validate({ type: 'object', dependencies: { creditCard: ['billingAddress'] } })
    expect(arrayForm({ creditCard: 1, billingAddress: 'x' })).toBe(true)
    expect(arrayForm({ creditCard: 1 })).toEqual({
      valid: false,
      errors: [{ message: "must have property 'billingAddress' when 'creditCard' is present", path: '' }],
    })

    const schemaForm = validate({ type: 'object', dependencies: { creditCard: { required: ['billingAddress'] } } })
    expect(schemaForm({ creditCard: 1, billingAddress: 'x' })).toBe(true)
    expect(schemaForm({ creditCard: 1 })).not.toBe(true)
    expect(schemaForm({})).toBe(true)
  })

  it('validates allOf as the intersection', () => {
    const validator = validate({
      allOf: [
        { type: 'object', properties: { a: { type: 'string' } }, required: ['a'] },
        { type: 'object', properties: { b: { type: 'number' } }, required: ['b'] },
      ],
    })
    expect(validator({ a: 'x', b: 1 })).toBe(true)
    expect(validator({ a: 'x' })).not.toBe(true)
  })

  it('validates anyOf', () => {
    const validator = validate({ anyOf: [{ type: 'string' }, { type: 'number' }] })
    expect(validator('x')).toBe(true)
    expect(validator(1)).toBe(true)
    expect(validator(true)).not.toBe(true)
  })

  it('validates oneOf as exactly one match', () => {
    const validator = validate({
      oneOf: [
        { type: 'object', properties: { kind: { const: 'a' } }, required: ['kind'] },
        { type: 'object', properties: { kind: { const: 'b' } }, required: ['kind'] },
      ],
    })
    expect(validator({ kind: 'a' })).toBe(true)
    expect(validator({ kind: 'c' })).not.toBe(true)
  })

  it('validates not', () => {
    const validator = validate({ not: { type: 'string' } })
    expect(validator(1)).toBe(true)
    expect(validator('x')).not.toBe(true)
  })

  it('validates if/then/else', () => {
    const validator = validate({
      type: 'object',
      properties: { kind: { type: 'string' }, value: {} },
      if: { properties: { kind: { const: 'number' } }, required: ['kind'] },
      then: { properties: { value: { type: 'number' } } },
      else: { properties: { value: { type: 'string' } } },
    })
    expect(validator({ kind: 'number', value: 1 })).toBe(true)
    expect(validator({ kind: 'number', value: 'x' })).not.toBe(true)
    expect(validator({ kind: 'text', value: 'x' })).toBe(true)
    expect(validator({ kind: 'text', value: 1 })).not.toBe(true)
  })

  it('treats boolean schemas as always/never valid', () => {
    expect(validate(true)(42)).toBe(true)
    expect(validate(false)(42)).not.toBe(true)
    expect(validate({ type: 'object', properties: { a: false } })({ a: 1 })).not.toBe(true)
    expect(validate({ type: 'object', properties: { a: false } })({})).toBe(true)
  })

  it('only enforces formats when they are enabled', () => {
    const lenient = validate({ type: 'string', format: 'email' })
    expect(lenient('not-an-email')).toBe(true)

    const strict = validate({ type: 'string', format: 'email' }, { formats: 'all' })
    expect(strict('ada@example.com')).toBe(true)
    expect(strict('not-an-email')).not.toBe(true)
  })

  it('supports the extended built-in formats', () => {
    const cases: Array<[string, string, string]> = [
      ['ipv4', '192.168.0.1', '999.1.1.1'],
      ['ipv6', '::1', 'nope::zz'],
      ['json-pointer', '/a/b/~0/~1', 'no-leading-slash'],
      ['relative-json-pointer', '1/foo', '/leading-slash'],
      ['uri-template', 'http://x/{id}', 'has space'],
      ['iri', 'https://例え.テスト/path', 'no scheme'],
      ['idn-email', 'аdа@example.com', 'not-an-email'],
      ['idn-hostname', '例え.テスト', '-leading-dash.example'],
      ['hostname', 'api.example.com', '-nope.example'],
    ]
    for (const [format, ok, bad] of cases) {
      const v = validate({ type: 'string', format }, { formats: 'all' })
      expect(v(ok), `${format} should accept ${ok}`).toBe(true)
      expect(v(bad), `${format} should reject ${bad}`).not.toBe(true)
    }
  })

  it('rejects an ipv4 octet with a leading zero', () => {
    // `01.2.3.4` is not a dotted quad, and accepting it is the classic
    // octal-interpretation allowlist bypass: `010` is 8 to some resolvers and 10
    // to others, so an allowlist and the code behind it can disagree. Ajv rejects
    // these too.
    const ipv4 = validate({ type: 'string', format: 'ipv4' }, { formats: 'all' })
    for (const bad of ['01.2.3.4', '1.02.3.4', '1.2.3.04', '00.0.0.0', '010.010.010.010']) {
      expect(ipv4(bad), bad).not.toBe(true)
    }
    for (const ok of ['0.0.0.0', '1.2.3.4', '255.255.255.255', '192.168.0.1', '10.0.0.100']) {
      expect(ipv4(ok), ok).toBe(true)
    }
    // The IPv6 grammar embeds the same octets, so the fix has to reach there too.
    const ipv6 = validate({ type: 'string', format: 'ipv6' }, { formats: 'all' })
    expect(ipv6('::ffff:192.168.0.1')).toBe(true)
    expect(ipv6('::ffff:192.168.00.1')).not.toBe(true)
  })

  it('requires an offset on a time, matching RFC 3339 full-time', () => {
    // A bare `12:00:00` is a `partial-time`, not a `time` — the offset is exactly
    // the ambiguity the format exists to remove, and Ajv rejects it as well.
    const time = validate({ type: 'string', format: 'time' }, { formats: 'all' })
    expect(time('12:00:00')).not.toBe(true)
    expect(time('12:00:00.123')).not.toBe(true)
    expect(time('12:00:00Z')).toBe(true)
    expect(time('12:00:00.123z')).toBe(true)
    expect(time('12:00:00+05:30')).toBe(true)
    expect(time('12:00:00-08:00')).toBe(true)
    expect(time('25:00:00Z')).not.toBe(true)
  })

  it('throws on an unknown `type` keyword instead of matching everything', () => {
    // A typo'd type is a schema error; silently treating it as "always valid"
    // would disable the constraint. Same loud contract as an unresolvable $ref.
    const single = validate({ type: 'strng' })
    expect(() => single('anything')).toThrow(/Unknown type "strng"/)

    // In a type union the unknown member throws when it is consulted (i.e. when
    // no earlier member matched the value).
    const union = validate({ type: ['string', 'bogus'] })
    expect(union('ok')).toBe(true)
    expect(() => union(42)).toThrow(/Unknown type "bogus"/)
  })

  it('validates through a $recursiveRef bound to its $recursiveAnchor (2019-09)', () => {
    const validator = validate({
      $recursiveAnchor: true,
      type: 'object',
      properties: {
        name: { type: 'string' },
        child: { $recursiveRef: '#' },
      },
    })

    expect(validator({ name: 'root', child: { name: 'leaf' } })).toBe(true)
    expect(validator({ name: 'root', child: { name: 42 } })).toEqual({
      valid: false,
      errors: [{ message: 'must be string', path: '/child/name' }],
    })
  })

  it('falls back to the document root for $recursiveRef with no $recursiveAnchor', () => {
    const validator = validate({
      type: 'object',
      properties: { next: { $recursiveRef: '#' }, id: { type: 'integer' } },
    })

    expect(validator({ id: 1, next: { id: 2 } })).toBe(true)
    expect(validator({ id: 1, next: { id: 'nope' } })).not.toBe(true)
  })

  it('validates the `regex` format by compiling the string', () => {
    const v = validate({ type: 'string', format: 'regex' }, { formats: 'all' })
    expect(v('^[a-z]+$')).toBe(true)
    expect(v('(')).not.toBe(true)
    // Still opt-in: a lenient validator treats an invalid regex as an annotation.
    expect(validate({ type: 'string', format: 'regex' })('(')).toBe(true)
  })

  it('resolves $ref by $anchor name, including recursion', () => {
    const validator = validate({
      $ref: '#node',
      $defs: {
        node: {
          $anchor: 'node',
          type: 'object',
          properties: { value: { type: 'number' }, next: { $ref: '#node' } },
          required: ['value'],
          additionalProperties: false,
        },
      },
    })
    expect(validator({ value: 1 })).toBe(true)
    expect(validator({ value: 1, next: { value: 2 } })).toBe(true)
    expect(validator({ value: 1, next: { value: 'x' } })).not.toBe(true)
    expect(validator({ value: 1, extra: true })).not.toBe(true)
  })

  it('accepts null for an OpenAPI `nullable: true` schema regardless of type', () => {
    const validator = validate({ type: 'string', minLength: 3, nullable: true })
    expect(validator(null)).toBe(true)
    expect(validator('abc')).toBe(true)
    expect(validator('ab')).not.toBe(true) // string constraints still apply
    expect(validator(42)).not.toBe(true) // wrong, non-null type still rejected
  })

  it('lets `nullable` short-circuit enum, const and format checks', () => {
    expect(validate({ enum: ['a', 'b'], nullable: true })(null)).toBe(true)
    expect(validate({ const: 'fixed', nullable: true })(null)).toBe(true)
    expect(validate({ type: 'string', format: 'email', nullable: true }, { formats: 'all' })(null)).toBe(true)
  })

  it('does not flag a null value on a nullable property', () => {
    const validator = validate({
      type: 'object',
      properties: {
        name: { type: 'string' },
        nickname: { type: 'string', nullable: true },
      },
      required: ['name'],
    })
    expect(validator({ name: 'Ada', nickname: null })).toBe(true)
    expect(validator({ name: 'Ada', nickname: 'Countess' })).toBe(true)
    expect(validator({ name: 'Ada', nickname: 7 })).not.toBe(true)
  })

  it('accepts null on a nullable schema that wraps a $ref', () => {
    // OpenAPI emits `nullable` as a sibling of `$ref` (and, where the spec is
    // followed strictly, as a sibling of `allOf: [{ $ref }]`). In both forms a
    // null value must short-circuit before the referenced schema is applied.
    const defs = { $defs: { Point: { type: 'object', properties: { x: { type: 'number' } }, required: ['x'] } } }

    const sibling = validate({ ...defs, $ref: '#/$defs/Point', nullable: true })
    expect(sibling(null)).toBe(true)
    expect(sibling({ x: 1 })).toBe(true)
    expect(sibling({ x: 'no' })).not.toBe(true) // non-null still validates against the ref

    const wrapped = validate({ ...defs, allOf: [{ $ref: '#/$defs/Point' }], nullable: true })
    expect(wrapped(null)).toBe(true)
    expect(wrapped({ x: 'no' })).not.toBe(true)
  })

  it('treats a non-schema node leniently instead of throwing or inventing errors', () => {
    // OpenAPI parameter objects (`{ in, name, required, ... }`) get swept up by
    // broad example selectors and handed to the validator as if they were
    // schemas. Ajv cannot compile them — `required` is a boolean, not an array
    // — so it silently skips them. We reach the same zero-findings outcome by
    // ignoring keywords we do not recognize and the malformed `required`,
    // rather than failing: an unknown keyword is an annotation, not a rule.
    const parameter = { in: 'query', name: 'limit', required: false, description: 'page size' }
    const validator = validate(parameter)
    expect(validator(123)).toBe(true)
    expect(validator({ anything: true })).toBe(true)
    expect(validator(null)).toBe(true)
  })

  it('throws a helpful error for an unresolvable $ref on first use', () => {
    // The schema is walked lazily — `$ref`s resolve when the validator runs, not
    // when it is built — so an unresolvable pointer surfaces on first use.
    const validator = validate({ $ref: '#/$defs/missing' })
    expect(() => validator({})).toThrow(/Cannot resolve/)
  })

  it('does no work until the validator is actually called', () => {
    // Building the validator must not walk or resolve anything: a malformed
    // $ref would throw on use, so construction completing without a throw proves
    // the interpreter is fully deferred to call time.
    let constructed = false
    const validator = validate({ $ref: '#/$defs/missing' })
    constructed = true
    expect(constructed).toBe(true)
    expect(() => validator(1)).toThrow(/Cannot resolve/)
  })

  describe('$id base URIs', () => {
    it('resolves a $ref written as a relative URI against an $id', () => {
      const validator = validate({
        $id: 'https://example.com/draft/base.json',
        $ref: 'int.json',
        $defs: { bigint: { $id: 'int.json', maximum: 10 } },
      })

      expect(validator(5)).toBe(true)
      expect(validator(50)).not.toBe(true)
    })

    it('resolves a $ref to a URN $id', () => {
      const validator = validate({
        $ref: 'urn:uuid:deadbeef-4321-ffff-ffff-1234feebdaed',
        $defs: {
          foo: {
            $id: 'urn:uuid:deadbeef-4321-ffff-ffff-1234feebdaed',
            $defs: { bar: { type: 'string' } },
            $ref: '#/$defs/bar',
          },
        },
      })

      expect(validator('a string')).toBe(true)
      expect(validator(1)).not.toBe(true)
    })

    it('scopes a pointer fragment to the resource it is written in', () => {
      // The inner `#/$defs/inner` must find the embedded resource's definition,
      // not the identically-named one at the document root.
      const validator = validate({
        $id: 'http://example.com/outer.json',
        properties: {
          foo: {
            $id: 'inner.json',
            $defs: { inner: { type: 'string' } },
            $ref: '#/$defs/inner',
          },
        },
        $defs: { inner: { type: 'number' } },
      })

      expect(validator({ foo: 'a string' })).toBe(true)
      expect(validator({ foo: 42 })).not.toBe(true)
    })

    it('still throws for a URI that names no resource in the document', () => {
      // Fetching the document behind it is `@amritk/resolve-refs`' job — here it
      // has to fail loudly rather than validate against a subset of the schema.
      const validator = validate({ $id: 'https://example.com/a.json', $ref: 'https://example.com/b.json' })
      expect(() => validator(1)).toThrow(/Cannot resolve/)
    })
  })

  describe('$dynamicRef', () => {
    it('binds to the outermost $dynamicAnchor in the dynamic scope', () => {
      // The generic `list` resource carries its own bookend anchor, but the
      // reference is redirected to the one the root declared — so the array is
      // held to `type: string` even though `list` itself says nothing.
      const validator = validate({
        $id: 'https://example.com/root',
        $ref: 'list',
        $defs: {
          foo: { $dynamicAnchor: 'items', type: 'string' },
          list: {
            $id: 'list',
            type: 'array',
            items: { $dynamicRef: '#items' },
            $defs: { items: { $dynamicAnchor: 'items' } },
          },
        },
      })

      expect(validator(['foo', 'bar'])).toBe(true)
      expect(validator(['foo', 42])).not.toBe(true)
    })

    it('does not bind to a resource evaluation never entered', () => {
      // `first_scope` declares the anchor but only the `if` went through it, so
      // by the time `then` runs it has left the dynamic scope.
      const validator = validate({
        $id: 'https://example.com/main',
        if: { $id: 'first_scope', $defs: { thingy: { $dynamicAnchor: 'thingy', type: 'number' } } },
        then: {
          $id: 'second_scope',
          $ref: 'start',
          $defs: { thingy: { $dynamicAnchor: 'thingy', type: 'null' } },
        },
        $defs: {
          start: { $id: 'start', $dynamicRef: 'inner_scope#thingy' },
          thingy: { $id: 'inner_scope', $dynamicAnchor: 'thingy', type: 'string' },
        },
      })

      expect(validator(null)).toBe(true)
      expect(validator(42)).not.toBe(true)
      expect(validator('a string')).not.toBe(true)
    })
  })

  describe('unevaluatedProperties', () => {
    it('rejects a property left unevaluated by properties (unevaluatedProperties: false)', () => {
      const validator = validate({
        type: 'object',
        properties: { id: { type: 'integer' } },
        unevaluatedProperties: false,
      })

      expect(validator({ id: 1 })).toBe(true)
      expect(validator({ id: 1, extra: true })).toEqual({
        valid: false,
        errors: [{ message: 'must NOT have unevaluated properties', path: '/extra' }],
      })
    })

    it('sees properties evaluated inside allOf branches', () => {
      const validator = validate({
        allOf: [
          { type: 'object', properties: { id: { type: 'integer' } } },
          { properties: { name: { type: 'string' } } },
        ],
        unevaluatedProperties: false,
      })

      expect(validator({ id: 1, name: 'a' })).toBe(true)
      expect(validator({ id: 1, name: 'a', extra: 1 })).not.toBe(true)
    })

    it('validates leftover properties against a schema-form unevaluatedProperties', () => {
      const validator = validate({
        type: 'object',
        properties: { id: { type: 'integer' } },
        unevaluatedProperties: { type: 'string' },
      })

      expect(validator({ id: 1, note: 'ok' })).toBe(true)
      expect(validator({ id: 1, note: 5 })).not.toBe(true)
    })

    it('counts properties evaluated by the taken if/then branch', () => {
      const validator = validate({
        type: 'object',
        properties: { kind: { type: 'string' } },
        if: { properties: { kind: { const: 'a' } }, required: ['kind'] },
        then: { properties: { a: { type: 'number' } } },
        unevaluatedProperties: false,
      })

      expect(validator({ kind: 'a', a: 1 })).toBe(true)
      expect(validator({ kind: 'a', b: 2 })).not.toBe(true)
    })
  })

  describe('unevaluatedItems', () => {
    it('rejects items past prefixItems (unevaluatedItems: false)', () => {
      const validator = validate({
        type: 'array',
        prefixItems: [{ type: 'string' }, { type: 'number' }],
        unevaluatedItems: false,
      })

      expect(validator(['a', 1])).toBe(true)
      expect(validator(['a', 1, 'extra'])).toEqual({
        valid: false,
        errors: [{ message: 'must NOT have unevaluated items', path: '/2' }],
      })
    })

    it('treats only the items contains matched as evaluated', () => {
      const validator = validate({
        type: 'array',
        contains: { type: 'number' },
        unevaluatedItems: false,
      })

      // Every item matches `contains`, so nothing is left over.
      expect(validator([1, 2])).toBe(true)
      // index 1 is not a number, so `contains` never evaluated it.
      expect(validator([1, 'anything'])).toEqual({
        valid: false,
        errors: [{ message: 'must NOT have unevaluated items', path: '/1' }],
      })
      // No number at all → contains itself fails.
      expect(validator(['x'])).not.toBe(true)
    })

    it('publishes contains annotations even when minContains is 0', () => {
      // `minContains: 0` makes the lower bound trivially satisfied, but the items
      // that *did* match are still evaluated — so an array of all matches passes
      // `unevaluatedItems: false` while one with a stray item does not.
      const validator = validate({
        type: 'array',
        contains: { type: 'string' },
        minContains: 0,
        unevaluatedItems: false,
      })

      expect(validator([])).toBe(true)
      expect(validator(['a', 'b'])).toBe(true)
      expect(validator(['a', 1])).not.toBe(true)
      expect(validator([1])).not.toBe(true)
    })

    it('merges contains annotations across allOf branches', () => {
      // Each branch evaluates the indices its own `contains` matched, and the
      // outer `unevaluatedItems` sees the union of both.
      const validator = validate({
        allOf: [{ contains: { multipleOf: 2 } }, { contains: { multipleOf: 3 } }],
        unevaluatedItems: { multipleOf: 5 },
      })

      // 2, 4 and 6 are matched by the first branch, 3 and 6 by the second, which
      // leaves only 5 — and 5 satisfies `unevaluatedItems`.
      expect(validator([2, 3, 4, 5, 6])).toBe(true)
      // Same shape, but the leftover item is 7, which is not a multiple of 5.
      expect(validator([2, 3, 4, 7, 8])).not.toBe(true)
    })
  })

  describe('uniqueItems', () => {
    it('detects duplicate primitives (distinguishing 1 from "1" and true)', () => {
      const validator = validate({ type: 'array', uniqueItems: true })

      expect(validator([1, '1', true, null, 'a'])).toBe(true)
      expect(validator([1, 2, 1])).not.toBe(true)
      expect(validator(['a', 'a'])).not.toBe(true)
    })

    it('detects duplicate objects via deep equality', () => {
      const validator = validate({ type: 'array', uniqueItems: true })

      expect(validator([{ a: 1 }, { a: 2 }])).toBe(true)
      expect(validator([{ a: 1 }, { a: 1 }])).not.toBe(true)
    })
  })

  describe('spec-correctness fixes', () => {
    it('multipleOf uses a magnitude-relative tolerance for large quotients', () => {
      expect(validate({ type: 'number', multipleOf: 0.01 })(1234567.89)).toBe(true)
      expect(validate({ type: 'number', multipleOf: 2 })(3)).not.toBe(true)
    })

    it('multipleOf rejects near-misses whose offset the old 1e-8 tolerance swallowed', () => {
      // A half-cent past a whole dollar amount: `q ≈ 1e8`, where a `1e-8·|q|`
      // tolerance reaches 1 and wrongly accepts any offset up to a full unit.
      expect(validate({ type: 'number', multipleOf: 0.01 })(1000000.005)).not.toBe(true)
      expect(validate({ type: 'number', multipleOf: 1 })(1e15 + 0.5)).not.toBe(true)
      expect(validate({ type: 'number', multipleOf: 1 })(3.00000002)).not.toBe(true)
    })

    it('multipleOf accepts huge exact integer multiples', () => {
      // `1e21 / 1` loses integer precision as a quotient; the exact `%` path for
      // integer divisors keeps this a true multiple.
      expect(validate({ type: 'number', multipleOf: 1 })(1e21)).toBe(true)
    })

    it('fails NaN against numeric bounds and multipleOf, matching the Ajv oracle', () => {
      // Ajv's `strict:false` oracle rejects NaN against any bound (it compares
      // `false`) and against `multipleOf`. A bare `type:'number'` with no bound
      // still accepts non-finite numbers, exactly as Ajv does — so the bound is
      // what does the rejecting here.
      for (const schema of [
        { type: 'number', minimum: 0 },
        { type: 'number', maximum: 10 },
        { type: 'number', exclusiveMinimum: 0 },
        { type: 'number', exclusiveMaximum: 10 },
        { type: 'number', minimum: 0, exclusiveMinimum: true },
        { type: 'number', multipleOf: 2 },
      ] as const) {
        expect(validate(schema)(Number.NaN), `NaN vs ${JSON.stringify(schema)}`).not.toBe(true)
      }
      // `multipleOf` rejects every non-finite value; `Infinity` follows ordinary
      // comparison against ordering bounds (passes `minimum: 0`, fails `maximum`).
      expect(validate({ type: 'number', multipleOf: 2 })(Number.POSITIVE_INFINITY)).not.toBe(true)
      expect(validate({ type: 'number', multipleOf: 2 })(Number.NEGATIVE_INFINITY)).not.toBe(true)
      expect(validate({ type: 'number', maximum: 10 })(Number.POSITIVE_INFINITY)).not.toBe(true)
      expect(validate({ type: 'number', minimum: 0 })(Number.POSITIVE_INFINITY)).toBe(true)
      expect(validate({ type: 'number' })(Number.POSITIVE_INFINITY)).toBe(true)
    })

    it('resolves array-index refs but fails loudly on prototype-member pointers', () => {
      expect(validate({ $ref: '#/prefixItems/0', prefixItems: [{ type: 'string' }] })('ok')).toBe(true)
      // A mistyped pointer landing on an inherited member must throw, not silently
      // resolve to `Object.prototype.toString` and accept anything.
      expect(() => validate({ $ref: '#/$defs/toString', $defs: {} })({ anything: true })).toThrow(/Cannot resolve/)
    })

    it('treats uniqueItems NaN consistently across its fast and slow paths', () => {
      // All-primitive (Set) and mixed (deepEqual) paths must agree that NaN === NaN.
      expect(validate({ type: 'array', uniqueItems: true })([Number.NaN, Number.NaN])).not.toBe(true)
      expect(validate({ type: 'array', uniqueItems: true })([Number.NaN, Number.NaN, {}])).not.toBe(true)
    })

    it('fails rather than throws on cyclic input reaching a deep comparison', () => {
      const a: Record<string, unknown> = {}
      a['self'] = a
      const b: Record<string, unknown> = {}
      b['self'] = b
      expect(() => validate({ type: 'array', uniqueItems: true })([a, b])).not.toThrow()
      expect(() => validate({ const: b })(a)).not.toThrow()
    })

    it('accepts the unspecified IPv6 address `::`', () => {
      const v = validate({ type: 'string', format: 'ipv6' }, { formats: 'all' })
      expect(v('::')).toBe(true)
      expect(v('::1')).toBe(true)
      expect(v('nope::zz')).not.toBe(true)
    })

    it('accepts IPv4-mapped and IPv4-embedded IPv6 addresses', () => {
      const v = validate({ type: 'string', format: 'ipv6' }, { formats: 'all' })
      expect(v('::ffff:192.168.0.1')).toBe(true)
      expect(v('1:2::192.168.0.1')).toBe(true)
      expect(v('1000:1000:1000:1000:1000:1000:255.255.255.255')).toBe(true)
      // A malformed embedded IPv4 is still rejected.
      expect(v('::ffff:999.1.1.1')).not.toBe(true)
    })

    it('percent-decodes local $ref fragments before pointer evaluation', () => {
      // RFC 6901 §6: `#/$defs/a%20b` addresses the key `a b`, not `a%20b`.
      const schema = { $defs: { 'a b': { type: 'number' } }, $ref: '#/$defs/a%20b' }
      const v = validate(schema)
      expect(v(1)).toBe(true)
      expect(v('x')).not.toBe(true)
    })

    it('applies presence-gated keywords with the same `!== undefined` rule as required', () => {
      // `{ a: undefined }` counts as absent for `required`, so it must not trigger
      // `dependentRequired` either — the two keywords now agree.
      const v = validate({ type: 'object', dependentRequired: { a: ['b'] } })
      expect(v({ a: undefined })).toBe(true)
      expect(v({ a: 1 })).not.toBe(true)
      expect(v({ a: 1, b: 2 })).toBe(true)
    })

    it('minLength/maxLength count Unicode code points, not UTF-16 units', () => {
      expect(validate({ type: 'string', maxLength: 1 })('\u{1F4A9}')).toBe(true)
      expect(validate({ type: 'string', minLength: 2 })('\u{1F4A9}')).not.toBe(true)
      expect(validate({ type: 'string', maxLength: 3 })('abcd')).not.toBe(true)
    })

    it('compiles patterns as Unicode so `.` matches an astral character', () => {
      expect(validate({ type: 'string', pattern: '^.$' })('\u{1F4A9}')).toBe(true)
    })

    it('escapes / and ~ in error-path JSON Pointers', () => {
      const result = validate({ type: 'object', properties: { 'a/b': { type: 'number' } } })(JSON.parse('{"a/b":"x"}'))
      expect(errorsOf(result)[0]?.path).toBe('/a~1b')
    })

    it('rejects structurally impossible date-time and honors the leap second', () => {
      const dt = validate({ type: 'string', format: 'date-time' }, { formats: 'all' })
      expect(dt('2020-01-15T10:30:00Z')).toBe(true)
      expect(dt('1990-12-31T23:59:60Z')).toBe(true)
      expect(dt('9999-99-99T99:99:99Z')).not.toBe(true)
    })

    it('resolves a plain #anchor ref to a $dynamicAnchor', () => {
      const schema = { $defs: { node: { $dynamicAnchor: 'n', type: 'number' } }, $ref: '#n' }
      const validator = validate(schema)
      expect(validator(5)).toBe(true)
      expect(validator('x')).not.toBe(true)
    })

    it('does not leak outer annotations into a nested unevaluatedProperties', () => {
      // The inner allOf's `unevaluatedProperties: false` must see only its own
      // subtree (nothing), so `a` — evaluated by the OUTER schema — is unevaluated
      // for it and rejected. Matches Ajv.
      const schema = {
        type: 'object',
        properties: { a: { type: 'string' } },
        unevaluatedProperties: true,
        allOf: [{ unevaluatedProperties: false }],
      }
      expect(validate(schema)({ a: 'x' })).not.toBe(true)
    })
  })

  describe('property presence uses own-property membership', () => {
    it('does not treat an inherited constructor as a present required property', () => {
      const validator = validate({ type: 'object', required: ['constructor'] })
      expect(validator({})).not.toBe(true)
      expect(validator({ constructor: 1 })).toBe(true)
    })

    it('still enforces a prototype-member required key when properties is present', () => {
      // The leftover-required list was built with `k in properties`, which walks
      // `Object.prototype` — so `'toString' in {}` was true, the key looked already
      // covered and was dropped, and it was absent from the declared-key list too
      // (that comes from `Object.keys`). Nothing checked it at all. Ajv shares this
      // bug by default, so the differential fuzz cannot catch it.
      for (const name of ['constructor', 'toString', 'valueOf', 'hasOwnProperty', '__proto__']) {
        const validator = validate({ type: 'object', required: [name], properties: {} })
        expect(validator({}), `${name} must be required`).not.toBe(true)
        expect(validator(JSON.parse(`{"${name}": 1}`)), `${name} present`).toBe(true)
      }
    })

    it('counts only own properties for minProperties and maxProperties', () => {
      // The count used a bare `for…in`, which walks the prototype chain, so an
      // object with one own key and one inherited key satisfied `minProperties: 2`.
      const inherited = Object.create({ fromPrototype: 1 }) as Record<string, unknown>
      inherited['a'] = 1
      expect(validate({ type: 'object', minProperties: 2 })(inherited)).not.toBe(true)
      expect(validate({ type: 'object', maxProperties: 1 })(inherited)).toBe(true)
      expect(validate({ type: 'object', minProperties: 1 })(inherited)).toBe(true)
      // Plain objects are unaffected.
      expect(validate({ type: 'object', minProperties: 2 })({ a: 1, b: 2 })).toBe(true)
      expect(validate({ type: 'object', maxProperties: 1 })({ a: 1, b: 2 })).not.toBe(true)
    })

    it('validates a real __proto__ property against its subschema', () => {
      const validator = validate({ type: 'object', properties: { ['__proto__']: { type: 'string' } } })
      // Empty object: no own __proto__, so the string subschema does not apply.
      expect(validator({})).toBe(true)
      // Own __proto__ data property must be checked like any other property.
      expect(validator(JSON.parse('{"__proto__": "hi"}'))).toBe(true)
      expect(validator(JSON.parse('{"__proto__": 5}'))).not.toBe(true)
    })
  })

  describe('recursive $ref cycles', () => {
    it('does not overflow the stack on a self-referential $ref', () => {
      expect(validate({ $ref: '#' })({})).toBe(true)
      expect(validate({ $defs: { a: { $ref: '#/$defs/a' } }, $ref: '#/$defs/a' })(42)).toBe(true)
    })

    it('does not overflow the stack on mutually recursive $refs', () => {
      const schema = { $defs: { A: { $ref: '#/$defs/B' }, B: { $ref: '#/$defs/A' } }, $ref: '#/$defs/A' }
      expect(validate(schema)(1)).toBe(true)
    })

    it('still validates deep-but-finite recursive data correctly', () => {
      const schema = {
        $defs: {
          node: {
            type: 'object',
            properties: { children: { type: 'array', items: { $ref: '#/$defs/node' } } },
            required: ['children'],
          },
        },
        $ref: '#/$defs/node',
      }
      const validator = validate(schema)
      expect(validator({ children: [{ children: [] }, { children: [{ children: [] }] }] })).toBe(true)
      expect(validator({ children: [{ children: 'nope' }] })).not.toBe(true)
    })
  })

  describe('keywords whose evaluation was reworked for cost', () => {
    it('still reports every enum value in the failure message', () => {
      // The label is now built only in error-collecting mode, because the guard
      // path and every anyOf/oneOf branch probe discarded it. Error mode must be
      // unchanged.
      const result = validate({ enum: ['a', 'b', 3, null] })('z')
      expect(errorsOf(result)[0]?.message).toBe('must be one of: "a", "b", 3, null')
    })

    it('reports an enum failure alongside the other keywords it fails', () => {
      // Error mode keeps walking after an enum miss; only the guard path unwinds.
      const result = validate({ type: 'number', enum: [1, 2] })('z')
      expect(errorsOf(result).map((e) => e.message)).toEqual(['must be one of: 1, 2', 'must be number'])
    })

    it('short-circuits contains without changing any verdict', () => {
      // `contains` stops at the first `minContains` matches when no `maxContains`
      // and no annotation scope need the exact total — the counts below pin down
      // the cases where it must NOT stop early.
      const items = [1, 'a', 2, 'b', 3]
      expect(validate({ type: 'array', contains: { type: 'string' } })(items)).toBe(true)
      expect(validate({ type: 'array', contains: { type: 'boolean' } })(items)).not.toBe(true)
      expect(validate({ type: 'array', contains: { type: 'string' }, minContains: 2 })(items)).toBe(true)
      expect(validate({ type: 'array', contains: { type: 'string' }, minContains: 3 })(items)).not.toBe(true)
      // `maxContains` is an upper bound, so the full count is still needed.
      expect(validate({ type: 'array', contains: { type: 'string' }, maxContains: 1 })(items)).not.toBe(true)
      expect(validate({ type: 'array', contains: { type: 'string' }, maxContains: 2 })(items)).toBe(true)
      // `minContains: 0` is trivially satisfied but any `maxContains` still applies.
      expect(validate({ type: 'array', contains: { type: 'boolean' }, minContains: 0 })(items)).toBe(true)
    })

    it('keeps the contains annotation exact when unevaluatedItems is in scope', () => {
      // A satisfied `contains` marks the whole array evaluated, but only while it
      // stays within `maxContains` — so the annotation path must see every match,
      // not just the first.
      const schema = { type: 'array', contains: { type: 'string' }, maxContains: 1, unevaluatedItems: false }
      expect(validate(schema)(['a'])).toBe(true)
      expect(validate(schema)(['a', 'b'])).not.toBe(true)
    })

    it('checks every key against propertyNames, not just the first', () => {
      // The key loop now reuses one scratch context instead of allocating one per
      // key, so a failure recorded for an earlier key must not leak into a later
      // one (and vice versa).
      const validator = validate({ type: 'object', propertyNames: { maxLength: 3 } })
      expect(validator({ ab: 1, cd: 2 })).toBe(true)
      expect(validator({ ab: 1, toolong: 2 })).not.toBe(true)
      expect(validator({ toolong: 1, ab: 2 })).not.toBe(true)
      expect(errorsOf(validator({ waytoolong: 1, ab: 2, alsotoolong: 3 }))).toHaveLength(2)
      // A pattern-based propertyNames over many keys exercises the reuse harder.
      const prefixed = validate({ type: 'object', propertyNames: { pattern: '^x' } })
      expect(prefixed({ x1: 1, x2: 2, x3: 3 })).toBe(true)
      expect(prefixed({ x1: 1, y2: 2, x3: 3 })).not.toBe(true)
    })

    it('applies the dependency keywords from their memoized entry lists', () => {
      const dependentRequired = validate({ type: 'object', dependentRequired: { a: ['b', 'c'] } })
      expect(dependentRequired({})).toBe(true)
      expect(dependentRequired({ a: 1, b: 2, c: 3 })).toBe(true)
      expect(dependentRequired({ a: 1, b: 2 })).not.toBe(true)
      // A non-array value is not a dependency list and is filtered out up front.
      expect(validate({ type: 'object', dependentRequired: { a: 'b' } })({ a: 1 })).toBe(true)

      const dependentSchemas = validate({ type: 'object', dependentSchemas: { a: { required: ['b'] } } })
      expect(dependentSchemas({ b: 1 })).toBe(true)
      expect(dependentSchemas({ a: 1, b: 2 })).toBe(true)
      expect(dependentSchemas({ a: 1 })).not.toBe(true)

      const dependencies = validate({ type: 'object', dependencies: { a: ['b'], c: { required: ['d'] } } })
      expect(dependencies({ a: 1, b: 2 })).toBe(true)
      expect(dependencies({ a: 1 })).not.toBe(true)
      expect(dependencies({ c: 1 })).not.toBe(true)
      expect(dependencies({ c: 1, d: 2 })).toBe(true)
    })
  })

  describe('registered schema documents', () => {
    it('resolves a $ref to a document supplied through `schemas`', () => {
      const validator = validate(
        { type: 'array', items: { $ref: 'https://example.com/user.json' } },
        { schemas: { 'https://example.com/user.json': { type: 'object', required: ['name'] } } },
      )

      expect(validator([{ name: 'Ada' }])).toBe(true)
      expect(validator([{}])).not.toBe(true)
    })

    it('resolves a JSON Pointer and an $anchor into a registered document', () => {
      const schemas = {
        'https://example.com/defs.json': {
          $defs: { positive: { type: 'integer', minimum: 1 }, named: { $anchor: 'named', type: 'string' } },
        },
      }

      expect(validate({ $ref: 'https://example.com/defs.json#/$defs/positive' }, { schemas })(3)).toBe(true)
      expect(validate({ $ref: 'https://example.com/defs.json#/$defs/positive' }, { schemas })(0)).not.toBe(true)
      expect(validate({ $ref: 'https://example.com/defs.json#named' }, { schemas })('x')).toBe(true)
      expect(validate({ $ref: 'https://example.com/defs.json#named' }, { schemas })(1)).not.toBe(true)
    })

    it('resolves a relative $ref inside a registered document against the URI it was registered under', () => {
      // A document with no `$id` of its own still has a base URI: the one the
      // caller registered it under. This is what makes a directory of files that
      // reference each other by filename work.
      const validator = validate(
        { $ref: 'https://example.com/nested/outer.json' },
        {
          schemas: {
            'https://example.com/nested/outer.json': { type: 'object', properties: { foo: { $ref: 'inner.json' } } },
            'https://example.com/nested/inner.json': { type: 'string' },
          },
        },
      )

      expect(validator({ foo: 'ok' })).toBe(true)
      expect(validator({ foo: 1 })).not.toBe(true)
    })

    it('lets a registered document answer to both its retrieval URI and its own $id', () => {
      // The two can legitimately disagree — a document served from one URL while
      // declaring another — and refs written inside it resolve against the `$id`.
      const schemas = {
        'https://example.com/fetched-from.json': {
          $id: 'https://example.com/calls-itself.json',
          $defs: { bar: { type: 'string' } },
          $ref: '#/$defs/bar',
        },
      }

      expect(validate({ $ref: 'https://example.com/fetched-from.json' }, { schemas })('x')).toBe(true)
      expect(validate({ $ref: 'https://example.com/fetched-from.json' }, { schemas })(1)).not.toBe(true)
      expect(validate({ $ref: 'https://example.com/calls-itself.json' }, { schemas })('x')).toBe(true)
    })

    it('resolves a $ref into an embedded resource of a registered document', () => {
      const validator = validate(
        { $ref: 'https://example.com/inner-id.json' },
        {
          schemas: {
            'https://example.com/outer.json': {
              $defs: { embedded: { $id: 'inner-id.json', type: 'integer' } },
            },
          },
        },
      )

      expect(validator(7)).toBe(true)
      expect(validator('7')).not.toBe(true)
    })

    it('bookends a $dynamicRef across documents', () => {
      // The extension declares its own `$dynamicAnchor` and pulls in a generic
      // document by `$ref`; the generic document's `$dynamicRef` must bind to the
      // *outermost* anchor, which lives in the schema under validation.
      const validator = validate(
        {
          $id: 'https://example.com/strict-list.json',
          $ref: 'https://example.com/list.json',
          $defs: { item: { $dynamicAnchor: 'item', type: 'string' } },
        },
        {
          schemas: {
            'https://example.com/list.json': {
              $id: 'https://example.com/list.json',
              type: 'array',
              items: { $dynamicRef: '#item' },
              $defs: { item: { $dynamicAnchor: 'item' } },
            },
          },
        },
      )

      expect(validator(['a', 'b'])).toBe(true)
      // Without bookending this would fall back to `list.json`'s own permissive
      // anchor and accept anything.
      expect(validator(['a', 2])).not.toBe(true)
    })

    it('still throws for a $ref naming a document nobody registered, and says how to supply it', () => {
      const validator = validate(
        { $ref: 'https://example.com/absent.json' },
        { schemas: { 'https://example.com/present.json': { type: 'string' } } },
      )

      expect(() => validator('x')).toThrow(/Cannot resolve/)
      expect(() => validator('x')).toThrow(/schemas/)
    })

    it('ignores a registered entry that is not a schema object', () => {
      // Registering junk should not corrupt the registry; the URI simply names
      // nothing, and the ref fails as loudly as if it had never been registered.
      const validator = validate(
        { $ref: 'https://example.com/junk.json' },
        { schemas: { 'https://example.com/junk.json': 'not a schema' } },
      )
      expect(() => validator('x')).toThrow(/Cannot resolve/)
    })

    it('turns the validation vocabulary off when a registered metaschema omits it', () => {
      // A dialect that leaves the validation vocabulary out of `$vocabulary`
      // keeps `minimum` and friends as annotations. Reading that used to require
      // fetching the metaschema; now the caller can just hand it over.
      const metaschema = {
        $id: 'https://example.com/no-validation.json',
        $vocabulary: {
          'https://json-schema.org/draft/2020-12/vocab/core': true,
          'https://json-schema.org/draft/2020-12/vocab/applicator': true,
        },
      }
      const schemas = { 'https://example.com/no-validation.json': metaschema }

      const relaxed = validate(
        {
          $schema: 'https://example.com/no-validation.json',
          properties: { n: { type: 'string', minimum: 10 }, bad: false },
        },
        { schemas },
      )

      expect(relaxed({ n: 1 })).toBe(true)
      // Applicators are a different vocabulary and keep working.
      expect(relaxed({ bad: 'anything' })).not.toBe(true)

      // The same schema against a dialect that does include validation.
      const strict = validate(
        {
          $schema: 'https://example.com/with-validation.json',
          properties: { n: { type: 'string', minimum: 10 } },
        },
        {
          schemas: {
            'https://example.com/with-validation.json': {
              $vocabulary: { 'https://json-schema.org/draft/2020-12/vocab/validation': true },
            },
          },
        },
      )
      expect(strict({ n: 1 })).not.toBe(true)
    })

    it('keeps enforcing everything when the metaschema was not registered', () => {
      // The strict answer is the safe default: an unknown dialect never quietly
      // switches assertions off.
      const validator = validate({ $schema: 'https://example.com/unknown.json', minimum: 10 })
      expect(validator(1)).not.toBe(true)
    })
  })

  describe('keys the instance does not own', () => {
    // Schemas and values both arrive at runtime, so neither the prototype chain
    // nor a polluted `Object.prototype` can be assumed away.
    const withInherited = (): Record<string, unknown> => {
      const value = Object.create({ inherited: 'not mine' }) as Record<string, unknown>
      value['own'] = 1
      return value
    }

    it('does not validate an inherited key as additionalProperties', () => {
      const validator = validate({ type: 'object', additionalProperties: { type: 'number' } })
      expect(validator(withInherited())).toBe(true)
    })

    it('does not reject an inherited key under additionalProperties: false', () => {
      // The shape a polluted `Object.prototype` gives every object in the
      // process — this rejected valid input everywhere at once.
      const validator = validate({ type: 'object', properties: { own: {} }, additionalProperties: false })
      expect(validator(withInherited())).toBe(true)
    })

    it('does not run propertyNames over an inherited key', () => {
      const validator = validate({ type: 'object', propertyNames: { pattern: '^own$' } })
      expect(validator(withInherited())).toBe(true)
    })

    it('does not run unevaluatedProperties over an inherited key', () => {
      const validator = validate({
        type: 'object',
        properties: { own: { type: 'number' } },
        unevaluatedProperties: false,
      })
      expect(validator(withInherited())).toBe(true)
    })

    it('agrees with minProperties about how many properties there are', () => {
      // The count says one; every sweep above has to see the same one.
      expect(validate({ type: 'object', maxProperties: 1 })(withInherited())).toBe(true)
    })
  })

  describe('presence is own-property membership, everywhere that asks', () => {
    // Every keyword that asks "does the instance have this key?" has to answer
    // the same way as `minProperties` / `additionalProperties` /
    // `unevaluatedProperties`, which sweep the instance's own keys. An
    // inherited value used to say yes, so an object serializing to `{}`
    // satisfied `required` while every sweep agreed it had no properties.
    const inherited = (): Record<string, unknown> => Object.create({ token: 'x' }) as Record<string, unknown>

    it('required with a properties entry', () => {
      const validator = validate({ type: 'object', properties: { token: {} }, required: ['token'] })
      expect(validator(inherited())).not.toBe(true)
    })

    it('required with no properties entry', () => {
      expect(validate({ type: 'object', required: ['token'] })(inherited())).not.toBe(true)
    })

    it('dependentRequired does not fire on an inherited trigger', () => {
      const validator = validate({ type: 'object', dependentRequired: { token: ['billing'] } })
      expect(validator(inherited())).toBe(true)
    })

    it('dependentSchemas does not apply on an inherited trigger', () => {
      const validator = validate({ type: 'object', dependentSchemas: { token: { required: ['billing'] } } })
      expect(validator(inherited())).toBe(true)
    })

    it('properties does not validate an inherited value', () => {
      const validator = validate({ type: 'object', properties: { token: { type: 'number' } } })
      expect(validator(inherited())).toBe(true)
    })

    it('agrees with the own-key sweeps about an empty object', () => {
      const value = inherited()
      expect(Object.keys(value)).toEqual([])
      expect(validate({ type: 'object', maxProperties: 0 })(value)).toBe(true)
      expect(validate({ type: 'object', additionalProperties: false })(value)).toBe(true)
    })
  })

  describe('a format naming a prototype member', () => {
    // The spec says an unrecognized format is ignored. Reading it straight off
    // the checks table found `Function.prototype.toString` instead — truthy,
    // and with no `.test`, so the validator threw on a schema it should have
    // accepted.
    for (const format of ['toString', 'constructor', 'valueOf', 'hasOwnProperty']) {
      it(`ignores format "${format}" rather than throwing`, () => {
        const validator = validate({ type: 'string', format }, { formats: 'all' })
        expect(validator('anything')).toBe(true)
      })
    }
  })
})
