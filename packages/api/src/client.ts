/**
 * The browser-safe subpath: `@amritk/api/client`. Everything a frontend needs
 * — `createClient`, `defineContract`, the opt-in serializers, the auth
 * helpers, and the error predicates — with a transitive import graph that
 * never touches a server module, so bundlers resolve zero `node:*` built-ins
 * and print zero externalization warnings. The root barrel exports all of
 * this too and `sideEffects: false` tree-shakes the server half out; this
 * entry exists so browser safety is a guarantee of the import graph, not a
 * property of the bundler.
 */
export { appendCookies } from './append-cookies'
export { buildParamPath } from './build-param-path'
export {
  isMalformedBodyError,
  isUnexpectedStatusError,
  malformedBodyError,
  unexpectedStatusError,
} from './client-errors'
export type { BearerSession, BearerSessionOptions, BearerTokenStorage } from './create-bearer-session'
export { createBearerSession } from './create-bearer-session'
export type {
  ApiClient,
  BodySerializer,
  ClientInput,
  ClientMethod,
  ClientOptions,
  ClientReply,
  ClientReplyOf,
  CookiesSerializer,
  ErrorBodyOf,
  ErrorStatusOf,
  FetchOptions,
  PathParamsBuilder,
  QueryParamsSerializer,
  RequestBodyOf,
  RequestCookiesOf,
  RequestHeadersOf,
  RequestParamsOf,
  RequestQueryOf,
  ResponseBodyOf,
  ResponseStatusOf,
  SuccessBodyOf,
  SuccessStatusOf,
} from './create-client'
export { createClient } from './create-client'
export type { CsrfHeaderOptions } from './create-csrf-header'
export { createCsrfHeader } from './create-csrf-header'
export type { RefreshFetchOptions } from './create-refresh-fetch'
export { createRefreshFetch } from './create-refresh-fetch'
export type { AuthToken, TokenRefresh, TokenRefreshOptions } from './create-token-refresh'
export { createTokenRefresh } from './create-token-refresh'
export { decodeJwtExpiry } from './decode-jwt-expiry'
export { defineContract } from './define-contract'
export { formBodySerializer } from './form-body-serializer'
export { multipartBodySerializer } from './multipart-body-serializer'
export { toSearchParams } from './to-search-params'
export type {
  AnyContract,
  BodyType,
  Contract,
  HttpMethod,
  RefineInput,
  RefineIssue,
  ResponseContract,
  ResponseContracts,
} from './types'
