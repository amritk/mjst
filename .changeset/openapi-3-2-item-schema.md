---
'@amritk/api': minor
---

Generate OpenAPI 3.2 documents, and document streaming responses per item.

**The document now declares `openapi: '3.2.0'`** (was `'3.1.0'`). The schema
dialect is unchanged — 3.2 still embeds JSON Schema Draft 2020-12 verbatim —
so no contract or schema has to move. `OpenApiDocument['openapi']` is typed
`'3.2.0'`, which is the breaking part: code asserting the literal `'3.1.0'`
stops compiling, and a consumer pinned to a 3.1-only validator or SDK
generator will need one that reads 3.2.

**`itemSchema` on a response contract.** A raw `contentType` says what a
stream *is*; `itemSchema` says what each item in it looks like, which is what
a consumer reading the stream incrementally needs. Declare it beside
`contentType` on a sequential media type — `text/event-stream`,
`application/jsonl`, `application/json-seq`, `multipart/mixed` — and it lands
next to `schema` in the media type object. Both may be declared: the payload
as a whole and the shape of one item.

Like a `body` schema on a raw status it is documentation only — adapters pass
the stream through untouched, so nothing here is validated at runtime — but it
does take part in `components.schemas` hoisting, so a titled event schema
shared across routes appears once and is `$ref`erenced.

Declaring `itemSchema` without a `contentType` now throws at document-build
time. It described a sequential media type the status never named, so the
emitter silently dropped it while hoisting still collected it — leaving an
orphan in `components.schemas`, and letting a title collision from a schema
that never reached the document un-hoist a real shared one back inline.

**`sseItemSchema(dataSchema, options?)`** builds that schema for SSE, where
the item is the event *envelope* (`event`, `id`, `data`, `retry`) with the
payload inside `data` rather than the payload itself. `data` is typed as the
schema given, `{ event: 'token' }` pins the event name as a `const`, and
`{ id: true }` marks a resumable stream. Neither `data` nor `id` is ever
required: a keep-alive frame carries no data, and requiring it would make the
document reject frames the stream legitimately sends.

**Removed: the Hey API (`@hey-api/openapi-ts`) integration test** and its
devDependency. It was never a dependency of the package — only a test
asserting the generated document was valid input to one SDK generator — and
holding the document at 3.1 to keep that generator happy is the wrong trade
when `createClient` already derives the first-party typed client from the
contracts with no codegen. External consumers still generate from the served
document with whatever tooling they use.
