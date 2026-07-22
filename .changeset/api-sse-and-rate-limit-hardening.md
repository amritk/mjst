---
"@amritk/api": patch
---

Security hardening for two request-facing surfaces.

**SSE frame injection.** `formatSse` now sanitizes newlines per the SSE line
grammar (CR, LF, and CRLF all terminate a line), closing an injection hole a
handler hit whenever it streamed user-controlled strings. Previously `data`
split only on `\n`, so a lone `\r` was emitted verbatim and the browser parsed
it as a line break — letting attacker text forge extra `data:` fields, or via
`\r\r` terminate the event and forge a whole new one. The single-line `event`
and `id` fields were not sanitized at all, so a newline in either injected
arbitrary fields/events. Now `data`/`comment` split on CR/LF/CRLF into repeated
fields and `event`/`id` have any CR/LF stripped.

**Rate-limit store memory bound.** The default in-process `memoryRateLimitStore`
is now bounded: it trims to a target size once it crosses a hard ceiling. A
flood of distinct keys — trivial when the key derives from a spoofable header
such as `x-forwarded-for` — previously grew the map without bound (memory
exhaustion) and, because a sweep can only drop already-expired entries, turned
every subsequent insert into a full O(n) scan that freed nothing (CPU
exhaustion). Eviction is oldest-first with hysteresis, so maintenance amortizes
to O(1) per request.
