---
'@amritk/api': patch
---

Fix five ways a request could be lost, and two ways a build could break.

`createSecurityHeaders` wrote straight to `response.headers` instead of going
through `writableResponse`. A response that came out of `fetch()` — which is
every reply a proxying mount returns, the `mounts: { '/api/auth': ... }` shape
the package documents — carries an immutable header guard, so the first
`headers.set` threw `TypeError: immutable` and the pipeline turned that into a
blanket 500. Every sibling decorator already probed for writability; this one
did not. Bun's `Response` lets the mutation through, which is why the suite
never saw it — the test now uses the guarded shape Node, Workers and browsers
enforce.

`toNodeHandler`'s body reader waited on an `end` event that would never fire
again when a parser upstream had already drained the stream — the
`app.use(express.json())` wiring the adapter's own docs show. The promise never
settled, the handler never replied, and the socket stayed open until the client
gave up. It now reads what the parser left on `req.body`, settles on a
destroyed or aborted stream instead of hanging, and enforces `maxBodyBytes` on
the recovered value. Note that a recovered body is a JSON *reconstruction*: a
route that needs the client's exact bytes (verifying an HMAC over a webhook)
must not have a parser mounted in front of it.

The fetch adapter's dispatch is deliberately not `async`, so a synchronous
throw left a function declared `Promise<Response>` by throwing rather than
rejecting — invisible to a caller holding only `.catch(...)`. Both a mount
(whose type admits a plain `Response`) and `api.handle`'s 404/405
`ErrorFormatters` callbacks can throw that way. Both now arrive as rejections,
in the compiled engine as well, held there by a differential test.

`compileToModule` now fails the build when an app export collides with one of
the generated module's own top-level names — `notFound`, `toResponse`,
`readBodyCapped`, and about twenty more, each a plausible route name. That
produced a module declaring the name twice, failing to load with a
`SyntaxError` naming an identifier the author never wrote. The internal names
are read back out of the emitted source, so the check cannot drift.

`stripContractFields` found call sites with a bare `indexOf`, so a
`defineContract` quoted inside a string, template or comment was silently
rewritten — a docs page lost the very fields its sample existed to show. The
scan now walks in code position. A `/` it guesses is a regex never skips a call
site (a wrong guess there would silently ship every schema to the bundle the
transform exists to slim), and `<` is no longer read as regex-preceding, which
JSX made routinely wrong.
