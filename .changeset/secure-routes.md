---
'@amritk/api': minor
---

Add `secureRoutes` for deny-by-default authorization. It resolves each route's
OpenAPI `security` requirement — its own, or a document-level default — into the
guards that enforce it and prepends them to the route's `guards`. Schemes carry
their guard under an `x-guard` extension (the exported `securityGuard` key), so
one declaration drives both the OpenAPI document and runtime enforcement; the
guard is stripped from the generated document. AND/OR requirement semantics
follow OpenAPI, a public route opts out with `security: []`, and a requirement
naming a scheme with no guard is a startup error. Because the guards land on
`contract.guards`, both the runtime and compiled engines honor them unchanged.
