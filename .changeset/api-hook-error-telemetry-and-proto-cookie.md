---
'@amritk/api': patch
---

Report thrown adapter hooks instead of swallowing them, and stop dropping a `__proto__` cookie

**A throwing `onRequest` gate or `onResponse` decorator is no longer silent.**
Wrapping the hook chains stopped a throwing hook from escaping to the platform,
but the caught error was then dropped on the floor: no log, and the app's own
`onError` — which every routed failure already goes through — was never
consulted. The motivating case is exactly the one that needs telemetry:
`createRequestId({ trustInbound: true })` reflecting a CRLF-bearing inbound
`x-request-id` into `Headers.set` answered a bare `{"error":"internal_error"}`
with no indication that a decorator threw, or which one. Before the wrapping the
throw at least surfaced as a platform-level unhandled error, so the fix traded a
crash for an undiagnosable 500.

A thrown hook now goes to the app's `onError` (with `route: undefined` — a hook
belongs to no route), whose reply shapes the response exactly like a handler
error's does, raw-`Response` escape hatch included. An app that wired no
`onError` gets a `console.error` instead, because silence is the one outcome
that is never acceptable here; a reporter that throws falls back to the same log
and the bare 500. `Api` gained an optional `onError` so the adapter can reach the
sink the app already configured — the hooks run outside `handle`, so the
pipeline's own boundary never sees them. `compileToModule` emits the identical
helper, and the two-engine differential corpus now pins that both engines report
the same error, through the same sink, with the same log line.

**A contract declaring a cookie named `__proto__` now actually receives it.**
The read side treated the name as ordinary data, but the write side was a plain
`cookies[name] = value`, which runs `Object.prototype`'s `__proto__` setter
rather than creating a property — so the value silently vanished and
`required: ['__proto__']` failed for every request no matter what the client
sent. Same `defineProperty` fix already applied in `@amritk/generate-validators`
and `@amritk/yaml`. Both engines share this parser, so the compiled engine picks
it up unchanged.
