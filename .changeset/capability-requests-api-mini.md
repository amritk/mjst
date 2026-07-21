---
"@amritk/api": minor
"@amritk/mini": minor
---

Close a batch of capability gaps found migrating a real admin dashboard onto
`@amritk/api` and `@amritk/mini`, all backward-compatible.

**`@amritk/api`**

- **All-optional query (and cookie) slots are optional at the call site.** When
  every property of a declared `query`/`cookies` schema is optional (no
  `required`), the slot — and, when it is the only declared slot, the whole
  input argument — is now optional in `ClientInput`, folded into `RequiredKeys`
  the same way a fully-absent slot already is. A GET whose query params are all
  optional type-checks as `client.listThings()`. `params` (the path needs them)
  and `body` (declaring it makes a body required) stay strictly required.
- **Raw `text` / `bytes` request bodies.** `bodyType` gains `'text'` and
  `'bytes'`: the body is validated verbatim against the schema and handed to the
  handler as a `string` (decoded) or a `Uint8Array`, and the typed client sends
  the call's `body` on the wire unchanged under a raw content type you can
  override per call via `headers` — a `text/csv` or binary upload that stays
  inside the typed contract and client. Both engines and the OpenAPI document
  understand it; the 415 check is lenient (`text/*` for text, any media type for
  bytes) so the schema is the gate.
- **`mounts` handlers receive `env` and `executionContext`.** Prefix-mounted
  sub-handlers (`toFetchHandler` and the compiled engine) are now called with
  the platform arguments as well as the `Request`, so an env-dependent
  sub-router — Better Auth on Cloudflare Workers, where secrets and the DB URL
  live on `env` — can build its instance inside the mount. Existing
  `(request) => Response` mounts keep working.

**`@amritk/mini`**

- **`bindSelect(node, model)`** — two-way binding between a `<select>` and a
  string signal, the dropdown analogue of `bindValue`/`bindChecked`: it sets
  `.value` (the property, so the option actually selects) and writes back on
  `change`.
- **More typed form-control attributes.** `<input>` gains `name`, `checked`,
  `accept`, `min`, `max`, `step`, `multiple`, and `readonly`; `<textarea>` gains
  `name`, `required`, and `readonly` — so file, number, and checkbox inputs stop
  needing `ref` + `setAttribute`.
