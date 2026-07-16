import type { Validator } from '@amritk/runtime-validators'

import { buildParamsObject } from './build-params-object'
import { buildQueryObject } from './build-query-object'
import { matchRoute } from './match-route'
import type {
  ApiRequest,
  ApiResponse,
  ContextFactory,
  ErasedRequestContext,
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
}

/**
 * Shared no-allocation responses for outcomes whose body never varies.
 */
const NOT_FOUND: ApiResponse = Object.freeze({ status: 404, body: Object.freeze({ error: 'not_found' }) })
const INTERNAL_ERROR: ApiResponse = Object.freeze({ status: 500, body: Object.freeze({ error: 'internal_error' }) })
const INVALID_JSON: ApiResponse = Object.freeze({ status: 400, body: Object.freeze({ error: 'invalid_json' }) })

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

  const match = matchRoute(internals.table, request.method, request.path)
  if (match === undefined) return NOT_FOUND
  const route = match.route

  let params: unknown
  if (route.params !== undefined) {
    params = buildParamsObject(match.params, route.params.coercions)
    if (!route.params.guard(params)) return validationFailure('params', route.params.collect, params)
  }

  let query: unknown
  if (route.query !== undefined) {
    query = buildQueryObject(request.searchParams(), route.query.coercions)
    if (!route.query.guard(query)) return validationFailure('query', route.query.collect, query)
  }

  let body: unknown
  if (route.body !== undefined) {
    try {
      body = await request.readBody()
    } catch {
      return INVALID_JSON
    }
    if (!route.body.guard(body)) return validationFailure('body', route.body.collect, body)
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
    const context = { params, query, body, context: appContext, request } as ErasedRequestContext
    reply = await route.contract.handler(context)
  } catch (error) {
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
): ApiResponse => {
  const result = collect(value)
  const body: ValidationFailureBody = {
    error: 'validation_failed',
    source,
    errors: result === true ? [] : result.errors,
  }
  return { status: 400, body }
}
