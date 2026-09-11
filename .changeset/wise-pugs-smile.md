---
'@amritk/runtime-validators': minor
---

Validate formats against their grammars, and measure it against the official suite.

`date` accepted `2020-02-30` and `1998-02-29`, `email` accepted `.test@`, `te..st@`
and `test.@`, `uri-reference` accepted `\\WINDOWS\fileshare`, and the OpenAPI
numeric formats (`int32`, `int64`, `float`, `double`) were not checked at all —
`format` was only ever consulted for strings. Where a pattern cannot answer the
question the check now does the arithmetic (the calendar day, the leap-second
hour); where the answer is a grammar it is assembled from the RFC's own
productions (RFC 3986/3987 for `uri`/`iri`, RFC 6570 for `uri-template`, RFC 3339
Appendix A's nested form for `duration`, which is why `P1Y2D` is not one).

New formats: `int32`, `int64`, `float`, `double`, `byte`, `binary`, `password`,
`url`, `iso-time`, `iso-date-time`, `json-pointer-uri-fragment`.

The suite's optional/format corpus (861 cases) is now vendored and run on every
build with an exact expected-failure list: 786/861 pass, against Ajv's 729/861 on
the same corpus. Where the suite and Ajv disagree the suite wins, which costs
agreement with Ajv on eight values (a hostname's trailing dot, four `time` offset
rules, two `duration` nestings, a non-numeric port).
