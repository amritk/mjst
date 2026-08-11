---
'@amritk/api': patch
---

Fix five ways a request could be lost: an immutable-headers throw in
`createSecurityHeaders`, a hang in the Node adapter's body reader, two
synchronous escapes out of the fetch adapter, and a strip transform that
rewrote quoted code samples.

`createSecurityHeaders` wrote straight to `response.headers` instead of going
through `writableResponse`. A response that came out of `fetch()` — which is
every reply a proxying mount returns, the `mounts: { '/api/auth': ... }` shape
the package documents — carries an immutable header guard, so the first
`headers.set` threw `TypeError: immutable` and the pipeline turned that into a
blanket 500. Every sibling decorator (`createCors`, `createCsrf`,
`createRequestId`, `createRateLimit`) already probes for writability and has a
test pinning it; this one had neither. It now returns the response to stamp,
and skips the probe entirely when every header is opted out. Bun's `Response`
lets the mutation through, which is why the package's own suite never saw it —
the new test uses the guarded shape that Node, Workers, and browsers enforce.

`toNodeHandler`'s `readBytes` attached `data`/`end` listeners without checking
whether the stream had already ended. Under `app.use(express.json())` ahead of
`app.use(toNodeHandler(api))` — the Express wiring the adapter's own docs show
— the parser has drained the request before the adapter sees it, so those
events never fire again: the promise never settled, the handler never replied,
and the socket stayed open until the client gave up. It now reads what the
parser left on `req.body` (a Buffer or string verbatim, a decoded value
re-serialized), falling back to an empty body, and enforces the same
`maxBodyBytes` cap on the recovered value. A 'close' listener settles the other
half of the same hazard: a socket torn down mid-upload emits 'close' without
'end'.

The fetch adapter's dispatch is deliberately not `async` — the sync-reply fast
path skips the promise and the microtask turn — so a synchronous throw inside
it left a function declared `Promise<Response>` by throwing rather than
rejecting, which a caller holding only `.catch(...)` (or `waitUntil`) never
sees. Two callees can throw that way, both app code: a mount, whose type admits
a plain `Response`, and `api.handle`, whose 404/405 `ErrorFormatters` callbacks
run before any promise exists. Both now arrive as rejections. `compileToModule`
emitted the identical hole in its unhooked dispatch, so it gets the same
wrapper and a differential test holds the two engines to the same escape shape.

`stripContractFields` found call sites with a bare `indexOf`, which also
matched the name inside strings, template literals, and comments — so a docs
page holding a usage sample as data had that sample silently rewritten, losing
the very fields it existed to show. The scan now walks in code position,
skipping literals and comments, and treats a literal it cannot follow (an
apostrophe in JSX text) as an ordinary character rather than giving up on the
rest of the module.
