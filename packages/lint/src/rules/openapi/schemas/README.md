# OpenAPI structural meta-schemas

These are the official OpenAPI JSON Schema documents from
[spec.openapis.org](https://spec.openapis.org/oas/), vendored as raw `.json`
files. `scripts/generate-schema-modules.mjs` turns each one into the sibling
`.ts` module that [`index.ts`](./index.ts) imports — a static import so the
package can be bundled, and so it runs where `createRequire` does not exist
(Workers, Deno). The build fails if a `.json` file and its module drift apart.
They back the `oas2-schema` / `oas3-schema` / `oas3_1-schema` / `oas3_2-schema`
rules.

| File | Source | Adaptation |
| --- | --- | --- |
| `oas31.json` | `https://spec.openapis.org/oas/3.1/schema/2025-11-23` | **none** — verbatim |
| `oas32.json` | `https://spec.openapis.org/oas/3.2/schema/2025-11-23` | **none** — verbatim |
| `oas30.json` | `https://spec.openapis.org/oas/3.0/schema/2024-10-18` | **none** — verbatim |
| `oas20.json` | `https://spec.openapis.org/oas/2.0/schema/2017-08-27` | external draft-04 metaschema `$ref`s inlined as local `definitions` (see below); top-level `id` and `$schema` removed |

## Why these run without a dialect engine

`@amritk/runtime-validators` is a JSON Schema 2020-12 interpreter that resolves
**local** references (JSON Pointer, `$anchor`, and `$dynamicRef`/`$dynamicAnchor`)
but never fetches remote documents.

- **3.1 / 3.2** are 2020-12 schemas that are already fully self-contained: they
  express the Schema Object via a local `$dynamicRef: "#meta"`, which the
  interpreter binds natively. They drop in unchanged.
- **3.0** is a draft-04 schema but is also self-contained (only internal
  `#/definitions/...` refs). The interpreter runs it verbatim — its draft-04
  `id` / `$schema` keywords are simply ignored, and it produces identical
  verdicts to a hand-adapted copy on the real-world specs tested.
- **2.0** is the one exception: its draft-04 schema `$ref`s an *external*
  metaschema (`http://json-schema.org/draft-04/schema#/...`) for ~15 numeric and
  string facet definitions. The interpreter throws on those unresolvable remote
  refs, so `oas20.json` inlines them as local `definitions` and drops the top-level
  `id` and `$schema` keys — the only file that differs from its upstream source.

## Refreshing

For 3.0 / 3.1 / 3.2, re-download the URL above and replace the file verbatim.
For 2.0, re-inline the external draft-04 metaschema fragments the schema
references (they are stable — the draft-04 metaschema has not changed).

Then regenerate the modules and commit both the `.json` and the `.ts`:

```sh
cd packages/lint && node scripts/generate-schema-modules.mjs
```
