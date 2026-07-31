---
'@amritk/api': minor
---

Add a browser-safe `@amritk/api/client` subpath and shave the client's fixed cost by making every non-JSON wire piece opt-in.

- **New `@amritk/api/client` entry point** — `createClient`, `defineContract`, the opt-in serializers (`toSearchParams`, `appendCookies`, `buildParamPath`, `formBodySerializer`, `multipartBodySerializer`), the error predicates, the `…Of` type helpers, and the client-side auth helpers (`createCsrfHeader`, `createTokenRefresh`, `createRefreshFetch`, `decodeJwtExpiry`). Its import graph never touches a server module (enforced by a test), so bundlers resolve zero `node:*` built-ins and print zero externalization warnings — browser safety no longer depends on `sideEffects: false` tree-shaking. The root barrel keeps exporting everything.
- **Breaking: query serialization is opt-in**, matching the existing `pathParams` pattern. Calls that pass `query` need `queryParams: toSearchParams` in `createClient` options; a call without it throws with the fix in the message. JSON-only apps that never send query strings no longer bundle the serializer.
- **Breaking: the `cookies` slot is opt-in** for the same reason — register `cookies: appendCookies` (Node/undici/workers only; browsers forbid setting the `cookie` header, so a browser bundle could never use it and now never carries it).
- The two client error modules merged into one (`client-errors`) with a shared constructor, halving their scaffolding bytes. `malformedBodyError` / `unexpectedStatusError` and their predicates behave exactly as before and stay exported from the root.
