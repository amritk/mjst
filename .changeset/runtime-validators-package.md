---
"@amritk/runtime-validators": minor
---

Add `@amritk/runtime-validators`: a runtime JSON Schema validator for schemas
you do not know ahead of time. It compiles a schema into a single specialized
function via `new Function` (hoisting regexes, enum sets, and constants into the
closure so nothing recompiles per call), and exposes two entry points:
`compileGuard` (a zero-allocation boolean type guard that short-circuits on the
first failure) and `compile` (collects every error with a JSON Pointer path).
Startup cost is minimized via a lean compiler and a `WeakMap` compile cache.
Benchmarks against Ajv live in the package's `bench/` directory.
