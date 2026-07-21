import { describe, expect, it } from 'vitest'

import { schemaToValidator } from './schema-to-validator'

const schema = {
  type: 'object',
  properties: {
    email: { type: 'string', minLength: 1 },
    age: { type: 'string', pattern: '^[0-9]+$' },
  },
  required: ['email'],
} as const

describe('schema-to-validator', () => {
  it('returns no errors for valid values', () => {
    const validate = schemaToValidator(schema)
    expect(validate({ email: 'a@b.com', age: '30' })).toEqual({})
  })

  it('maps a value-level error to its field via the pointer path', () => {
    const validate = schemaToValidator(schema)
    const errors = validate({ email: 'a@b.com', age: 'not-a-number' })
    expect(errors['age']).toBeDefined()
    expect(errors['email']).toBeUndefined()
  })

  it('maps a missing required property to its field via the message', () => {
    const validate = schemaToValidator(schema)
    const errors = validate({ age: '30' })
    // The required error is reported at the root path, so the field name is
    // recovered from the message text.
    expect(errors['email']).toBeDefined()
  })

  it('keeps only the first error per field', () => {
    const strict = {
      type: 'object',
      properties: { name: { type: 'string', minLength: 5, pattern: '^[A-Z]' } },
      required: ['name'],
    } as const
    const validate = schemaToValidator(strict)
    const errors = validate({ name: 'ab' })
    expect(typeof errors['name']).toBe('string')
  })
})
