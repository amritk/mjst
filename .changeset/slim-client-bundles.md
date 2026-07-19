---
'@amritk/api': minor
---

Slim browser bundles for `createClient` — a contract-slimming bundler plugin plus opt-in wire formats.

**New: `@amritk/api/bundler`.** `stripContractsVite()` (Vite) and `stripContractsBun()` (`Bun.build`) strip server/OpenAPI freight — request/response schemas, `refine`, `summary`, `description`, tags, security — from `defineContract` call sites in browser builds, keeping only what the client runtime reads (`method`, `path`, `bodyType`, body/`contentType` markers). Types are compile-time, so consumers see no difference; unparseable call sites are left untouched. Measured on a three-contract JSON-only widget: contract data drops from 1.3 kB to 0.31 kB minified (~75% per route), the full bundle from 3.6 kB to 2.7 kB minified (1.7 kB to 1.4 kB gzip).

**Breaking: form/multipart serialization is now opt-in.** `bodyType: 'form'` / `'multipart'` contracts need their serializer registered: `createClient(contracts, url, { serializers: [formBodySerializer, multipartBodySerializer] })`. JSON stays built in (and can be overridden with a custom `bodyType: 'json'` serializer). Calling a contract whose `bodyType` has no registered serializer throws with the fix in the message.

**Breaking: `{param}` path building is now opt-in.** Contracts with path parameters need `createClient(contracts, url, { pathParams: buildParamPath })`. Static-path apps pass nothing and no longer bundle the template code.
