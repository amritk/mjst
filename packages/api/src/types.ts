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
   * JSON Schemas for notable response headers, keyed by header name
   * (`{ 'x-ratelimit-remaining': { type: 'integer' } }`). Documented as
   * OpenAPI response headers; with `validateResponses` on, reply headers are
   * validated against them too (as an open object — undeclared headers pass).
   */
  readonly headers?: Readonly<Record<string, unknown>>
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
 * The per-request scratch space shared by `onRequest` gates, `onResponse`
 * decorators, the context factory, and handlers (as `request.locals`). An auth
 * gate resolves a tenant once and the handler reads it; a rate-limit gate
 * computes counters and the response decorator stamps them onto headers. Plain
 * string keys, no reserved names — the bag belongs entirely to the app.
 */
export type RequestLocals = Record<string, unknown>

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
  /**
   * The platform's native request object, exactly as the adapter received it —
   * the escape hatch for data the neutral seam does not model. The fetch
   * adapter (and compiled engine) put the Web `Request` here, so on Cloudflare
   * Workers `(request.raw as Request & { cf: IncomingRequestCfProperties }).cf`
   * exposes geo/ASN data; the Node adapter puts the `IncomingMessage` here.
   * Deliberately `unknown`: reading it is platform-specific by design, and the
   * cast at the use site is the honest record of that coupling. Optional so
   * hand-written adapters keep working.
   */
  readonly raw?: unknown
  /**
   * The per-request {@link RequestLocals} bag. Built-in adapters always
   * provide it (created lazily, so untouched requests never allocate);
   * optional so hand-written adapters keep working.
   */
  readonly locals?: RequestLocals
}

/**
 * A reply header value: one string, or several for headers that legitimately
 * repeat on the wire — `set-cookie` above all, where joining values into one
 * comma-separated string corrupts cookies (RFC 6265 forbids folding). Adapters
 * send an array as that many separate header lines.
 */
export type ResponseHeaderValue = string | readonly string[]

/** The reply headers a handler (or error formatter) may set. */
export type ResponseHeaders = Readonly<Record<string, ResponseHeaderValue>>

/**
 * The framework-neutral response {@link Api.handle} resolves with. Adapters
 * serialize `body` as JSON; `undefined` means an empty body. When
 * `contentType` is set (the reply's status was declared with a raw
 * `contentType` in its contract), `body` is a {@link StreamingBody} and
 * adapters send it untouched under that content type instead of serializing.
 */
export type ApiResponse = {
  readonly status: number
  readonly headers?: ResponseHeaders
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
        readonly headers?: ResponseHeaders
        readonly body: StreamingBody
      }
    : Responses[Status] extends { body: infer B }
      ? {
          readonly status: Status
          readonly headers?: ResponseHeaders
          readonly body: FromSchema<B>
        }
      : {
          readonly status: Status
          readonly headers?: ResponseHeaders
          readonly body?: undefined
        }
}[keyof Responses]

/**
 * {@link RouteReply} keyed by the contract itself — the server-side twin of
 * the client's `ClientReplyOf`, so a helper that builds replies for one route
 * (`const paymentRequired = (): RouteReplyOf<typeof demoChat> => ...`) can
 * name its return type without reaching for `C['responses']`.
 */
export type RouteReplyOf<C extends AnyContract> = RouteReply<C['responses']>

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
 * One problem a {@link Contract.refine} hook reports. Shaped after the
 * validators' `ValidationError` so refinement failures ride the standard
 * `validation_failed` envelope deployed clients already parse.
 */
export type RefineIssue = {
  /**
   * Which request slot the constraint belongs to; becomes the envelope's
   * `source`. Defaults to `'body'` (the first issue's source labels the
   * envelope when several slots are involved).
   */
  readonly source?: 'params' | 'query' | 'headers' | 'cookies' | 'body'
  /** JSON-pointer-style location within the slot, e.g. `/messages/3/content`. */
  readonly path?: string
  readonly message: string
}

/**
 * What a `refine` hook receives: every validated (and coerced) request slot at
 * once, which is exactly what cross-field constraints need and per-slot JSON
 * Schema cannot see.
 */
export type RefineInput<Params, Query, Body, Headers, Cookies> = {
  readonly params: SchemaValue<Params>
  readonly query: SchemaValue<Query>
  readonly body: SchemaValue<Body>
  readonly headers: SchemaValue<Headers>
  readonly cookies: SchemaValue<Cookies>
}

/**
 * A route's contract: method + path + schemas + response map, with **no
 * handler** — pure data, safe to import from a browser bundle. Create these
 * with {@link defineContract} (then bind the server implementation with
 * `implementRoute`), or declare contract and handler in one shot with
 * {@link defineRoute}, whose {@link RouteContract} is this type plus the
 * handler. The schema slots are `unknown` (not `JSONSchema`) for the same
 * literal-preserving reason as {@link ResponseContract}.
 *
 * `path` uses OpenAPI syntax — `/users/{id}` — so the contract maps into the
 * generated document verbatim. A parameter owns its whole segment.
 */
export type Contract<
  Params = undefined,
  Query = undefined,
  Body = undefined,
  Headers = undefined,
  Cookies = undefined,
  Responses extends ResponseContracts = ResponseContracts,
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
  /** Marks the operation deprecated in the OpenAPI document. */
  readonly deprecated?: boolean
  /**
   * OpenAPI security requirements for this operation, e.g.
   * `[{ bearerAuth: [] }]`. Scheme names refer to the API-level
   * `securitySchemes`; an empty array (`[]`) marks the operation public when
   * an API-level default `security` exists.
   */
  readonly security?: SecurityRequirements
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
     * schema without a `type` keyword). `'text'` and `'bytes'` skip parsing
     * entirely: the handler receives the raw `string` / `Uint8Array` and the
     * schema validates it verbatim (`{ type: 'string' }` for text, `{}` for
     * bytes) — a `text/csv` or binary upload that the typed client can send.
     * A request whose `content-type` contradicts the declared type answers
     * 415. Selects the OpenAPI requestBody content key.
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
  /**
   * Post-validation refinement for cross-field constraints JSON Schema cannot
   * express ("sum of all message lengths ≤ 64k", "start before end"). Runs
   * after every declared slot has validated, before the context factory and
   * handler, and may be sync or async — a returned promise is awaited. Return
   * (or resolve) issues to reject the request — they answer through the
   * standard `validation_failed` envelope (and the `validationFailed` error
   * formatter) — or `undefined` / an empty array to accept it. A thrown or
   * rejected refine takes the handler-error path (`onError`), exactly like a
   * throwing handler.
   */
  readonly refine?: (
    input: RefineInput<Params, Query, Body, Headers, Cookies>,
  ) => readonly RefineIssue[] | undefined | Promise<readonly RefineIssue[] | undefined>
  readonly responses: Responses
}

/**
 * A single route: a {@link Contract} plus its server handler. Create these
 * with {@link defineRoute} (one shot) or `implementRoute(contract, handler)`.
 *
 * Deliberately a standalone object type rather than `Contract & { handler }`:
 * with an intersection as the contextual type, TypeScript stops enforcing the
 * handler's reply *body* shapes against the response schemas (the
 * `@ts-expect-error` cases in define-route.test.ts go green). Keep the shared
 * fields in sync with {@link Contract} — the `ContractFieldsStayInSync`
 * assertion below fails to compile if they drift.
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
  /** Marks the operation deprecated in the OpenAPI document. */
  readonly deprecated?: boolean
  /** OpenAPI security requirements for this operation. See {@link Contract.security}. */
  readonly security?: SecurityRequirements
  /** Request schemas. See {@link Contract.request} for per-slot semantics. */
  readonly request?: {
    readonly params?: Params
    readonly query?: Query
    readonly body?: Body
    readonly bodyType?: BodyType
    readonly headers?: Headers
    readonly cookies?: Cookies
  }
  /** Post-validation cross-field refinement, sync or async. See {@link Contract.refine}. */
  readonly refine?: (
    input: RefineInput<Params, Query, Body, Headers, Cookies>,
  ) => readonly RefineIssue[] | undefined | Promise<readonly RefineIssue[] | undefined>
  readonly responses: Responses
  readonly handler: RouteHandler<Params, Query, Body, Headers, Cookies, Responses, Context>
}

/**
 * Compile-time guard that {@link RouteContract} carries exactly
 * {@link Contract}'s fields plus `handler` — the price of the deliberate
 * duplication documented on RouteContract. Drift makes the `Expect`
 * constraints below fail to compile.
 */
type Expect<T extends true> = T
export type ContractFieldsStayInSync = [
  Expect<Omit<RouteContract, 'handler'> extends Contract ? true : false>,
  Expect<Contract extends Omit<RouteContract, 'handler'> ? true : false>,
]

/**
 * A reply with the types erased — what the pipeline works with once a contract
 * has been through {@link AnyRouteContract}.
 */
export type RouteReplyValue = {
  readonly status: number
  readonly headers?: ResponseHeaders
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
 * The refine input with the types erased, mirroring
 * {@link ErasedRequestContext}: `never` slots keep every concretely-typed
 * refine assignable.
 */
export type ErasedRefineInput = {
  readonly params: never
  readonly query: never
  readonly body: never
  readonly headers: never
  readonly cookies: never
}

/**
 * The type-erased form of {@link Contract} — what `createClient` and the
 * OpenAPI generator work over. Any contract produced by {@link defineContract}
 * (or any route from {@link defineRoute}, which carries a handler on top) is
 * assignable to this, whatever its schema literals — erasure is what lets one
 * record hold differently-typed contracts.
 */
export type AnyContract = {
  readonly method: HttpMethod
  readonly path: string
  readonly summary?: string
  readonly description?: string
  readonly tags?: readonly string[]
  readonly operationId?: string
  readonly deprecated?: boolean
  readonly security?: SecurityRequirements
  readonly request?: {
    readonly params?: unknown
    readonly query?: unknown
    readonly body?: unknown
    readonly bodyType?: BodyType
    readonly headers?: unknown
    readonly cookies?: unknown
  }
  readonly refine?: (
    input: ErasedRefineInput,
  ) => readonly RefineIssue[] | undefined | Promise<readonly RefineIssue[] | undefined>
  readonly responses: ResponseContracts
}

/**
 * The type-erased form of {@link RouteContract} that {@link createApi} accepts:
 * an {@link AnyContract} plus the erased handler.
 */
export type AnyRouteContract = AnyContract & {
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
 *
 * `'text'` and `'bytes'` are the raw encodings: the body is not parsed into an
 * object but handed to the handler as-is — a `string` (`readText`) or a
 * `Uint8Array` (`readBytes`) — so a `text/csv` upload or a binary payload rides
 * the typed contract and client instead of a hand-rolled `fetch`. The body
 * schema is validated verbatim against that value (`{ type: 'string' }` for
 * text; `{}` accepts any bytes), and the typed client sends the call's `body`
 * unchanged under the raw content type (override it per call via `headers`).
 */
export type BodyType = 'json' | 'form' | 'multipart' | 'text' | 'bytes'

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
 * The reply validators for one declared status, built only when
 * `validateResponses` is on: the body schema's validators, and — when the
 * status declares response header schemas — validators over the reply's
 * headers object.
 */
export type CompiledResponse = {
  readonly body?: CompiledValidation | undefined
  readonly headers?: CompiledValidation | undefined
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
  /** Per-status reply validators, present only when `validateResponses` is on. */
  readonly responses: ReadonlyMap<number, CompiledResponse> | undefined
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
 * The `contact` object of the OpenAPI `info` block. Passed through verbatim —
 * documentation UIs render it as the "who to reach" block.
 */
export type OpenApiContact = {
  readonly name?: string
  readonly url?: string
  readonly email?: string
}

/**
 * The `license` object of the OpenAPI `info` block. `identifier` is the
 * OpenAPI 3.1 SPDX expression field (e.g. `'MIT'`); it and `url` are mutually
 * exclusive per the spec, but that is left to the author — everything passes
 * through verbatim.
 */
export type OpenApiLicense = {
  readonly name: string
  readonly identifier?: string
  readonly url?: string
}

/**
 * The `info` block of the generated OpenAPI document. Everything here passes
 * through to the document verbatim.
 */
export type OpenApiInfo = {
  readonly title: string
  readonly version: string
  readonly description?: string
  /** URL of the terms of service for the API. */
  readonly termsOfService?: string
  readonly contact?: OpenApiContact
  readonly license?: OpenApiLicense
}

/**
 * One entry of the document-level `tags` array: a description (and optional
 * external docs link) for a tag name that operations reference via their own
 * `tags`. Documentation UIs use these to title and order their sections.
 */
export type OpenApiTag = {
  readonly name: string
  readonly description?: string
  readonly externalDocs?: {
    readonly url: string
    readonly description?: string
  }
}

/** One entry of the OpenAPI `servers` array. */
export type OpenApiServer = {
  readonly url: string
  readonly description?: string
}

/**
 * OpenAPI security requirements: each entry maps a scheme name (declared in
 * `securitySchemes`) to its required scopes. Alternatives OR together.
 */
export type SecurityRequirements = ReadonlyArray<Readonly<Record<string, readonly string[]>>>

/**
 * The document-level OpenAPI settings beyond `info`: where the API is served,
 * how callers authenticate, and the default security requirement. Shared by
 * `createApi` and `compileToModule` so both engines document identically.
 */
export type OpenApiExtras = {
  /** The OpenAPI `servers` array (base URLs the API is served from). */
  readonly servers?: readonly OpenApiServer[] | undefined
  /**
   * Named Security Scheme Objects, emitted under `components.securitySchemes`
   * (e.g. `{ bearerAuth: { type: 'http', scheme: 'bearer' } }`). Passed
   * through verbatim — any scheme OpenAPI 3.1 supports works.
   */
  readonly securitySchemes?: Readonly<Record<string, unknown>> | undefined
  /**
   * The document-level default security requirement, applied to every
   * operation that does not declare its own `security`. A route opts out with
   * `security: []`.
   */
  readonly security?: SecurityRequirements | undefined
  /**
   * Document-level tag metadata, emitted as the top-level `tags` array.
   * Operations still tag themselves via {@link Contract.tags}; this is where
   * those tag names get descriptions and external docs links.
   */
  readonly tags?: readonly OpenApiTag[] | undefined
}

/**
 * The generated OpenAPI 3.1 document. Route schemas pass through verbatim —
 * OpenAPI 3.1's schema dialect *is* JSON Schema Draft 2020-12, which is why no
 * conversion layer exists here. Schemas carrying a `title` that are reused
 * across contracts are hoisted into `components.schemas` and referenced.
 */
export type OpenApiDocument = {
  readonly openapi: '3.1.0'
  readonly jsonSchemaDialect: string
  readonly info: OpenApiInfo
  readonly servers?: readonly OpenApiServer[]
  readonly security?: SecurityRequirements
  readonly tags?: readonly OpenApiTag[]
  readonly paths: Readonly<Record<string, unknown>>
  readonly components?: Readonly<Record<string, unknown>>
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
  /**
   * The per-request {@link RequestLocals} bag — the same object `onRequest`
   * gates and `onResponse` decorators see, so an auth gate's resolved tenant
   * is already here when the factory runs. `undefined` only under hand-written
   * adapters that do not provide `ApiRequest.locals`.
   */
  readonly locals: RequestLocals | undefined
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
export type ApiOptions = OpenApiExtras & {
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
  /**
   * Called once per matched request with the route contract, the outcome
   * status, and the pipeline duration — the seam for per-route latency
   * metrics and structured request logs (`GET /users/{id} → 200 in 3ms`).
   * Runs for every matched outcome, validation failures and handler errors
   * included; unmatched requests (404/405) and the OpenAPI document are not
   * observed. A thrown observer is swallowed — it must never fail the
   * request it watched. Keep it synchronous-fast: fire-and-forget any I/O.
   */
  readonly observe?: (observation: RequestObservation) => void
  /**
   * The unmatched-request counterpart to `observe`, called once per request
   * that matched no route (404), only routes under other methods (405), or
   * was an OPTIONS answered automatically for a path served under other
   * methods (204) —
   * request-logging parity with framework middleware, without wrapping the
   * adapter. Kept separate from `observe` so its observation can honestly
   * carry `route: undefined` (one logger can serve both via
   * `observation.route?.path`). The OpenAPI document path is still not
   * observed, and a thrown observer is swallowed.
   */
  readonly observeUnmatched?: (observation: UnmatchedObservation) => void
}

/**
 * What {@link ApiOptions.observeUnmatched} receives for one unmatched request.
 * `route` is always `undefined` — the field exists so one observer function
 * can serve both hooks and discriminate on it.
 */
export type UnmatchedObservation = {
  readonly route: undefined
  /** The request as the pipeline saw it. */
  readonly request: ApiRequest
  /**
   * 404; 405 when the path is served under other methods; or 204 for an
   * OPTIONS request answered automatically because the path exists under
   * other methods (no explicit `options` route matched).
   */
  readonly status: number
  /** Milliseconds spent matching and shaping the miss response. */
  readonly durationMs: number
  /** The platform bindings the adapter was invoked with (Workers `env`). */
  readonly env: unknown
  /** The platform execution context (Workers `ctx`, for `waitUntil`). */
  readonly executionContext: unknown
}

/**
 * What {@link ApiOptions.observe} receives for one matched request. `route`
 * carries the contract — its `path` pattern (`/users/{id}`, not `/users/8`)
 * is the dimension metrics and logs group by.
 */
export type RequestObservation = {
  /** The matched route's contract. */
  readonly route: AnyRouteContract
  /** The request as the pipeline saw it. */
  readonly request: ApiRequest
  /** The status of the response the pipeline produced. */
  readonly status: number
  /** Milliseconds from match to response, handler included. */
  readonly durationMs: number
  /** The platform bindings the adapter was invoked with (Workers `env`). */
  readonly env: unknown
  /** The platform execution context (Workers `ctx`, for `waitUntil`). */
  readonly executionContext: unknown
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
