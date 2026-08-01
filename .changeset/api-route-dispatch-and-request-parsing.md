---
'@amritk/api': patch
---

Bucket route dispatch by shape, and fix two request-parsing defects

**Route lookup no longer scans every parameterized route.** The runtime engine
kept one list of dynamic routes per method and walked it in registration order,
re-running the segment matcher against each candidate. At 500 routes that was
~7.3 µs per lookup, and a miss cost the same as a hit. Dynamic routes are now
bucketed by segment count and by their first literal segment, so a lookup only
ever touches candidates that could match the shape in front of it: ~0.55 µs at
500 routes, and flat as the table grows. Precedence is unchanged — the buckets
are precomputed with the wildcard-first routes merged into each literal's list
in registration order, so which of two overlapping routes wins is exactly what
it was, greedy tails and static-over-dynamic included.

**An unroutable path is no longer the most expensive request an API serves.**
Building the 405 `allow` header re-ran the *whole* matcher once per method the
API declares, so a path from a vulnerability scanner cost up to seven times the
scan — ~45 µs of pure dispatch on a 500-route table, versus ~3 µs to serve a
real request. The static half of that answer is now precomputed at startup (the
same table the compiled engine emits as `ALLOW_STATIC`) and the dynamic half
reuses one path split across all methods: ~0.9 µs. The static hit path also
stopped building a `method + ' ' + path` key per request.

**Duplicate cookie names now resolve first-wins, not last-wins.** Browsers send
the most specific cookie first (RFC 6265 orders by longer path, then earlier
creation), so a `Path=/` cookie planted from a sibling subdomain arrives *after*
the real session cookie — and last-wins let it shadow it. First-wins is what the
`cookie` package behind Express, Hono, and Fastify does, and what the rest of the
stack assumes. Both engines share this parser, so they stay identical.

**`buildParamPath` rejects `.` and `..` path parameters.** Dots are unreserved,
so `encodeURIComponent` left them alone and `client.getUser({ params: { id:
'..' } })` built `/users/..`, which the URL parser then collapsed *before the
request was sent* — the call silently hit a different endpoint. It now throws.
Greedy `{name+}` tails are checked per segment for the same reason: WHATWG URL
normalizes `%2e%2e` too, so a literal `..` path component cannot be transmitted
at all, which makes one there always an unintended traversal rather than a
directory name.

The bench harness gains two dispatch cases — `dynamic GET, 500-route table, last
match (runtime)` and `unroutable path, 500-route table (runtime)` — so the PR
delta table catches a regression in either.
