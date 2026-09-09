import { describe, expect, it } from 'vitest'
import { validate } from '@/validate'
import { validateGuard } from '@/validate-guard'

describe('formats', () => {
  it('checks a custom string format given as a regex', () => {
    const isPhone = validateGuard(
      { type: 'string', format: 'phone-e164' },
      { customFormats: { 'phone-e164': /^\+[1-9]\d{6,14}$/ } },
    )
    expect(isPhone('+14155552671')).toBe(true)
    expect(isPhone('415-555-2671')).toBe(false)
  })

  it('checks a custom string format given as a predicate', () => {
    const isSlug = validateGuard(
      { type: 'string', format: 'slug' },
      { customFormats: { slug: (value) => value === value.toLowerCase() && !value.includes(' ') } },
    )
    expect(isSlug('hello-world')).toBe(true)
    expect(isSlug('Hello World')).toBe(false)
  })

  it('checks a custom numeric format', () => {
    // A format is an assertion about one JSON type, so a numeric one has to say
    // so — otherwise it would be consulted only for strings and never run.
    const isPort = validate(
      { type: 'integer', format: 'port' },
      {
        customFormats: {
          port: { type: 'number', validate: (value) => Number.isInteger(value) && value > 0 && value < 65_536 },
        },
      },
    )
    expect(isPort(8080)).toBe(true)
    expect(isPort(0)).not.toBe(true)
    expect(isPort(70_000)).not.toBe(true)
  })

  it('enforces a custom format without it also being named in formats', () => {
    // Registering a checker is the opt-in: there is no reading of "here is a
    // checker for phone" that also means "do not use it".
    const schema = { type: 'string', format: 'phone' }
    const customFormats = { phone: /^\d+$/ }
    expect(validate(schema, { customFormats })('nope')).not.toBe(true)
    expect(validate(schema, { customFormats, formats: [] })('nope')).not.toBe(true)
  })

  it('lets a custom format replace a built-in of the same name', () => {
    // How a caller tightens `email` without forking the package.
    const schema = { type: 'string', format: 'email' }
    const strict = { customFormats: { email: /^[a-z]+@example\.com$/ } }
    expect(validate(schema, { formats: 'all' })('someone@other.org')).toBe(true)
    expect(validate(schema, strict)('someone@other.org')).not.toBe(true)
    expect(validate(schema, strict)('someone@example.com')).toBe(true)
  })

  it('moves a name between families when a custom definition redefines it', () => {
    // `int32` is a built-in numeric format. Redefining it as a string format has
    // to retire the numeric one, or the name would mean two things at once.
    const custom = { customFormats: { int32: /^-?\d+$/ }, formats: 'all' as const }
    expect(validate({ format: 'int32' }, custom)('12345')).toBe(true)
    expect(validate({ format: 'int32' }, custom)('nope')).not.toBe(true)
    // The numeric check is gone, so a number is no longer this format's business.
    expect(validate({ format: 'int32' }, custom)(2 ** 40)).toBe(true)
  })

  it('leaves the built-ins opt-in when custom formats are supplied', () => {
    const schema = { type: 'object', properties: { at: { type: 'string', format: 'date' } } }
    const customFormats = { slug: /^[a-z-]+$/ }
    // `date` was not enabled, so it stays an annotation even though something else was registered.
    expect(validate(schema, { customFormats })({ at: 'not-a-date' })).toBe(true)
    expect(validate(schema, { customFormats, formats: ['date'] })({ at: 'not-a-date' })).not.toBe(true)
  })

  it('keys the validator cache on the custom formats, so two definitions never share one', () => {
    // A stale hit here would be a silently wrong verdict: same schema, same
    // options, but somebody else's idea of what the format means.
    const schema = { type: 'string', format: 'code' }
    const digits = { customFormats: { code: /^\d+$/ } }
    const letters = { customFormats: { code: /^[a-z]+$/ } }

    expect(validate(schema, digits)).toBe(validate(schema, digits))
    expect(validate(schema, letters)).not.toBe(validate(schema, digits))
    expect(validate(schema, digits)('123')).toBe(true)
    expect(validate(schema, letters)('123')).not.toBe(true)
  })

  it('reports a failed custom format the same way a built-in one is reported', () => {
    const result = validate(
      { type: 'object', properties: { phone: { type: 'string', format: 'phone' } } },
      { customFormats: { phone: /^\d+$/ } },
    )({ phone: 'nope' })

    expect(result).toEqual({
      valid: false,
      errors: [
        { message: 'must match format "phone"', path: '/phone', keyword: 'format', params: { format: 'phone' } },
      ],
    })
  })
})
