import type { Validator } from '@amritk/runtime-validators'

import { buildHeadersObject } from './build-headers-object'
import { buildParamsObject } from './build-params-object'
import { buildQueryObject } from './build-query-object'
import { matchRoute } from './match-route'
import { isPayloadTooLargeError } from './payload-too-large'
import type {
  ApiRequest,
  ApiResponse,
  ContextFactory,
  ErasedRequestContext,
  ErrorFormatters,
  OpenApiDocument,
  RouteReplyValue,
  RouteTable,
  ValidationFailureBody,
} from './types'

/**
 * Everything `handle` needs, pre-computed by `createApi`. Kept as a separate
 * type (rather than closing over locals) so the pipeline is a plain testable
 * function.
 */
export type ApiInternals = {
  readonly table: RouteTable
  readonly openApiPath: string | undefined
  readonly openApi: () => OpenApiDocument
  readonly createContext: ContextFactory | undefined
  readonly onError: ((error: unknown, request: ApiRequest) => ApiResponse) | undefined
  readonly errors: ErrorFormatters | undefined
}

/**
 * Shared no-allocation responses for outcomes whose body never varies.
 */
const NOT_FOUND: ApiResponse = Object.freeze({ status: 404, body: Object.freeze({ error: 'not_found' }) })
const INTERNAL_ERROR: ApiResponse = Object.freeze({ status: 500, body: Object.freeze({ error: 'internal_error' }) })
const INVALID_JSON: ApiResponse = Object.freeze({ status: 400, body: Object.freeze({ error: 'invalid_json' }) })
const PAYLOAD_TOO_LARGE: ApiResponse = Object.freeze({
  status: 413,
  body: Object.freeze({ error: 'payload_too_large' }),
})

/**
 * The core request pipeline: match → coerce + validate declared inputs → run
 * the handler → (optionally) validate the reply. Every step that can be
 * skipped is: undeclared slots are never parsed, guards run alone on the happy
 * path, and the error-collecting validator only executes after a guard has
 * already rejected — so a valid request does no error bookkeeping at all.
 */
export const handleRequest = async (
  internals: ApiInternals,
  request: ApiRequest,
  env?: unknown,
  executionContext?: unknown,
): Promise<ApiResponse> => {
  if (internals.openApiPath !== undefined && request.method === 'GET' && request.path === internals.openApiPath) {
    return { status: 200, body: internals.openApi() }
  }

  const errors = internals.errors
  const match = matchRoute(internals.table, request.method, request.path)
  if (match === undefined) return errors?.notFound?.(request) ?? NOT_FOUND
  const route = match.route

  let params: unknown
  if (route.params !== undefined) {
    params = buildParamsObject(match.params, route.params.coercions)
    if (!route.params.guard(params)) return validationFailure('params', route.params.collect, params, errors, request)
  }

  let query: unknown
  if (route.query !== undefined) {
    query = buildQueryObject(request.searchParams(), route.query.coercions)
    if (!route.query.guard(query)) return validationFailure('query', route.query.collect, query, errors, request)
  }

  let headers: unknown
  if (route.headers !== undefined) {
    headers = buildHeadersObject(request.header, route.headers)
    if (!route.headers.guard(headers)) {
      return validationFailure('headers', route.headers.collect, headers, errors, request)
    }
  }

  let body: unknown
  if (route.body !== undefined) {
    try {
      body = await request.readBody()
    } catch (error) {
      if (isPayloadTooLargeError(error)) return errors?.payloadTooLarge?.(request) ?? PAYLOAD_TOO_LARGE
      return errors?.invalidJson?.(request) ?? INVALID_JSON
    }
    if (!route.body.guard(body)) return validationFailure('body', route.body.collect, body, errors, request)
  }

  let reply: RouteReplyValue
  try {
    // The app context is built after validation so the factory (a session
    // lookup, a database handle) never runs for requests that will be 400ed
    // anyway. A factory error takes the same path as a handler error.
    const appContext =
      internals.createContext === undefined
        ? undefined
        : await internals.createContext({ request, env, executionContext })
    // The erased handler type exists for contract assignability (see
    // AnyRouteContract); the values really do match the contract's schemas at
    // this point, which is what the cast asserts.
    const context = { params, query, body, headers, context: appContext, request } as ErasedRequestContext
    reply = await route.contract.handler(context)
  } catch (error) {
    // A handler that read the body itself (webhook verification, uploads)
    // hits the size limit as a thrown error — that is the transport's 413,
    // not a handler crash.
    if (isPayloadTooLargeError(error)) return errors?.payloadTooLarge?.(request) ?? PAYLOAD_TOO_LARGE
    return internals.onError !== undefined ? internals.onError(error, request) : INTERNAL_ERROR
  }

  if (route.responses !== undefined) {
    const compiled = route.responses.get(reply.status)
    if (compiled !== undefined && !compiled.guard(reply.body)) {
      const result = compiled.collect(reply.body)
      return {
        status: 500,
        body: {
          error: 'invalid_response',
          status: reply.status,
          errors: result === true ? [] : result.errors,
        },
      }
    }
    if (compiled === undefined && route.contract.responses[reply.status] === undefined) {
      return {
        status: 500,
        body: { error: 'invalid_response', status: reply.status, errors: [] },
      }
    }
  }

  // A raw status carries its contract-declared content type out to the
  // adapter, which sends the body untouched instead of JSON-serializing it.
  const rawContentType = route.rawContentTypes?.get(reply.status)
  if (rawContentType !== undefined) {
    return reply.headers === undefined
      ? { status: reply.status, body: reply.body, contentType: rawContentType }
      : { status: reply.status, headers: reply.headers, body: reply.body, contentType: rawContentType }
  }
  return reply
}

/**
 * Runs the error-collecting validator (the cold path) and shapes the 400. The
 * guard has already said no by the time this runs, so the second pass exists
 * purely to tell the caller why.
 */
const validationFailure = (
  source: ValidationFailureBody['source'],
  collect: Validator,
  value: unknown,
  errors: ErrorFormatters | undefined,
  request: ApiRequest,
): ApiResponse => {
  const result = collect(value)
  const collected = result === true ? [] : result.errors
  if (errors?.validationFailed !== undefined) {
    return errors.validationFailed({ source, errors: collected }, request)
  }
  const body: ValidationFailureBody = {
    error: 'validation_failed',
    source,
    errors: collected,
  }
  return { status: 400, body }
}
