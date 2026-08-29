# @amritk/mjst

## 0.15.0

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

- Updated dependencies [14d06c8]
- Updated dependencies [4d5f1bb]
- Updated dependencies [2b7901f]
- Updated dependencies [b6dcb13]
- Updated dependencies [0f27eeb]
- Updated dependencies [ec764d0]
- Updated dependencies [1c328af]
- Updated dependencies [1a74eaa]
- Updated dependencies [d8ceda5]
- Updated dependencies [18b817a]
- Updated dependencies [6771a4f]
- Updated dependencies [69ca72b]
- Updated dependencies [1fd154c]
- Updated dependencies [d8ceda5]
- Updated dependencies [3557eb5]
- Updated dependencies [fc60a77]
- Updated dependencies [11a280f]
- Updated dependencies [b4be038]
- Updated dependencies [e65a96b]
- Updated dependencies [06261b1]
- Updated dependencies [eb58f18]
- Updated dependencies [118aca9]
- Updated dependencies [be45c14]
- Updated dependencies [178eab0]
- Updated dependencies [5563205]
- Updated dependencies [41b14ae]
- Updated dependencies [7ca3bd8]
- Updated dependencies [41f8173]
- Updated dependencies [e65a96b]
- Updated dependencies [cb7b35a]
- Updated dependencies [a12b888]
- Updated dependencies [77f2f78]
- Updated dependencies [e091f22]
- Updated dependencies [d8f08b9]
- Updated dependencies [bbda384]
- Updated dependencies [8af6bb0]
- Updated dependencies [3a54baf]
- Updated dependencies [543fbe8]
- Updated dependencies [53651a1]
- Updated dependencies [bce4aa6]
- Updated dependencies [c6a1f16]
- Updated dependencies [62c81b8]
- Updated dependencies [9a2510f]
- Updated dependencies [1e77678]
- Updated dependencies [ea377c7]
- Updated dependencies [f97fac4]
- Updated dependencies [d8ceda5]
- Updated dependencies [892f306]
- Updated dependencies [261f650]
- Updated dependencies [637684a]
- Updated dependencies [4102fdf]
- Updated dependencies [d8ceda5]
- Updated dependencies [4f12bad]
- Updated dependencies [78b7972]
- Updated dependencies [95f3cd8]
- Updated dependencies [c90143f]
- Updated dependencies [ae4f785]
- Updated dependencies [f938dd7]
- Updated dependencies [b3364fd]
- Updated dependencies [7e452e1]
- Updated dependencies [b957e36]
  - @amritk/adapters@0.5.0
  - @amritk/generate-examples@0.7.0
  - @amritk/api@0.16.0
  - @amritk/lint@0.5.0
  - @amritk/generate-validators@0.14.0
  - @amritk/generate-parsers@0.19.5
  - @amritk/resolve-refs@0.7.1
  - @amritk/yaml@0.7.2
  - @amritk/helpers@0.16.0

## 0.14.9

### Patch Changes

- 34c5eaf: Report a config option named after an `Object.prototype` member as unknown.
  `validateConfig` indexed its known-options table directly, so a config
  containing `"constructor"`, `"toString"` or `"valueOf"` found the prototype
  member and type-checked the value against it — answering `expected undefined,
received string` instead of the unknown-option message that lists the real
  options and makes the typo obvious.
- Updated dependencies [34c5eaf]
- Updated dependencies [34c5eaf]
- Updated dependencies [34c5eaf]
- Updated dependencies [34c5eaf]
- Updated dependencies [34c5eaf]
- Updated dependencies [34c5eaf]
- Updated dependencies [34c5eaf]
- Updated dependencies [6f04ced]
  - @amritk/adapters@0.4.4
  - @amritk/api@0.15.2
  - @amritk/generate-examples@0.6.4
  - @amritk/generate-parsers@0.19.4
  - @amritk/helpers@0.15.4
  - @amritk/lint@0.4.8
  - @amritk/resolve-refs@0.7.0
  - @amritk/generate-validators@0.13.1

## 0.14.8

### Patch Changes

- Updated dependencies [36f03a2]
- Updated dependencies [823ea4e]
  - @amritk/generate-validators@0.13.0
  - @amritk/helpers@0.15.3
  - @amritk/adapters@0.4.3
  - @amritk/generate-examples@0.6.3
  - @amritk/generate-parsers@0.19.3

## 0.14.7

### Patch Changes

- d646199: Stop the README from tripping a WAF rule in front of the registry, which is what
  has refused every publish of these two packages since 2026-08-04.

  The 403 was never npm's. `npm publish` embeds the README as plain text in the
  publish document, and both READMEs used `../../../etc/passwd` as the example of a
  `$ref` that walks out of the schema's directory — the line documenting the
  traversal guard. Cloudflare, in front of `registry.npmjs.org`, read that as a
  path-traversal attempt and rejected the PUT with its own HTML interstitial. npm
  discards the response body, so all that reached the job log was its canned
  "forbidden by your security policy" line with no reason attached, and the failure
  looked like a registry block on the two package names.

  It explains the shape of the outage exactly: these were the only two packages
  carrying the string, which is why the other ten published from the same run.
  `@amritk/runtime-validators` documents `file:///etc/passwd` and publishes fine —
  the rule wants the traversal _and_ the `/etc/` path together, and either alone
  passes.

  The example is now `../../../secrets.env`, which documents the same thing: a path
  outside the document tree. No behaviour changes — the guard itself, and the paths
  it refuses, are untouched.

- Updated dependencies [2e3399a]
- Updated dependencies [3e9869b]
- Updated dependencies [d646199]
  - @amritk/helpers@0.15.2
  - @amritk/resolve-refs@0.6.0
  - @amritk/adapters@0.4.2
  - @amritk/generate-examples@0.6.2
  - @amritk/generate-parsers@0.19.2
  - @amritk/generate-validators@0.12.2
  - @amritk/lint@0.4.7

## 0.14.6

### Patch Changes

- 0b294a1: Retry the publish that npm has refused since 0.14.0 and 0.5.0.

  Every version of these two since 2026-08-04 has been built, tested and packed by
  the release job and then refused by the registry with an empty 403, while the
  other ten packages publish from the same run. Nothing in either package changed
  here — the bump gives the release a version to attempt while the block is with
  npm support.

- Updated dependencies [0b294a1]
  - @amritk/resolve-refs@0.5.3
  - @amritk/lint@0.4.7

## 0.14.5

### Patch Changes

- 2e5dada: Republish after 0.14.4 and 0.5.1 never reached npm.

  Both versions were built, tested and packed by the release job, and both were
  refused by the registry with a bare 403 while the other ten packages published
  from the same job. Nothing in either package changed — this bump exists to give
  the release something to publish, so npm has the versions its consumers expect.

- Updated dependencies [2e5dada]
  - @amritk/resolve-refs@0.5.2
  - @amritk/lint@0.4.7

## 0.14.4

### Patch Changes

- 4178e8d: Patch release across all packages.
- Updated dependencies [4178e8d]
  - @amritk/adapters@0.4.1
  - @amritk/api@0.15.1
  - @amritk/generate-examples@0.6.1
  - @amritk/generate-parsers@0.19.1
  - @amritk/generate-validators@0.12.1
  - @amritk/helpers@0.15.1
  - @amritk/lint@0.4.7
  - @amritk/resolve-refs@0.5.1
  - @amritk/yaml@0.7.1

## 0.14.3

### Patch Changes

- Updated dependencies [ae367f8]
  - @amritk/api@0.15.0

## 0.14.2

### Patch Changes

- Updated dependencies [fb67e63]
- Updated dependencies [eb4e216]
  - @amritk/api@0.14.0
  - @amritk/yaml@0.7.0
  - @amritk/lint@0.4.6

## 0.14.1

### Patch Changes

- Updated dependencies [7d2c805]
- Updated dependencies [05d0b29]
- Updated dependencies [a6bd637]
  - @amritk/yaml@0.6.0
  - @amritk/lint@0.4.5

## 0.14.0

### Minor Changes

- 2c08493: Add `--allowed-roots` so a split spec can reach a sibling directory again

  `@amritk/resolve-refs` now confines a local `$ref` to the directory holding the
  document it appears in, which closed a real path-traversal hole
  (`{"$ref": "/etc/passwd"}` used to be read and inlined). The CLI inherited that
  default with no way to widen it, so a completely ordinary multi-version layout —
  `specs/v1/api.json` referencing `../common/user.json` — started failing, and the
  error told the user to "set allowedRoots", a _library_ option nothing on the
  command line could reach.

  `--allowed-roots <dirs>` is that escape hatch, on both `mjst generate` and
  `mjst lint`, alongside an `allowedRoots` config-file key. On the generate path it
  takes a comma-separated list or the flag repeated (matching `--allowed-hosts`);
  on `lint` you repeat the flag (matching its `--allowed-hosts`). Relative entries
  resolve against the current working directory, from a config file as readily as
  from the flag, which is how `schema` and `outDir` already behave.

  Two things it deliberately does not do. It does not replace the default: the
  schema's (or linted document's) own directory stays allowed, so naming a shared
  `common/` folder cannot revoke the one directory nobody would think to list. And
  it does not widen anything on its own — there is no implicit default drawn from
  the config file's location, because a config file usually sits at the repo root
  and quietly granting read access to the whole project tree is not a decision
  anyone would read into `--config`. A `$ref` that lands outside every named root
  is still refused.

  Refusals now name the flag that exists (`pass --allowed-roots <dir> …`) instead
  of leaving the library's option name as the only lead.

- a8f96c9: Stop the CLI from succeeding quietly, and make generation safe to write

  **`mjst lint` no longer exits 0 when its file arguments match nothing.** A glob
  or path that resolved to zero files fell through to the stdin branch; in CI
  there is no TTY, so stdin is an empty pipe and the linter dutifully reported
  "No problems found" on an empty document and exited 0. A typo'd path turned a
  lint gate into a silent no-op that reported success. Document arguments that
  match nothing now exit 2 with `No files matched: …`, and only a run with no
  document arguments at all reads stdin.

  **`mjst lint` rejects unknown flags.** yargs was built without `.strict()`, so
  `--bogus-flag`, a mistyped `--fail-severity`, or a misspelled `--allowed-hosts`
  was dropped and the run silently used the defaults — the opposite of the
  generate command's deliberate strictness. A non-numeric `--concurrency` now
  reports what is wrong instead of crashing with `Invalid array length`.

  **Generation never clobbers a file it did not write.** A generated name that
  collided with a hand-written file (`index.ts` is the common one) overwrote it
  without a word, and `--build` then deleted it along with the other intermediate
  sources. Each run records what it wrote in a `.mjst-manifest.json` at the root
  of the output directory: paths listed there are reclaimed freely, so
  regenerating still needs no ceremony, while anything else aborts the run before
  a byte is written. The new `--force` flag opts out. This covers every output the
  CLI produces — the parser tree, `--validators`, `--examples`, and `--out-file`,
  which is the one most likely to be aimed at hand-written source
  (`--out-file src/types.ts` used to overwrite that file silently and, under
  `--build`, delete it afterwards). For `--out-file` the manifest lands in the
  directory holding the file, alongside the `--build` output and any generated
  examples.

  **Generation is atomic.** Files are staged under temporary names and renamed
  into place only once the whole set has been written, so a mid-run failure (a
  `_helpers` path occupied by a regular file, a full disk) leaves the output
  directory exactly as it found it instead of a half-generated tree.

  **`--root-type` is validated, and writes are confined to the output
  directory.** `--root-type '../../Escaped'` — from the command line or from a
  config file — wrote outside `--out-dir` and emitted a type name that could not
  compile. The name must now be a TypeScript identifier, and the writer
  independently refuses any path that resolves outside the output directory.

  **Config files are validated.** Every key was guarded by a `typeof` check whose
  failure branch was "drop it", so `{"strcit": true, "strict": "true"}` generated
  non-strict output and exited 0 while the same typo on the command line was
  rejected. Unknown keys and wrong types now fail with the offending pointer and
  the expected type, and `config.schema.json` closes the object with
  `additionalProperties: false`.

  **`-v` / `-h` / `--version` / `--help` are only honored in flag position.** Both
  predicates scanned the whole argv, so any flag whose _value_ was `-v` (say
  `--type-suffix -v`) printed the version, generated nothing, and exited 0.

  Smaller argument-parsing fixes: `--` is accepted as the end-of-flags terminator
  instead of being rejected as an unknown flag; `--config` with no value is an
  error rather than a silently skipped config file; a missing config file reports
  `Config file not found: …` instead of a raw `ENOENT`; an `--out-dir` pointing at
  an existing file explains itself instead of surfacing `EEXIST … mkdir`; a stray
  positional (`mjst genrate --schema …`) is rejected rather than quietly generating
  as if the typo were not there; and `--build --types-only` no longer claims to
  have built `.js` files that were never emitted.

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

- Updated dependencies [a342117]
- Updated dependencies [f5a52b7]
- Updated dependencies [365c6c1]
- Updated dependencies [299ed2a]
- Updated dependencies [2eed2e5]
- Updated dependencies [d989bc4]
- Updated dependencies [de0952c]
- Updated dependencies [213ecc4]
- Updated dependencies [9cb45a0]
- Updated dependencies [ef77708]
- Updated dependencies [5afbfd4]
- Updated dependencies [eb80ca6]
- Updated dependencies [798fd7a]
- Updated dependencies [874856f]
- Updated dependencies [2c9982c]
- Updated dependencies [f439570]
- Updated dependencies [fa8620c]
- Updated dependencies [cb0ef39]
- Updated dependencies [08b2833]
- Updated dependencies [d749ee2]
- Updated dependencies [945e8f2]
- Updated dependencies [f9f790a]
- Updated dependencies [0d4bed2]
- Updated dependencies [947d44a]
- Updated dependencies [7757788]
- Updated dependencies [7839a38]
- Updated dependencies [007aa05]
- Updated dependencies [1b720e2]
- Updated dependencies [c1a176f]
- Updated dependencies [00eb0c9]
  - @amritk/api@0.13.0
  - @amritk/generate-examples@0.6.0
  - @amritk/generate-validators@0.12.0
  - @amritk/generate-parsers@0.19.0
  - @amritk/helpers@0.15.0
  - @amritk/resolve-refs@0.5.0
  - @amritk/lint@0.4.4
  - @amritk/adapters@0.4.0
  - @amritk/yaml@0.5.0

## 0.13.9

### Patch Changes

- Updated dependencies [dd8f407]
  - @amritk/api@0.12.0

## 0.13.8

### Patch Changes

- Updated dependencies [e6f0ff2]
  - @amritk/yaml@0.4.0
  - @amritk/lint@0.4.3

## 0.13.7

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
- Updated dependencies [dcc2ea4]
- Updated dependencies [491bde2]
- Updated dependencies [fe8191b]
  - @amritk/generate-validators@0.11.12
  - @amritk/generate-examples@0.5.6
  - @amritk/generate-markdown@0.4.5
  - @amritk/generate-parsers@0.18.0
  - @amritk/resolve-refs@0.4.5
  - @amritk/helpers@0.14.0
  - @amritk/adapters@0.3.6
  - @amritk/lint@0.4.2
  - @amritk/yaml@0.3.5
  - @amritk/api@0.11.0

## 0.13.6

### Patch Changes

- Updated dependencies [42fdea2]
  - @amritk/api@0.10.0

## 0.13.5

### Patch Changes

- Updated dependencies [6191ec9]
- Updated dependencies [e072b47]
- Updated dependencies [2b74018]
  - @amritk/api@0.9.0

## 0.13.4

### Patch Changes

- Updated dependencies [d0a6e99]
- Updated dependencies [a09134f]
- Updated dependencies [2e757e3]
- Updated dependencies [217cb66]
  - @amritk/api@0.8.0
  - @amritk/adapters@0.3.5
  - @amritk/helpers@0.13.5
  - @amritk/generate-examples@0.5.5
  - @amritk/generate-validators@0.11.11
  - @amritk/lint@0.4.1
  - @amritk/generate-parsers@0.17.2

## 0.13.3

### Patch Changes

- Updated dependencies [d5282f8]
- Updated dependencies [3c3611c]
  - @amritk/api@0.7.0

## 0.13.2

### Patch Changes

- 1901231: Ship AI-agent-facing docs. Each package now includes an `AI.md` in its published
  tarball — a mental model, a minimal runnable example, and the gotchas most
  likely to trip up an LLM — and gains `@example` JSDoc on its primary exports. A
  root `llms.txt` / `llms-full.txt` (generated by `bun run generate-llms`) indexes
  them, and `@amritk/mini` adds a `check:reactivity` guard for the compilerless-JSX
  "called signal" footgun.
- Updated dependencies [1901231]
- Updated dependencies [019ecbc]
- Updated dependencies [e197c0c]
- Updated dependencies [019ecbc]
  - @amritk/generate-validators@0.11.10
  - @amritk/generate-examples@0.5.4
  - @amritk/generate-markdown@0.4.4
  - @amritk/generate-parsers@0.17.1
  - @amritk/resolve-refs@0.4.4
  - @amritk/adapters@0.3.4
  - @amritk/helpers@0.13.4
  - @amritk/lint@0.4.0
  - @amritk/api@0.6.1
  - @amritk/yaml@0.3.4

## 0.13.1

### Patch Changes

- Updated dependencies [d82bae9]
  - @amritk/api@0.6.0

## 0.13.0

### Minor Changes

- e40dc3e: Add a `compile-api` subcommand — `mjst compile-api <routes-module> --out <file>` — that loads a module of `@amritk/api` route contracts and compiles them with `compileToModule` into a fused fetch-handler module, so producing the compiled engine no longer requires a hand-written build script. Supports `--routes-import`, `--options <json-file>` (spread into the compile options), `--open-api-path`, and `--max-body-bytes`.

### Patch Changes

- Updated dependencies [da1be72]
- Updated dependencies [824b869]
- Updated dependencies [5395bed]
- Updated dependencies [09ff86c]
- Updated dependencies [da1be72]
- Updated dependencies [ca672c3]
  - @amritk/api@0.5.0

## 0.12.3

### Patch Changes

- 6e7c65e: Slim published packages — comments are now stripped from the compiled JS in `dist` (they were duplicating the JSDoc that already ships in the `.d.ts` files, which is what editors read), and `@amritk/lint` now minifies its bundled OpenAPI meta-schema JSON documents. Unpacked size drops ~30% across the board (for example `@amritk/lint` 448 kB → 307 kB, `@amritk/generate-parsers` 293 kB → 191 kB) with no behavior change: declaration files keep their docs, `/* @__PURE__ */` annotations and the CLI shebang survive, and `@amritk/helpers` still ships its TypeScript sources for embedded mode.
- Updated dependencies [57d617a]
- Updated dependencies [6e7c65e]
  - @amritk/generate-parsers@0.17.0
  - @amritk/adapters@0.3.3
  - @amritk/generate-examples@0.5.3
  - @amritk/generate-markdown@0.4.3
  - @amritk/generate-validators@0.11.9
  - @amritk/helpers@0.13.3
  - @amritk/lint@0.3.3
  - @amritk/resolve-refs@0.4.3
  - @amritk/yaml@0.3.3

## 0.12.2

### Patch Changes

- 4e23c02: Packaging fixes across all published packages: the `types` export condition now precedes runtime conditions (`default`/`import`) so TypeScript resolves the declared `.d.ts` explicitly instead of relying on file adjacency, and published tarballs now include the LICENSE file (copied in during the publish job).
- Updated dependencies [4e23c02]
  - @amritk/adapters@0.3.2
  - @amritk/generate-examples@0.5.2
  - @amritk/generate-markdown@0.4.2
  - @amritk/generate-parsers@0.16.3
  - @amritk/generate-validators@0.11.8
  - @amritk/helpers@0.13.2
  - @amritk/lint@0.3.2
  - @amritk/resolve-refs@0.4.2
  - @amritk/yaml@0.3.2

## 0.12.1

### Patch Changes

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

- Updated dependencies [df10916]
- Updated dependencies [f2857b6]
- Updated dependencies [248a412]
- Updated dependencies [69b9841]
- Updated dependencies [a676e8d]
- Updated dependencies [2a89506]
- Updated dependencies [737b390]
- Updated dependencies [797a156]
- Updated dependencies [8c69893]
- Updated dependencies [6eac298]
  - @amritk/adapters@0.3.1
  - @amritk/generate-parsers@0.16.2
  - @amritk/generate-validators@0.11.7
  - @amritk/lint@0.3.1
  - @amritk/helpers@0.13.1
  - @amritk/generate-examples@0.5.1
  - @amritk/resolve-refs@0.4.1
  - @amritk/yaml@0.3.1

## 0.12.0

### Minor Changes

- 15602f2: Add an `--examples` flag (config `"examples": true`) that wires
  `@amritk/generate-examples` into the CLI.

  When set, alongside the parser output mjst also emits a `fast-check` arbitrary
  (`FooArbitrary`) and a concrete example value (`fooExample`) for every schema.
  The test-data files are written into an `examples/` subdirectory of the output
  destination so they never collide with the parser files (both otherwise produce
  `<name>.ts` / `index.ts`). The flag works with both `--schema` and
  `--schema-dir` — under `--schema-dir` the examples mirror the schema layout
  beneath `examples/`.

  The generated arbitraries import `fast-check`, which consumers must install as a
  (dev) dependency; the static example values have no runtime dependencies. The
  example sources are intentionally left out of `--build`.

- 5293b35: Add a `--validators` flag (config key `"validators": true`) to the `mjst` CLI.
  When set, the CLI also emits validation functions alongside the generated
  parsers: for every generated type `X` you get a `validateX` (returning a rich
  `ValidationResult` with JSON-Pointer error paths) and an `isX` boolean type
  guard, produced by `@amritk/generate-validators`. The validator files carry the
  same schema-derived filenames as the parsers, so they land in a `validators/`
  subdirectory of the output to avoid colliding. This works with both `--schema`
  and `--schema-dir` (the `validators/` tree mirrors the parser layout) and with
  `--build`; it cannot be combined with `--types-only` or `--out-file`, which emit
  no runtime code. The README overview previously claimed the CLI produced
  validators — it now does.
- fbb3ef0: Resolve external and remote `$ref`s when generating parsers. The codegen path
  previously did a bare `JSON.parse`, so a schema referencing another file
  (`{ "$ref": "./address.json" }`) or a remote URL failed. Schema loading now
  dereferences cross-file and remote references with `@amritk/resolve-refs`,
  inlining them into a single schema before generation. Same-document
  (`#/$defs/...`) refs are left untouched so named-type output is unchanged.

  The same safety flags as `mjst lint` are exposed — `--resolve-remote`,
  `--allowed-hosts`, and `--allow-private-hosts` — with remote fetching off by
  default (a schema with a remote `$ref` fails rather than making a network call
  unless opted in). Unresolvable references (a missing file, a refused host, a bad
  URL) fail the run with the underlying reason. Works with `--schema-dir`, where
  each schema resolves its own references.

- a0e1fbb: Surface `$ref` resolution failures as lint findings. `mjst lint` previously
  discarded the resolver's `errors` array, so a typo'd `$ref`, a missing file, or
  a refused/failed remote fetch produced no diagnostic at all. A `LintResolver`
  may now return `diagnostics`, and the CLI resolver maps each resolution error to
  a finding — anchored to the offending ref's position in the source document
  where recoverable, or reported at document level otherwise.

### Patch Changes

- 345aeb7: Document the `--banner` flag in the bundled `config.schema.json` so config-file
  users can discover and validate it, and regenerate the CLI README config table
  to include it. Also refresh the stale `config` property description, which
  enumerated the supported keys but omitted `input`, `export`, `stripUnknown`,
  `caseInsensitive`, and `banner`.
- Updated dependencies [815f9ab]
- Updated dependencies [a6f4606]
- Updated dependencies [88b549a]
- Updated dependencies [e8d97e7]
- Updated dependencies [9c98116]
- Updated dependencies [7b37ec2]
- Updated dependencies [9bf3330]
- Updated dependencies [47fe796]
- Updated dependencies [1dbe5bc]
- Updated dependencies [317a940]
- Updated dependencies [e612130]
- Updated dependencies [2bf31d3]
- Updated dependencies [ce0d515]
- Updated dependencies [9d05033]
- Updated dependencies [a0e1fbb]
- Updated dependencies [ef43b87]
- Updated dependencies [2392836]
- Updated dependencies [acfe75e]
- Updated dependencies [c74cd35]
- Updated dependencies [297ccba]
- Updated dependencies [641afa9]
- Updated dependencies [4715e6f]
- Updated dependencies [22c4b8f]
- Updated dependencies [8e4cd38]
- Updated dependencies [29b7a18]
- Updated dependencies [ce79384]
- Updated dependencies [a834a17]
- Updated dependencies [5d89429]
  - @amritk/adapters@0.3.0
  - @amritk/generate-examples@0.5.0
  - @amritk/lint@0.3.0
  - @amritk/helpers@0.13.0
  - @amritk/generate-parsers@0.16.1
  - @amritk/generate-validators@0.11.6
  - @amritk/resolve-refs@0.4.0
  - @amritk/yaml@0.3.0

## 0.11.0

### Minor Changes

- 161c2fc: Add a `caseInsensitive` option for case-insensitive `enum`/`const` coercion.

  When enabled, a coercing parser normalizes a mis-cased string to the exact casing of the declared `enum`/`const` member it matches case-insensitively (e.g. `hElLo` → `hello`) instead of coercing it to the default. It applies to object properties, array items, and top-level enum/const parsers. Coerce mode only — strict parsers still reject a casing mismatch.

  Performance is unaffected on already-valid input: the exact `===` fast path (and the shape validators / deep guards built on it) is unchanged, and the case-insensitive lookup is emitted only on the coercion failure branch, so a correctly-cased value never runs it.

  `buildSchema` takes a new trailing `caseInsensitive` argument; `mjst` exposes it as the `--case-insensitive` flag and the `caseInsensitive` config key.

- 7147396: Resolve `$ref`, `$dynamicRef`/`$dynamicAnchor`, and `$recursiveRef`/`$recursiveAnchor` when linting.

  `@amritk/resolve-refs` now dereferences plain-name anchors (`#node` → `$anchor`/`$dynamicAnchor`) and the dynamic/recursive reference keywords, in both the in-memory and cross-file resolvers. Dynamic/recursive references bind to their document-global anchor (the single-bundle case; nested `$id` base-URI re-scoping is not modelled).

  `mjst lint` now dereferences documents before running rules, so rules with `resolved: true` (the ruleset default) see through references — including cross-file refs, whose findings are attributed to the referenced file's own `line:column`. New flags: `--no-resolve` to disable, and `--resolve-remote` / `--allowed-hosts` / `--allow-private-hosts` to opt into fetching remote (`http(s)`) refs (off by default so a lint run stays offline).

### Patch Changes

- Updated dependencies [161c2fc]
- Updated dependencies [273bbce]
- Updated dependencies [7147396]
  - @amritk/generate-parsers@0.16.0
  - @amritk/lint@0.2.0
  - @amritk/resolve-refs@0.3.0

## 0.10.0

### Minor Changes

- 195873d: Add `@amritk/lint`: a format-agnostic JSON/YAML style-guide linter with JSON
  Schema and custom rules, in a single package.

  - `@amritk/lint` — parsing (exact source positions), the engine (documents,
    ruleset loading/merging, a compiled JSONPath, the rule runner), the built-in
    rule functions (`schema` (JSON Schema, via `@amritk/runtime-validators`),
    `truthy`, `pattern`, `casing`, `alphabetical`, `length`, `enumeration`, `xor`,
    …), and the auto-fix plumbing. `lintDocument` returns structured findings;
    rendering them is left to the caller.
  - `@amritk/mjst` — gains a `lint` subcommand: `mjst lint <files> -r <ruleset>`,
    with `.lint.*` ruleset discovery, a compact `file:line:col` report, and
    severity-based exit codes.

  JSON/YAML linting with JSON Schema and custom rules only — no OpenAPI-specific
  rulesets, functions, or `$ref` resolution.

### Patch Changes

- Updated dependencies [195873d]
  - @amritk/lint@0.1.0

## 0.9.0

### Minor Changes

- 1bb7a25: Add `--help` / `-h` and print usage when the CLI is invoked with no arguments.

  Running `mjst` with no arguments (or `mjst --help` / `-h` / `help`) previously
  errored with "--out-dir or --out-file is required". It now prints a usage
  summary listing every flag — schema, schema-dir, out-dir, out-file, input,
  export, types-only, build, strict, log-warnings, strip-unknown, readonly,
  helpers, type-suffix, banner, import-ext, root-type, config, and version.

- 1bb7a25: Select `package` helpers mode only when `@amritk/helpers` is a declared
  dependency of the target project.

  Auto-detection previously chose `package` mode whenever `@amritk/helpers` was
  merely _resolvable_, which includes being hoisted into `node_modules` as a
  transitive dependency of `@amritk/mjst`. The generated code then worked under
  npm/bun's hoisted layouts but broke under pnpm/isolated installs, where an
  undeclared package is unreachable at runtime. Detection now reads the nearest
  `package.json` above the output directory and picks `package` only when
  `@amritk/helpers` is listed in its dependencies (or dev/peer/optional);
  otherwise it falls back to the self-contained `embedded` mode and prints a tip
  to declare `@amritk/helpers` for a shared helper copy. The explicit
  `--helpers package|embedded` override still skips detection.

- 1bb7a25: Default generated relative imports to the literal `.ts` extension so the output
  runs under Node without a build step.

  Generated `.ts` files imported siblings as `./x.js` — the TS NodeNext form Bun
  and tsc resolve to the `.ts` file, but Node's type stripping (Node ≥ 22.18)
  throws `ERR_MODULE_NOT_FOUND` because it does not remap `.js` → `.ts`. The CLI
  now defaults `--import-ext` (config key `importExt`) to `ts`, emitting the
  literal on-disk paths, so `node generated/index.ts` loads and parses directly.

  `js` remains available for consumers who compile the output, and `--build`
  still selects `js` automatically (tsc cannot emit from `.ts` specifiers). tsc
  consumers running the `.ts` sources directly must set
  `allowImportingTsExtensions` — documented in the CLI README. `--import-ext ts`
  combined with `--build` stays an error.

- 1bb7a25: Derive the root type name from the schema instead of always using `Document`
  (breaking).

  The root type is now named after the schema — its `title`, falling back to the
  schema filename in PascalCase (`program.json` → `Program`, `spec-plan.json` →
  `SpecPlan`), and only then to `Document`. Generating from two schemas no longer
  forces import aliasing: the functions become `parseProgram` /
  `validateProgramShape` and nested types `SpecPlan_AxiomsItem`. A new
  `--root-type <Name>` flag overrides the name for a single `--schema` run; it is
  rejected with `--schema-dir`, where each schema derives its own root.

  This is breaking for consumers importing `parseDocument` / `validateDocumentShape`
  today — update those imports to the new schema-derived names.

  Fixed a latent generator bug this surfaced: a JSON Schema meta-schema special
  case (a pass-through, validation-free parser) fired on any type literally named
  `Schema`. It now applies only to `$ref`-reached definitions, so a common
  `schema.json` root gets a real parser instead of a silent pass-through.

### Patch Changes

- Updated dependencies [1bb7a25]
- Updated dependencies [1bb7a25]
  - @amritk/generate-parsers@0.15.0
  - @amritk/helpers@0.12.0
  - @amritk/adapters@0.2.16

## 0.8.0

### Minor Changes

- 9253843: Add `--import-ext <js|ts>` (config key `importExt`) to control the extension
  emitted on relative import specifiers in generated output — cross-file `$ref`
  imports, the `index.ts` barrel, and embedded `_helpers/` imports.

  The default stays `js` (the standard TS NodeNext form, required by `--build`).
  Passing `ts` emits the literal on-disk paths so the generated `.ts` sources run
  directly under Node's type stripping (Node 22.6+ with
  `--experimental-strip-types`, on by default from Node 23) with no compile step.
  `--import-ext ts` is rejected in combination with `--build`, since tsc refuses
  to emit from `.ts` specifiers.

  `buildSchema` gains a trailing `importExt` parameter, and
  `generateIndexBarrel` accepts an `importExt` option.

### Patch Changes

- Updated dependencies [91dab2b]
- Updated dependencies [9253843]
  - @amritk/generate-parsers@0.14.0
  - @amritk/helpers@0.11.0
  - @amritk/adapters@0.2.15

## 0.7.16

### Patch Changes

- Updated dependencies [18df9f7]
- Updated dependencies [02f6b05]
  - @amritk/generate-parsers@0.13.0
  - @amritk/helpers@0.10.3
  - @amritk/adapters@0.2.14

## 0.7.15

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
- Updated dependencies [4501ff0]
- Updated dependencies [c288a90]
  - @amritk/generate-parsers@0.12.3
  - @amritk/helpers@0.10.2
  - @amritk/generate-markdown@0.4.1
  - @amritk/adapters@0.2.13

## 0.7.14

### Patch Changes

- Updated dependencies [dc740e4]
- Updated dependencies [3e6f49d]
  - @amritk/generate-markdown@0.4.0
  - @amritk/generate-parsers@0.12.2

## 0.7.13

### Patch Changes

- Updated dependencies [9afc4cc]
- Updated dependencies [7d43e6f]
  - @amritk/generate-markdown@0.3.0
  - @amritk/helpers@0.10.1
  - @amritk/generate-parsers@0.12.1
  - @amritk/adapters@0.2.12

## 0.7.12

### Patch Changes

- Updated dependencies [e57d6ca]
- Updated dependencies [b6e103d]
- Updated dependencies [8517631]
  - @amritk/adapters@0.2.11
  - @amritk/generate-parsers@0.12.0

## 0.7.11

### Patch Changes

- Updated dependencies [113f979]
  - @amritk/generate-parsers@0.11.1

## 0.7.10

### Patch Changes

- Updated dependencies [6fa79a6]
  - @amritk/generate-parsers@0.11.0

## 0.7.9

### Patch Changes

- d1be238: Add a `stripUnknown` option to `@amritk/generate-parsers` (a `buildSchema` /
  `generateFile` / `generateParserFunction` option, the `stripUnknown` config key,
  and the `--strip-unknown` CLI flag; default `false`). When enabled, generated
  parsers build their result from the schema's declared properties only, silently
  dropping undeclared input keys at every nesting level — zod's `.strip()` / the
  `parseSafe` benchmark semantics — without treating extras as a validation error.
  It reuses the existing strict-keys machinery: the `{ ...input }` spread is dropped
  in the slow path and the fast path is gated on the `_hasOnlyKnownKeys` predicate.
  It composes with `strict` (still throws on wrong types and missing required
  properties, but strips extras instead of throwing on them) and yields to
  `additionalProperties: false`, where rejecting still wins over stripping in strict
  mode.
- Updated dependencies [d1be238]
  - @amritk/generate-parsers@0.10.0

## 0.7.8

### Patch Changes

- Updated dependencies [89a445a]
- Updated dependencies [cdfe681]
  - @amritk/generate-parsers@0.9.0
  - @amritk/helpers@0.10.0
  - @amritk/adapters@0.2.10

## 0.7.7

### Patch Changes

- 1eefe88: Generated parsers now validate inline nested objects and respect
  `additionalProperties: false`, matching the runtime interpreter and the
  just-fixed validator generator:

  - **Inline nested objects get a private sub-parser.** An object schema written
    directly under `properties` (rather than `$ref`'d) previously only passed an
    `isObject` check — its fields were never parsed, in either mode. Each inline
    nested object now gets a non-exported sub-parser, shape predicate, and type
    alias (`type OrderShipTo = Order["shipTo"]`) in the same generated file, and
    parsing recurses to any depth: coerce mode coerces nested fields (and builds
    deep defaults for non-object input), strict mode throws path-aware errors
    like `[OrderShipTo] field "zip" expected string, got number`.
  - **`additionalProperties: false` is enforced.** Strict mode throws
    `[TypeName] unknown property "key"`; coerce mode strips undeclared keys from
    the result instead of spreading them through (previously extras — including
    a potential `__proto__` — flowed straight into the typed output). The shape
    predicate and the parser fast path refuse inputs with undeclared keys so
    extras cannot survive via `{ ...input }`. The declared-keys Set is hoisted
    to module scope and the sweep is an allocation-free `for...in` loop.

  Schemas without `additionalProperties: false` generate byte-identical output
  to before, so loose parsing keeps its existing fast path. Schemas combining
  `additionalProperties: false` with `patternProperties` or composition keywords
  skip the undeclared-key handling, since the generator cannot evaluate those
  yet. The `strict` option docs and config schemas no longer claim unknown keys
  are always allowed.

- Updated dependencies [b0c83e7]
- Updated dependencies [1eefe88]
  - @amritk/helpers@0.9.0
  - @amritk/generate-parsers@0.8.0
  - @amritk/adapters@0.2.9

## 0.7.6

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
  - @amritk/generate-parsers@0.7.2
  - @amritk/adapters@0.2.8

## 0.7.5

### Patch Changes

- 6218978: chore: version bumps
- Updated dependencies [6218978]
  - @amritk/adapters@0.2.7
  - @amritk/generate-markdown@0.2.4
  - @amritk/generate-parsers@0.7.1
  - @amritk/helpers@0.7.1

## 0.7.4

### Patch Changes

- Updated dependencies [6fdb8bf]
  - @amritk/helpers@0.7.0
  - @amritk/generate-parsers@0.7.0
  - @amritk/adapters@0.2.6

## 0.7.3

### Patch Changes

- 8cde234: Re-publish all packages.
- Updated dependencies [8cde234]
  - @amritk/adapters@0.2.5
  - @amritk/generate-markdown@0.2.3
  - @amritk/generate-parsers@0.6.3
  - @amritk/helpers@0.6.2

## 0.7.2

### Patch Changes

- f9c426a: Render the config reference as an HTML table with a two-row layout: each property's metadata (name, flag, type, required, default) sits on one row and its description spans the full table width on the row below. This uses vertical space better and stops the description from being squeezed into a narrow column on small screens.
- Updated dependencies [f9c426a]
  - @amritk/generate-markdown@0.2.2
  - @amritk/generate-parsers@0.6.2

## 0.7.1

### Patch Changes

- Updated dependencies [ccecc67]
  - @amritk/helpers@0.6.1
  - @amritk/adapters@0.2.4
  - @amritk/generate-parsers@0.6.1

## 0.7.0

### Minor Changes

- 9fea346: Make the generated type-name suffix configurable and default it to no suffix.

  `refToName` previously always appended `Object` to every type name derived from
  a `$ref` (e.g. `Contact` → `ContactObject`). It now accepts an optional `suffix`
  that defaults to `''`, so generated types, parsers, and validators use the plain
  PascalCase name by default.

  A new `typeSuffix` option threads through the generators and the CLI
  (`--type-suffix <suffix>`) to restore or customize the suffix — pass
  `--type-suffix Object` to keep the previous `ContactObject` naming.

  **Breaking:** with no `typeSuffix` set, generated type/parser/validator names no
  longer include the `Object` suffix. Set `typeSuffix: 'Object'` (or
  `--type-suffix Object`) to preserve the old output.

### Patch Changes

- Updated dependencies [9fea346]
  - @amritk/generate-parsers@0.6.0
  - @amritk/helpers@0.6.0
  - @amritk/adapters@0.2.3

## 0.6.0

### Minor Changes

- 99f1876: Add an `--out-file` option that concatenates every generated definition into a single self-contained file instead of a directory (currently supported with `--types-only`). Add a `--readonly` option that emits every property, array, and record in the generated types as `readonly` for deeply immutable types. All CLI flags now accept both kebab-case and camelCase (e.g. `--out-dir` and `--outDir`) and are documented as kebab-case. `buildSchema` gains an optional trailing `readonly` argument, and `generateTypeDefinition` gains an optional `options` argument.
- 9a26ac1: Add `--schemaDir` for recursive generation: point mjst at a directory of JSON Schemas and it generates parsers for every `*.json` file, mirroring the directory layout under `outDir`. The runtime helpers are emitted once into a shared `outDir/_helpers/` that every nested parser imports from (via a computed relative path), and `--build` compiles the whole tree in place. `buildSchema` gains an optional `helpersImportPrefix` argument to support the shared-helpers layout.

### Patch Changes

- Updated dependencies [99f1876]
- Updated dependencies [9a26ac1]
  - @amritk/generate-parsers@0.5.0
  - @amritk/helpers@0.5.0
  - @amritk/adapters@0.2.2

## 0.5.1

### Patch Changes

- Updated dependencies [d14d39f]
  - @amritk/adapters@0.2.1

## 0.5.0

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
  - @amritk/adapters@0.2.0
  - @amritk/helpers@0.4.0
  - @amritk/generate-parsers@0.4.0

## 0.4.0

### Minor Changes

- 83eb57a: Derive the root type name from the schema's `title` instead of always using "Document". The CLI now generates types and parsers named after the schema (e.g. an "OpenAPI Document" title yields `OpenAPIDocument` / `parseOpenAPIDocument`), falling back to `Document` when the schema has no usable title. Adds a `deriveRootTypeName` helper to `@amritk/helpers`.

### Patch Changes

- Updated dependencies [83eb57a]
  - @amritk/helpers@0.3.0
  - @amritk/generate-parsers@0.3.1

## 0.3.0

### Minor Changes

- cbc0e4c: Generated parser output is now self-contained when `@amritk/helpers` isn't installed in the consumer project.

  - `@amritk/mjst` (CLI) auto-detects whether `@amritk/helpers` resolves from the consumer's `outDir`. When it doesn't, the CLI runs in **embedded** mode: the runtime helper sources are shipped alongside the generated parsers in `outDir/_helpers/` and imports are rewritten to `./_helpers/...`. When it does, the CLI runs in **package** mode (the historical behaviour) and continues to import from `@amritk/helpers/...`.
  - New `--helpers <package|embedded>` CLI flag (and config key) lets callers override auto-detection — useful for forcing self-contained output in CI or when shipping generated code to a runtime without `@amritk/helpers` installed.
  - `@amritk/generate-parsers`' `buildSchema()` takes a new optional `helpersMode` parameter; in embedded mode it appends `_helpers/<name>.ts` entries to its returned `GeneratedFile[]` for each runtime helper the generated parsers actually use.
  - The CLI's `--build` flag no longer relies on a brittle `compilerOptions.paths` mapping that pointed back into the CLI's own install location; in both modes, `tsc` now resolves helper imports via standard module resolution.
  - `@amritk/helpers` extracts `hasRef` into its own subpath export (`@amritk/helpers/has-ref`). The existing `@amritk/helpers/schema-guards` continues to re-export it for backward compatibility.

### Patch Changes

- Updated dependencies [cbc0e4c]
  - @amritk/generate-parsers@0.3.0
  - @amritk/helpers@0.2.2

## 0.2.1

### Patch Changes

- dbf49bf: Republish via npm trusted publishing (OIDC).
- Updated dependencies [dbf49bf]
  - @amritk/generate-markdown@0.2.1
  - @amritk/generate-parsers@0.2.1

## 0.2.0

### Minor Changes

- 53fa6bf: Initial public release of the mjst toolchain: a CLI plus libraries for generating TypeScript parsers, validators, and markdown documentation from JSON Schemas.
- b6e63c3: Add `strict` option that makes generated parsers throw on invalid input instead of coercing to defaults. Available as the `--strict` CLI flag, the `strict` key in `mjst.config.json`, and the `strict` argument on `buildSchema` / `generateFile` / `generateParserFunction`. Throws on non-object input, missing required properties, wrong primitive types, and enum / pattern / length / min / max / multipleOf violations. Unknown extra keys are still allowed.

### Patch Changes

- ad1efe5: chore: initial release
- Updated dependencies [ad1efe5]
- Updated dependencies [53fa6bf]
- Updated dependencies [b6e63c3]
  - @amritk/generate-markdown@0.2.0
  - @amritk/generate-parsers@0.2.0
