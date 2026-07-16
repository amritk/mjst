---
'@amritk/api': minor
---

Ship the adoption-readiness feature set, in both the runtime and compiled engines:

- **Raw request bodies**: `ApiRequest.readText` / `readBytes` for webhook HMAC verification and uploads; the pipeline only consumes the body stream when a body schema is declared.
- **Body size cap**: `maxBodyBytes` on `toFetchHandler` / `toNodeHandler` / `compileToModule` answers 413 via a shared capped stream reader (`readBytesCapped`), enforced for pipeline and handler-initiated reads alike.
- **Streaming replies**: response contracts may declare `contentType`; handlers then return `ReadableStream` / `Uint8Array` / string bodies that adapters send untouched. `ApiRequest.signal` aborts on client disconnect.
- **Hook chains**: `toFetchHandler({ onRequest, onResponse })` — short-circuiting gates before mounts/routing and decorators on every outgoing response; compiled via `onRequestExports` / `onResponseExports`.
- **CORS**: `createCors(options)` returns an onRequest/onResponse hook pair handling preflight and response decoration.
- **Custom error envelopes**: `createApi({ errors })` formatters for notFound / invalidJson / payloadTooLarge / validationFailed; compiled via `errorsExport`.
- **Header schemas**: `request.headers` validates declared headers (with coercion) and emits `in: 'header'` OpenAPI parameters.
- **Typed client**: the OpenAPI output is covered by a Hey API (`@hey-api/openapi-ts`) integration test generating a typed fetch SDK.
