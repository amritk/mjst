---
"@amritk/mjst": minor
---

Add a `compile-api` subcommand — `mjst compile-api <routes-module> --out <file>` — that loads a module of `@amritk/api` route contracts and compiles them with `compileToModule` into a fused fetch-handler module, so producing the compiled engine no longer requires a hand-written build script. Supports `--routes-import`, `--options <json-file>` (spread into the compile options), `--open-api-path`, and `--max-body-bytes`.
