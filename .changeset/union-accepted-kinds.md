---
"@amritk/validation": patch
"@amritk/runtime-validators": patch
"@amritk/mjst": patch
---

Name the kinds a union accepts when no branch takes the value's kind, and warn about `null` when moving off Ajv.

- **A failing `anyOf` / `oneOf` names the accepted kinds when the value matches none of them.** With `--branch-errors` (and always in `@amritk/runtime-validators`), a value whose kind no branch accepts used to get only "must match a schema in anyOf", which names no field and no reason. It now also gets one `type` error naming what the union accepts: `'true'` against an object-or-`false` union reports `must be object or boolean`, with `params.type` set to `['object', 'boolean']`. Kinds from a multi-type branch or a nested union are flattened into the list. Nothing is claimed when a `oneOf` failed by matching more than one branch, or when a branch could not explain itself. The generated validators and the interpreter build the same error, and the parity suite checks that.
- **Docs.** The Ajv migration notes now warn that a caller treating a rejected document as absent will silently drop any block holding a `null` that Ajv used to coerce, and say how to keep the old behavior on purpose.
