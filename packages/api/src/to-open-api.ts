import type { AnyRouteContract, OpenApiDocument, OpenApiInfo } from './types'

/**
 * Builds an OpenAPI 3.1 document from route contracts — no annotations, no
 * decorators, no second source of truth. This works because OpenAPI 3.1's
 * schema dialect *is* JSON Schema Draft 2020-12: every schema in a contract is
 * embedded verbatim, byte for byte, so whatever the validators enforce is
 * exactly what the document promises.
 *
 * Params/query object schemas are unrolled into per-property Parameter
 * Objects (`in: 'path'` / `in: 'query'`). Object-level keywords on those
 * schemas (`additionalProperties`, `patternProperties`, …) still validate at
 * runtime but have no per-parameter representation in OpenAPI, so they do not
 * appear in the document.
 */
export const toOpenApi = (routes: ReadonlyArray<AnyRouteContract>, info: OpenApiInfo): OpenApiDocument => {
  const paths: Record<string, Record<string, unknown>> = {}

  for (const route of routes) {
    const operation: Record<string, unknown> = {}
    if (route.summary !== undefined) operation['summary'] = route.summary
    if (route.description !== undefined) operation['description'] = route.description
    if (route.tags !== undefined) operation['tags'] = route.tags
    if (route.operationId !== undefined) operation['operationId'] = route.operationId

    const parameters = [
      ...toParameters(route.request?.params, 'path'),
      ...toParameters(route.request?.query, 'query'),
      ...toParameters(route.request?.headers, 'header'),
      ...toParameters(route.request?.cookies, 'cookie'),
    ]
    if (parameters.length > 0) operation['parameters'] = parameters

    if (route.request?.body !== undefined) {
      operation['requestBody'] = {
        required: true,
        content: { [BODY_MEDIA_TYPES[route.request.bodyType ?? 'json']]: { schema: route.request.body } },
      }
    }

    const responses: Record<string, unknown> = {}
    for (const [status, contract] of Object.entries(route.responses)) {
      const response: Record<string, unknown> = {
        // OpenAPI requires a description on every response object.
        description: contract.description ?? 'Status ' + status,
      }
      if (contract.contentType !== undefined) {
        // Raw statuses document under their declared content type. Media-type
        // parameters (`; charset=utf-8`) are stripped: OpenAPI keys content
        // by media type alone.
        const mediaType = contract.contentType.split(';')[0]?.trim() ?? contract.contentType
        response['content'] = { [mediaType]: contract.body !== undefined ? { schema: contract.body } : {} }
      } else if (contract.body !== undefined) {
        response['content'] = { 'application/json': { schema: contract.body } }
      }
      responses[status] = response
    }
    operation['responses'] = responses

    const pathItem = paths[route.path] ?? {}
    pathItem[route.method] = operation
    paths[route.path] = pathItem
  }

  return {
    openapi: '3.1.0',
    jsonSchemaDialect: 'https://json-schema.org/draft/2020-12/schema',
    info,
    paths,
  }
}

/** The OpenAPI requestBody content key for each declared body type. */
const BODY_MEDIA_TYPES = {
  json: 'application/json',
  form: 'application/x-www-form-urlencoded',
  multipart: 'multipart/form-data',
} as const

const toParameters = (schema: unknown, location: 'path' | 'query' | 'header' | 'cookie'): unknown[] => {
  if (typeof schema !== 'object' || schema === null) return []
  const { properties, required } = schema as {
    properties?: Record<string, unknown>
    required?: readonly string[]
  }
  if (properties === undefined || typeof properties !== 'object') return []
  const requiredKeys = new Set(required ?? [])
  return Object.entries(properties).map(([name, propertySchema]) => ({
    name,
    in: location,
    // The OpenAPI spec mandates required: true for path parameters.
    required: location === 'path' ? true : requiredKeys.has(name),
    schema: propertySchema,
  }))
}
