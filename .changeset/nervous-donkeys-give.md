---
'@amritk/api': patch
---

Stop a JSX closing tag from making `stripContractFields` a silent no-op, and
say plainly what the Node adapter's recovered body is.

`isScannableId` accepts `.tsx`, and the scan's regex heuristic treats `<` as a
character a regex can follow — so the `/` of a `</p>` opened a "regex" that ran
to the next `/` in the file. With a `defineContract` call on the same line
(`path: '/x'` supplies the closing slash) the whole call site was stepped over
and the module came back unchanged: no error, and every request and response
schema shipped to the browser bundle the transform exists to strip. The scan no
longer reads `<`/`>` as regex-preceding, and — belt and braces — rejects any
regex guess that would span a `defineContract`, since a guess that swallows a
call site is wrong by construction.

`consumedBody`'s documentation now says what it actually returns. Recovering a
body an upstream parser decoded means re-serializing it as JSON, so `readText`
and `readBytes` see this process's whitespace and key order rather than the
bytes the client sent — and for `express.urlencoded`, JSON where the content
type says form encoding. A route verifying an HMAC over its raw body must not
have a parser mounted in front of it; scoping the parser
(`app.use('/api', express.json())`) leaves the live stream for the adapter.
