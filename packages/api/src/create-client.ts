import type { FromSchema } from '@amritk/runtime-validators'

import { malformedBodyError } from './malformed-body-error'
import { toSearchParams } from './to-search-params'
import type { AnyContract, BodyType, ResponseContracts } from './types'
import { unexpectedStatusError } from './unexpected-status-error'

/**
 * One opt-in wire format: how a declared `bodyType` turns a call's `body`
 * into fetchable bytes. JSON is built into the client; everything else
 * (`formBodySerializer`, `multipartBodySerializer`, or your own) is imported
 * and registered explicitly so apps only bundle the formats they send.
 * Registering a `bodyType: 'json'` serializer overrides the built-in one.
 */
export type BodySerializer = {
  /** The contract `bodyType` this serializer handles. */
  readonly bodyType: BodyType
  /**
   * `content-type` header to stamp when the serialized body does not carry
   * its own. Omit it for `URLSearchParams`/`FormData` results — fetch derives
   * the header (including the multipart boundary) from the body itself.
   */
  readonly contentType?: string
  /**
   * Turns the call's (schema-typed) body value into a fetch body. Typed via
   * `RequestInit` because the standalone `BodyInit` name is not in every lib
   * set this package compiles against.
   */
  readonly serialize: (body: unknown) => NonNullable<RequestInit['body']>
}

/**
 * Fills a contract's `{param}` path template with a call's `params`. Opt-in
 * for the same reason as {@link BodySerializer}: apps whose contracts use
 * only static paths never bundle the template machinery. The package ships
 * `buildParamPath` as the standard implementation.
 */
export type PathParamsBuilder = (pattern: string, params: Readonly<Record<string, unknown>> | undefined) => string

/**
 * Extra `RequestInit` fields passed through to fetch untouched —
 * `credentials`, `cache`, `redirect`, `keepalive`, `mode`, and friends. The
 * fields the client computes itself (`method`, `headers`, `body`, `signal`)
 * are carved out so a passthrough can never clobber them.
 */
export type FetchOptions = Omit<RequestInit, 'method' | 'headers' | 'body' | 'signal'>

/**
 * Options for {@link createClient}.
 */
export type ClientOptions = {
  /**
   * Fetch implementation override — inject a stub in tests, a polyfill, or a
   * wrapper that adds retries. Defaults to the global `fetch`.
   */
  readonly fetch?: (url: string, init: RequestInit) => Promise<Response>
  /**
   * `RequestInit` fields merged into every request, e.g.
   * `{ credentials: 'include' }` for browser cookie auth. Per-call
   * `fetchOptions` win over these on conflict (shallow merge). Note that
   * browsers forbid setting the `cookie` request header, so the typed
   * `cookies` slot only works from Node/undici/workers — browser cookie auth
   * should rely on server-set cookies plus `credentials: 'include'` here.
   */
  readonly fetchOptions?: FetchOptions
  /**
   * Headers sent with every call: a static record, or a (possibly async)
   * function evaluated per call — the shape auth tokens need. Per-call
   * `headers` win over these on conflict.
   */
  readonly headers?:
    | Readonly<Record<string, string>>
    | (() => Readonly<Record<string, string>> | Promise<Readonly<Record<string, string>>>)
  /**
   * Wire formats beyond JSON, matched to contracts by `bodyType`. Import and
   * register `formBodySerializer` / `multipartBodySerializer` only when your
   * contracts declare those types; calling a contract whose `bodyType` has no
   * registered serializer throws with the fix in the message.
   */
  readonly serializers?: readonly BodySerializer[]
  /**
   * Path-template builder for contracts with `{param}` segments — pass
   * `buildParamPath`. Calling a parameterized contract without one throws;
   * static-path apps omit it and skip the code entirely.
   */
  readonly pathParams?: PathParamsBuilder
  /**
   * Default timeout applied to every call, in milliseconds. Implemented with
   * `AbortSignal.timeout`, composed via `AbortSignal.any` when a call also
   * passes its own `signal` — either one aborts the request. Per-call
   * `timeoutMs` overrides this, including an explicit `undefined` to disable
   * the timeout for one call.
   */
  readonly timeoutMs?: number
}

/**
 * Extracts one request-slot schema from a contract type. Undeclared slots
 * come out as `never` (the slot property exists on every contract type but
 * holds `undefined` when unused), which is what {@link SlotField} keys off.
 */
type SlotSchema<
  C extends AnyContract,
  K extends 'params' | 'query' | 'body' | 'headers' | 'cookies',
> = K extends keyof NonNullable<C['request']>
  ? Exclude<NonNullable<C['request']>[K & keyof NonNullable<C['request']>], undefined>
  : never

/** A required, schema-typed input field when declared; nothing when not. */
type SlotField<Key extends string, S> = [S] extends [never] ? unknown : { readonly [K in Key]: FromSchema<S> }

/**
 * What a declared slot's schema means as a value — and `undefined` for a
 * contract that never declared the slot, mirroring what the server handler
 * sees (`SchemaValue` in types.ts), so code shared by both sides types
 * identically.
 */
type SlotValue<S> = [S] extends [never] ? undefined : FromSchema<S>

/**
 * Ad-hoc header values. Numbers and booleans are allowed (serialized with
 * `String`) so coerced header schemas (`x-retry-count: { type: 'integer' }`)
 * type-check without manual stringification.
 */
type ExtraHeaders = Readonly<Record<string, string | number | boolean>>

/**
 * The `headers` input field: always available for extra ad-hoc headers, and
 * intersected with the schema-derived shape when the contract declares one —
 * so declared headers are required and typed while extras still pass.
 */
type HeadersField<S> = [S] extends [never]
  ? { readonly headers?: ExtraHeaders }
  : { readonly headers: FromSchema<S> & ExtraHeaders }

/**
 * What one client call accepts, derived entirely from the contract: declared
 * slots become required, typed fields; undeclared ones do not exist.
 */
export type ClientInput<C extends AnyContract> = SlotField<'params', SlotSchema<C, 'params'>> &
  SlotField<'query', SlotSchema<C, 'query'>> &
  SlotField<'body', SlotSchema<C, 'body'>> &
  SlotField<'cookies', SlotSchema<C, 'cookies'>> &
  HeadersField<SlotSchema<C, 'headers'>> & {
    /** Per-call cancellation, e.g. from `AbortSignal.timeout(5000)`. */
    readonly signal?: AbortSignal
    /**
     * Per-call `RequestInit` passthrough, shallow-merged over the
     * client-level `fetchOptions` — the winning source for `credentials`,
     * `cache`, `redirect`, and friends on this one request.
     */
    readonly fetchOptions?: FetchOptions
    /**
     * Per-call timeout override in milliseconds. The explicit `| undefined`
     * matters under `exactOptionalPropertyTypes`: present-but-`undefined`
     * disables the client-level default for this call, while absent falls
     * back to it.
     */
    readonly timeoutMs?: number | undefined
  }

/**
 * What one client call resolves with: a union discriminated on `status`,
 * derived from the contract's response map. JSON statuses carry `body` typed
 * from their schema; raw (`contentType`) statuses carry only the untouched
 * `Response`, so callers can read the stream and response headers themselves.
 * Every variant keeps `response` for header access. An undeclared status
 * never appears here — it throws (see `unexpectedStatusError`) instead of
 * widening the union.
 */
export type ClientReply<Responses extends ResponseContracts> = {
  [Status in keyof Responses]: Responses[Status] extends { contentType: string }
    ? { readonly status: Status; readonly body?: undefined; readonly response: Response }
    : Responses[Status] extends { body: infer B }
      ? { readonly status: Status; readonly body: FromSchema<B>; readonly response: Response }
      : { readonly status: Status; readonly body?: undefined; readonly response: Response }
}[keyof Responses]

/**
 * {@link ClientReply} keyed by the contract itself, matching how
 * {@link ClientInput} is written — so naming the union a method resolves with
 * does not require reaching for `C['responses']`.
 */
export type ClientReplyOf<C extends AnyContract> = ClientReply<C['responses']>

/**
 * The schema-typed body for one declared status (or a union of statuses;
 * defaults to every declared one). This is what lets an app name its wire
 * types straight from the contracts — no codegen, no hand-written mirror that
 * can drift:
 *
 * ```typescript
 * // The 402 body, exactly as the contract declares it.
 * export type DemoLimitBody = ResponseBodyOf<typeof demoLimit, 402>
 * ```
 *
 * Derived from the declared schema, not from the client's parsing: a raw
 * (`contentType`) status that documents a `body` schema still yields that
 * schema's type here, so code that parses the stream itself can type what it
 * expects to find — even though {@link ClientReply} leaves such a status's
 * `Response` unread. Statuses declared without a body come out `undefined`.
 */
export type ResponseBodyOf<
  C extends AnyContract,
  Status extends keyof C['responses'] = keyof C['responses'],
> = Status extends keyof C['responses']
  ? C['responses'][Status] extends { body: infer B }
    ? FromSchema<B>
    : undefined
  : never

/**
 * The path-parameter shape a contract declares, or `undefined` when it
 * declares none. Like {@link ResponseBodyOf}, these request-slot helpers
 * exist so an app names its wire types once from the contract — a form model,
 * a composable's argument — instead of re-declaring shapes that can drift.
 */
export type RequestParamsOf<C extends AnyContract> = SlotValue<SlotSchema<C, 'params'>>

/** The query shape a contract declares, or `undefined` when it declares none. */
export type RequestQueryOf<C extends AnyContract> = SlotValue<SlotSchema<C, 'query'>>

/** The request-body shape a contract declares, or `undefined` when it declares none. */
export type RequestBodyOf<C extends AnyContract> = SlotValue<SlotSchema<C, 'body'>>

/** The declared request-header shape, or `undefined` when the contract declares none. */
export type RequestHeadersOf<C extends AnyContract> = SlotValue<SlotSchema<C, 'headers'>>

/** The declared cookie shape, or `undefined` when the contract declares none. */
export type RequestCookiesOf<C extends AnyContract> = SlotValue<SlotSchema<C, 'cookies'>>

/**
 * The statuses a contract declares, as number literals (`200 | 402`) — the
 * domain for an exhaustive switch over a reply's `status`.
 */
export type ResponseStatusOf<C extends AnyContract> = keyof C['responses'] & number

/**
 * Filters a status union down to a class by its leading digit. Template
 * literal matching is how the type system reads a number's first digit —
 * there is no numeric range type to lean on.
 */
type StatusInClass<Status extends number, FirstDigit extends string> = Status extends number
  ? `${Status}` extends `${FirstDigit}${string}`
    ? Status
    : never
  : never

/** The declared success (2xx) statuses. */
export type SuccessStatusOf<C extends AnyContract> = StatusInClass<ResponseStatusOf<C>, '2'>

/** The declared error (4xx/5xx) statuses. */
export type ErrorStatusOf<C extends AnyContract> = StatusInClass<ResponseStatusOf<C>, '4' | '5'>

/**
 * The success payload union — the bodies of every declared 2xx status. This
 * is the "data" type an SDK generator would emit per operation, named from
 * the contract instead. A raw (`contentType`) success without a documented
 * body schema contributes `undefined` (its payload is the stream itself).
 */
export type SuccessBodyOf<C extends AnyContract> = ResponseBodyOf<C, SuccessStatusOf<C> & keyof C['responses']>

/**
 * The error payload union — the bodies of every declared 4xx/5xx status, the
 * per-operation error type an SDK generator would emit. A contract that
 * declares no error statuses comes out `never`; error statuses declared
 * without a body contribute `undefined`.
 */
export type ErrorBodyOf<C extends AnyContract> = ResponseBodyOf<C, ErrorStatusOf<C> & keyof C['responses']>

/** Keys of T that an empty object cannot satisfy — i.e. the required ones. */
type RequiredKeys<T> = { [K in keyof T]-?: object extends Pick<T, K> ? never : K }[keyof T]

/**
 * One route's client method. The whole input argument becomes optional when
 * the contract declares no request slots, so `client.health()` reads
 * naturally.
 */
export type ClientMethod<C extends AnyContract> = [RequiredKeys<ClientInput<C>>] extends [never]
  ? (input?: ClientInput<C>) => Promise<ClientReply<C['responses']>>
  : (input: ClientInput<C>) => Promise<ClientReply<C['responses']>>

/**
 * The typed client: one method per contract, named by the contracts record's
 * keys.
 */
export type ApiClient<Contracts extends Readonly<Record<string, AnyContract>>> = {
  readonly [K in keyof Contracts]: ClientMethod<Contracts[K]>
}

/** The loosely-typed view one method works with at runtime. */
type RawInput = {
  readonly params?: Readonly<Record<string, unknown>>
  readonly query?: Readonly<Record<string, unknown>>
  readonly body?: unknown
  readonly headers?: ExtraHeaders
  readonly cookies?: Readonly<Record<string, unknown>>
  readonly signal?: AbortSignal
  readonly fetchOptions?: FetchOptions
  readonly timeoutMs?: number | undefined
}

/**
 * Builds a typed fetch client from a record of contracts — no codegen, no
 * OpenAPI round-trip: the same contract literals that type the server
 * handlers type the client calls, so client and server cannot drift. Because
 * contracts are pure data (`defineContract`), a frontend imports them — and
 * this function — without bundling any server code. This is the
 * framework-agnostic replacement for RPC clients like Hono's `hc`.
 *
 * Per call: `query` serializes repeats for arrays, `body` follows the
 * contract's `bodyType` (JSON built in; register `formBodySerializer` /
 * `multipartBodySerializer` for the rest), `params` fill the path template
 * through the registered `pathParams` builder (`buildParamPath`
 * segment-encodes; greedy `{x+}` parameters keep their slashes), declared
 * `headers`/`cookies` are typed, and extra headers and an `AbortSignal` ride
 * along. Every request carries `accept: application/json` unless some header
 * source overrides it. Extra `RequestInit` fields (`credentials`, `cache`,
 * `redirect`, ...) pass through via `fetchOptions` — client-level defaults
 * with per-call overrides — and `timeoutMs` aborts slow calls, composing with
 * a caller `signal` through `AbortSignal.any`. Replies come back as the
 * {@link ClientReply} union; an undeclared status throws (check it with
 * `isUnexpectedStatusError`) and a declared JSON status whose body fails to
 * parse throws too (check it with `isMalformedBodyError` — the `Response` and
 * the parse error ride along). The non-JSON wire formats and the
 * path-template builder are opt-in imports so apps only bundle what their
 * calls actually use.
 *
 * Browsers forbid setting the `cookie` request header, so the typed `cookies`
 * slot works from Node/undici/workers only. Browser cookie auth should use
 * server-set cookies plus `fetchOptions: { credentials: 'include' }`.
 *
 * @example
 * ```typescript
 * import * as contracts from './contracts'
 *
 * const client = createClient(contracts, 'https://api.example.com', {
 *   headers: () => ({ authorization: `Bearer ${token}` }),
 *   pathParams: buildParamPath, // only needed for {param} paths
 * })
 *
 * const reply = await client.getUser({ params: { id: 7 } })
 * if (reply.status === 200) console.log(reply.body.name) // typed from the schema
 *
 * const chat = await client.chat({ body: { message: 'hi' }, signal })
 * if (chat.status === 200) await readStream(chat.response.body) // raw statuses expose the Response
 * ```
 */
export const createClient = <Contracts extends Readonly<Record<string, AnyContract>>>(
  contracts: Contracts,
  baseUrl: string,
  options?: ClientOptions,
): ApiClient<Contracts> => {
  // Global fetch must not be called unbound (browsers throw Illegal
  // invocation), so the default goes through a wrapper.
  const fetchImpl = options?.fetch ?? ((url: string, init: RequestInit) => globalThis.fetch(url, init))
  const serializers: Partial<Record<BodyType, BodySerializer>> = {}
  for (const serializer of options?.serializers ?? []) serializers[serializer.bodyType] = serializer
  const shared: SharedClientState = {
    base: baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl,
    fetchImpl,
    baseHeaders: options?.headers,
    serializers,
    pathParams: options?.pathParams,
    fetchOptions: options?.fetchOptions,
    timeoutMs: options?.timeoutMs,
  }
  const client: Record<string, unknown> = {}
  for (const [name, contract] of Object.entries(contracts)) {
    client[name] = buildMethod(name, contract, shared)
  }
  return client as ApiClient<Contracts>
}

/** What every built method shares — resolved once in {@link createClient}. */
type SharedClientState = {
  readonly base: string
  readonly fetchImpl: NonNullable<ClientOptions['fetch']>
  readonly baseHeaders: ClientOptions['headers']
  readonly serializers: Partial<Record<BodyType, BodySerializer>>
  readonly pathParams: PathParamsBuilder | undefined
  readonly fetchOptions: FetchOptions | undefined
  readonly timeoutMs: number | undefined
}

const buildMethod = (
  name: string,
  contract: AnyContract,
  shared: SharedClientState,
): ((input?: RawInput) => Promise<unknown>) => {
  const method = contract.method.toUpperCase()
  const bodyType = contract.request?.bodyType ?? 'json'
  const hasBody = contract.request?.body !== undefined
  const hasPathParams = contract.path.includes('{')
  return async (input: RawInput = {}) => {
    // The accept default goes in first so every later source — client-level
    // headers, declared headers, per-call extras — can override it.
    const headers = new Headers({ accept: 'application/json' })
    const baseHeaders = typeof shared.baseHeaders === 'function' ? await shared.baseHeaders() : shared.baseHeaders
    if (baseHeaders !== undefined) {
      for (const [headerName, value] of Object.entries(baseHeaders)) headers.set(headerName, value)
    }
    if (input.headers !== undefined) {
      for (const [headerName, value] of Object.entries(input.headers)) headers.set(headerName, String(value))
    }
    if (input.cookies !== undefined) appendCookies(headers, input.cookies)

    let body: RequestInit['body'] | undefined
    if (hasBody) {
      const serializer = shared.serializers[bodyType]
      if (serializer !== undefined) {
        body = serializer.serialize(input.body)
        if (serializer.contentType !== undefined && !headers.has('content-type')) {
          headers.set('content-type', serializer.contentType)
        }
      } else if (bodyType === 'json') {
        body = JSON.stringify(input.body)
        if (!headers.has('content-type')) headers.set('content-type', 'application/json')
      } else {
        // Thrown per call rather than in createClient so a shared contracts
        // record can carry formats this particular app never sends. Kept
        // terse on purpose — these strings ship in every browser bundle.
        throw new Error(
          `Contract '${name}': no serializer for bodyType '${bodyType}' — add it to createClient serializers`,
        )
      }
    }

    let path = contract.path
    if (hasPathParams) {
      if (shared.pathParams === undefined) {
        throw new Error(`Contract '${name}': path '${contract.path}' needs createClient pathParams (buildParamPath)`)
      }
      path = shared.pathParams(contract.path, input.params)
    }

    const url = shared.base + path + queryStringOf(input.query)
    // Passthrough options spread first so the fields the client computes
    // (method, headers, body, signal) always win over them.
    const init: RequestInit = { ...shared.fetchOptions, ...input.fetchOptions, method, headers }
    if (body !== undefined) init.body = body
    // A per-call timeoutMs property wins even when set to undefined — that is
    // how one call opts out of the client-level default.
    const timeoutMs = 'timeoutMs' in input ? input.timeoutMs : shared.timeoutMs
    const signal = composeSignal(input.signal, timeoutMs)
    if (signal !== undefined) init.signal = signal
    const response = await shared.fetchImpl(url, init)

    const declared = contract.responses[response.status]
    if (declared === undefined) throw unexpectedStatusError(name, response)
    // Raw statuses hand the Response over untouched — the body may be a live
    // stream nobody should preemptively consume. JSON statuses with a schema
    // parse eagerly; statuses declared without a body stay unread.
    if (declared.contentType !== undefined || declared.body === undefined) {
      return { status: response.status, response }
    }
    // A bare SyntaxError from response.json() would lose the route name, the
    // status, and the Response — wrap it so error handling keeps all three.
    const parsed: unknown = await response.json().catch((cause: unknown) => {
      throw malformedBodyError(name, response, cause)
    })
    return { status: response.status, body: parsed, response }
  }
}

/**
 * Builds the effective abort signal for one request: the caller's signal, a
 * timeout signal, both composed with `AbortSignal.any` (Node >= 20, our
 * engines floor — no polyfill needed), or nothing at all.
 */
const composeSignal = (callerSignal: AbortSignal | undefined, timeoutMs: number | undefined): AbortSignal | undefined => {
  if (timeoutMs === undefined) return callerSignal
  const timeoutSignal = AbortSignal.timeout(timeoutMs)
  return callerSignal === undefined ? timeoutSignal : AbortSignal.any([callerSignal, timeoutSignal])
}

const queryStringOf = (query: Readonly<Record<string, unknown>> | undefined): string => {
  if (query === undefined) return ''
  const text = toSearchParams(query).toString()
  return text === '' ? '' : '?' + text
}

/** Serializes declared cookies onto the `cookie` header (percent-encoded, like the server's decode). */
const appendCookies = (headers: Headers, cookies: Readonly<Record<string, unknown>>): void => {
  const pairs = Object.entries(cookies)
    .filter(([, value]) => value !== undefined)
    .map(([cookieName, value]) => `${cookieName}=${encodeURIComponent(String(value))}`)
  if (pairs.length === 0) return
  const existing = headers.get('cookie')
  const joined = pairs.join('; ')
  headers.set('cookie', existing === null ? joined : existing + '; ' + joined)
}
