import { buildCoercionPlan } from './build-coercion-plan'
import { parsePathPattern } from './parse-path-pattern'
import type {
  AnyRouteContract,
  Coercion,
  CompiledBody,
  CompiledCookies,
  CompiledHeaders,
  CompiledInput,
  CompiledResponse,
  CompiledRoute,
  ValidatorCompiler,
} from './types'

/**
 * Turns a route contract into its compiled runtime form. Everything derivable
 * from the contract — parsed path segments, validators, coercion plans — is
 * built here, once, at startup, so `handle` touches no schema at request time.
 *
 * Response validators are only compiled when response validation is enabled;
 * with it off (the production default) declaring response schemas costs
 * nothing at runtime — they exist purely for OpenAPI and handler typing.
 */
export const compileRoute = (
  contract: AnyRouteContract,
  compile: ValidatorCompiler,
  validateResponses: boolean,
): CompiledRoute => {
  const segments = parsePathPattern(contract.path)
  const request = contract.request

  let responses: Map<number, CompiledResponse> | undefined
  if (validateResponses) {
    responses = new Map()
    for (const [status, response] of Object.entries(contract.responses)) {
      // Raw statuses carry a stream or text, not a JSON value — any body
      // schema they declare exists purely for OpenAPI, so there is nothing
      // for response validation to check.
      const body =
        response.body !== undefined && response.contentType === undefined ? compile(response.body) : undefined
      // Declared response headers validate as an open object: undeclared
      // headers pass, declared ones must match their schema when present.
      const headers =
        response.headers !== undefined ? compile({ type: 'object', properties: response.headers }) : undefined
      if (body !== undefined || headers !== undefined) {
        responses.set(Number(status), { body, headers })
      }
    }
  }

  let rawContentTypes: Map<number, string> | undefined
  for (const [status, response] of Object.entries(contract.responses)) {
    if (response.contentType !== undefined) {
      rawContentTypes ??= new Map()
      rawContentTypes.set(Number(status), response.contentType)
    }
  }

  return {
    contract,
    method: contract.method.toUpperCase(),
    segments,
    params: compileInput(request?.params, compile),
    query: compileInput(request?.query, compile),
    body: compileBody(request?.body, request?.bodyType, compile),
    headers: compileHeaders(request?.headers, compile),
    cookies: compileCookies(request?.cookies, compile),
    responses,
    rawContentTypes,
  }
}

const compileInput = (schema: unknown, compile: ValidatorCompiler): CompiledInput | undefined => {
  if (schema === undefined) return undefined
  return { ...compile(schema), coercions: buildCoercionPlan(schema) }
}

/** Empty plan shared by JSON bodies, whose values arrive already typed. */
const NO_COERCIONS: ReadonlyMap<string, Coercion> = new Map<string, Coercion>()

const compileBody = (
  schema: unknown,
  bodyType: CompiledBody['bodyType'] | undefined,
  compile: ValidatorCompiler,
): CompiledBody | undefined => {
  if (schema === undefined) return undefined
  const type = bodyType ?? 'json'
  // Only form and multipart fields arrive as strings needing coercion (exactly
  // like query parameters). JSON values are already typed, and raw text/bytes
  // are handed over unparsed — all three skip the plan.
  const coercions = type === 'form' || type === 'multipart' ? buildCoercionPlan(schema) : NO_COERCIONS
  return { ...compile(schema), bodyType: type, coercions }
}

/**
 * Headers additionally need the declared property names captured up front —
 * the request offers header lookup, not enumeration, so these names are the
 * complete list of what the route will ever read.
 */
const compileHeaders = (schema: unknown, compile: ValidatorCompiler): CompiledHeaders | undefined => {
  if (schema === undefined) return undefined
  const names = declaredProperties(schema).map((property) => [property, property.toLowerCase()] as const)
  return { ...compile(schema), coercions: buildCoercionPlan(schema), names }
}

/**
 * Cookies filter by declared name too, but as a set: the parser walks the
 * whole `cookie` header (which carries everything the browser holds) and
 * keeps only these.
 */
const compileCookies = (schema: unknown, compile: ValidatorCompiler): CompiledCookies | undefined => {
  if (schema === undefined) return undefined
  return { ...compile(schema), coercions: buildCoercionPlan(schema), names: new Set(declaredProperties(schema)) }
}

const declaredProperties = (schema: unknown): string[] => {
  const properties =
    typeof schema === 'object' && schema !== null ? (schema as { properties?: unknown }).properties : undefined
  return typeof properties === 'object' && properties !== null ? Object.keys(properties) : []
}
