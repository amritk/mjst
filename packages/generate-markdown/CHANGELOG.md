# @amritk/generate-markdown

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
