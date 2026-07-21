import type { AnyRouteContract, OpenApiDocument, OpenApiExtras, OpenApiInfo } from './types'

/**
 * Builds an OpenAPI 3.1 document from route contracts — no annotations, no
 * decorators, no second source of truth. This works because OpenAPI 3.1's
 * schema dialect *is* JSON Schema Draft 2020-12: every schema in a contract is
 * embedded verbatim, byte for byte, so whatever the validators enforce is
 * exactly what the document promises.
 *
 * Two transformations are applied to body schemas:
 *
 * - A schema carrying a `title` that is used by more than one body position
 *   (request or response) is hoisted into `components.schemas` under that
 *   title and referenced with `$ref` — so a `User` schema shared by five
 *   routes appears once, and generated clients get one `User` type instead of
 *   five structurally identical ones. Titles that collide with *different*
 *   contents stay inline (never a wrong `$ref`).
 * - A schema containing internal `$ref`s (`#/$defs/...`, recursion) cannot be
 *   embedded inline — its refs would resolve against the OpenAPI document
 *   root and dangle. Such schemas are always hoisted (under their title, or a
 *   key synthesized from the operation) with every internal ref rewritten to
 *   point inside the hoisted component.
 *
 * Every operation gets an `operationId`: the contract's explicit one, or a
 * deterministic camelCase synthesis from method + path. Duplicates — explicit
 * or synthesized — throw at build time, naming both routes.
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
  // operationId → "method path", so a duplicate can name both offenders.
  const operationIds = new Map<string, string>()

  for (const route of routes) {
    const operation: Record<string, unknown> = {}
    if (route.summary !== undefined) operation['summary'] = route.summary
    if (route.description !== undefined) operation['description'] = route.description
    if (route.tags !== undefined) operation['tags'] = route.tags

    // Every operation carries an operationId — generated clients key methods
    // by it, so leaving it out degrades every consumer downstream.
    const operationId = route.operationId ?? synthesizeOperationId(route.method, route.path)
    const claimedBy = operationIds.get(operationId)
    const routeName = route.method + ' ' + route.path
    if (claimedBy !== undefined) {
      throw new Error(
        `Duplicate operationId '${operationId}': declared by both '${claimedBy}' and '${routeName}'. ` +
          `Set a distinct explicit operationId on one of them.`,
      )
    }
    operationIds.set(operationId, routeName)
    operation['operationId'] = operationId

    if (route.deprecated === true) operation['deprecated'] = true
    if (route.security !== undefined) operation['security'] = route.security

    const parameters = [
      ...toParameters(route.request?.params, 'path', greedyParamNames(route.path)),
      ...toParameters(route.request?.query, 'query'),
      ...toParameters(route.request?.headers, 'header'),
      ...toParameters(route.request?.cookies, 'cookie'),
    ]
    if (parameters.length > 0) operation['parameters'] = parameters

    if (route.request?.body !== undefined) {
      const mediaTypeObject: Record<string, unknown> = { schema: embed(route.request.body) }
      if (route.request.bodyType === 'multipart') {
        const encoding = toMultipartEncoding(route.request.body)
        if (encoding !== undefined) mediaTypeObject['encoding'] = encoding
      }
      operation['requestBody'] = {
        required: true,
        content: { [BODY_MEDIA_TYPES[route.request.bodyType ?? 'json']]: mediaTypeObject },
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

    // Greedy `{name+}` params are a routing concept; the OpenAPI paths key
    // must use plain `{name}` templates or the document is invalid.
    const pathKey = toPathsKey(route.path)
    const pathItem = paths[pathKey] ?? {}
    pathItem[route.method] = operation
    paths[pathKey] = pathItem
  }

  const document: Record<string, unknown> = {
    openapi: '3.1.0',
    jsonSchemaDialect: 'https://json-schema.org/draft/2020-12/schema',
    info,
  }
  if (extras.servers !== undefined) document['servers'] = extras.servers
  if (extras.security !== undefined) document['security'] = extras.security
  if (extras.tags !== undefined) document['tags'] = extras.tags
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
  // Raw encodings document a representative default media type; the actual
  // request may carry any textual (text/*) or binary type — the 415 check is
  // deliberately lenient there (see matchesBodyType).
  text: 'text/plain',
  bytes: 'application/octet-stream',
} as const

/** Matches a greedy `{name+}` path segment (parse-path-pattern's syntax). */
const GREEDY_SEGMENT = /\{([^{}]+)\+\}/g

/**
 * The OpenAPI paths key for a route: greedy `{name+}` markers become plain
 * `{name}` templates, because `+` is not part of OpenAPI path templating.
 */
const toPathsKey = (path: string): string => path.replace(GREEDY_SEGMENT, '{$1}')

/** The parameter names a path declares as greedy (`{name+}`). */
const greedyParamNames = (path: string): ReadonlySet<string> =>
  new Set([...path.matchAll(GREEDY_SEGMENT)].map((match) => match[1] as string))

/** Component-schema keys must match `^[a-zA-Z0-9._-]+$`. */
const sanitizeComponentKey = (title: string): string => title.replace(/[^a-zA-Z0-9._-]/g, '_')

/**
 * Deterministic camelCase operationId from method + path: the method, each
 * static segment PascalCased, each `{param}` (greedy or not) contributing
 * `By<Param>` — `get /users/{id}` → `getUsersById`. Output stays within
 * `[A-Za-z0-9_]` because the PascalCase step drops everything else.
 */
const synthesizeOperationId = (method: string, path: string): string => {
  const parts = path
    .split('/')
    .filter((segment) => segment !== '')
    .map((segment) => {
      const parameter = /^\{([^{}]+?)\+?\}$/.exec(segment)
      return parameter === null ? pascalCase(segment) : 'By' + pascalCase(parameter[1] as string)
    })
  return method + parts.join('')
}

/** PascalCases a path segment, dropping characters outside `[A-Za-z0-9_]`. */
const pascalCase = (value: string): string =>
  value
    .split(/[^A-Za-z0-9_]+/)
    .filter((piece) => piece !== '')
    .map((piece) => piece.charAt(0).toUpperCase() + piece.slice(1))
    .join('')

type ComponentPlan = {
  /** Hoisted schemas by component key, ready for `components.schemas`. */
  readonly schemas: ReadonlyMap<string, unknown>
  /** Schema object → its `$ref` replacement, for every hoisted occurrence. */
  readonly refs: ReadonlyMap<object, { readonly $ref: string }>
}

/** One body-position use of a schema, with the key to synthesize if needed. */
type SchemaOccurrence = {
  readonly schema: object
  /** Deterministic fallback component key: operation name + slot. */
  readonly syntheticKey: string
}

/**
 * Plans `components.schemas` from every body-position schema (request and
 * response bodies). Two kinds of schemas hoist:
 *
 * - Titled schemas used in two or more positions (identical object, or
 *   distinct objects whose JSON serialization matches) — deduplication for
 *   generated clients. A title claimed by schemas with *different* contents
 *   is a conflict and nothing hoists under it — an inline duplicate is always
 *   correct, a `$ref` to the wrong shape never is. A sanitized-key collision
 *   between different titles keeps the later title inline too.
 * - Schemas containing internal `$ref`s — these *must* hoist (inline
 *   embedding leaves the refs dangling against the document root), so there
 *   is no inline fallback: a conflicted or untitled ref-carrying schema gets
 *   a key synthesized from its operation, and any remaining key collision is
 *   disambiguated with a numeric suffix. Every internal ref in the hoisted
 *   copy is rewritten to resolve inside the component.
 */
const collectComponentSchemas = (routes: ReadonlyArray<AnyRouteContract>): ComponentPlan => {
  const occurrences: SchemaOccurrence[] = []
  for (const route of routes) {
    const operationName = synthesizeOperationId(route.method, route.path)
    const push = (schema: unknown, slot: string): void => {
      if (typeof schema === 'object' && schema !== null)
        occurrences.push({ schema, syntheticKey: operationName + slot })
    }
    push(route.request?.body, 'Body')
    for (const [status, response] of Object.entries(route.responses)) push(response.body, 'Response' + status)
  }

  type Entry = { json: string; objects: object[]; conflict: boolean }
  const byTitle = new Map<string, Entry>()
  for (const { schema } of occurrences) {
    const title = (schema as { title?: unknown }).title
    if (typeof title !== 'string' || title === '') continue
    const entry = byTitle.get(title)
    if (entry === undefined) {
      byTitle.set(title, { json: JSON.stringify(schema), objects: [schema], conflict: false })
      continue
    }
    if (!entry.objects.includes(schema)) {
      if (entry.json === JSON.stringify(schema)) entry.objects.push(schema)
      else entry.conflict = true
    } else {
      // The same object again — a second usage site.
      entry.objects.push(schema)
    }
  }

  const schemas = new Map<string, unknown>()
  const refs = new Map<object, { readonly $ref: string }>()
  // Original (pre-rewrite) JSON → component key, so structurally identical
  // ref-carrying schemas share one component instead of hoisting twice.
  const refSchemaKeys = new Map<string, string>()

  // Numeric-suffix disambiguation: ref-carrying schemas have no safe inline
  // fallback, so a taken key yields `Key2`, `Key3`, … instead.
  const claimFreeKey = (desired: string): string => {
    if (!schemas.has(desired)) return desired
    for (let suffix = 2; ; suffix += 1) {
      const candidate = desired + String(suffix)
      if (!schemas.has(candidate)) return candidate
    }
  }

  const hoistRefSchema = (objects: readonly object[], json: string, desiredKey: string): void => {
    const existingKey = refSchemaKeys.get(json)
    const key = existingKey ?? claimFreeKey(desiredKey)
    if (existingKey === undefined) {
      schemas.set(key, rewriteInternalRefs(objects[0], key))
      refSchemaKeys.set(json, key)
    }
    const ref = { $ref: '#/components/schemas/' + key }
    for (const object of objects) refs.set(object, ref)
  }

  for (const [title, entry] of byTitle) {
    if (entry.conflict) continue
    const carriesRefs = hasInternalRef(entry.objects[0])
    // Without refs, hoisting is purely a deduplication: only worth it for
    // two or more uses. With refs, even a single use must hoist.
    if (!carriesRefs && entry.objects.length < 2) continue
    const key = sanitizeComponentKey(title)
    if (carriesRefs) {
      hoistRefSchema(entry.objects, entry.json, key)
      continue
    }
    if (schemas.has(key)) continue
    schemas.set(key, entry.objects[0])
    const ref = { $ref: '#/components/schemas/' + key }
    for (const object of entry.objects) refs.set(object, ref)
  }

  // Ref-carrying schemas the title pass could not place: untitled ones, and
  // titled ones whose title is conflicted.
  for (const { schema, syntheticKey } of occurrences) {
    if (refs.has(schema) || !hasInternalRef(schema)) continue
    hoistRefSchema([schema], JSON.stringify(schema), sanitizeComponentKey(syntheticKey))
  }

  return { schemas, refs }
}

/** Whether a schema contains a `$ref` targeting the schema's own document (`#...`). */
const hasInternalRef = (schema: unknown): boolean => {
  if (Array.isArray(schema)) return schema.some(hasInternalRef)
  if (typeof schema !== 'object' || schema === null) return false
  return Object.entries(schema).some(
    ([keyword, value]) =>
      (keyword === '$ref' && typeof value === 'string' && value.startsWith('#')) || hasInternalRef(value),
  )
}

/**
 * Deep-copies a schema, re-rooting every internal `$ref` at its hoisted
 * component: `#/$defs/Node` becomes `#/components/schemas/<Key>/$defs/Node`,
 * and a bare `#` becomes the component itself. Refs the schema wrote against
 * its own root stay valid because the component *is* that root.
 */
const rewriteInternalRefs = (schema: unknown, key: string): unknown => {
  if (Array.isArray(schema)) return schema.map((item) => rewriteInternalRefs(item, key))
  if (typeof schema !== 'object' || schema === null) return schema
  return Object.fromEntries(
    Object.entries(schema).map(([keyword, value]) =>
      keyword === '$ref' && typeof value === 'string' && value.startsWith('#')
        ? [keyword, '#/components/schemas/' + key + value.slice(1)]
        : [keyword, rewriteInternalRefs(value, key)],
    ),
  )
}

/**
 * The `encoding` object for a multipart request body, mapping each file part
 * (a property schema with no `type` keyword — the multipart file convention)
 * to its part content type. `undefined` when the body has no file parts, so
 * all-field bodies stay free of an empty `encoding`.
 */
const toMultipartEncoding = (body: unknown): Record<string, unknown> | undefined => {
  if (typeof body !== 'object' || body === null) return undefined
  const { properties } = body as { properties?: Record<string, unknown> }
  if (properties === undefined || typeof properties !== 'object' || properties === null) return undefined
  const fileParts = Object.entries(properties).filter(
    ([, schema]) => typeof schema === 'object' && schema !== null && !('type' in schema),
  )
  if (fileParts.length === 0) return undefined
  return Object.fromEntries(
    fileParts.map(([name, schema]) => {
      const { contentMediaType } = schema as { contentMediaType?: unknown }
      return [
        name,
        { contentType: typeof contentMediaType === 'string' ? contentMediaType : 'application/octet-stream' },
      ]
    }),
  )
}

const toParameters = (
  schema: unknown,
  location: 'path' | 'query' | 'header' | 'cookie',
  greedyNames?: ReadonlySet<string>,
): unknown[] => {
  if (typeof schema !== 'object' || schema === null) return []
  const { properties, required } = schema as {
    properties?: Record<string, unknown>
    required?: readonly string[]
  }
  if (properties === undefined || typeof properties !== 'object') return []
  const requiredKeys = new Set(required ?? [])
  return Object.entries(properties).map(([name, propertySchema]) => {
    const parameter: Record<string, unknown> = {
      name,
      in: location,
      // The OpenAPI spec mandates required: true for path parameters.
      required: location === 'path' ? true : requiredKeys.has(name),
      schema: propertySchema,
    }
    if (greedyNames?.has(name) === true) {
      // The paths key shows a plain `{name}`, so the greedy capture behavior
      // has to be said somewhere readers will see it.
      const note = 'Matches one or more slash-separated path segments.'
      const existing = (propertySchema as { description?: unknown } | null)?.description
      parameter['description'] = typeof existing === 'string' && existing !== '' ? existing + ' ' + note : note
    }
    return parameter
  })
}
