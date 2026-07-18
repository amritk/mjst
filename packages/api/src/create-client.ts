import type { FromSchema } from '@amritk/runtime-validators'

import type { AnyContract, ResponseContracts } from './types'
import { unexpectedStatusError } from './unexpected-status-error'

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
   * Headers sent with every call: a static record, or a (possibly async)
   * function evaluated per call — the shape auth tokens need. Per-call
   * `headers` win over these on conflict.
   */
  readonly headers?:
    | Readonly<Record<string, string>>
    | (() => Readonly<Record<string, string>> | Promise<Readonly<Record<string, string>>>)
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
}

/**
 * Builds a typed fetch client from a record of contracts — no codegen, no
 * OpenAPI round-trip: the same contract literals that type the server
 * handlers type the client calls, so client and server cannot drift. Because
 * contracts are pure data (`defineContract`), a frontend imports them — and
 * this function — without bundling any server code. This is the
 * framework-agnostic replacement for RPC clients like Hono's `hc`.
 *
 * Per call: `params` fill the path template (segment-encoded; greedy `{x+}`
 * parameters keep their slashes), `query` serializes repeats for arrays,
 * `body` follows the contract's `bodyType` (JSON, form, or multipart with
 * `File` values), declared `headers`/`cookies` are typed, and extra headers
 * and an `AbortSignal` ride along. Replies come back as the
 * {@link ClientReply} union; an undeclared status throws (check it with
 * `isUnexpectedStatusError`).
 *
 * @example
 * ```typescript
 * import * as contracts from './contracts'
 *
 * const client = createClient(contracts, 'https://api.example.com', {
 *   headers: () => ({ authorization: `Bearer ${token}` }),
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
  const baseHeaders = options?.headers
  const base = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl
  const client: Record<string, unknown> = {}
  for (const [name, contract] of Object.entries(contracts)) {
    client[name] = buildMethod(name, contract, base, fetchImpl, baseHeaders)
  }
  return client as ApiClient<Contracts>
}

const buildMethod = (
  name: string,
  contract: AnyContract,
  base: string,
  fetchImpl: NonNullable<ClientOptions['fetch']>,
  baseHeaders: ClientOptions['headers'],
): ((input?: RawInput) => Promise<unknown>) => {
  const method = contract.method.toUpperCase()
  const bodyType = contract.request?.bodyType ?? 'json'
  const hasBody = contract.request?.body !== undefined
  return async (input: RawInput = {}) => {
    const headers = new Headers(typeof baseHeaders === 'function' ? await baseHeaders() : baseHeaders)
    if (input.headers !== undefined) {
      for (const [headerName, value] of Object.entries(input.headers)) headers.set(headerName, String(value))
    }
    if (input.cookies !== undefined) appendCookies(headers, input.cookies)

    let body: string | URLSearchParams | FormData | undefined
    if (hasBody) {
      if (bodyType === 'json') {
        body = JSON.stringify(input.body)
        if (!headers.has('content-type')) headers.set('content-type', 'application/json')
      } else if (bodyType === 'form') {
        // URLSearchParams and FormData bodies carry their own content type
        // (FormData's includes the boundary), so fetch stamps the header.
        body = toSearchParams(input.body as Readonly<Record<string, unknown>>)
      } else {
        body = toFormData(input.body as Readonly<Record<string, unknown>>)
      }
    }

    const url = base + buildPath(contract.path, input.params) + queryStringOf(input.query)
    const init: RequestInit = { method, headers }
    if (body !== undefined) init.body = body
    if (input.signal !== undefined) init.signal = input.signal
    const response = await fetchImpl(url, init)

    const declared = contract.responses[response.status]
    if (declared === undefined) throw unexpectedStatusError(name, response)
    // Raw statuses hand the Response over untouched — the body may be a live
    // stream nobody should preemptively consume. JSON statuses with a schema
    // parse eagerly; statuses declared without a body stay unread.
    if (declared.contentType !== undefined || declared.body === undefined) {
      return { status: response.status, response }
    }
    return { status: response.status, body: (await response.json()) as unknown, response }
  }
}

/**
 * Fills the contract's path template. Plain parameters are fully encoded; a
 * greedy `{name+}` value is encoded per segment so its slashes survive as
 * path structure — the inverse of the server's per-segment decode.
 */
const buildPath = (pattern: string, params: Readonly<Record<string, unknown>> | undefined): string =>
  pattern.replace(/\{([^}]+)\}/g, (_match, rawName: string) => {
    const greedy = rawName.endsWith('+')
    const key = greedy ? rawName.slice(0, -1) : rawName
    const value = params?.[key]
    if (value === undefined) throw new Error(`Missing path parameter '${key}' for '${pattern}'`)
    const text = String(value)
    return greedy ? text.split('/').map(encodeURIComponent).join('/') : encodeURIComponent(text)
  })

const queryStringOf = (query: Readonly<Record<string, unknown>> | undefined): string => {
  if (query === undefined) return ''
  const text = toSearchParams(query).toString()
  return text === '' ? '' : '?' + text
}

/** Serializes an object the way the server parses it: repeats for arrays, `String` for scalars, skips `undefined`. */
const toSearchParams = (values: Readonly<Record<string, unknown>>): URLSearchParams => {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) continue
    if (Array.isArray(value)) {
      for (const item of value) search.append(key, String(item))
    } else {
      search.append(key, String(value))
    }
  }
  return search
}

const toFormData = (values: Readonly<Record<string, unknown>>): FormData => {
  const data = new FormData()
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) continue
    if (value instanceof Blob) {
      data.append(key, value)
    } else if (Array.isArray(value)) {
      for (const item of value) data.append(key, String(item))
    } else {
      data.append(key, String(value))
    }
  }
  return data
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
