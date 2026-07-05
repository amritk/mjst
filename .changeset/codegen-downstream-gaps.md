---
"@amritk/generate-parsers": patch
"@amritk/generate-validators": patch
"@amritk/generate-examples": patch
"@amritk/helpers": patch
---

Close generated-parser gaps reported from downstream use:

- **Recursive discriminated `$ref` unions** are now validated. A top-level
  `oneOf`/`anyOf` of `$ref` branches sharing a discriminator dispatches to the
  branch parsers (e.g. `_disc === "lit" ? parseLit(input) : …`) in both strict and
  non-strict mode, instead of emitting a blind `input as T` cast that let
  mis-shaped values through. A `const` discriminator tag is also predicable now,
  so a discriminated branch's shape validator is a real predicate rather than the
  `=> false` stub.
- **Strict parsers enforce array constraints** (`minItems`/`maxItems`/
  `uniqueItems`), which were silently unenforced even in `--strict`.
- **Node ESM imports**: all emitted relative imports carry a `.js` extension
  (cross-file `$ref` imports, the index barrel, embedded `_helpers`, the
  validators' `validation-result`, and the examples' arbitrary imports). Node's
  ESM resolver rejects extensionless relative specifiers.
- **Embedded-mode packaging**: `@amritk/helpers` now publishes its `src/*.ts`
  helper sources, and parser generation falls back to the always-published
  compiled `dist/*.js` when they are absent — fixing the `bunx mjst` crash that
  read an unpublished `src/is-object.ts`.
