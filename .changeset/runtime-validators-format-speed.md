---
"@amritk/runtime-validators": patch
---

Check the `uri`, `uri-reference`, `iri`, `iri-reference` and `url` formats by splitting the value on its delimiters (RFC 3986 Appendix B) and testing each part against a character class, instead of matching one large grammar regex. JavaScriptCore could not JIT that regex, so on Bun it cost about 35µs for an ordinary URI and returned `false` for valid URIs past a couple of hundred kilobytes. On Bun a check now takes under 1µs and long URIs validate. On Node, which handled the regex well, a check moves from about 0.3µs to 0.5–1µs.

`date`, `time`, `date-time`, `iso-time` and `iso-date-time` read their fields by position rather than through capture groups, which makes a `date-time` check 2–5× faster on both engines. The accepted values are unchanged for every format; a fuzz of several hundred thousand strings against the previous checks found no difference.
