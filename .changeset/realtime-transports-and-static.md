---
'@amritk/api': minor
---

Realtime transports, static file serving, and route-scoped response hooks.

**`connectRealtime` prefers WebTransport and drops down to WebSocket.** The
fallback fires when WebTransport is unavailable (Node, Bun, any browser without
the API), refused, or hung — and the last of those is the one that matters. A
WebTransport attempt on a network that silently drops UDP does not fail, it
hangs, because QUIC cannot tell a blackhole from a slow path; without the
connect deadline the fallback never runs and the user simply waits. Both arms
hand back the same message channel, so nothing above it branches on which won,
and `onFallback` reports the choice, because a silent fallback hides exactly
the signal you want. Ships in the browser-safe `@amritk/api/client` entry.

**Server-side WebTransport is deliberately absent.** It needs a QUIC stack, and
no runtime the adapters target exposes one through a fetch handler: workerd has
no HTTP/3 implementation at all, Bun 1.4 serves HTTP/3 but ships no WebTransport
API, and Deno's `upgradeWebTransport` lives on a raw QUIC listener rather than
on `Deno.serve`. Supplying one would mean a native addon dependency, which would
cost the Workers and React Native support that staying dependency-light buys.
The negotiation is written now so that when a runtime does ship it, clients
already prefer it and no application code changes.

**`upgradeWebSocket` routes a Bun handshake through the ordinary pipeline**, so
path params, guards, and `onRequest` gates all apply to it — an upgrade that
skipped the contract would be a hole in every policy the app configured. It
returns `undefined` when the runtime refuses, which is not a formality: Bun's
HTTP/3 listener does not implement RFC 9220, so `server.upgrade()` returns
`false` for every request that arrived over QUIC and the same route succeeds
over TCP. Requiring the caller to supply the refusal keeps that in the contract
rather than collapsing it to a 500. Measured against Bun 1.4 with `http3: true`:
`101` over TCP, the declared `426` over QUIC. `acceptWebSocket` covers workerd,
hiding the `WebSocketPair` object-keyed-`0`-and-`1` wart and the silent message
drop that follows a missed `accept()`.

**`createStatic` serves a document root, traversal-safe.** Doing this by hand is
one route today, and that route is wrong in a way its own tests will not catch:
the tail parameter decodes each segment individually, so
`/assets/%2e%2e%2f%2e%2e%2fetc/passwd` reaches the handler as
`../../etc/passwd`. A literal `../` never gets that far — clients and proxies
normalize it away — so the obvious `path.includes('..')` guard passes every test
anyone writes for it and stops nothing. `resolveStaticPath` splits first,
decodes each segment second, and judges third, so containment holds by
construction; dotfiles are denied by default, since a document root routinely
sits beside `.env` and `.git`. Content types, `etag`/`last-modified`,
conditional `304`s, and HEAD are handled; `Range` is not, and a symlink pointing
out of the root is invisible without a `realpath` the reader seam does not
expose. Reading is injected, because no one filesystem call works on Bun, Node,
and Workers alike.

**Route contracts take `onResponse` hooks.** Per-route timing, a header stamped
on one route group, an audit record written from the reply — the wrap-around
seam, without a middleware onion. Hooks run in order after the handler (and
after a guard denial, which is a reply like any other), each seeing the previous
one's result, and a replacement is validated against the contract just as the
handler's would have been. They do not run on a security-guard denial, which
fires before validation and before the context factory precisely so an
unauthenticated request never reaches app code. A route that declares none pays
one `undefined` check in the runtime engine and nothing in the compiled one,
where the branch resolves at emit time and a hookless route emits exactly the
code it always did. `compileToModule` emits the same ordering, and the staleness
shape check now covers response hooks, so a hook added after compilation fails
the deploy rather than being silently skipped.
