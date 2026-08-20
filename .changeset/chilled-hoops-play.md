---
'@amritk/helpers': minor
---

`escapeRegexPattern` rejected patterns that are legal in Unicode mode.

Its validating `new RegExp(pattern)` omitted the `u` flag, while `regexFlagsFor`
adds that flag whenever the pattern compiles with it. A pattern that is legal
*only* in Unicode mode — an astral range like `[😀-😜]`, or `[\u{61}-\u{7A}]` —
therefore failed generation with "Invalid regex pattern", even though the
emitter would have given it the `u` flag that makes it legal, and even though
Ajv (the differential oracle this package tracks) accepts it.

Both functions now read one cached compile decision: `u` where the pattern is a
legal Unicode-mode regex, no flag where it is legal only without one, and an
error only where it is a regex in neither mode. A pattern that is legal only
without the flag (`\-`, a bare `\p`) is unaffected.
