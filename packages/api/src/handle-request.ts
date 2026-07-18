import type { Validator } from '@amritk/runtime-validators'

import { buildCookiesObject } from './build-cookies-object'
import { buildHeadersObject } from './build-headers-object'
import { buildParamsObject } from './build-params-object'
import { buildQueryObject } from './build-query-object'
import { buildQueryObjectFromString } from './build-query-object-from-string'
import type { RouteMatch } from './match-route'
import { matchRoute } from './match-route'
import { matchesBodyType, parseFormBody, parseMultipartBody } from './parse-body'
import { isPayloadTooLargeError } from './payload-too-large'
import { refinementFailure } from './refinement-failure'
import type {
  ApiRequest,
  ApiResponse,
  ContextFactory,
  ErasedRefineInput,
  ErasedRequestContext,
  ErrorFormatters,
  OnErrorDetails,
  OpenApiDocument,
  RequestObservation,
  RouteReplyValue,
  RouteTable,
  UnmatchedObservation,
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
  readonly onError: ((error: unknown, request: ApiRequest, details: OnErrorDetails) => ApiResponse) | undefined
  readonly errors: ErrorFormatters | undefined
  readonly observe: ((observation: RequestObservation) => void) | undefined
  readonly observeUnmatched: ((observation: UnmatchedObservation) => void) | undefined
}

/**
 * Shared no-allocation responses for outcomes whose body never varies.
 */
const NOT_FOUND: ApiResponse = Object.freeze({ status: 404, body: Object.freeze({ error: 'not_found' }) })
const INTERNAL_ERROR: ApiResponse = Object.freeze({ status: 500, body: Object.freeze({ error: 'internal_error' }) })
const INVALID_JSON: ApiResponse = Object.freeze({ status: 400, body: Object.freeze({ error: 'invalid_json' }) })
const INVALID_BODY: ApiResponse = Object.freeze({ status: 400, body: Object.freeze({ error: 'invalid_body' }) })
const UNSUPPORTED_MEDIA_TYPE: ApiResponse = Object.freeze({
  status: 415,
  body: Object.freeze({ error: 'unsupported_media_type' }),
})
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
export const handleRequest = (
  internals: ApiInternals,
  request: ApiRequest,
  env?: unknown,
  executionContext?: unknown,
): Promise<ApiResponse> => {
  // Deliberately not an async function: the matched path hands off to
  // `runRoute` (async) untouched, so a request pays for exactly one async
  // frame — a second one here measurably taxes the whole pipeline.
  if (
    internals.openApiPath !== undefined &&
    (request.method === 'GET' || request.method === 'HEAD') &&
    request.path === internals.openApiPath
  ) {
    return Promise.resolve({ status: 200, body: internals.openApi() })
  }

  const errors = internals.errors
  // Sampled before matching only when unmatched requests are observed, so
  // their durations cover the same span observe would have seen.
  const unmatchedStart = internals.observeUnmatched === undefined ? 0 : performance.now()
  // Per RFC 9110 HEAD is GET without the body, so a HEAD request with no
  // explicitly declared HEAD route runs the GET pipeline — handler included —
  // and the adapters discard the body from whatever comes back.
  let match = matchRoute(internals.table, request.method, request.path)
  if (match === undefined && request.method === 'HEAD') {
    match = matchRoute(internals.table, 'GET', request.path)
  }
  if (match === undefined) {
    // The path may be served under other methods — that is a 405 with an
    // `allow` header, not a 404. Cold path, so scanning the method list is
    // cheaper than maintaining a per-path index for every request.
    const allow: string[] = []
    for (const method of internals.table.methods) {
      if (method !== request.method && matchRoute(internals.table, method, request.path) !== undefined) {
        allow.push(method)
      }
    }
    let miss: ApiResponse
    if (allow.length > 0) {
      // GET routes implicitly serve HEAD (see the fallback above), so the
      // allow list advertises it whenever GET appears.
      if (allow.includes('GET') && !allow.includes('HEAD')) allow.push('HEAD')
      allow.sort()
      miss = errors?.methodNotAllowed?.(allow, request) ?? {
        status: 405,
        headers: { allow: allow.join(', ') },
        body: { error: 'method_not_allowed' },
      }
    } else {
      miss = errors?.notFound?.(request) ?? NOT_FOUND
    }
    if (internals.observeUnmatched !== undefined) {
      try {
        internals.observeUnmatched({
          route: undefined,
          request,
          status: miss.status,
          durationMs: performance.now() - unmatchedStart,
          env,
          executionContext,
        })
      } catch {
        // A throwing observer must never fail the request it watched.
      }
    }
    return Promise.resolve(miss)
  }

  const observe = internals.observe
  if (observe === undefined) return runRoute(internals, match, request, env, executionContext)

  const start = performance.now()
  const routeMatch = match
  return runRoute(internals, match, request, env, executionContext).then((response) => {
    try {
      observe({
        route: routeMatch.route.contract,
        request,
        status: response.status,
        durationMs: performance.now() - start,
        env,
        executionContext,
      })
    } catch {
      // A throwing observer must never fail the request it watched.
    }
    return response
  })
}

/**
 * The matched-route section of the pipeline: coerce + validate declared
 * inputs, run the handler, (optionally) validate the reply. Split out so the
 * observe wrapper above times exactly this — the part whose duration belongs
 * to the route.
 */
const runRoute = async (
  internals: ApiInternals,
  match: RouteMatch,
  request: ApiRequest,
  env: unknown,
  executionContext: unknown,
): Promise<ApiResponse> => {
  const errors = internals.errors
  const route = match.route

  let params: unknown
  if (route.params !== undefined) {
    params = buildParamsObject(match.params, route.params.coercions)
    if (!route.params.guard(params)) return validationFailure('params', route.params.collect, params, errors, request)
  }

  let query: unknown
  if (route.query !== undefined) {
    // The raw query string (when the adapter has it) skips URLSearchParams
    // construction for plain queries — the encoded ones fall back inside.
    query =
      request.queryString !== undefined
        ? buildQueryObjectFromString(request.queryString(), route.query.coercions)
        : buildQueryObject(request.searchParams(), route.query.coercions)
    if (!route.query.guard(query)) return validationFailure('query', route.query.collect, query, errors, request)
  }

  let headers: unknown
  if (route.headers !== undefined) {
    headers = buildHeadersObject(request.header, route.headers)
    if (!route.headers.guard(headers)) {
      return validationFailure('headers', route.headers.collect, headers, errors, request)
    }
  }

  let cookies: unknown
  if (route.cookies !== undefined) {
    cookies = buildCookiesObject(request.header('cookie'), route.cookies.names, route.cookies.coercions)
    if (!route.cookies.guard(cookies)) {
      return validationFailure('cookies', route.cookies.collect, cookies, errors, request)
    }
  }

  let body: unknown
  if (route.body !== undefined) {
    const bodyType = route.body.bodyType
    // Enforced only when the client actually declared a media type: a present
    // but contradictory content-type is a 415, an absent one gets the benefit
    // of the doubt and fails on the parse instead (keeps bare curl working).
    const contentType = request.header('content-type')
    if (contentType !== undefined && !matchesBodyType(contentType, bodyType)) {
      return errors?.unsupportedMediaType?.(contentType, request) ?? UNSUPPORTED_MEDIA_TYPE
    }
    try {
      body =
        bodyType === 'json'
          ? await request.readBody()
          : bodyType === 'form'
            ? parseFormBody(await request.readText(), route.body.coercions)
            : await parseMultipartBody(await request.readBytes(), contentType, route.body.coercions)
    } catch (error) {
      if (isPayloadTooLargeError(error)) return errors?.payloadTooLarge?.(request) ?? PAYLOAD_TOO_LARGE
      if (bodyType === 'json') return errors?.invalidJson?.(request) ?? INVALID_JSON
      return errors?.invalidBody?.(request) ?? INVALID_BODY
    }
    if (!route.body.guard(body)) return validationFailure('body', route.body.collect, body, errors, request)
  }

  let reply: RouteReplyValue
  try {
    // Refinement runs after every slot validated (its whole point is seeing
    // them together) and inside this try so a throwing refine takes the
    // handler-error path — a cross-field check is app code, not transport.
    const refine = route.contract.refine
    if (refine !== undefined) {
      const issues = refine({ params, query, body, headers, cookies } as ErasedRefineInput)
      if (issues !== undefined && issues.length > 0) {
        const failure = refinementFailure(issues)
        if (errors?.validationFailed !== undefined) return errors.validationFailed(failure, request)
        const failureBody: ValidationFailureBody = { error: 'validation_failed', ...failure }
        return { status: 400, body: failureBody }
      }
    }
    // The app context is built after validation so the factory (a session
    // lookup, a database handle) never runs for requests that will be 400ed
    // anyway. A factory error takes the same path as a handler error.
    const appContext =
      internals.createContext === undefined
        ? undefined
        : await internals.createContext({ request, env, executionContext, locals: request.locals })
    // The erased handler type exists for contract assignability (see
    // AnyRouteContract); the values really do match the contract's schemas at
    // this point, which is what the cast asserts.
    const context = { params, query, body, headers, cookies, context: appContext, request } as ErasedRequestContext
    reply = await route.contract.handler(context)
  } catch (error) {
    // A handler that read the body itself (webhook verification, uploads)
    // hits the size limit as a thrown error — that is the transport's 413,
    // not a handler crash.
    if (isPayloadTooLargeError(error)) return errors?.payloadTooLarge?.(request) ?? PAYLOAD_TOO_LARGE
    return internals.onError !== undefined
      ? internals.onError(error, request, { route: route.contract, env, executionContext })
      : INTERNAL_ERROR
  }

  if (route.responses !== undefined) {
    const compiled = route.responses.get(reply.status)
    if (compiled?.body !== undefined && !compiled.body.guard(reply.body)) {
      const result = compiled.body.collect(reply.body)
      return {
        status: 500,
        body: {
          error: 'invalid_response',
          status: reply.status,
          errors: result === true ? [] : result.errors,
        },
      }
    }
    if (compiled?.headers !== undefined) {
      const replyHeaders = reply.headers ?? {}
      if (!compiled.headers.guard(replyHeaders)) {
        const result = compiled.headers.collect(replyHeaders)
        return {
          status: 500,
          body: {
            error: 'invalid_response',
            status: reply.status,
            source: 'headers',
            errors: result === true ? [] : result.errors,
          },
        }
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
