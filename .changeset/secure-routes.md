---
'@amritk/api': minor
---

Add `secureRoutes` for deny-by-default authorization. It resolves each route's
OpenAPI `security` requirement — its own, or a document-level default — into the
guards that enforce it and attaches them as the route's `securityGuards`. Schemes
carry their guard under an `x-guard` extension (the exported `securityGuard`
key), so one declaration drives both the OpenAPI document and runtime
enforcement; the guard is stripped from the generated document.

AND/OR requirement semantics follow OpenAPI (the first alternative's denial is
what the client sees), a requirement's scopes reach the scheme's guard as its
second argument, and a public route opts out with `security: []`. Security guards
run before slot validation, body reads and `refine` — after the context factory,
so they can gate on the session — which keeps an unauthenticated caller away from
the parser, the schema error detail and app code.

Four fail-closed startup errors keep the document and the runtime in agreement: a
requirement naming an undefined or guard-less scheme; an empty requirement object
(`{}`, OpenAPI's "auth optional" — opt in with `allowOptionalSecurity`); a guard
whose denial status the route's `responses` omits (opt out with
`allowUndeclaredDenials`); and calling `createApi`/`compileToModule` with a
`security` default covering a route that never went through `secureRoutes`.

Because the guards land on `contract.securityGuards`, both the runtime and
compiled engines honor them unchanged.
