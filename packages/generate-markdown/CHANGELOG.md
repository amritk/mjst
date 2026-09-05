# @amritk/generate-markdown

## 0.6.0

### Minor Changes

- c8cb8b0: The prose reference labels a map-shaped object as `Record<string, T>`.

  A property whose values are described through `additionalProperties` or
  `patternProperties` rather than named fields — `environments`, `resources`,
  every other keyed bag — rendered its **Type:** as a bare `object`. That said
  nothing about the values, and for a map of objects it left the value's fields
  (`### methods`) reading as the map's own, when they live at
  `resources.<name>.methods`; nothing on the page said the key level existed.

  `referenceType` now spells the map the way it already spells an array: `Record<
string, string>` for a map of strings, `Record<string, object>` for a map of
  objects, and `Record<string, ResourceConfig>` when the value shape carries an
  `x-doc.type`. Several `patternProperties` shapes union (`Record<string, string |
number>`), and map-ness is read without a declared `type: 'object'` too. An
  object that names `properties` beside its extras is still `object` — its rows
  document the fields — and so is a value shape with no label of its own
  (`additionalProperties: {}`), rather than `Record<string, unknown>`.

  `x-doc.type` still overrides the label wholesale. Golden fixtures regenerated;
  the only change is the **Type:** line of each map-shaped property.

## 0.5.0

### Minor Changes

- 9f1504e: Add a prose reference renderer, so a config schema can generate a full
  documentation guide rather than only a README table.

  `generateMarkdownFiles(schema, options?)` returns `{ filename, content }[]` —
  one heading per property with a **Type:** line, the description as markdown, the
  default, constraints, and a code example, split across as many markdown files as
  the schema declares. `generateDocs({ schemaPath, outDir })` writes them.
  `renderConfigTable` and `dereferenceSchema` are now exported too.

  Everything the output says comes from the schema. A single `x-doc` vendor
  extension carries what JSON Schema keywords cannot: `pages` and `sections` place
  a property, `example`/`note`/`footer` carry prose and code samples, `type`
  overrides a label JSON Schema cannot spell (`(heading: Heading) => string`),
  `layout` picks headings, a table, or nothing for a property's children, and
  `hidden`/`order`/`sort`/`heading` tune what shows and in what order. When the
  schema supplies no example, one is derived from `examples` and wrapped back into
  the shape of the config file.

  A container whose values are another container is followed as far as it goes,
  so a matrix, a list of maps, or a map of arrays documents the fields at the
  bottom of it rather than stopping at the outer shape.

  Children come from every applicator that names one, not just `properties`:
  `allOf` branches merge (properties and requirements both), `anyOf`/`oneOf`/
  `then`/`else`/`dependentSchemas` contribute properties without requirements, and
  a container's shape is read through `items`/`prefixItems`/`additionalProperties`/
  `patternProperties`, including when it sits behind a union. The same rules apply
  at the root, so a schema that is one big keyed bag documents its value shape
  instead of rendering a title and nothing else.

  Schema text is contained wherever it reaches the page: metadata labels and table
  cells go through the backtick-run-aware code span, titles and one-line labels
  collapse their line endings, fence languages are sanitised, and cross-page link
  destinations are percent-encoded. A backtick in a `default` used to close its
  code span and leave the rest of the value rendering as live markdown.

  Placement mistakes are refused rather than dropped: two pages sharing an id or
  resolving to the same file, two sections sharing an id, a page written outside
  the output directory or naming no file, and a schema nested past what the walk
  can read. A reference to an `$anchor`, or the empty pointer `#` a self-recursive schema
  uses, resolves instead of emptying the property that carried it.

  A recursive reference collapses where it repeats, labelled with the type its
  definition has and carrying that definition's documentation the way any other
  ref site does — its prose, its type label, its layout, its examples, whether it
  is hidden — plus what the definition says about the value itself (`deprecated`,
  `default`, `examples`, every constraint keyword) and what it requires, so the alternative
  beside it keeps its **Required** markers. What stays behind is what places and announces an
  occurrence rather than describing it: `x-doc.page`, `section`, `title`,
  `heading` and `order`. A reference that resolves to the document itself — `#`,
  `#/`, or the root's own `$anchor` — carries nothing, the root being a page
  configuration rather than a definition. Reading what a definition requires
  refuses to re-enter one already on the path and is worked out once per pointer,
  so a combinator language (`Filter` is `And` or `Or`, each inheriting `Filter`)
  renders instead of never finishing.

  A table row is one line, so a code block never goes in one: a description
  opening with a fenced or indented sample gives the row its first paragraph of
  prose, and the sample prints below the row with its indentation intact — it used
  to reach the reader de-indented, as live markup, and nowhere else on the page.

  In the **Type:** label an `allOf` reads as an intersection (`a & b`) rather than
  as a union, and a page file is percent-encoded as a path — `#` and `?` in a file
  name are encoded rather than left to read as a fragment and a query.

  `generateMarkdown()` — the README table — is unchanged.

### Patch Changes

- 580bbe9: Resolve `$ref` pointers the way the rest of the repo does, and stop an
  exponential inline from running forever.

  `resolvePointer` refused to index an array, so `#/$defs/timeout/anyOf/0` — an
  ordinary pointer real schemas write — silently produced a property documented as
  a bare name with no type and no description. Segments are now percent-decoded
  (`#/$defs/a%20b` addresses the definition named `a b`), array positions resolve,
  and only _own_ properties are addressable, so `#/constructor` no longer reads
  through `Object.prototype`.

  Inlining is a tree expansion: a definition reused twice at each of D nesting
  levels expands to 2^D nodes, so a 3 KB schema nested 22 deep never finished and
  one nested 16 deep quietly wrote a 29 MB README. The walk now stops at 100,000
  inlined nodes and says why — three orders of magnitude above any real config
  schema.

  The **Required** column also counted a `required` entry naming a property the
  schema does not declare, rendering a column that stayed blank on every row; it
  now counts only names `properties` actually has. Every walk over `properties`
  goes through one guard, so a malformed `properties: "ab"` no longer spells its
  characters into rows named `0` and `1`. A malformed `config.schema.json` reports
  its path instead of a bare parse offset.

## 0.4.9

### Patch Changes

- 34c5eaf: Treat OpenAPI 3.0's singular `example` as instance data alongside `examples`,
  and add `dependencies` to the schema-map keywords. A `$ref`-shaped value under
  `example` is a documented config value, not a reference to inline; and
  `dependencies` keys are trigger property names, so an entry named `default` was
  read as the data keyword and documented as a raw `{"$ref": …}` instead of the
  schema it names.

## 0.4.8

### Patch Changes

- 90645bd: Fix a set of correctness bugs in the config-table renderer, found by an audit of
  the whole package:

  - Control characters in a string `default`/`enum`/`examples` member are now
    escaped. A raw newline ended the `<table>`'s HTML block mid-row, so every tag
    after it rendered as literal text.
  - The README splice looks for the end marker _after_ the start marker. Prose
    above the region mentioning `<!-- config-table-end -->` made it slice
    backwards, duplicating the region on every run and growing the file without
    bound.
  - Property names are escaped before they reach the anchor `id`/`href` and the
    `####` heading — a name containing `"` terminated the attribute early.
  - Detail tables get unique anchor ids. A property named `a.b` and `b` nested
    under `a` both rendered as `config-a-b`, so one table was unreachable.
  - `null` inside `enum`/`examples` renders as `null` instead of being dropped and
    leaving a dangling separator.
  - `$ref`-shaped values inside `default`/`const`/`enum`/`examples` are no longer
    inlined; they are documented config values, not references. A property
    legitimately named `default` is still treated as a schema.
  - A non-string `x-cli-flag`/`x-icon` no longer throws a bare `TypeError`, an
    empty `x-cli-flag` no longer adds an always-blank column, and a schema with no
    `properties` renders instead of crashing.
  - Line endings are collapsed in _every_ cell, not just formatted values — a
    newline in a property name, `x-cli-flag`, `x-icon` or type ended the table's
    HTML block the same way.
  - A property named `__proto__` is documented instead of silently vanishing
    (plain assignment set the prototype).
  - A non-finite `default` renders the way a nested one already did, rather than
    documenting `Infinity` — which is not JSON.
  - Keywords whose value has the wrong type (`enum: "abc"`, `required: 5`,
    `description: 5`, `properties: null`) no longer throw a bare `TypeError`
    naming neither the property nor the file.
  - The `####` heading collapses line endings. It is the one place a property name
    reaches the output neither escaped nor collapsed, so a newline ended the code
    span and the rest of the name opened a fence, heading, list or raw HTML block
    that swallowed the tables below it.
  - A CRLF-authored `description` is truncated to its first paragraph, as an
    LF-authored one already was.
  - `null` members inside `anyOf`/`oneOf`/`allOf` and `properties`, and a schema
    file holding `null`, no longer throw.
  - The bootstrap README is written with the markers, so a second run can splice
    it instead of refusing to touch its own output.
  - The splice takes the start marker closest to the region rather than the
    document's first, so one quoted in a code fence above it no longer deletes
    everything in between.
  - The heading's code span uses a backtick run longer than any run in the name,
    padding where needed. A fixed single-backtick delimiter was closed by a
    backtick _in the name_, dropping the remainder into inline context where raw
    HTML, links and emphasis are live.
  - The description paragraph split recognises CR-only and whitespace-only blank
    lines, which CommonMark also treats as paragraph breaks.
  - A README that exists but cannot be read is no longer treated as absent and
    overwritten; only `ENOENT` means "safe to create one".
  - The description paragraph split normalises line endings before splitting. An
    inline alternation let the regex backtrack so a _single_ CRLF matched as a
    blank line, dropping everything after the first line break in any
    CRLF-authored description.

## 0.4.7

### Patch Changes

- 4178e8d: Patch release across all packages.

## 0.4.6

### Patch Changes

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

## 0.4.5

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

## 0.4.4

### Patch Changes

- 1901231: Ship AI-agent-facing docs. Each package now includes an `AI.md` in its published
  tarball — a mental model, a minimal runnable example, and the gotchas most
  likely to trip up an LLM — and gains `@example` JSDoc on its primary exports. A
  root `llms.txt` / `llms-full.txt` (generated by `bun run generate-llms`) indexes
  them, and `@amritk/mini` adds a `check:reactivity` guard for the compilerless-JSX
  "called signal" footgun.

## 0.4.3

### Patch Changes

- 6e7c65e: Slim published packages — comments are now stripped from the compiled JS in `dist` (they were duplicating the JSDoc that already ships in the `.d.ts` files, which is what editors read), and `@amritk/lint` now minifies its bundled OpenAPI meta-schema JSON documents. Unpacked size drops ~30% across the board (for example `@amritk/lint` 448 kB → 307 kB, `@amritk/generate-parsers` 293 kB → 191 kB) with no behavior change: declaration files keep their docs, `/* @__PURE__ */` annotations and the CLI shebang survive, and `@amritk/helpers` still ships its TypeScript sources for embedded mode.

## 0.4.2

### Patch Changes

- 4e23c02: Packaging fixes across all published packages: the `types` export condition now precedes runtime conditions (`default`/`import`) so TypeScript resolves the declared `.d.ts` explicitly instead of relying on file adjacency, and published tarballs now include the LICENSE file (copied in during the publish job).

## 0.4.1

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

## 0.4.0

### Minor Changes

- dc740e4: Only render columns and icons the schema actually uses. The **CLI Flag**,
  **Required**, and **Default** columns are now dropped entirely when no property
  anywhere in the schema fills them (the check spans nested objects so every table
  keeps a consistent shape), and properties without an `x-icon` no longer get a
  fallback icon. Empty cells are left blank instead of showing an `—` placeholder.
- 3e6f49d: Resolve `$ref`/`$defs` and infer types from composition keywords. `$ref`
  pointers are now inlined from the document's `$defs` (any `#/…` JSON pointer)
  before rendering, with recursive definitions detected and collapsed so
  generation always terminates and sibling keywords on a `$ref` (e.g.
  `description`) overriding the referenced definition. Properties that describe
  their type through `enum`, `const`, or `anyOf`/`oneOf`/`allOf` instead of a
  plain `type` now get an inferred **Type** label. This lets schemas assembled
  from reusable definitions render directly, without pre-bundling.

## 0.3.0

### Minor Changes

- 9afc4cc: Surface `enum` and `examples` in the generated property table. Each property's
  full-width detail row now appends an **Allowed:** line for `enum` values and an
  **Examples:** line for `examples`, formatted (quoted/JSON-encoded) the same way
  defaults are. The README gains an Examples section showing input schemas and
  their generated markdown for defaults, enums/examples, required properties, CLI
  flags, and nested objects.

## 0.2.4

### Patch Changes

- 6218978: chore: version bumps

## 0.2.3

### Patch Changes

- 8cde234: Re-publish all packages.

## 0.2.2

### Patch Changes

- f9c426a: Render the config reference as an HTML table with a two-row layout: each property's metadata (name, flag, type, required, default) sits on one row and its description spans the full table width on the row below. This uses vertical space better and stops the description from being squeezed into a narrow column on small screens.

## 0.2.1

### Patch Changes

- dbf49bf: Republish via npm trusted publishing (OIDC).

## 0.2.0

### Minor Changes

- 53fa6bf: Initial public release of the mjst toolchain: a CLI plus libraries for generating TypeScript parsers, validators, and markdown documentation from JSON Schemas.

### Patch Changes

- ad1efe5: chore: initial release
