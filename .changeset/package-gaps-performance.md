---
"@amritk/resolve-refs": minor
"@amritk/runtime-validators": minor
"@amritk/generate-validators": minor
"@amritk/helpers": minor
"@amritk/generate-parsers": patch
"@amritk/mjst": patch
"@amritk/adapters": patch
---

Close package gaps and add performance improvements.

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
