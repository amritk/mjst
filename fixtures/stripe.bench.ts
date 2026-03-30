import { coerceValue } from '@scalar/workspace-store/schemas/typebox-coerce'
import { validate } from '@scalar/validation'
import { bench, describe } from 'vitest'
import stripe from '../fixtures/stripe.json'
import { OpenAPIDocumentSchema } from '../fixtures/typebox/openapi-document'
import { parseDocument } from '../src/3.1.2/document'
import { openApiDocumentSchema } from './scalar-validation-schema'

describe('stripe bench', () => {
  bench('amrit parser', () => {
    parseDocument(stripe)
  })

  bench('typebox', () => {
    coerceValue(OpenAPIDocumentSchema, stripe)
  })

  bench('@scalar/validation', () => {
    validate(openApiDocumentSchema, stripe)
  })

  // bench('indexOf', () => {
  //   text.indexOf('isObject') !== -1
  // })
})
