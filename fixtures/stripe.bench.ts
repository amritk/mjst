import { coerceValue } from '@scalar/workspace-store/schemas/typebox-coerce'
import { bench, describe } from 'vitest'
import stripe from '../fixtures/stripe.json'
import { OpenAPIDocumentSchema } from '../fixtures/typebox/openapi-document'
import { parseDocument } from '../src/3.1.2/document'

describe('stripe bench', () => {
  bench('amrit parser', () => {
    parseDocument(stripe)
  })

  bench('typebox', () => {
    coerceValue(OpenAPIDocumentSchema, stripe)
  })

  // bench('indexOf', () => {
  //   text.indexOf('isObject') !== -1
  // })
})
