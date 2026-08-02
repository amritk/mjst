---
'@amritk/api': patch
---

Stop paying for an AbortSignal on every request, and re-measure the cross-framework tables

**Both engines materialized a host-backed `AbortSignal` per request.** The
per-request `ApiRequest` was built with `signal: request.signal`, read eagerly.
On workerd that first touch constructs a host object backed by C++ state —
cheap in bytes, expensive to collect — for handlers that overwhelmingly never
look at it. Hono never creates one at all. Reading it through a getter defers
the cost to the handlers that actually want it. `hookApiRequest` still reads it
eagerly: that path runs once per 500 and hands its object straight to an
`onError` reporter.

**The getter has to be inherited, not owned.** An own accessor pushes the
object out of V8's in-object slots. The compiled engine's request object had no
accessor before this change, and gaining one took it from 852 to 1276 bytes
allocated per request inside workerd. On a shared prototype the instances stay
plain data objects and the deferral is free. Both engines get the same
treatment, as the differential corpus requires.

**Measured, not inferred.** The README previously reported that workerd stalled
the `@amritk/api` columns far more often than Hono and guessed the cause was
allocating more per request. That guess was wrong: on the static GET the
compiled engine already allocated 852 bytes per request against bare Hono's
1220, and turned a batch of 2048 requests around faster than Hono did. It
allocated less and ran quicker, then periodically got stopped. After the fix it
allocates 816 bytes per request and stalls on 0 of 60 batches, where before it
stalled on 5 and lost 29% of its wall clock to them. The runtime engine still
stalls and still allocates ~2172 bytes per request; that is called out in the
README as open work rather than presented as solved.

**New: `bun run bench:workerd:allocations`.** Reads the isolate's heap over
workerd's inspector either side of a run of exactly N requests and regresses
the delta against N, so the Miniflare loopback hop lands in the intercept and
cancels; it also times fixed batches inside the isolate and reports how many
ran more than twice the median. workerd accepts `HeapProfiler.startSampling`
but answers with an empty profile, so there is no per-call-frame attribution to
be had from the runtime. `bench/run-workerd.ts` now repeats each cell across
several fresh isolates and reports the median of the per-isolate medians —
a single isolate's median is robust to a paused trial, but isolates differ from
each other by more than that, which was enough to hide effects this size.

**The cached-`ResponseInit` comment claimed ~40% and was measured on neither
runtime it gets read on.** Measured now: on Node it is worth about 10% on the
static GET (104k vs 93k ops/s against `Response.json`); inside workerd the
cached init, a cached `Headers` instance, and plain `Response.json` are
indistinguishable. The code stays — it costs nothing anywhere and helps on one
runtime — but the comment now says so.

All three tables were re-measured together on one machine, which is slower than
the one earlier revisions used, so the absolutes moved down across every column
at once. The README says that where the tables are.
