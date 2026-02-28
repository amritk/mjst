import { coerceValue } from '@scalar/workspace-store/schemas/typebox-coerce'
import { describe, expect, it } from 'vitest'
// import { parseDocument } from '../../src/3.1.2/document'
import stripe from '../cloudinary.json'
import { OpenAPIDocumentSchema } from './openapi-document'

describe.skip('stripe test', () => {
  const parseDocument = (input: unknown) => input
  const amrit = parseDocument(stripe)
  const typebox = coerceValue(OpenAPIDocumentSchema, stripe) as any

  it('servers should match', () => {
    expect(amrit.servers).toEqual(typebox.servers)
  })

  it('openapi should match', () => {
    expect(amrit.openapi).toEqual(typebox.openapi)
  })

  it('components.callbacks should match', () => {
    expect(amrit.components?.callbacks).toEqual(typebox.components?.callbacks)
  })

  it('components.parameters should match', () => {
    expect(amrit.components?.parameters).toEqual(typebox.components?.parameters)
  })

  it('components.responses should match', () => {
    expect(amrit.components?.responses).toEqual(typebox.components?.responses)
  })

  it('components.examples should match', () => {
    expect(amrit.components?.examples).toEqual(typebox.components?.examples)
  })

  it('components.requestBodies should match', () => {
    expect(amrit.components?.requestBodies).toEqual(typebox.components?.requestBodies)
  })

  it('components.headers should match', () => {
    expect(amrit.components?.headers).toEqual(typebox.components?.headers)
  })

  it('components.securitySchemes should match', () => {
    expect(amrit.components?.securitySchemes).toEqual(typebox.components?.securitySchemes)
  })

  it('externalDocs should match', () => {
    expect(amrit.externalDocs).toEqual(typebox.externalDocs)
  })

  it('info should match', () => {
    expect(amrit.info).toEqual(typebox.info)
  })

  it('paths should match', () => {
    expect(amrit.paths).toEqual(typebox.paths)
  })

  it('components.schemas should match', () => {
    expect(amrit.components?.schemas).toEqual(typebox.components?.schemas)
  })
})
