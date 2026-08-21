---
'@amritk/api': minor
---

`createMessageQueue` now rejects a consumer that is parked when the producer
ends with an error.

**Breaking:** a `for await` loop that was already awaiting when the stream
failed used to exit cleanly and now throws. That is the point — the error was
being dropped entirely, so a transport failure read as a clean end of stream —
but code that relied on the loop simply finishing needs a `try`/`catch`, and a
detached loop (`void (async () => { for await … })()`, the shape this package's
own docs show) needs a `.catch` or the rejection is unhandled. The affected
iterators are `connectRealtime`'s `messages` and the `messages`/`binary`
streams of `bindMessages` / `connectMessages`.

A consumer that happened to call `next()` *after* the end already saw the
error; only the parked case — which is the normal one, not an edge case — was
losing it. Buffered messages are still delivered first, so a stream that
errored after producing values still yields them before surfacing the failure.
