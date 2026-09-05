# @amritk/adapters

## 0.6.0

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

## 0.5.2

### Patch Changes

- Updated dependencies [049b0e9]
  - @amritk/helpers@0.18.0

## 0.5.1

### Patch Changes

- Updated dependencies [5e45680]
- Updated dependencies [69fa1f6]
  - @amritk/helpers@0.17.0

## 0.5.0

### Minor Changes

- 14d06c8: Add an Apache Avro adapter at `@amritk/adapters/avro-to-json-schema`, wired into
  the CLI as `--input avro`.

  Avro is the schema language most event-driven APIs actually use, and it is the
  one format here with no JSON Schema exporter to delegate to — so the conversion
  is implemented in full. It still adds **no dependency**: an `.avsc` is already
  JSON, so there is nothing to parse that `JSON.parse` does not.

  ```ts
  import { avroToJsonSchema } from "@amritk/adapters/avro-to-json-schema";

  const jsonSchema = avroToJsonSchema(JSON.parse(avsc));
  ```

  ```sh
  mjst --schema user.avsc --input avro --out-dir ./generated
  ```

  Every named type (`record`, `enum`, `fixed`) is defined once under its
  **fullname** in `$defs` and referenced by `$ref` everywhere it appears, so a
  recursive type stays finite and `com.example.User` generates a `ComExampleUser`
  type rather than an inline shape repeated at each use site. Unlike the other
  formats, `--schema` points at the JSON document itself rather than a JS/TS
  module — nothing is imported, so `--export` does not apply.

  **Pick the encoding you mean.** Avro is a binary format with a _separately
  specified_ JSON encoding, and the two readings of "the JSON for this schema"
  genuinely disagree, so the adapter makes you choose:

  | `encoding`           | Describes                                                                  | Unions                                                   | `bytes`                   | Fields with a `default` |
  | :------------------- | :------------------------------------------------------------------------- | :------------------------------------------------------- | :------------------------ | :---------------------- |
  | `'json'` _(default)_ | the object your application code sees                                      | plain `anyOf`; `["null", T]` collapses to a nullable `T` | base64                    | optional                |
  | `'avro-json'`        | the spec's JSON encoding, as sent under `application/vnd.apache.avro+json` | single-key wrappers tagged with the branch's fullname    | codepoint-per-byte string | required                |

  The `default` column is not a style choice. Avro has **no optional fields** —
  every declared field is present in the encoding, and a `default` is only
  consulted during schema resolution, when reading data written against a
  _different_ schema. So `'avro-json'` marks every field required, because that is
  what is on the wire, while `'json'` treats a defaulted field as optional,
  because that is the shape application code deals with. For the same reason a
  latin-1 byte `default` is dropped under `'json'` rather than mistranslated:
  `default` is not annotation-only here, since `@amritk/generate-parsers` coerces
  with it.

  Two mappings look like gaps and are deliberate:

  - **A `long` gets no bounds.** Its range is ±2^63, which no JSON number can
    represent — a stated `maximum` would round to 2^63 and be both wrong and
    unreachable. An `int` _is_ bounded, since ±2^31 lands exactly on a double.
  - **Date and time logical types stay integers.** Avro encodes
    `timestamp-millis` as a `long` in its JSON encoding as much as in binary, so
    `format: 'date-time'` would describe a string that never arrives. Only `uuid`
    narrows its base type.

  The default **value** is translated, not copied: Avro states a union's default as
  a bare value of its first branch, so under `'avro-json'` it is wrapped to match
  the branch tagging the data uses (`null` stays bare), and under `'json'` a
  latin-1 byte default is dropped rather than mistranslated into base64. Both rules
  apply at any depth, and a byte value anywhere inside a default drops the whole
  default — a half-translated one is worse than none.

  `decimal` and `duration` degrade to their base type and are reported through the
  existing widening warning (`strict: true` throws instead). An unrecognised
  `logicalType` falls through to its base type silently, which the Avro spec
  requires, as does one declared on a base it is not defined for. Names are
  validated against the spec's pattern, since a name is written straight into a
  `$defs` key and the `$ref` pointing at it. `aliases` and field `order` describe how _two_ schemas relate during
  resolution and have no place in a single document's shape, so they are ignored.
  A duplicate name, a reference to an undefined name, or a malformed
  `record`/`enum`/`fixed` throws rather than converting to something wrong.

### Patch Changes

- Updated dependencies [1c328af]
- Updated dependencies [1fd154c]
- Updated dependencies [3557eb5]
- Updated dependencies [11a280f]
- Updated dependencies [e091f22]
- Updated dependencies [3a54baf]
- Updated dependencies [543fbe8]
- Updated dependencies [c6a1f16]
- Updated dependencies [261f650]
  - @amritk/helpers@0.16.0

## 0.4.4

### Patch Changes

- 34c5eaf: Stop the tuple normalizers from rewriting instance data, and from making
  optional tuple positions required.

  Both walked every value, `enum`/`const`/`default`/`examples`/`example`
  included — but those hold values the schema _describes_. A Zod
  `.default({ items: ['a', 'b'] })` came out as
  `default: { prefixItems: ['a','b'], minItems: 2, items: false }`: a different
  default than the author wrote, handed to consumers as theirs. The walk is
  position-aware now — `@amritk/helpers`' shared position predicates, so it
  cannot drift from the walkers that share them — which also means a property genuinely _named_
  `default` or `examples`, and a draft-07 `dependencies` entry named `items`, are
  treated as the names they are rather than as keywords.

  `enforceTupleLength` raised an explicit `minItems` to the tuple's length. An
  explicit `minItems` is the author saying which trailing positions are optional
  — Effect's `optionalElement` emits exactly that — so raising it made those
  positions required and rejected arrays the source schema accepts. Only a
  missing `minItems` is filled in, and only for a non-empty tuple — stamping
  `minItems: 0` onto an empty one would put a keyword in the output that the
  source never declared. Every `items`/`additionalItems`/`prefixItems` read is
  an own-property read, since a polluted `Object.prototype.items` made every
  node look like a tuple — `items: false` was never written, and nodes gained a
  tuple bound they never declared.

- Updated dependencies [34c5eaf]
  - @amritk/helpers@0.15.4

## 0.4.3

### Patch Changes

- Updated dependencies [36f03a2]
  - @amritk/helpers@0.15.3

## 0.4.2

### Patch Changes

- Updated dependencies [2e3399a]
  - @amritk/helpers@0.15.2

## 0.4.1

### Patch Changes

- 4178e8d: Patch release across all packages.
- Updated dependencies [4178e8d]
  - @amritk/helpers@0.15.1

## 0.4.0

### Minor Changes

- 2c9982c: Fix the published manifests so the packages install, resolve, and dedupe correctly

  **Types resolve on TypeScript's default config.** Every package was
  exports-only: nine declared `"module": "./dist/index.js"` (a field neither Node
  nor TypeScript reads) and nothing declared `types`. A consumer on
  `moduleResolution: "node10"` — still the default when `module` is `commonjs` —
  cannot see `exports` at all, so `import { lintDocument } from '@amritk/lint'`
  failed with `TS2307: Cannot find module '@amritk/lint' or its corresponding type
declarations`. Each package with a `.` export now also declares `main` and
  `types`; `@amritk/helpers` and `@amritk/adapters` have no `.` export (they are
  subpath-only), so they declare a `typesVersions` wildcard mapping instead, which
  gives their subpaths the same node10 fallback. All of it is ignored under
  `node16`/`nodenext`/`bundler`, where `exports` still wins.

  **`workspace:*` resolves to a caret, not an exact pin.** All fourteen
  inter-package edges shipped as exact versions, so installing two `@amritk/*`
  packages published at different times pulled in two copies of their shared
  dependency. That is not merely wasteful: the module-level caches those packages
  rely on are per-copy, so the `WeakMap` validator cache in
  `@amritk/runtime-validators` silently stopped hitting. Pre-1.0 a caret stays
  narrow (`^0.9.1` is `>=0.9.1 <0.10.0`) and breaking changes here already ride a
  minor bump.

  **`@amritk/helpers` stops shipping 21 source files it does not need.** Embedded
  mode reads four helper sources (`is-object`, `validate-array`,
  `validate-record`, `has-ref`) out of the installed package at generation time,
  so `src` has to ship — but only those four. `files` now lists them explicitly
  instead of globbing all of `src`, cutting the tarball from 78 files / 206 kB to
  63 / 112 kB.

  **Two packages no longer declare a dependency they never import.**
  `@amritk/mjst` and `@amritk/generate-parsers` both listed
  `@amritk/generate-markdown` under `dependencies`, but the only importer is each
  package's `scripts/generate-readme.ts`, which is not published. Both moved to
  `devDependencies`. `@amritk/adapters` likewise dropped its
  `@sinclair/typebox` peer dependency: the TypeBox adapter is purely structural
  (it strips symbol keys) and imports nothing. `valibot` stays — it is a genuine
  transitive peer of `@valibot/to-json-schema`.

  **`@amritk/mjst` fixes.** `json-schema-typed` moved to `dependencies`, because
  the shipped `dist/emit-examples.d.ts` imports types from it. The package gained
  an `exports` map, so it is no longer deep-importable in its entirety. And the
  build now marks `dist/cli.js` executable: `npm pack` records on-disk modes, and
  package managers only `chmod` bin targets when they link them, so flows that
  consume the tarball directly (vendoring, Docker `npm pack` + `tar -x`) hit
  `EACCES`.

### Patch Changes

- Updated dependencies [213ecc4]
- Updated dependencies [9cb45a0]
- Updated dependencies [5afbfd4]
- Updated dependencies [eb80ca6]
- Updated dependencies [2c9982c]
- Updated dependencies [f439570]
- Updated dependencies [fa8620c]
  - @amritk/helpers@0.15.0

## 0.3.6

### Patch Changes

- 65771d4: Repair the workspace type check and complete the published manifests

  `bun run types:check` had been failing for three packages and nothing in CI ran
  it. `@amritk/lint`, `@amritk/runtime-validators`, and `@amritk/yaml` were the
  only tsconfigs without the `**/*.test.ts` exclude the other nine carry, so their
  test files pulled the shared OpenAPI fixture loader into the program, where its
  `@amritk/resolve-refs` / `@amritk/yaml` imports do not resolve from the repo
  root. CI now runs `types:check` alongside the lint and test steps.

  Every package declares `engines: { node: '>=20' }`, matching the Node target the
  CLI already emits for, so an install on an older runtime warns instead of
  failing at run time. Every library also declares `sideEffects: false` so bundlers
  can tree-shake them — relevant to `@amritk/runtime-validators`, `@amritk/lint`,
  and `@amritk/yaml`, which are built to ship into browsers and Workers. The CLI
  is excluded: its bin runs on import.

  `@amritk/runtime-validators` no longer depends on `json-schema-typed`. It never
  imported the package, and the dependency was installed by every consumer of the
  one package whose design goal is staying self-contained.

- Updated dependencies [65771d4]
- Updated dependencies [fe8191b]
  - @amritk/helpers@0.14.0

## 0.3.5

### Patch Changes

- 217cb66: `FromSchema` now honours the `x-mjst` `brand` hint, so branded ids reach the API
  boundary.

  - **`@amritk/runtime-validators`** — a schema carrying
    `'x-mjst': { brand: 'UserId' }` now infers `Base & { readonly __brand: 'UserId' }`
    (e.g. `string & …`), matching the `.d.ts` shape the code generators already
    emit. Branding stays type-level only — runtime validation still checks the
    plain base type — and `null` remains assignable when a `nullable` schema is
    branded.
  - **`@amritk/api`** — because route `params` / `query` / `body` are typed through
    `FromSchema`, a branded param schema now flows a nominal id into the handler and
    the derived typed client, so a `UserId` can't be passed where an `OrderId` is
    expected. The same protection Drizzle's `.$type<UserId>()` gives a column, at
    the API boundary.
  - **Docs** — the `x-mjst` reference now documents the `brand` hint (a new
    "Nominal brands" section in `@amritk/adapters`), with recipes in the
    `@amritk/api` README/AI.md and the `@amritk/runtime-validators` type-inference
    docs, plus the `mjst-extension` subpath in `@amritk/helpers`.

- Updated dependencies [217cb66]
  - @amritk/helpers@0.13.5

## 0.3.4

### Patch Changes

- 1901231: Ship AI-agent-facing docs. Each package now includes an `AI.md` in its published
  tarball — a mental model, a minimal runnable example, and the gotchas most
  likely to trip up an LLM — and gains `@example` JSDoc on its primary exports. A
  root `llms.txt` / `llms-full.txt` (generated by `bun run generate-llms`) indexes
  them, and `@amritk/mini` adds a `check:reactivity` guard for the compilerless-JSX
  "called signal" footgun.
- Updated dependencies [1901231]
  - @amritk/helpers@0.13.4

## 0.3.3

### Patch Changes

- 6e7c65e: Slim published packages — comments are now stripped from the compiled JS in `dist` (they were duplicating the JSDoc that already ships in the `.d.ts` files, which is what editors read), and `@amritk/lint` now minifies its bundled OpenAPI meta-schema JSON documents. Unpacked size drops ~30% across the board (for example `@amritk/lint` 448 kB → 307 kB, `@amritk/generate-parsers` 293 kB → 191 kB) with no behavior change: declaration files keep their docs, `/* @__PURE__ */` annotations and the CLI shebang survive, and `@amritk/helpers` still ships its TypeScript sources for embedded mode.
- Updated dependencies [6e7c65e]
  - @amritk/helpers@0.13.3

## 0.3.2

### Patch Changes

- 4e23c02: Packaging fixes across all published packages: the `types` export condition now precedes runtime conditions (`default`/`import`) so TypeScript resolves the declared `.d.ts` explicitly instead of relying on file adjacency, and published tarballs now include the LICENSE file (copied in during the publish job).
- Updated dependencies [4e23c02]
  - @amritk/helpers@0.13.2

## 0.3.1

### Patch Changes

- df10916: Fix the Effect adapter emitting draft-07 tuples that downstream generators under-validate. `JSONSchema.make` (and the adapter's structural rescue path) express a fixed tuple as `items: [...]` + `additionalItems`, but the mjst pipeline recognizes a tuple only by 2020-12 `prefixItems` — so `Schema.Tuple(Schema.String, Schema.Number)` produced an array whose element types and length were never checked. The adapter now normalizes tuples to `prefixItems` and restores the length bound, matching the Zod and Valibot adapters. The tuple-normalization helpers are now shared between the Zod and Effect adapters instead of living privately in the Zod one.
- 797a156: Fix a batch of correctness bugs found in a cross-package audit:

  - **`@amritk/lint`**: the `alphabetical` rule compared decimal numeric strings lexically because of an inverted numeric guard, flagging correctly-ordered lists like `["9.5", "10"]` and missing genuinely out-of-order ones. Numeric strings now compare numerically on both sides.
  - **`@amritk/mjst`** (CLI): the `validators` key in a JSON config file was silently ignored, so `validators: true` in a config never emitted `validateX`/`isX` files. It is now read like every other boolean flag.
  - **`@amritk/runtime-validators`**:
    - `minContains: 0` together with `maxContains` no longer wrongly rejects arrays under `unevaluatedItems` (it now marks the array evaluated, matching Ajv).
    - the `ipv6` format now accepts IPv4-mapped / IPv4-embedded addresses (e.g. `::ffff:192.168.0.1`), rebuilt from the RFC 4291 grammar.
    - local `$ref` fragments are percent-decoded per RFC 6901 §6, so a ref like `#/$defs/a%20b` resolves to the key `a b` instead of throwing.
  - **`@amritk/helpers`**: `escapeRegexPattern('')` now emits `(?:)` instead of an empty body, so a schema `pattern: ""` no longer generates `//.test(...)` (a comment) that breaks the generated file. This also fixes the empty-pattern case in generated parsers and validators.
  - **`@amritk/generate-examples`**: integer arbitraries now round fractional bounds (`minimum: 2.5`, `exclusiveMinimum: 5.5`) to satisfiable integers instead of handing `fc.integer` a non-integral bound that throws at sample time; number arbitraries honour the tighter of an inclusive/exclusive bound pair instead of dropping the exclusive one.
  - **`@amritk/generate-validators`**: schema-controlled property names are now escaped when embedded in generated error-path template literals, so a key containing a backtick or `${…}` can no longer break compilation or inject an interpolation; paths also JSON-Pointer-escape `~` and `/` to match the interpreter.
  - **`@amritk/adapters`**: the Valibot adapter now targets Draft 2020-12, so tuples emit `prefixItems` (validated downstream) instead of draft-07 `items: [...]` (silently under-validated).

- Updated dependencies [797a156]
  - @amritk/helpers@0.13.1

## 0.3.0

### Minor Changes

- 29b7a18: Bring the Valibot adapter to parity with Zod for lossy conversions, and add an
  opt-in strict mode to both.

  - The Valibot adapter previously ran `@valibot/to-json-schema` in
    `errorMode: 'warn'` and let that library log widening in its own words, one
    line per construct — from mjst's side, Valibot widening was effectively
    invisible. It now runs the converter in `errorMode: 'ignore'`, collects the
    constructs it could not represent (unrepresentable schema types that degrade
    to an open schema, plus refinements like flagged regexes that JSON Schema
    cannot express) via the converter's override hooks, and emits a single
    batched, `[mjst]`-branded `console.warn` — the same style the Zod adapter
    already uses. `date` and `bigint` remain rescued into the shared `x-mjst`
    hint and are never reported as lossy.
  - Both `zodToJsonSchema` and `valibotToJsonSchema` now accept an
    `{ strict?: boolean }` options argument (surfaced on the shared `Adapter`
    type as `AdapterOptions`). In strict mode a construct that cannot be fully
    represented throws instead of silently widening the generated type.

- 5d89429: Add a Zod 3 fallback to the Zod adapter. When the installed `zod` lacks the
  native `toJSONSchema` (Zod 3), the adapter now routes conversion through the
  optional `zod-to-json-schema` peer dependency, applying the same `x-mjst`
  date/bigint mapping and lossy-type warnings as the Zod 4 path. If neither Zod 4's
  `toJSONSchema` nor `zod-to-json-schema` is available, a clear error explains what
  to install.

### Patch Changes

- 815f9ab: Declare `@sinclair/typebox` as an optional peer dependency (`>=0.34`).

  The TypeBox pass-through adapter (`typebox-to-json-schema`) relied on TypeBox's
  plain-object schema shape but had no `peerDependencies` entry, so there was no
  version signal or guard for it. Adding the optional peer (mirroring the
  `peerDependenciesMeta` pattern already used for zod, valibot,
  `@valibot/to-json-schema`, and effect) records the supported range and lets
  package managers surface an incompatible TypeBox version instead of failing
  silently on a future shape change.

- 88b549a: fix: the Effect adapter now rescues nested `Schema.BigIntFromSelf` /
  `Schema.DateFromSelf` instead of throwing. Previously only a top-level bigint or
  runtime `Date` was mapped to an `x-mjst` hint, so a `BigIntFromSelf` /
  `DateFromSelf` buried inside a struct, array, or union made `JSONSchema.make`
  fail outright — unlike the Zod, Valibot, and TypeBox adapters, which handle
  nested date/bigint fine. The rescue is now recursive: representable subtrees are
  still converted verbatim by Effect, and only the branches leading to an
  unrepresentable leaf are walked to attach `x-mjst` `primitive: 'bigint'` /
  `instanceOf: 'Date'` hints at the corresponding nested paths. The documented
  encoded-representation semantics for `Schema.Date` (a string) are unchanged.
- Updated dependencies [9bf3330]
- Updated dependencies [e612130]
  - @amritk/helpers@0.13.0

## 0.2.16

### Patch Changes

- Updated dependencies [1bb7a25]
  - @amritk/helpers@0.12.0

## 0.2.15

### Patch Changes

- Updated dependencies [91dab2b]
- Updated dependencies [9253843]
  - @amritk/helpers@0.11.0

## 0.2.14

### Patch Changes

- Updated dependencies [02f6b05]
  - @amritk/helpers@0.10.3

## 0.2.13

### Patch Changes

- 4501ff0: Robustness fixes across the CLI and peripheral generators:

  - **generate-examples**: recursive schemas now emit lazily-tied fast-check
    arbitraries (`fc.letrec`) instead of code that crashed with a TDZ
    `ReferenceError`; `pattern`s are escaped so a `/` no longer breaks the emitted
    regex literal, and `minLength`/`maxLength` are honored alongside a pattern;
    tuples, `allOf`, `additionalProperties`, and combined `minimum`+`exclusiveMinimum`
    bounds are handled.
  - **cli**: config files no longer silently drop the `helpers`/`typeSuffix`/`banner`
    keys; unknown or value-missing flags now error instead of being ignored; schema
    discovery skips `node_modules` and dot-directories; a missing `npx`/`tsc` is
    distinguished from a real compile failure.
  - **generate-markdown**: `x-icon` is HTML-escaped, and a README missing its
    markers is no longer clobbered with a table-only file.
  - **exports** maps now order the `types` condition before `default` so type
    resolution works.

- Updated dependencies [1efd6e8]
- Updated dependencies [c288a90]
  - @amritk/helpers@0.10.2

## 0.2.12

### Patch Changes

- Updated dependencies [7d43e6f]
  - @amritk/helpers@0.10.1

## 0.2.11

### Patch Changes

- e57d6ca: Two more adapter fidelity fixes:

  - **Effect**: a top-level `Schema.BigIntFromSelf` / `Schema.DateFromSelf` now
    converts to the shared `x-mjst` hint (`primitive: 'bigint'` / `instanceOf:
'Date'`) instead of throwing, matching the Zod, Valibot, and TypeBox adapters.
    A nested unrepresentable bigint/Date now throws an actionable error pointing at
    the string-encoded `Schema.BigInt` / `Schema.Date` or a `jsonSchema` annotation.
  - **Zod**: an object intersection (`z.intersection` / `.and`) emitted an `allOf`
    of two `additionalProperties: false` objects, which is unsatisfiable (each
    branch rejects the other's keys). When every `allOf` branch is a closed object
    the adapter now merges them into one object — properties unioned, `required`
    unioned, `additionalProperties: false` kept. Non-object intersections (e.g. two
    refined strings) are left as an `allOf`.

- b6e103d: Enforce tuple length in the Zod adapter. Zod 4's `toJSONSchema` emits a fixed
  tuple as a bare `prefixItems` array with no length bound, so the converted schema
  accepted arrays that were too short (trailing positions went unchecked) or too
  long (nothing forbade extra items) — values the Zod schema itself rejects. The
  adapter now restores the constraint: `minItems` requires the fixed elements, and
  a tuple with no `.rest(...)` gets `items: false` to forbid extras. Tuples with a
  rest element keep their open tail. Applied to every `prefixItems` node, so nested
  tuples are fixed too.

## 0.2.10

### Patch Changes

- Updated dependencies [cdfe681]
  - @amritk/helpers@0.10.0

## 0.2.9

### Patch Changes

- Updated dependencies [b0c83e7]
  - @amritk/helpers@0.9.0

## 0.2.8

### Patch Changes

- 51c2032: Close package gaps and add performance improvements.

  - **resolve-refs:** the SSRF guard now follows redirects manually and re-checks
    every hop (an allow-listed host can no longer bounce to a private/metadata
    address), and detects IPv4-mapped IPv6 and decimal/octal/hex IPv4 encodings.
    Concurrent loads of the same remote URL are coalesced onto one request.
  - **runtime-validators:** adds `unevaluatedProperties` / `unevaluatedItems`
    (annotation tracking across `$ref`/`allOf`/`if`-`then`-`else`/`anyOf`/`oneOf`/
    `dependentSchemas`, matching Ajv), and a linear `uniqueItems` fast-path for
    all-primitive arrays.
  - **generate-validators:** validates `const`, `dependentRequired`, and
    `propertyNames` (pattern form); regex `pattern`s are now correctly escaped so
    patterns containing `/` (or backslashes) emit compiling literals.
  - **generate-parsers:** corrects regex `pattern` escaping (backslashes are no
    longer doubled, which previously turned `\d` into a literal backslash) via the
    shared `@amritk/helpers/escape-regex-pattern`.
  - **helpers:** new `escape-regex-pattern` export and `hasDependentRequired` /
    `hasPropertyNames` guards; `resolveDynamicRefs` now rewrites `$dynamicRef`s
    nested inside array keywords (`allOf`, `anyOf`, `oneOf`, `prefixItems`).
  - **cli:** invalid `--input` / `--helpers` values fail fast with a clear message
    instead of being silently dropped, and `tsc` build failures include the
    compiler output.
  - **adapters:** the Zod and Valibot adapters now report when an unrepresentable
    type is widened to "accept anything" instead of dropping it silently.

- Updated dependencies [51c2032]
  - @amritk/helpers@0.8.0

## 0.2.7

### Patch Changes

- 6218978: chore: version bumps
- Updated dependencies [6218978]
  - @amritk/helpers@0.7.1

## 0.2.6

### Patch Changes

- Updated dependencies [6fdb8bf]
  - @amritk/helpers@0.7.0

## 0.2.5

### Patch Changes

- 8cde234: Re-publish all packages.
- Updated dependencies [8cde234]
  - @amritk/helpers@0.6.2

## 0.2.4

### Patch Changes

- Updated dependencies [ccecc67]
  - @amritk/helpers@0.6.1

## 0.2.3

### Patch Changes

- Updated dependencies [9fea346]
  - @amritk/helpers@0.6.0

## 0.2.2

### Patch Changes

- Updated dependencies [99f1876]
  - @amritk/helpers@0.5.0

## 0.2.1

### Patch Changes

- d14d39f: Publish `@amritk/adapters` for converting external schemas (TypeBox, Zod, Valibot, Effect) into JSON Schema for mjst.

## 0.2.0

### Minor Changes

- d5da63a: Add schema adapters so the CLI can ingest schemas from external libraries. The
  new `@amritk/adapters` package converts a source schema into Draft 2020-12 JSON
  Schema before generation, leaving the core pipeline untouched. The CLI gains
  `--input <format>` — `typebox`, `zod`, `valibot`, and `effect`, alongside the
  default `json` — and `--export <name>` to pick which export of a schema module
  to use.

  Each source library is an optional peer dependency loaded at runtime. The Zod
  (Zod 4 `toJSONSchema`) and Valibot (`@valibot/to-json-schema`) adapters map
  their date types to the same `x-mjst` instanceOf extension used by TypeBox
  dates; the Effect adapter (`JSONSchema.make`) passes through Effect's encoded
  representation. Constructs JSON Schema cannot express are preserved via the
  `x-mjst` extension, which the type generator, parsers, and validators
  understand.

  Constructs that JSON Schema cannot express (e.g. TypeBox's `Type.Date()`) are
  preserved via an `x-mjst` vendor extension. The type generator, parsers, and
  validators now understand `x-mjst: { instanceOf }`, emitting the class type, an
  `instanceof` check (with `Date` coercion in non-strict parsers), and a matching
  validator error.

### Patch Changes

- Updated dependencies [d5da63a]
  - @amritk/helpers@0.4.0
