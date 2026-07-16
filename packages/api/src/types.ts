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
}

/**
 * Maps status codes to their contracts, e.g. `{ 200: { body: userSchema } }`.
 * The handler's return type is derived from this map, so a handler can only
 * return status codes the contract declares.
 */
export type ResponseContracts = { readonly [status: number]: ResponseContract }

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
 */
export type ApiRequest = {
  /** Uppercase HTTP method, e.g. `'GET'`. Adapters are responsible for casing. */
  readonly method: string
  /** URL pathname only — no origin, no query string. */
  readonly path: string
  /** Lazily parsed query parameters. */
  readonly searchParams: () => URLSearchParams
  /** Case-insensitive header lookup; call with a lowercase name. */
  readonly header: (name: string) => string | undefined
  /** Reads and JSON-parses the request body. Called at most once per request. */
  readonly readBody: () => Promise<unknown>
}

/**
 * The framework-neutral response {@link Api.handle} resolves with. Adapters
 * serialize `body` as JSON; `undefined` means an empty body.
 */
export type ApiResponse = {
  readonly status: number
  readonly headers?: Readonly<Record<string, string>>
  readonly body?: unknown
}

/**
 * What a handler receives: the validated (and coerced) request slots plus the
 * raw {@link ApiRequest} for anything the contract does not model (headers,
 * out-of-band query access, and so on).
 */
export type RequestContext<Params, Query, Body> = {
  readonly params: SchemaValue<Params>
  readonly query: SchemaValue<Query>
  readonly body: SchemaValue<Body>
  readonly request: ApiRequest
}

/**
 * The replies a handler may return, derived from the route's response map. Each
 * declared status becomes a variant whose `body` type comes from that status's
 * schema — so returning an undeclared status, or the wrong body shape for a
 * declared one, is a type error at the contract.
 */
export type RouteReply<Responses extends ResponseContracts> = {
  [Status in keyof Responses]: Responses[Status] extends { body: infer B }
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
export type RouteHandler<Params, Query, Body, Responses extends ResponseContracts> = (
  context: RequestContext<Params, Query, Body>,
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
  readonly request?: {
    /** JSON Schema (object) for path parameters. Values are coerced from strings first. */
    readonly params?: Params
    /** JSON Schema (object) for query parameters. Values are coerced from strings first. */
    readonly query?: Query
    /** JSON Schema for the JSON request body. Declaring it makes a JSON body required. */
    readonly body?: Body
  }
  readonly responses: Responses
  readonly handler: RouteHandler<Params, Query, Body, Responses>
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
 * One segment of a compiled route path: a literal string, or a named parameter
 * capturing the whole segment.
 */
export type PathSegment = string | { readonly name: string }

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
  readonly body: CompiledValidation | undefined
  /** Response-body validators, present only when `validateResponses` is on. */
  readonly responses: ReadonlyMap<number, CompiledValidation> | undefined
}

/**
 * The two-tier routing table {@link createApi} builds: fully-static paths in a
 * flat map for O(1) lookup, parameterized paths per method for a segment scan.
 */
export type RouteTable = {
  readonly staticRoutes: ReadonlyMap<string, CompiledRoute>
  readonly dynamicRoutes: ReadonlyMap<string, readonly CompiledRoute[]>
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
   * Validate handler reply bodies against the declared response schemas and
   * turn mismatches into a 500. Off by default: it is a development/test net,
   * and skipping it keeps production replies free of a second validation pass.
   */
  readonly validateResponses?: boolean
  /** Maps a thrown handler error to a response. Defaults to a bare 500. */
  readonly onError?: (error: unknown, request: ApiRequest) => ApiResponse
}

/**
 * A compiled API. `handle` is the whole runtime — adapters are thin wrappers
 * that translate their framework's request/response types around it.
 */
export type Api = {
  /** Match, validate, run the handler, and produce a response. */
  readonly handle: (request: ApiRequest) => Promise<ApiResponse>
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
  readonly source: 'params' | 'query' | 'body'
  readonly errors: readonly ValidationError[]
}
