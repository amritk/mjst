---
---

Documentation-only accuracy pass over every README in the repo.

Corrected claims that had drifted from the code:

- **`@amritk/adapters`** — the Effect adapter rescues a `BigIntFromSelf` /
  `DateFromSelf` *anywhere* in the tree, not just at the top level; a nested one
  is no longer described as fatal. Fixed a stale source line anchor.
- **`@amritk/generate-markdown`** — `generateMarkdown` throws when an existing
  `README.md` lacks the marker comments; it does not overwrite it.
- **`@amritk/runtime-validators`** — documented `options.limits`
  (`maxDepth` / `maxSteps` / `allowUnsafePatterns`) and `isValidationLimitError`,
  and corrected the differential-fuzz sample size.
- **`@amritk/resolve-refs`** — replaced a stale aside about another project's
  resolver with how non-JSON documents actually work here (the `parse` option,
  as `mjst lint` uses it).
- **`@amritk/lint`** — added the missing `or` built-in function.
- **`@amritk/generate-parsers`** — the `buildSchema` table covered 6 of its 13
  positional parameters.
- **`@amritk/generate-validators`** — noted the `isX` boolean guard each
  generated file exports, and `buildValidatorSchema`'s `typeSuffix` parameter.
- **`@amritk/mjst`** — refreshed the stale `Scripts` table and corrected
  `validateXShape` to `validateX` (also in `config.schema.json`).
- **`@amritk/yaml`** — the overview's speed/size multipliers now match the
  benchmark tables below them.
- **`@amritk/api`** — documented the shipped framework-parity helpers that had
  no README coverage: `createDocs`/`docsHtml`, `createHealth`, `createETag`,
  `createCompression`, `createRequestId`/`getRequestId`, `versionRoutes`,
  `withTimeout`, `runAfterResponse`/`createBackground`, `sseStream`/`formatSse`,
  `streamMultipart`, and `negotiateMediaType`/`parseAccept`.
- **Root README** — added `@amritk/api` to the toolbox list, described
  `generate-markdown` accurately, and mentioned `mjst compile-api`.
