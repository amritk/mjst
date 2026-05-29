---
"@amritk/runtime-validators": minor
---

Add `@amritk/runtime-validators`: an eval-free runtime JSON Schema validator for
schemas you do not know ahead of time. It interprets the schema directly — no
`new Function`, no code generation, no build step — so it has zero startup cost
and runs anywhere `eval` is forbidden (strict CSP, Cloudflare Workers, React
Native/Hermes). Two entry points: `validateGuard` (a zero-allocation boolean type
guard that short-circuits on the first failure) and `validate` (collects every
error with a JSON Pointer path). OpenAPI 3.0's `nullable: true` is honored — a
`null` value is accepted regardless of the declared `type`. It is tuned for the
cold one-shot path (validate a few values per schema), where it beats Ajv's
compile-then-validate by ~90–1600×; for one-schema-many-values throughput, a
compiling validator like Ajv or this repo's build-time `@amritk/generate-validators`
is the right tool. Parity with Ajv is enforced by a differential fuzz test
(~144k random/mutated values, zero divergences).
