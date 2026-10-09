---
"@amritk/validation": minor
"@amritk/helpers": minor
"@amritk/mjst": minor
---

Name `integer` in type errors, and make the generated output compile in a strict project unchanged.

- **`type: integer` reports "must be integer".** A fractional value for an `integer` property was told it "must be number", which it already was. The validator, coercer and repairer now report the declared type (`/retries must be integer`, `must be integer or null`), as the runtime interpreter and Ajv already did. The strict parser does the same (`expected integer, got number`). This changes error text: anything that matched on the old "must be number" message for an `integer` schema needs updating.
- **The output type-checks under `noPropertyAccessFromIndexSignature`.** The generated code read properties off a `Record<string, unknown>` with a dot, which that flag rejects with `TS4111` in every generated file. Property reads now use the bracket form (`obj["name"]`), and the generated-code type tests compile with the flag on. Engines compile both forms to the same load, so this costs nothing at runtime. **Breaking for direct callers:** `safeAccessor` in `@amritk/helpers` now returns the bracket form for plain identifiers too (`input["name"]`, not `input.name`).
- **`--banner` passes line comments through.** Text that starts with `//` is emitted as written instead of wrapped in a JSDoc block, so `--banner "// @ts-nocheck"` works. Text that mixes comment and plain lines is still wrapped. TypeScript only honors that directive as a line comment.
- **Docs.** The CLI README now says up front that a project type-checking the output wants `--import-ext js`, since the `.ts` default needs `allowImportingTsExtensions`.
