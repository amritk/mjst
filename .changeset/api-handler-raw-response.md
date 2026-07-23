---
"@amritk/api": minor
---

Let a routed handler return a raw web `Response` as a first-class escape hatch.
A handler may now return a `Response` directly instead of a `{ status, body }`
reply; both engines (runtime and compiled) and both adapters (`toFetchHandler`,
`toNodeHandler`) send it verbatim — still through `onResponse` decorators, with
the body stripped for HEAD — and response validation is skipped since there is
no framework-level body to check. This removes the need for a `Response`→reply
adapter when porting handlers that already build `Response` objects.
