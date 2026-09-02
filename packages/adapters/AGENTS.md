# AGENTS.md — @amritk/adapters

Contributor guide for AI agents editing **this package**. Repo-wide rules:
[`../../AGENTS.md`](../../AGENTS.md). Consuming the package? See [`AI.md`](./AI.md).

Converts TypeBox / Zod / Valibot / Effect schemas — and Apache Avro `.avsc`
documents — into Draft 2020-12 JSON Schema.

## Commands

```bash
bun run --filter='@amritk/adapters' test
bun run --filter='@amritk/adapters' types:check
```

## Invariants — do not break these

- **No barrel export — one subpath per adapter.** Each `@amritk/adapters/<name>`
  maps to a single file. `getAdapter` is the runtime dispatcher. Don't add a `.`
  root entry.
- **Source libraries (zod/valibot/effect/typebox) are optional peer deps,
  imported dynamically** inside each adapter — never import them at module top
  level, or you'll force every consumer to install all four. Avro has no peer
  dep at all and must keep it that way: an `.avsc` is JSON, so the conversion is
  implemented here rather than delegated.
- **Avro's two encodings are both load-bearing — never collapse them.** `'json'`
  describes the decoded object the application sees; `'avro-json'` describes the
  spec's JSON encoding (branch-tagged union wrappers, latin-1 bytes, every field
  required, because Avro has no optional fields). The second exists so an
  AsyncAPI `examples.payload` under `application/vnd.apache.avro+json` can be
  validated; dropping it silently mis-describes real wire data.
- **A `long` stays unbounded and date/time logical types stay integers.** Both
  look like gaps and are deliberate: ±2^63 does not fit in a JSON number, and
  Avro encodes `timestamp-millis` as a `long` in JSON as much as in binary.
- **`getAdapter('json')` must throw** (JSON needs no adapter). Keep the error
  actionable.
- Unrepresentable constructs widen to `{}` with a `[mjst]` stderr warning
  (Effect throws on nested ones); `strict: true` throws instead. Keep both modes.

Add a changeset for every change (`bunx changeset`).
