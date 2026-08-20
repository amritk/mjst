---
'@amritk/api': minor
---

Robustness and security fixes from a review pass over the package.

**`streamMultipart` releases the request body.** A consumer that stopped early
— `break` once it found the part it wanted, a throwing part handler, an early
return — left the reader locked and the source uncancelled, so the client kept
uploading into a buffer the server had walked away from. Every exit now
cancels, abandoned or complete. The same parser rescanned its whole pending
buffer for the header terminator after every chunk, which made a header block
delivered in small pieces cost up to `maxHeaderBytes` squared byte
comparisons; the scan now resumes where the last one ended.

**`toNodeHandler` reads request headers as own properties.** A contract
declaring a header named `constructor` or `__proto__` got the inherited
function or prototype instead of `undefined`, filled the slot with it, and
`400`ed every request that never sent the header — while the fetch adapter,
reading through `Headers`, answered `200`. The two adapters now agree.

**`formatSse` sanitizes `retry`.** `data`, `comment`, `event`, and `id` were
already guarded against a value carrying its own newlines; `retry` was not,
because it is typed as a number — and the type is the only thing saying so. A
handler passing a value that came out of a JSON payload could forge fields and
whole events. Only a finite integer is emitted now, which is all the SSE
grammar reads from the field.

**`createCompression` leaves partial responses alone and weakens strong
etags.** A `206` (or anything carrying `content-range`) describes a byte range
of the identity representation, so encoding the body left the header
describing a payload that was no longer being sent. And an `ETag` names one
representation: on a response it encodes, a strong tag is now weakened to
`W/`, the same thing nginx does.

**Breaking:** `toOpenApi` now throws when two routes claim the same OpenAPI
path and method. `/files/{p}` and `/files/{p+}` are distinct patterns to the
matcher and both serve, but the paths key drops the greedy marker, so the
later one silently overwrote the earlier and the document described half the
API. A synthesized `operationId` already caught that pair; explicit ones
walked past it. Give such routes distinct paths.

`secureRoutes` also looks security schemes up as own properties, so a
requirement naming `constructor` reports the missing scheme rather than a
missing guard, and the fetch adapter's `ResponseInit` cache is built once from
the contracts instead of filling itself with whatever status a handler
returned — the table `compileToModule` has always emitted.
