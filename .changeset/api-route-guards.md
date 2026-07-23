---
'@amritk/api': minor
---

Add route guards for per-endpoint authorization. Declare `guards: [...]` on
`defineRoute`, `implementRoute`, or `routeImplementer` (server side — the
browser-safe `defineContract` stays pure data); each guard runs after the
context factory and before the handler, sees the same `RequestContext` the
handler will, and either returns a reply to deny the request or `undefined` to
pass. Guards run in order (first denial wins), may be sync or async, and a
thrown guard takes the `onError` path. A guard can only deny with a status the
route's `responses` map declares, so enforcement can never silently open an
endpoint and the 401/403 is already in the OpenAPI document. Guards attach in
one place — the `guards` field — and the denial status stays declared on the
contract, so OpenAPI, response validation, and the typed `createClient` all
agree. `requireContext` packages the common reusable session/role check; declare
a shared `authResponses` fragment once to keep the boilerplate DRY. Both the
runtime and compiled engines run guards identically, pinned by the differential
corpus.
