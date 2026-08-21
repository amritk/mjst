---
'@amritk/api': minor
---

Message contracts for realtime connections — typing and validating what flows
after the 101.

The WebSocket handshake was already contract-covered (it is an ordinary routed
request: params validated, guards run, `onRequest` gates applied, the 426
declared), but the contract stopped there. `socket.send` took anything, frames
arrived as `string | Uint8Array`, and nothing was validated — so validation,
typing, and the whole contract-first premise ended at the handshake.

**`defineMessages(contract)`**, or a `messages` field on a route contract,
declares what flows over the connection. Two things a request/response contract
cannot express, and a socket needs: **direction** and **message identity**.

```ts
const chatMessages = defineMessages({
  clientToServer: { say: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] } },
  serverToClient: { said: { type: 'object', properties: { from: { type: 'string' } }, required: ['from'] } },
})
```

Directions are named for their endpoints rather than for the reader —
`send`/`receive` and `inbound`/`outbound` invert depending on which side reads
them, and both sides read this same declaration.

Messages are identified by a discriminator, `type` unless `discriminator` says
otherwise. Your schema describes the *payload*, and the tag is not part of it:
it is read to select the message, then removed before the payload is validated.
That keeps `additionalProperties: false` working, and composed schemas too — an
`allOf` branch or a `$ref` target that closes itself never sees a property it
did not declare. A schema that declares the discriminator itself is refused at
setup time, since it could only ever fail.

**`bindMessages(contract, socket, options?)`** wraps a server-side socket:
inbound frames validated against `clientToServer` and narrowed to a tagged
union, outbound `send` typed and serialized. It covers Bun, Workers, and Deno —
`accept(raw)` is the ingest seam for Bun, whose message handlers live outside
the request on `Bun.serve({ websocket })`, and sockets with `addEventListener`
are wired automatically.

**`connectMessages(contract, options)`** is the mirror image on the client,
over `connectRealtime` (WebTransport with the WebSocket fallback, unchanged).
The directions swap and nothing else does. It is exported from the browser-safe
`@amritk/api/client` entry; that entry's only external stays
`@amritk/runtime-validators`, now imported as a value rather than types alone —
it is eval-free and pulls in no `node:` built-in, and tree-shakes out of bundles
that do not use it.

A throwing `onInvalid` is swallowed and treated as "no opinion", so a broken
metrics call cannot stop a contract violation from being answered.

`bindMessages` sets `binaryType = 'arraybuffer'` on sockets that expose it.
Deno's defaults to `'blob'`, and a Blob only converts to bytes asynchronously —
which the message listener cannot await — so binary frames would have reached
`channel.binary` as empty buffers.

**Invalid frames close with `4007`** and a one-line reason, truncated to RFC
6455's 123-byte budget on a UTF-8 character boundary (overrunning it or
splitting a character makes implementations throw). Not RFC 6455's own 1007:
the WHATWG `close()` algorithm accepts only 1000 and 3000–4999 from a caller,
so a 1xxx code throws on Workers and Deno. `onInvalid` sees every
refusal — `malformed`, `binary`, `unknown-type`, `invalid-payload` — and may
return `'ignore'` to keep the connection open. Binary frames default to
`ignore` rather than `close`: nothing in a JSON contract describes them, but a
peer may legitimately send them alongside contract messages, and they stay
reachable on the raw socket.

Outbound messages are typed at compile time and validated only under
`validateOutbound`, matching what `validateResponses` does for handler replies.

Binary frames arrive on `channel.binary`, on both ends, behind an explicit
`receiveBinary` flag — nothing in a JSON contract describes them, but a peer
may legitimately send them alongside contract messages. The flag rather than a
first read, because frames arrive before a caller could subscribe and the queue
underneath is unbounded.

`messages` has no OpenAPI representation — OpenAPI has no vocabulary for a
bidirectional message union — so it never appears in the document, and it is
not part of the contracts hash either: `compileToModule` never emits message
schemas, so an edit to one cannot stale a compiled module.
