---
"@amritk/mjst": patch
---

Load the generator pipeline (validation engines, adapters, `$ref` resolver, AsyncAPI extraction, example and contract emitters) only once a run needs it. `mjst --help` and `mjst --version` no longer import it, which roughly halves their startup time.
