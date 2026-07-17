---
'@amritk/api': minor
---

Seven new capabilities, each implemented in both the runtime and compiled engines and held identical by the differential corpus:

- **Form and multipart bodies**: `request.bodyType: 'form' | 'multipart'` parses `application/x-www-form-urlencoded` (query-style coercion: typed keys coerce, array keys accumulate) and `multipart/form-data` (string parts coerce, file parts reach the handler as `File` objects — declare them without a `type` keyword) against the declared body schema. Multipart parsing rides the platform's `Response#formData` over the shared buffered read, so `maxBodyBytes` still caps uploads. Parse failures answer `400 { error: 'invalid_body' }` (new `errors.invalidBody` formatter).
- **415 enforcement**: a request whose `content-type` contradicts the declared body type answers `415 { error: 'unsupported_media_type' }` (new `errors.unsupportedMediaType` formatter) before any read. An absent content-type still falls through to the parse, so bare `curl` keeps working; JSON accepts `+json` structured suffixes.
- **Greedy catch-all path parameters**: `/files/{path+}` (the AWS API Gateway convention) captures one or more remaining segments, decoded per segment and joined with `/`. Must be last; the bare prefix stays 404.
- **OpenAPI components**: schemas carrying a `title` and reused across body positions hoist into `components.schemas` with `$ref` references — one `User` component and one generated client type instead of N inline copies. Conflicting titles stay inline.
- **OpenAPI security, servers, deprecated**: `createApi`/`compileToModule` accept `servers`, `securitySchemes`, and a document-level default `security`; routes accept per-operation `security` and `deprecated`.
- **Response header documentation**: `responses[status].headers` declares header schemas — emitted as OpenAPI header objects and validated (as an open object) under `validateResponses`, failing to the `invalid_response` 500 with `source: 'headers'`.
- **`observe` hook**: called once per matched request with `{ route, request, status, durationMs, env, executionContext }` — per-route latency metrics and structured request logs with the route *pattern* as the grouping key. Validation failures and handler errors are observed; 404s/405s and the OpenAPI document are not; a throwing observer is swallowed; unset costs nothing. Compiled via `observeExport`.
