import Ajv2020 from 'ajv/dist/2020'
import addFormats from 'ajv-formats'
import { describe, expect, it } from 'vitest'
import { validate } from '@/validate'

/**
 * Unit-level assertions about the built-in `format` checks, and the record of
 * where they deliberately part company with `ajv-formats`.
 *
 * The exhaustive measurement lives in `format-conformance.test.ts`, which runs
 * the official suite's 861 optional `format` cases. Ajv is not the bar there —
 * the suite is, and on several formats the suite requires a stricter answer than
 * Ajv gives. Those divergences are pinned below so that "we disagree with Ajv
 * here" stays a decision on the record.
 */
const ajv = addFormats(new Ajv2020({ strict: false, allErrors: true }))

/** Every value given, run through both implementations and required to agree. */
const agreesWithAjv = (format: string, type: 'string' | 'number', values: readonly unknown[]): void => {
  const schema = { type, format }
  const theirs = ajv.compile(schema)
  const ours = validate(schema, { formats: 'all' })

  const divergent = values.filter((value) => theirs(value) !== (ours(value) === true))
  expect(divergent, `${format} disagreed with ajv-formats on ${JSON.stringify(divergent)}`).toEqual([])
}

describe('format-checks', () => {
  it('validates the calendar, not just the shape of a date', () => {
    // The bug a regex-only check always has: February 30th matches
    // `\d{4}-\d{2}-\d{2}` and is not a date.
    const isDate = validate({ type: 'string', format: 'date' }, { formats: 'all' })
    expect(isDate('2020-02-29')).toBe(true) // 2020 is a leap year
    expect(isDate('1998-02-29')).not.toBe(true)
    expect(isDate('2020-02-30')).not.toBe(true)
    expect(isDate('2021-13-01')).not.toBe(true)
    // Century years are leap years only when divisible by 400.
    expect(isDate('2000-02-29')).toBe(true)
    expect(isDate('1900-02-29')).not.toBe(true)
  })

  it('accepts a leap second only where one can happen', () => {
    // A leap second is always the last second of a UTC day, so the offset
    // decides which local reading is the same instant.
    const isTime = validate({ type: 'string', format: 'time' }, { formats: 'all' })
    expect(isTime('23:59:60Z')).toBe(true)
    expect(isTime('15:59:60-08:00')).toBe(true)
    expect(isTime('22:59:60Z')).not.toBe(true)
    expect(isTime('23:58:60Z')).not.toBe(true)
  })

  it('requires an offset for time and allows one to be omitted for iso-time', () => {
    // A bare `12:00:00` names no instant, which is the ambiguity `time` exists
    // to remove; `iso-time` is the format for when you meant the wall clock.
    expect(validate({ type: 'string', format: 'time' }, { formats: 'all' })('08:30:06')).not.toBe(true)
    expect(validate({ type: 'string', format: 'iso-time' }, { formats: 'all' })('08:30:06')).toBe(true)
  })

  it('rejects a dot at the edge of an email local part', () => {
    const isEmail = validate({ type: 'string', format: 'email' }, { formats: 'all' })
    expect(isEmail('joe.bloggs@example.com')).toBe(true)
    expect(isEmail('.test@example.com')).not.toBe(true)
    expect(isEmail('test.@example.com')).not.toBe(true)
    expect(isEmail('te..st@example.com')).not.toBe(true)
  })

  it('rejects a trailing dot in a hostname, as the suite requires', () => {
    const isHostname = validate({ type: 'string', format: 'hostname' }, { formats: 'all' })
    expect(isHostname('www.example.com')).toBe(true)
    expect(isHostname('www.example.com.')).not.toBe(true)
    expect(isHostname('not_a_valid_host_name')).not.toBe(true)
  })

  it('rejects a second fragment and a backslash in a URI', () => {
    const isUri = validate({ type: 'string', format: 'uri' }, { formats: 'all' })
    expect(isUri('http://foo.bar/?baz=qux#quux')).toBe(true)
    expect(isUri('http://foo.bar/?baz=qux#quux#quux')).not.toBe(true)
    // A Windows share is not a URI, however little whitespace it contains.
    expect(validate({ type: 'string', format: 'uri-reference' }, { formats: 'all' })('\\\\WINDOWS\\share')).not.toBe(
      true,
    )
  })

  it('checks the numeric formats against the number, not the string', () => {
    // `int32` and friends constrain a number, so they used to be checked for
    // nothing at all: the format keyword was only ever consulted for strings.
    const isInt32 = validate({ type: 'integer', format: 'int32' }, { formats: 'all' })
    expect(isInt32(2_147_483_647)).toBe(true)
    expect(isInt32(2_147_483_648)).not.toBe(true)
    expect(isInt32(-2_147_483_648)).toBe(true)
    expect(isInt32(-2_147_483_649)).not.toBe(true)

    // int64 can only ask for integrality — a JSON number past 2^53 has already
    // lost the precision the bound would need.
    const isInt64 = validate({ type: 'number', format: 'int64' }, { formats: 'all' })
    expect(isInt64(9_007_199_254_740_991)).toBe(true)
    expect(isInt64(1.5)).not.toBe(true)
  })

  it('leaves a numeric format alone when the instance is not a number', () => {
    // Every format is an assertion about one JSON type and silent about the
    // rest, so `{ format: 'int32' }` with no `type` still accepts a string.
    expect(validate({ format: 'int32' }, { formats: 'all' })('not a number')).toBe(true)
    expect(validate({ format: 'int32' }, { formats: 'all' })(1.5)).not.toBe(true)
  })

  it('treats an unknown format as an annotation rather than crashing on it', () => {
    // The schema is runtime input, so `format` can name anything — including a
    // property that exists on `Object.prototype`.
    expect(validate({ type: 'string', format: 'not-a-real-format' }, { formats: 'all' })('anything')).toBe(true)
    expect(validate({ type: 'string', format: 'toString' }, { formats: 'all' })('anything')).toBe(true)
    expect(validate({ type: 'string', format: 'constructor' }, { formats: 'all' })('anything')).toBe(true)
  })

  it('checks only the formats it was asked to check', () => {
    const schema = { type: 'string', format: 'date' }
    expect(validate(schema)('2020-02-30')).toBe(true)
    expect(validate(schema, { formats: ['uuid'] })('2020-02-30')).toBe(true)
    expect(validate(schema, { formats: ['date'] })('2020-02-30')).not.toBe(true)
  })

  it('is stricter than ajv-formats where the official suite requires it', () => {
    // These are the places the two deliberately disagree. Ajv accepts each of
    // them; the suite requires each to be rejected, and the suite is the
    // specification's own corpus. Kept as a test so the divergence is a recorded
    // decision rather than something to rediscover next time they are compared.
    const strictWhereSuiteRequires: readonly [string, string][] = [
      ['hostname', 'example.'],
      ['time', '08:30:06+0130'],
      ['time', '08:30:06+01'],
      ['time', '24:59:00+01:00'],
      ['time', '23:60:00+00:01'],
      ['duration', 'P1Y2D'],
      ['duration', 'PT1H2S'],
      ['uri', 'http://example.com:abc/path'],
    ]

    for (const [format, value] of strictWhereSuiteRequires) {
      expect(ajv.compile({ type: 'string', format })(value), `ajv on ${format} ${value}`).toBe(true)
      expect(validate({ type: 'string', format }, { formats: 'all' })(value), `${format} ${value}`).not.toBe(true)
    }
  })

  it('is looser than ajv-formats only where the official suite requires it', () => {
    // The one case in the other direction: Ajv rounds a fifteen-nines fraction
    // up to a full second and reads it as a leap second in the wrong hour.
    const value = '00:59:59.999999999999999Z'
    expect(ajv.compile({ type: 'string', format: 'time' })(value)).toBe(false)
    expect(validate({ type: 'string', format: 'time' }, { formats: 'all' })(value)).toBe(true)
  })

  it('agrees with ajv-formats on the formats where neither is the stricter one', () => {
    agreesWithAjv('date', 'string', ['1963-06-19', '2020-02-29', '1998-02-29', '2020-02-30', '2021-13-01', '1963-06-1'])
    agreesWithAjv('email', 'string', [
      'a@b.co',
      'joe.bloggs@example.com',
      '2962',
      '.test@example.com',
      'te..st@example.com',
    ])
    agreesWithAjv('ipv4', 'string', ['192.168.0.1', '127.0.0.0.1', '256.256.256.256', '0.0.0.0', '087.10.0.1'])
    agreesWithAjv('ipv6', 'string', ['::1', '12345::', '::abef', '1:1:1:1:1:1:1:1:1', '::ffff:192.168.0.1'])
    agreesWithAjv('json-pointer', 'string', ['/foo/bar~0/baz~1/%a', '/foo/bar~2', '/foo//bar', '0', '/~0~1'])
    agreesWithAjv('relative-json-pointer', 'string', ['1', '0#', '/foo/bar', '-1/foo/bar', '01/a'])
    agreesWithAjv('regex', 'string', ['([abc])+\\s+$', '^(abc]', 'a{1,2}'])
    agreesWithAjv('byte', 'string', ['aGVsbG8=', 'aGVsbG8', '####', ''])
    agreesWithAjv('binary', 'string', ['anything at all', ''])
    agreesWithAjv('password', 'string', ['hunter2'])
    agreesWithAjv('int32', 'number', [0, 2_147_483_647, 2_147_483_648, -2_147_483_648, -2_147_483_649, 1.5, 1e100])
    agreesWithAjv('int64', 'number', [0, 9_007_199_254_740_991, 1.5, -3])
    agreesWithAjv('float', 'number', [1.5, 0, 1e100])
    agreesWithAjv('double', 'number', [1.5, 0])
  })

  it('validates the internationalized formats ajv-formats does not carry', () => {
    // No oracle for these two, so they are pinned directly.
    const isIdnEmail = validate({ type: 'string', format: 'idn-email' }, { formats: 'all' })
    expect(isIdnEmail('실례@실례.테스트')).toBe(true)
    expect(isIdnEmail('2962')).not.toBe(true)
    expect(isIdnEmail('.실례@실례.테스트')).not.toBe(true)

    const isIdnHostname = validate({ type: 'string', format: 'idn-hostname' }, { formats: 'all' })
    expect(isIdnHostname('실례.테스트')).toBe(true)
    expect(isIdnHostname('실례.테스트.')).not.toBe(true)
    expect(isIdnHostname('-실례.테스트')).not.toBe(true)
  })

  it('validates a JSON pointer carried in a URI fragment', () => {
    const isFragment = validate({ type: 'string', format: 'json-pointer-uri-fragment' }, { formats: 'all' })
    expect(isFragment('#/a/b')).toBe(true)
    expect(isFragment('#')).toBe(true)
    expect(isFragment('/a/b')).not.toBe(true)
  })
})
