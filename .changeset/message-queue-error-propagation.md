---
'@amritk/api': patch
---

`createMessageQueue` now rejects a consumer that is parked when the producer
ends with an error.

A consumer sitting in `for await` — the normal state, not an edge case — was
released with `{ done: true }` and never saw the error, so a transport failure
read as a clean end of stream. The rejection path only fired for a consumer
that happened to call `next()` *after* the end. Buffered messages are still
delivered first, so a stream that errored after producing values still yields
them before surfacing the failure.
