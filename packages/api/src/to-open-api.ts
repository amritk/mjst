import type { AnyRouteContract, OpenApiDocument, OpenApiExtras, OpenApiInfo } from './types'

/**
 * Builds an OpenAPI 3.1 document from route contracts — no annotations, no
 * decorators, no second source of truth. This works because OpenAPI 3.1's
 * schema dialect *is* JSON Schema Draft 2020-12: every schema in a contract is
 * embedded verbatim, byte for byte, so whatever the validators enforce is
 * exactly what the document promises.
 *
 * The one transformation applied: a schema carrying a `title` that is used by
 * more than one body position (request or response) is hoisted into
 * `components.schemas` under that title and referenced with `$ref` — so a
 * `User` schema shared by five routes appears once, and generated clients get
 * one `User` type instead of five structurally identical ones. Titles that
 * collide with *different* contents stay inline (never a wrong `$ref`).
 *
 * Params/query object schemas are unrolled into per-property Parameter
 * Objects (`in: 'path'` / `in: 'query'`). Object-level keywords on those
 * schemas (`additionalProperties`, `patternProperties`, …) still validate at
 * runtime but have no per-parameter representation in OpenAPI, so they do not
 * appear in the document.
 */
export const toOpenApi = (
  routes: ReadonlyArray<AnyRouteContract>,
  info: OpenApiInfo,
  extras: OpenApiExtras = {},
): OpenApiDocument => {
  const components = collectComponentSchemas(routes)
  const embed = (schema: unknown): unknown => components.refs.get(schema as object) ?? schema

  const paths: Record<string, Record<string, unknown>> = {}

  for (const route of routes) {
    const operation: Record<string, unknown> = {}
    if (route.summary !== undefined) operation['summary'] = route.summary
    if (route.description !== undefined) operation['description'] = route.description
    if (route.tags !== undefined) operation['tags'] = route.tags
    if (route.operationId !== undefined) operation['operationId'] = route.operationId
    if (route.deprecated === true) operation['deprecated'] = true
    if (route.security !== undefined) operation['security'] = route.security

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
        content: { [BODY_MEDIA_TYPES[route.request.bodyType ?? 'json']]: { schema: embed(route.request.body) } },
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
        response['content'] = { [mediaType]: contract.body !== undefined ? { schema: embed(contract.body) } : {} }
      } else if (contract.body !== undefined) {
        response['content'] = { 'application/json': { schema: embed(contract.body) } }
      }
      if (contract.headers !== undefined) {
        response['headers'] = Object.fromEntries(
          Object.entries(contract.headers).map(([name, schema]) => [name, { schema }]),
        )
      }
      responses[status] = response
    }
    operation['responses'] = responses

    const pathItem = paths[route.path] ?? {}
    pathItem[route.method] = operation
    paths[route.path] = pathItem
  }

  const document: Record<string, unknown> = {
    openapi: '3.1.0',
    jsonSchemaDialect: 'https://json-schema.org/draft/2020-12/schema',
    info,
  }
  if (extras.servers !== undefined) document['servers'] = extras.servers
  if (extras.security !== undefined) document['security'] = extras.security
  document['paths'] = paths
  if (components.schemas.size > 0 || extras.securitySchemes !== undefined) {
    const block: Record<string, unknown> = {}
    if (components.schemas.size > 0) block['schemas'] = Object.fromEntries(components.schemas)
    if (extras.securitySchemes !== undefined) block['securitySchemes'] = extras.securitySchemes
    document['components'] = block
  }
  return document as unknown as OpenApiDocument
}

/** The OpenAPI requestBody content key for each declared body type. */
const BODY_MEDIA_TYPES = {
  json: 'application/json',
  form: 'application/x-www-form-urlencoded',
  multipart: 'multipart/form-data',
} as const

/** Component-schema keys must match `^[a-zA-Z0-9._-]+$`. */
const sanitizeComponentKey = (title: string): string => title.replace(/[^a-zA-Z0-9._-]/g, '_')

type ComponentPlan = {
  /** Hoisted schemas by component key, ready for `components.schemas`. */
  readonly schemas: ReadonlyMap<string, unknown>
  /** Schema object → its `$ref` replacement, for every hoisted occurrence. */
  readonly refs: ReadonlyMap<object, { readonly $ref: string }>
}

/**
 * Finds titled schemas worth hoisting: used in two or more body positions
 * (identical object, or distinct objects whose JSON serialization matches).
 * A title claimed by schemas with *different* contents is a conflict and
 * nothing under it hoists — an inline duplicate is always correct, a `$ref`
 * to the wrong shape never is. Component keys are sanitized; a sanitized-key
 * collision between different titles keeps the later title inline too.
 */
const collectComponentSchemas = (routes: ReadonlyArray<AnyRouteContract>): ComponentPlan => {
  type Entry = { json: string; objects: object[]; conflict: boolean }
  const byTitle = new Map<string, Entry>()

  const visit = (schema: unknown): void => {
    if (typeof schema !== 'object' || schema === null) return
    const title = (schema as { title?: unknown }).title
    if (typeof title !== 'string' || title === '') return
    const entry = byTitle.get(title)
    if (entry === undefined) {
      byTitle.set(title, { json: JSON.stringify(schema), objects: [schema], conflict: false })
      return
    }
    if (!entry.objects.includes(schema)) {
      if (entry.json === JSON.stringify(schema)) entry.objects.push(schema)
      else entry.conflict = true
    } else {
      // The same object again — a second usage site.
      entry.objects.push(schema)
    }
  }

  for (const route of routes) {
    visit(route.request?.body)
    for (const response of Object.values(route.responses)) visit(response.body)
  }

  const schemas = new Map<string, unknown>()
  const refs = new Map<object, { readonly $ref: string }>()
  for (const [title, entry] of byTitle) {
    if (entry.conflict || entry.objects.length < 2) continue
    const key = sanitizeComponentKey(title)
    if (schemas.has(key)) continue
    schemas.set(key, entry.objects[0])
    const ref = { $ref: '#/components/schemas/' + key }
    for (const object of entry.objects) refs.set(object, ref)
  }
  return { schemas, refs }
}

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
