# @amritk/generate-markdown

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
