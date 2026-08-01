import type { Validator } from '@amritk/runtime-validators'

import { buildCookiesObject } from './build-cookies-object'
import { buildHeadersObject } from './build-headers-object'
import { buildParamsObject } from './build-params-object'
import { buildQueryObject } from './build-query-object'
import { buildQueryObjectFromString } from './build-query-object-from-string'
import type { RouteMatch } from './match-route'
import { allowedMethods, matchRoute } from './match-route'
import { matchesIfNoneMatch } from './matches-if-none-match'
import { matchesBodyType, parseFormBody, parseMultipartBody } from './parse-body'
import { isPayloadTooLargeError } from './payload-too-large'
import { refinementFailure } from './refinement-failure'
import type {
  ApiRequest,
  ApiResponse,
  ContextFactory,
  ErasedGuard,
  ErasedRefineInput,
  ErasedRequestContext,
  ErrorFormatters,
  OnErrorDetails,
  RawReply,
  RequestObservation,
  RouteReplyValue,
  RouteTable,
  UnmatchedObservation,
  ValidationFailureBody,
} from './types'

/**
 * The OpenAPI document ready to serve: its JSON string (stringified once —
 * the document is immutable per process) and the strong etag derived from
 * that string, quoted and ready for the `etag` header.
 */
export type OpenApiSerialized = {
  readonly json: string
  readonly etag: string
}

/**
 * Everything `handle` needs, pre-computed by `createApi`. Kept as a separate
 * type (rather than closing over locals) so the pipeline is a plain testable
 * function.
 */
export type ApiInternals = {
  readonly table: RouteTable
  readonly openApiPath: string | undefined
  readonly openApiSerialized: () => OpenApiSerialized
  readonly openApiGuards: readonly ErasedGuard[] | undefined
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
    // The document endpoint is answered before matching, so `secureRoutes`
    // never sees it — under a deny-by-default API the schema would stay public
    // unless it is gated here.
    if (internals.openApiGuards !== undefined) {
      return guardOpenApi(internals, internals.openApiGuards, request, env, executionContext)
    }
    return Promise.resolve(serveOpenApi(internals, request))
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
    // `allow` header, not a 404. `allowedMethods` answers from the routing
    // index rather than re-running the whole matcher once per known method,
    // which is what used to make an unroutable path several times as
    // expensive to reject as a real request is to serve.
    const allow = allowedMethods(internals.table, request.path, request.method)
    let miss: ApiResponse
    if (allow.length > 0) {
      // GET routes implicitly serve HEAD (see the fallback above), so the
      // allow list advertises it whenever GET appears.
      if (allow.includes('GET') && !allow.includes('HEAD')) allow.push('HEAD')
      // The server genuinely serves OPTIONS for known paths (see the 204
      // below), so it belongs in every allow list. The guard matters when an
      // explicit options route already put it there via the scan.
      if (!allow.includes('OPTIONS')) allow.push('OPTIONS')
      allow.sort()
      // A plain OPTIONS on a path served under other methods is a capability
      // question, not a wrong-method mistake — answer it with the allow list
      // instead of a 405. An explicitly declared options route matched above
      // and never reaches this branch.
      miss =
        request.method === 'OPTIONS'
          ? { status: 204, headers: { allow: allow.join(', ') } }
          : (errors?.methodNotAllowed?.(allow, request) ?? {
              status: 405,
              headers: { allow: allow.join(', ') },
              body: { error: 'method_not_allowed' },
            })
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
 * Serves the cached OpenAPI document, honouring `if-none-match`.
 */
const serveOpenApi = (internals: ApiInternals, request: ApiRequest): ApiResponse => {
  const { json, etag } = internals.openApiSerialized()
  // The document is immutable per process, so a matching validator makes
  // the revalidation `cache-control: no-cache` forces essentially free.
  const ifNoneMatch = request.header('if-none-match')
  if (ifNoneMatch !== undefined && matchesIfNoneMatch(ifNoneMatch, etag)) {
    return { status: 304, headers: { etag, 'cache-control': 'no-cache' } }
  }
  // The cached string rides the raw contentType path so adapters send it
  // as-is instead of re-stringifying the document on every request.
  return {
    status: 200,
    headers: { etag, 'cache-control': 'no-cache' },
    body: json,
    contentType: 'application/json',
  }
}

/**
 * The guarded document path: build the app context, run the document guards in
 * order (first denial winning), and serve the document only if none denied.
 * There is no route contract behind this endpoint, so a denial is sent as-is —
 * response validation has no schema to check it against.
 */
const guardOpenApi = async (
  internals: ApiInternals,
  guards: readonly ErasedGuard[],
  request: ApiRequest,
  env: unknown,
  executionContext: unknown,
): Promise<ApiResponse> => {
  let denied: RouteReplyValue | RawReply | undefined
  try {
    const appContext =
      internals.createContext === undefined
        ? undefined
        : await internals.createContext({ request, env, executionContext, locals: request.locals })
    const gate = {
      params: undefined,
      query: undefined,
      body: undefined,
      headers: undefined,
      cookies: undefined,
      context: appContext,
      request,
    } as unknown as ErasedRequestContext
    for (const guard of guards) {
      denied = await guard(gate)
      if (denied !== undefined) break
    }
  } catch (error) {
    // Same transport-level 413 the route pipeline reports, for a guard that
    // read the body itself.
    if (isPayloadTooLargeError(error)) return internals.errors?.payloadTooLarge?.(request) ?? PAYLOAD_TOO_LARGE
    return internals.onError !== undefined
      ? internals.onError(error, request, { route: undefined, env, executionContext })
      : INTERNAL_ERROR
  }
  if (denied === undefined) return serveOpenApi(internals, request)
  const escaped = (denied as Partial<RawReply>).raw
  return escaped !== undefined ? { status: escaped.status, raw: escaped } : (denied as RouteReplyValue)
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

  // Security guards (resolved from the route's OpenAPI `security` by
  // `secureRoutes`) gate the request before anything is parsed or validated:
  // an unauthenticated caller must not reach the body reader, the multipart
  // parser, the schema error detail, or `refine` — all of which are app-visible
  // work that a deny-by-default API owes nobody. They gate on the session, so
  // the context factory runs first here; the usual "build the context after
  // validation" saving does not apply to a route whose whole point is to
  // reject before validation. The context is reused below, so the factory
  // still runs exactly once per request.
  const securityGuards = route.contract.securityGuards
  let appContext: unknown
  let contextBuilt = false
  if (securityGuards !== undefined) {
    let denied: RouteReplyValue | RawReply | undefined
    try {
      if (internals.createContext !== undefined) {
        appContext = await internals.createContext({ request, env, executionContext, locals: request.locals })
      }
      contextBuilt = true
      // The validated slots do not exist yet — a security guard reads the
      // session and the raw `request`, which is what `SecurityGuard` documents.
      const gate = {
        params: undefined,
        query: undefined,
        body: undefined,
        headers: undefined,
        cookies: undefined,
        context: appContext,
        request,
      } as unknown as ErasedRequestContext
      for (const guard of securityGuards) {
        denied = await guard(gate)
        if (denied !== undefined) break
      }
    } catch (error) {
      // A guard that read the body itself (a signature check) hits the size
      // limit as a thrown error — the transport's 413, exactly as it is for the
      // handler below.
      if (isPayloadTooLargeError(error)) return errors?.payloadTooLarge?.(request) ?? PAYLOAD_TOO_LARGE
      return internals.onError !== undefined
        ? internals.onError(error, request, { route: route.contract, env, executionContext })
        : INTERNAL_ERROR
    }
    // A denial is an ordinary reply: it takes the same response-validation and
    // serialization path a handler reply would.
    if (denied !== undefined) return finishReply(denied, route)
  }

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
          : bodyType === 'text'
            ? // Raw text: the decoded body, validated against the schema as-is.
              await request.readText()
            : bodyType === 'bytes'
              ? // Raw bytes: handed to the handler untouched (uploads, binary).
                await request.readBytes()
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

  let reply: RouteReplyValue | RawReply
  try {
    // Refinement runs after every slot validated (its whole point is seeing
    // them together) and inside this try so a throwing or rejecting refine
    // takes the handler-error path — a cross-field check is app code, not
    // transport. The await also admits async refines (uniqueness lookups).
    const refine = route.contract.refine
    if (refine !== undefined) {
      const issues = await refine({ params, query, body, headers, cookies } as ErasedRefineInput)
      if (issues !== undefined && issues.length > 0) {
        const failure = refinementFailure(issues)
        if (errors?.validationFailed !== undefined) return errors.validationFailed(failure, request)
        const failureBody: ValidationFailureBody = { error: 'validation_failed', ...failure }
        return { status: 400, body: failureBody }
      }
    }
    // The app context is built after validation so the factory (a session
    // lookup, a database handle) never runs for requests that will be 400ed
    // anyway. A factory error takes the same path as a handler error. A route
    // with security guards already built it above, before validation, and that
    // one value is reused — the factory runs once per request either way.
    if (!contextBuilt && internals.createContext !== undefined) {
      appContext = await internals.createContext({ request, env, executionContext, locals: request.locals })
    }
    // The erased handler type exists for contract assignability (see
    // AnyRouteContract); the values really do match the contract's schemas at
    // this point, which is what the cast asserts.
    const context = { params, query, body, headers, cookies, context: appContext, request } as ErasedRequestContext
    // Guards run after the context factory (they gate on the session it
    // resolved) and before the handler, in order, first denial winning. A
    // guard's reply is a normal reply — it falls through to the same response
    // validation and serialization below — and a throwing guard takes this
    // try's onError path, exactly like the handler.
    let denied: RouteReplyValue | RawReply | undefined
    const guards = route.contract.guards
    if (guards !== undefined) {
      for (const guard of guards) {
        denied = await guard(context)
        if (denied !== undefined) break
      }
    }
    reply = denied ?? (await route.contract.handler(context))
  } catch (error) {
    // A handler that read the body itself (webhook verification, uploads)
    // hits the size limit as a thrown error — that is the transport's 413,
    // not a handler crash.
    if (isPayloadTooLargeError(error)) return errors?.payloadTooLarge?.(request) ?? PAYLOAD_TOO_LARGE
    return internals.onError !== undefined
      ? internals.onError(error, request, { route: route.contract, env, executionContext })
      : INTERNAL_ERROR
  }

  return finishReply(reply, route)
}

/**
 * The shared reply tail: the raw-`Response` escape hatch, response validation
 * when it is on, and the raw-content-type passthrough. A security guard's
 * denial goes through it too, so a denial is serialized and checked exactly
 * like the handler reply it replaced.
 */
const finishReply = (reply: RouteReplyValue | RawReply, route: RouteMatch['route']): ApiResponse => {
  // The escape hatch: a handler that returns `raw(response)` takes full control
  // of the wire output. The response rides out to the adapter untouched via
  // `raw`, skipping response validation and serialization — there is no
  // framework-level body to check. The mirrored status keeps observers honest.
  // `RawReply` carries no `status` of its own — that is what keeps `status` a
  // usable discriminant on the reply union — so the test is the `raw` slot.
  const escaped = (reply as Partial<RawReply>).raw
  if (escaped !== undefined) return { status: escaped.status, raw: escaped }

  // Past the escape hatch every reply is an ordinary `{ status, body }` value.
  const value = reply as RouteReplyValue

  if (route.responses !== undefined) {
    const compiled = route.responses.get(value.status)
    if (compiled?.body !== undefined && !compiled.body.guard(value.body)) {
      const result = compiled.body.collect(value.body)
      return {
        status: 500,
        body: {
          error: 'invalid_response',
          status: value.status,
          errors: result === true ? [] : result.errors,
        },
      }
    }
    if (compiled?.headers !== undefined) {
      const replyHeaders = value.headers ?? {}
      if (!compiled.headers.guard(replyHeaders)) {
        const result = compiled.headers.collect(replyHeaders)
        return {
          status: 500,
          body: {
            error: 'invalid_response',
            status: value.status,
            source: 'headers',
            errors: result === true ? [] : result.errors,
          },
        }
      }
    }
    if (compiled === undefined && route.contract.responses[value.status] === undefined) {
      return {
        status: 500,
        body: { error: 'invalid_response', status: value.status, errors: [] },
      }
    }
  }

  // A raw status carries its contract-declared content type out to the
  // adapter, which sends the body untouched instead of JSON-serializing it.
  const rawContentType = route.rawContentTypes?.get(value.status)
  if (rawContentType !== undefined) {
    return value.headers === undefined
      ? { status: value.status, body: value.body, contentType: rawContentType }
      : { status: value.status, headers: value.headers, body: value.body, contentType: rawContentType }
  }
  return value
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
