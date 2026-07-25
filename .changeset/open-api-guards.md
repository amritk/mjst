---
'@amritk/api': minor
---

Add `openApiGuards` to `createApi` and `compileToModule`, gating the served
OpenAPI document. The document endpoint is answered before route matching, so
`secureRoutes` never covers it — without this the full schema stayed public under
an otherwise deny-by-default API. The guards run exactly like a route's security
guards: the context factory first, then each guard in order with the first denial
winning, and the denial is sent as-is.

`OnErrorDetails.route` is now `AnyRouteContract | undefined`. It is `undefined`
only for an error raised on the guarded document path, which has no route behind
it; an `onError` that reads `details.route.path` needs a `?.` to keep
type-checking.
