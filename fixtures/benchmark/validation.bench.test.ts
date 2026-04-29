import { describe, expect, it } from 'bun:test'
import { Value } from '@scalar/typebox/value'
import { coerce } from '@scalar/validation'

import { parseDocument as parseLarge } from '../generate-parsers/benchmark/large/document'
import { parseDocument as parseMedium } from '../generate-parsers/benchmark/medium/document'
import { parseDocument as parseSmall } from '../generate-parsers/benchmark/small/document'
import { largeData } from './data/large'
import { largeInvalidData } from './data/large-invalid'
import { mediumData } from './data/medium'
import { mediumInvalidData } from './data/medium-invalid'
import { smallData } from './data/small'
import { smallInvalidData } from './data/small-invalid'
import { orderSchema } from './scalar-validation/large'
import { blogPostSchema } from './scalar-validation/medium'
import { userSchema } from './scalar-validation/small'
import { OrderSchema } from './typebox/large'
import { BlogPostSchema } from './typebox/medium'
import { UserSchema } from './typebox/small'

const sizes = [
  {
    name: 'small',
    validData: smallData,
    invalidData: smallInvalidData,
    typebox: UserSchema,
    validation: userSchema,
    parser: parseSmall,
  },
  {
    name: 'medium',
    validData: mediumData,
    invalidData: mediumInvalidData,
    typebox: BlogPostSchema,
    validation: blogPostSchema,
    parser: parseMedium,
  },
  {
    name: 'large',
    validData: largeData,
    invalidData: largeInvalidData,
    typebox: OrderSchema,
    validation: orderSchema,
    parser: parseLarge,
  },
] as const

describe('validation.bench', () => {
  for (const { name, validData, invalidData, typebox, validation, parser } of sizes) {
    for (const scenario of ['valid', 'invalid'] as const) {
      const data = scenario === 'valid' ? validData : invalidData

      // For invalid input the three libraries diverge on coercion strategy
      // (mjst coerces, typebox/Value.Cast resets to defaults). Only the
      // valid-input case is meaningfully comparable.
      const test = scenario === 'invalid' ? it.todo : it
      test(`all three produce equal output for ${name} (${scenario})`, () => {
        const mjstResult = parser(data)
        const typeboxResult = Value.Cast(typebox, data)
        const scalarResult = coerce(validation, data)

        expect(mjstResult).toEqual(typeboxResult)
        expect(mjstResult).toEqual(scalarResult)
      })
    }
  }
})
