import type { FromSchema, Guard, ValidationError, Validator } from '@amritk/runtime-validators'

/**
 * The HTTP methods a route contract can declare. Lowercase on purpose — these
 * double as the operation keys in the generated OpenAPI document, which the
 * spec requires to be lowercase.
 */
export type HttpMethod = 'get' | 'post' | 'put' | 'patch' | 'delete' | 'head' | 'options'

/**
 * What a route promises to return for one status code. `body` is a JSON Schema
 * (Draft 2020-12) written as a literal; it is deliberately typed `unknown` so
 * `const` inference preserves the literal for {@link FromSchema} — a `JSONSchema`
 * constraint would force `readonly` tuples like `required: ['id']` to widen.
 */
export type ResponseContract = {
  /** Human-readable summary used as the response description in OpenAPI. */
  readonly description?: string
  /** JSON Schema for the response body. Omit for an empty-body response. */
  readonly body?: unknown
  /**
   * Marks this status as a raw (non-JSON) response and sets its content type,
   * e.g. `'text/plain; charset=utf-8'` or `'text/event-stream'`. The handler
   * then returns a {@link StreamingBody} for this status, and adapters send it
   * untouched — no `JSON.stringify`, streaming intact. A `body` schema may
   * still be declared purely for OpenAPI documentation; runtime response
   * validation always skips raw statuses because there is no JSON value to
   * check.
   */
  readonly contentType?: string
}

/**
 * Maps status codes to their contracts, e.g. `{ 200: { body: userSchema } }`.
 * The handler's return type is derived from this map, so a handler can only
 * return status codes the contract declares.
 */
export type ResponseContracts = { readonly [status: number]: ResponseContract }

/**
 * What a handler returns as `body` for a status declared with `contentType`:
 * raw payloads the adapters pass through without JSON serialization. A
 * `ReadableStream` keeps flowing to the client as the handler produces it —
 * this is how server-sent events and AI token streams are modeled.
 */
export type StreamingBody = ReadableStream<Uint8Array> | Uint8Array | string

/**
 * The value a handler sees for one request slot: the schema's inferred type
 * when a schema was declared, or `undefined` when the slot was omitted from
 * the contract. The tuple wrapper keeps the conditional from distributing
 * over unions.
 */
export type SchemaValue<S> = [S] extends [undefined] ? undefined : FromSchema<S>

/**
 * The framework-neutral request an adapter hands to {@link Api.handle}. Adapters
 * (fetch, Node) construct this; writing your own adapter means producing one of
 * these per incoming request.
 *
 * Everything that costs work is lazy: `searchParams` is only called when the
 * matched route declares a query schema, and `readBody` only when it declares a
 * body schema — so routes that do not use them never pay for parsing.
 *
 * The built-in adapters back all three body readers with one shared buffered
 * read, so they may be called repeatedly and in any combination — including
 * after the pipeline consumed a declared body schema (webhook signature
 * verification alongside parsed access). A hand-written adapter should
 * provide the same guarantee: the underlying body is a single-use stream, so
 * uncached readers would fail (or hang, on Node) at the second call.
 */
export type ApiRequest = {
  /** Uppercase HTTP method, e.g. `'GET'`. Adapters are responsible for casing. */
  readonly method: string
  /** URL pathname only — no origin, no query string. */
  readonly path: string
  /** Lazily parsed query parameters. */
  readonly searchParams: () => URLSearchParams
  /**
   * The raw query string (no leading `?`), when the transport has it cheaply.
   * The pipeline prefers this over `searchParams` — plain queries then skip
   * URLSearchParams construction entirely, the biggest single cost on
   * query-validated routes. Optional so hand-written adapters keep working.
   */
  readonly queryString?: () => string
  /** Case-insensitive header lookup; call with a lowercase name. */
  readonly header: (name: string) => string | undefined
  /** Reads and JSON-parses the request body. */
  readonly readBody: () => Promise<unknown>
  /**
   * Reads the request body as text, exactly as it arrived — the form webhook
   * signature verification needs (Stripe, Shopify HMAC), where re-serialized
   * JSON would never match the signed bytes.
   */
  readonly readText: () => Promise<string>
  /** Reads the request body as raw bytes (file uploads, binary payloads). */
  readonly readBytes: () => Promise<Uint8Array>
  /**
   * Aborts when the client disconnects, so long-running handlers (streaming
   * chat replies) can stop work that nobody is listening to. Optional because
   * not every transport can observe disconnects.
   */
  readonly signal?: AbortSignal
}

/**
 * The framework-neutral response {@link Api.handle} resolves with. Adapters
 * serialize `body` as JSON; `undefined` means an empty body. When
 * `contentType` is set (the reply's status was declared with a raw
 * `contentType` in its contract), `body` is a {@link StreamingBody} and
 * adapters send it untouched under that content type instead of serializing.
 */
export type ApiResponse = {
  readonly status: number
  readonly headers?: Readonly<Record<string, string>>
  readonly body?: unknown
  readonly contentType?: string
}

/**
 * What a handler receives: the validated (and coerced) request slots, the
 * per-request app context (database handles, sessions — whatever the
 * {@link ApiOptions.context} factory returns), and the raw {@link ApiRequest}
 * for anything the contract does not model.
 */
export type RequestContext<Params, Query, Body, Headers, Cookies, Context = undefined> = {
  readonly params: SchemaValue<Params>
  readonly query: SchemaValue<Query>
  readonly body: SchemaValue<Body>
  readonly headers: SchemaValue<Headers>
  readonly cookies: SchemaValue<Cookies>
  readonly context: Context
  readonly request: ApiRequest
}

/**
 * The replies a handler may return, derived from the route's response map. Each
 * declared status becomes a variant whose `body` type comes from that status's
 * schema — so returning an undeclared status, or the wrong body shape for a
 * declared one, is a type error at the contract.
 */
export type RouteReply<Responses extends ResponseContracts> = {
  [Status in keyof Responses]: Responses[Status] extends { contentType: string }
    ? {
        readonly status: Status
        readonly headers?: Readonly<Record<string, string>>
        readonly body: StreamingBody
      }
    : Responses[Status] extends { body: infer B }
      ? {
          readonly status: Status
          readonly headers?: Readonly<Record<string, string>>
          readonly body: FromSchema<B>
        }
      : {
          readonly status: Status
          readonly headers?: Readonly<Record<string, string>>
          readonly body?: undefined
        }
}[keyof Responses]

/**
 * A route's implementation. It only runs after every declared request schema
 * has validated, so the context values are safe to use without further checks.
 */
export type RouteHandler<
  Params,
  Query,
  Body,
  Headers,
  Cookies,
  Responses extends ResponseContracts,
  Context = undefined,
> = (
  context: RequestContext<Params, Query, Body, Headers, Cookies, Context>,
) => RouteReply<Responses> | Promise<RouteReply<Responses>>

/**
 * A single route: method + path + schemas + handler. Create these with
 * {@link defineRoute} so the schema literals are inferred and the handler is
 * typed from them. The schema slots are `unknown` (not `JSONSchema`) for the
 * same literal-preserving reason as {@link ResponseContract}.
 *
 * `path` uses OpenAPI syntax — `/users/{id}` — so the contract maps into the
 * generated document verbatim. A parameter owns its whole segment.
 */
export type RouteContract<
  Params = undefined,
  Query = undefined,
  Body = undefined,
  Headers = undefined,
  Cookies = undefined,
  Responses extends ResponseContracts = ResponseContracts,
  Context = undefined,
> = {
  readonly method: HttpMethod
  readonly path: string
  /** Short OpenAPI summary. */
  readonly summary?: string
  /** Longer OpenAPI description. */
  readonly description?: string
  /** OpenAPI tags for grouping operations. */
  readonly tags?: readonly string[]
  /** Explicit OpenAPI operationId. Omitted from the document when not set. */
  readonly operationId?: string
  readonly request?: {
    /** JSON Schema (object) for path parameters. Values are coerced from strings first. */
    readonly params?: Params
    /** JSON Schema (object) for query parameters. Values are coerced from strings first. */
    readonly query?: Query
    /** JSON Schema for the request body. Declaring it makes a body required. */
    readonly body?: Body
    /**
     * How the body arrives on the wire. `'json'` (the default) parses JSON;
     * `'form'` parses `application/x-www-form-urlencoded` with query-style
     * coercion (typed keys coerce, array keys accumulate); `'multipart'`
     * parses `multipart/form-data` — string parts coerce like form fields,
     * file parts reach the handler as `File` objects (declare them in the
     * schema without a `type` keyword). A request whose `content-type`
     * contradicts the declared type answers 415. Selects the OpenAPI
     * requestBody content key.
     */
    readonly bodyType?: BodyType
    /**
     * JSON Schema (object) for request headers. Property names are header
     * names (write them lowercase — lookup is case-insensitive but the
     * validated object's keys are exactly the schema's). Only declared
     * properties are read; values are coerced from strings first, like query
     * parameters. Each property becomes an `in: 'header'` parameter in
     * OpenAPI.
     */
    readonly headers?: Headers
    /**
     * JSON Schema (object) for request cookies. Property names are cookie
     * names (case-sensitive, per RFC 6265). Only declared cookies are read
     * from the `cookie` header; values are unquoted, percent-decoded, and
     * coerced from strings first. Each property becomes an `in: 'cookie'`
     * parameter in OpenAPI.
     */
    readonly cookies?: Cookies
  }
  readonly responses: Responses
  readonly handler: RouteHandler<Params, Query, Body, Headers, Cookies, Responses, Context>
}

/**
 * A reply with the types erased — what the pipeline works with once a contract
 * has been through {@link AnyRouteContract}.
 */
export type RouteReplyValue = {
  readonly status: number
  readonly headers?: Readonly<Record<string, string>>
  readonly body?: unknown
}

/**
 * The context type on {@link AnyRouteContract.handler}. The slots are `never`
 * so any concretely-typed handler is assignable (functions are contravariant
 * in their parameters, and `never` is assignable to every context a real
 * handler could ask for). The pipeline builds the real context and casts once,
 * after validation has proven the values match the contract's schemas.
 */
export type ErasedRequestContext = {
  readonly params: never
  readonly query: never
  readonly body: never
  readonly headers: never
  readonly cookies: never
  readonly context: never
  readonly request: ApiRequest
}

/**
 * The type-erased form of {@link RouteContract} that {@link createApi} accepts.
 * Any contract produced by {@link defineRoute} is assignable to this, whatever
 * its schema literals — erasure is what lets one array hold differently-typed
 * routes.
 */
export type AnyRouteContract = {
  readonly method: HttpMethod
  readonly path: string
  readonly summary?: string
  readonly description?: string
  readonly tags?: readonly string[]
  readonly operationId?: string
  readonly request?: {
    readonly params?: unknown
    readonly query?: unknown
    readonly body?: unknown
    readonly bodyType?: BodyType
    readonly headers?: unknown
    readonly cookies?: unknown
  }
  readonly responses: ResponseContracts
  readonly handler: (context: ErasedRequestContext) => RouteReplyValue | Promise<RouteReplyValue>
}

/**
 * The pair of validators the pipeline keeps per schema: a boolean guard for the
 * hot path (short-circuits, never allocates) and an error-collecting validator
 * that only runs once the guard has already said no — so valid traffic never
 * pays for error bookkeeping.
 */
export type CompiledValidation = {
  readonly guard: Guard
  readonly collect: Validator
}

/**
 * Turns a JSON Schema into a {@link CompiledValidation}. The default compiler
 * interprets the schema with `@amritk/runtime-validators`; supply your own to
 * plug in generated validators from `@amritk/generate-validators` (or any other
 * engine) for maximum steady-state throughput.
 */
export type ValidatorCompiler = (schema: unknown) => CompiledValidation

/**
 * The transport encodings a request body schema can validate. Selects the
 * parser, the 415 media-type check, and the OpenAPI requestBody content key.
 */
export type BodyType = 'json' | 'form' | 'multipart'

/**
 * How a string path/query value is converted before validation. HTTP delivers
 * every parameter as a string, so the plan (derived from the schema's declared
 * types at startup) restores numbers, booleans, and arrays without inspecting
 * the schema per request.
 */
export type Coercion = 'number' | 'boolean' | 'number-array' | 'boolean-array' | 'string-array'

/**
 * A compiled request slot: validators plus the coercion plan for its keys.
 */
export type CompiledInput = CompiledValidation & {
  readonly coercions: ReadonlyMap<string, Coercion>
}

/**
 * A compiled body slot: validators plus the wire encoding and — for form and
 * multipart bodies, whose fields arrive as strings — the coercion plan that
 * restores their schema-declared types before validation.
 */
export type CompiledBody = CompiledValidation & {
  readonly bodyType: BodyType
  readonly coercions: ReadonlyMap<string, Coercion>
}

/**
 * A compiled headers slot. Unlike params and query, headers cannot be
 * enumerated from an {@link ApiRequest} (it only offers lookup), so the
 * schema's declared property names — paired with their lowercase lookup form —
 * are captured at startup and drive the per-request reads.
 */
export type CompiledHeaders = CompiledInput & {
  readonly names: ReadonlyArray<readonly [property: string, lookup: string]>
}

/**
 * A compiled cookies slot. The `cookie` header carries every pair, so the
 * schema's declared names — captured at startup as a set — filter what the
 * route reads; undeclared cookies (analytics, ads) never reach validation.
 */
export type CompiledCookies = CompiledInput & {
  readonly names: ReadonlySet<string>
}

/**
 * One segment of a compiled route path: a literal string, or a named parameter
 * capturing the whole segment. A greedy parameter (`{name+}`, always last)
 * captures the remaining segments joined with `/`.
 */
export type PathSegment = string | { readonly name: string; readonly greedy?: boolean }

/**
 * A route after startup compilation: uppercase method, parsed path segments,
 * and pre-built validators/coercion plans so the per-request path does zero
 * schema work.
 */
export type CompiledRoute = {
  readonly contract: AnyRouteContract
  readonly method: string
  readonly segments: readonly PathSegment[]
  readonly params: CompiledInput | undefined
  readonly query: CompiledInput | undefined
  readonly body: CompiledBody | undefined
  readonly headers: CompiledHeaders | undefined
  readonly cookies: CompiledCookies | undefined
  /** Response-body validators, present only when `validateResponses` is on. */
  readonly responses: ReadonlyMap<number, CompiledValidation> | undefined
  /**
   * Statuses declared with a raw `contentType`, so the reply path can tag the
   * {@link ApiResponse} without touching the contract per request. Undefined
   * for the common all-JSON route.
   */
  readonly rawContentTypes: ReadonlyMap<number, string> | undefined
}

/**
 * The two-tier routing table {@link createApi} builds: fully-static paths in a
 * flat map for O(1) lookup, parameterized paths per method for a segment scan.
 */
export type RouteTable = {
  readonly staticRoutes: ReadonlyMap<string, CompiledRoute>
  readonly dynamicRoutes: ReadonlyMap<string, readonly CompiledRoute[]>
  /**
   * Every distinct (uppercase) method any route declares. The 405 path scans
   * these to build the `allow` header — a cold path, so a scan beats keeping
   * a per-path method index alive.
   */
  readonly methods: readonly string[]
}

/**
 * The `info` block of the generated OpenAPI document.
 */
export type OpenApiInfo = {
  readonly title: string
  readonly version: string
  readonly description?: string
}

/**
 * The generated OpenAPI 3.1 document. Route schemas pass through verbatim —
 * OpenAPI 3.1's schema dialect *is* JSON Schema Draft 2020-12, which is why no
 * conversion layer exists here.
 */
export type OpenApiDocument = {
  readonly openapi: '3.1.0'
  readonly jsonSchemaDialect: string
  readonly info: OpenApiInfo
  readonly paths: Readonly<Record<string, unknown>>
}

/**
 * What the {@link ApiOptions.context} factory receives, once per matched
 * request, after validation and just before the handler runs. `env` and
 * `executionContext` are the platform arguments the adapter was invoked with —
 * on Cloudflare Workers, the bindings object and the execution context; on
 * Node, whatever was passed to the adapter's `env` option.
 */
export type ContextFactoryInput = {
  readonly request: ApiRequest
  readonly env: unknown
  readonly executionContext: unknown
}

/**
 * Builds the per-request app context handlers see as `context` — database
 * handles (Drizzle), sessions (Better Auth), loggers, whatever the app needs.
 * May be async. Pair it with {@link routeFactory} so handlers see the same
 * type this returns; a thrown error here becomes a 500 (or `onError`).
 */
export type ContextFactory = (input: ContextFactoryInput) => unknown

/**
 * Options for {@link createApi}.
 */
export type ApiOptions = {
  readonly routes: ReadonlyArray<AnyRouteContract>
  /** OpenAPI `info` block. Defaults to a placeholder title/version. */
  readonly info?: OpenApiInfo
  /**
   * Where the generated OpenAPI document is served (as `GET <path>`). Pass
   * `false` to disable serving it. Defaults to `/openapi.json`.
   */
  readonly openApiPath?: string | false
  /** Swap the validation engine. See {@link ValidatorCompiler}. */
  readonly compile?: ValidatorCompiler
  /**
   * Per-request app context factory. Runs after validation, only for matched
   * requests, and its return value reaches handlers as `context`. Declare the
   * matching handler type with {@link routeFactory}.
   */
  readonly context?: ContextFactory
  /**
   * Validate handler reply bodies against the declared response schemas and
   * turn mismatches into a 500. Off by default: it is a development/test net,
   * and skipping it keeps production replies free of a second validation pass.
   */
  readonly validateResponses?: boolean
  /**
   * Maps a thrown handler (or context factory) error to a response. Defaults
   * to a bare 500. `details` carries what error reporting needs: the matched
   * route contract (its `path` pattern is the grouping key Sentry-style tools
   * want — raw URLs with IDs in them group terribly) and the platform
   * `env`/`executionContext` (Workers Sentry clients read their DSN from env
   * and flush via `waitUntil`). See `createSentry` for the packaged form.
   */
  readonly onError?: (error: unknown, request: ApiRequest, details: OnErrorDetails) => ApiResponse
  /**
   * Overrides the built-in error response bodies, for apps with an existing
   * error envelope their clients already parse. Each formatter replaces one
   * cold-path default; anything not supplied keeps the built-in shape.
   */
  readonly errors?: ErrorFormatters
}

/**
 * Context handed to `onError` alongside the failing request. Exists so error
 * reporting needs nothing beyond the pipeline's own seam: the route contract
 * for grouping, and the platform values for client construction and flushing.
 */
export type OnErrorDetails = {
  /** The matched route's contract. Its `path` pattern groups errors cleanly. */
  readonly route: AnyRouteContract
  /** The platform bindings the adapter was invoked with (Workers `env`). */
  readonly env: unknown
  /** The platform execution context (Workers `ctx`, for `waitUntil` flushes). */
  readonly executionContext: unknown
}

/**
 * What a request failed validation on, handed to the `validationFailed`
 * formatter so it can shape the 400 however the app's clients expect.
 */
export type ValidationFailure = {
  readonly source: 'params' | 'query' | 'headers' | 'cookies' | 'body'
  readonly errors: readonly ValidationError[]
}

/**
 * Custom formatters for the pipeline's own responses. These exist because an
 * API being migrated onto this framework usually has a wire-visible error
 * shape already — deployed clients parse it — and changing every 400/404 body
 * at once is a breaking change nobody asked for.
 */
export type ErrorFormatters = {
  /** Replaces the default `404 {error:'not_found'}`. */
  readonly notFound?: (request: ApiRequest) => ApiResponse
  /** Replaces the default `400 {error:'invalid_json'}` for unparseable JSON bodies. */
  readonly invalidJson?: (request: ApiRequest) => ApiResponse
  /** Replaces the default `400 {error:'invalid_body'}` for unparseable form/multipart bodies. */
  readonly invalidBody?: (request: ApiRequest) => ApiResponse
  /**
   * Replaces the default `415 {error:'unsupported_media_type'}`, answered
   * when a request's `content-type` contradicts the declared `bodyType`.
   */
  readonly unsupportedMediaType?: (contentType: string, request: ApiRequest) => ApiResponse
  /** Replaces the default `413 {error:'payload_too_large'}`. */
  readonly payloadTooLarge?: (request: ApiRequest) => ApiResponse
  /** Replaces the default `400` {@link ValidationFailureBody}. */
  readonly validationFailed?: (failure: ValidationFailure, request: ApiRequest) => ApiResponse
  /**
   * Replaces the default `405 {error:'method_not_allowed'}`. `allow` is the
   * sorted list of methods that do serve this path; include it as an `allow`
   * header (the default does) to stay spec-correct.
   */
  readonly methodNotAllowed?: (allow: readonly string[], request: ApiRequest) => ApiResponse
}

/**
 * A compiled API. `handle` is the whole runtime — adapters are thin wrappers
 * that translate their framework's request/response types around it.
 */
export type Api = {
  /**
   * Match, validate, run the handler, and produce a response. `env` and
   * `executionContext` are optional platform values (Workers bindings and
   * execution context) forwarded to the {@link ContextFactory}.
   */
  readonly handle: (request: ApiRequest, env?: unknown, executionContext?: unknown) => Promise<ApiResponse>
  /**
   * Whether a method + path would be handled (routes or the OpenAPI document
   * path). Lets middleware-style adapters pass unmatched requests along
   * instead of answering 404.
   */
  readonly matches: (method: string, path: string) => boolean
  /** The OpenAPI 3.1 document, built on first call and cached. */
  readonly openApi: () => OpenApiDocument
  /** The contracts this API was built from. */
  readonly routes: ReadonlyArray<AnyRouteContract>
}

/**
 * The shared error body shape for validation failures (400) and, with
 * `validateResponses` on, contract-breaking replies (500). Re-exported from
 * the validators so API consumers can type their error handling end to end.
 */
export type ValidationFailureBody = {
  readonly error: 'validation_failed'
  readonly source: 'params' | 'query' | 'headers' | 'cookies' | 'body'
  readonly errors: readonly ValidationError[]
}
