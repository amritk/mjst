# @amritk/asyncapi

## 0.1.0

### Minor Changes

- 21145a6: The generate pipeline now consumes AsyncAPI documents: `mjst --input asyncapi
--schema api.yaml --out-dir src/generated` walks an AsyncAPI 2.0–2.6 or 3.0
  document (JSON or YAML) and generates parsers — plus `--validators`,
  `--examples`, `--build`, and the rest of the existing flags — for **every
  message payload and headers schema** it declares, each in its own
  `channels/<channel>/<message>[-headers]/` subtree, exactly the way
  `--schema-dir` gives each schema file its own directory.

  **What "consumes" means, concretely.** A new `@amritk/asyncapi` package (this
  release) does the document work, and it is usable on its own
  (`extractAsyncApi(document)` → normalized model, `listMessageSchemas(model)` →
  generator inputs; no I/O, parsing and cross-file `$ref` resolution stay the
  caller's job):

  - Both majors normalize into one 3.0-shaped model. 2.x `publish` becomes
    `receive` and `subscribe` becomes `send` — directions named from the
    application's point of view, the same convention as `@amritk/api`'s message
    contracts, and the reason AsyncAPI 3.0 renamed the pair itself.
  - Message and operation traits are shallow-merged _before_ `schemaFormat` is
    read, so a trait-contributed format gates its payload like an inline one.
  - Payloads are normalized to the JSON Schema 2020-12 the generators expect:
    the AsyncAPI default dialect (a draft-07 superset) and declared draft-07 go
    through the draft-07 upgrade, OpenAPI-format payloads get `nullable` folded
    into `type`, declared 2020-12 passes through. 3.0 Multi Format Schema
    Objects are unwrapped.
  - Every `$ref` into `#/components/schemas/...` is rebased into a local
    `$defs` with the referenced components copied in transitively, so each
    extracted schema is **self-contained** — and still yields one named type
    per component rather than an inlined blob.
  - A payload whose `schemaFormat` is not a JSON Schema dialect (Avro,
    Protobuf, RAML, …) is skipped with a warning naming the message and format;
    the document's other messages still generate. Only a document yielding
    nothing generatable fails the run.

  **`mjst lint` grows preset names.** `--ruleset asyncapi` (aliases
  `loupe:asyncapi`, `spectral:asyncapi`) and `--ruleset oas` (aliases
  `loupe:oas`, `spectral:oas`) now resolve to the built-in presets from
  `@amritk/lint/rules/*` — previously the presets shipped in the library but the
  CLI could only load ruleset _files_, so linting an AsyncAPI document from the
  CLI meant writing a JS ruleset by hand. Unknown names still resolve as file
  paths.

  **`@amritk/adapters`**: `SourceFormat` gains `'asyncapi'`. It is a
  document-on-disk format like `'json'`, not an adapter — `getAdapter('asyncapi')`
  still throws, and the CLI branches before reaching it.

  Flag interactions: `--input asyncapi` rejects `--schema-dir`, `--out-file`,
  `--root-type`, and `--export`, each with an error saying why. Root type names
  come from message identity (`lightMeasured` → `LightMeasured`), never the
  schema `title` — two messages titled "Event" stay distinct. Colliding output
  names dedupe deterministically (`-2`, `-3`, …) with a warning rather than
  failing, because documents in the wild collide.

  **`@amritk/helpers`**: `upgradeDraft07Schema` now merges the renamed
  `definitions` into an authored `$defs` block instead of replacing it — a
  draft-07 document carrying both no longer loses every authored entry (and the
  refs pointing at them) during the upgrade.

  This is phase one of AsyncAPI support: generating `defineMessages`-compatible
  channel contracts, and projecting AsyncAPI documents _from_ `@amritk/api`
  route contracts, are the planned follow-ups.

### Patch Changes

- Updated dependencies [21145a6]
- Updated dependencies [eb425fe]
- Updated dependencies [c8cb8b0]
  - @amritk/helpers@0.19.0
