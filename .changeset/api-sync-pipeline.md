---
'@amritk/api': minor
---

Keep the runtime pipeline synchronous when the request never suspends

**`Api.handle` now returns `ApiResponse | Promise<ApiResponse>`.** It answers
synchronously when nothing along the route's path was asynchronous — no
declared body to read, no `refine`, no context factory, no guards, and a
handler that returned a value rather than a promise. This is the breaking part:
`await api.handle(...)` is unaffected, but code calling `.then()` on the result
directly must handle a plain value. The bench harness in this repo did exactly
that and is updated alongside.

**Why.** An `async` frame and its promise are not free, and on workerd the
difference is large enough to see. On the static GET, measured inside a real
isolate with `bench:workerd:allocations`, the runtime engine allocated 2115
bytes per request; it now allocates 1510, a 29% cut. Throughput on that case
went from ~69k to ~93k ops/s — from 0.80x bare Hono to roughly level with it.

**How.** `runRoute` is no longer one async function. It is a synchronous
dispatcher over three stages that hand off to each other synchronously until
something genuinely asynchronous appears:

- `runSecuredRoute` — security guards suspend before anything else happens, so
  that whole shape stays asynchronous, and rejoins the shared stages after.
- `runSlots` — coercion and validation for params, query, headers, and cookies,
  all of which were already synchronous.
- `runBody` — reading a declared body always suspends, so this stage is
  unconditionally asynchronous.
- `runTail` — refine, the context factory, guards, and the handler. Synchronous
  when none of the first three are configured and the handler returns a value;
  otherwise it delegates to `runTailAsync`, which is the original straight-line
  code.

The error tail is factored into one `routeError` helper the synchronous and
asynchronous halves share, so the two cannot drift on payload-too-large
detection or the `onError` contract. `finishReply` stays outside the error
boundary in both, exactly where it was.

**What did not change.** Ordering is identical: security guards still run
before any parsing, the context factory still runs after validation on
unsecured routes and before it on secured ones, and it still runs exactly once
per request. The differential corpus that holds the runtime and compiled
engines observationally identical passes unchanged.

**Still open.** The runtime engine's batch-time distribution is still bimodal
under workerd — a p95 around 3.3x its median, which is a major collection
rather than allocation volume. Neither the async work above nor removing
response validation moved it. The compiled engine, which is the production
path, does not show it.
