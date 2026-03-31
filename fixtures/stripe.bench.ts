import { coerce } from '@scalar/validation'
import { coerceValue } from '@scalar/workspace-store/schemas/typebox-coerce'
import { Bench } from 'tinybench'

import { parseDocument } from '../fixtures/generate-parsers/document'
import stripe from '../fixtures/stripe.json'
import { OpenAPIDocumentSchema } from '../fixtures/typebox/openapi-document'
import { openApiDocumentSchema } from './scalar-validation-schema'

const bench = new Bench({ name: 'stripe bench' })

bench
  .add('amrit parser', () => {
    parseDocument(stripe)
  })
  .add('typebox', () => {
    coerceValue(OpenAPIDocumentSchema, stripe)
  })
  .add('@scalar/validation', () => {
    coerce(openApiDocumentSchema, stripe)
  })

await bench.run()

console.table(bench.table())
