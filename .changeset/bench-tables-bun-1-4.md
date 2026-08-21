---
'@amritk/runtime-validators': patch
'@amritk/generate-validators': patch
'@amritk/generate-parsers': patch
'@amritk/resolve-refs': patch
'@amritk/lint': patch
'@amritk/yaml': patch
'@amritk/api': patch
---

Re-measure every published benchmark table on Bun 1.4.

The tables were labelled Bun 1.3 and predate both the runtime upgrade and this
release's interpreter work, so every one of them was re-run rather than
relabelled. All measurements come from one Linux x64 box with nothing else on
it, each package's own `bun run bench`, and the machine is named in each table's
caption — compare columns within a table, not against a figure you remember.

Three of them changed in ways a version label would have hidden:

- **`@amritk/lint`** — Spectral's JSONPath engine used to throw on the 2.8 MB
  OpenAI spec under Bun, so that row was published as mjst-only. It no longer
  throws, and the row is a real comparison now (~0.73 s against ~7.4 s). The
  bench keeps its guard, since that failure was runtime-specific.
- **`@amritk/api`** — Bun 1.4 made web-standard `Request`/`Response`
  construction far cheaper, which lifted every column of the Bun table (bare
  Hono went ~185k → ~503k ops/s). The compiled engine still leads the
  like-for-like `hono + zod` column on Bun and Node, but it no longer leads
  *unvalidated* Hono on the GET cases, and under workerd it now trails
  `hono + zod` on the static GET. The prose says so.
- **`@amritk/runtime-validators`** — the interpreter is much faster than when
  the ratios against Ajv were written, so the cold-path win narrows to ~96–870×
  (from ~90–1600×) and the steady-state loss narrows to ~6–11× (from ~15–25×).

`@amritk/generate-parsers`, `@amritk/generate-validators`, `@amritk/resolve-refs`
and `@amritk/yaml` keep the same shape and conclusions with refreshed numbers.
