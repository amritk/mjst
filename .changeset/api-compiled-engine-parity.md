---
"@amritk/api": minor
---

Compiled-engine parity and deployment features: `hashContracts` plus a baked `contractsHash` with an init-time staleness warning in every module `compileToModule` emits (schema edits without regeneration now surface as a `console.error` instead of silent drift); `compileExport` on `CompileModuleOptions` so a custom `ValidatorCompiler` (the runtime `compile` option) drives every guard and collector in the compiled engine too; `validateResponses` on `CompileModuleOptions` for runtime-identical reply body/header validation (`invalid_response` 500s) in the compiled engine; and `fetchToNodeHandler`, a general Node bridge that runs any fetch handler — a compiled module's `fetch` export included — under `node:http`/Express with streaming, repeated `set-cookie`, backpressure, and disconnect handling.
